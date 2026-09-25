export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts
 *
 * POST /api/guilds/[guildId]/quests/[questId]/contribute
 *
 * Record a contribution to a guild quest by an authenticated guild member.
 *
 * Flow:
 *   1. Verify caller is a guild member
 *   2. Check rate limit (max 100 contributions/day per user per quest)
 *   3. Insert contribution record
 *   4. Increment quest current_count
 *   5. If quest is now complete: award guild XP, distribute coins to all members
 *   6. Award XP to the contributing user
 *   7. Return { questId, userId, newCount, isCompleted }
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, gt, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { calculateXPForAction } from "@/lib/xp/engine";
import { creditCoins } from "@/lib/economy/coins";
import { publishRealtimeEvent } from "@/lib/realtime";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

// ---------------------------------------------------------------------------
// POST /api/guilds/[guildId]/quests/[questId]/contribute
// ---------------------------------------------------------------------------

/**
 * Contribute to a guild quest. Guild member only.
 * Rate-limited to 100 contributions per day per user per quest.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: Promise<{ guildId: string; questId: string }>;
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { guildId, questId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
      const orm = await getDb();

      // 1. Verify guild membership
      const guildCheck = await orm
        .select({ id: schema.guilds.id })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!guildCheck[0]) throw notFound("Guild not found");

      const memberCheck = await orm
        .select({ role: schema.guildMembers.role })
        .from(schema.guildMembers)
        .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)))
        .limit(1);
      if (!memberCheck[0]) throw forbidden("You are not a member of this guild");

      // 2. Fetch the quest and verify it belongs to this guild and is active
      const questResult = await orm
        .select({
          id: schema.guildQuests.id,
          guildId: schema.guildQuests.guildId,
          targetCount: schema.guildQuests.targetCount,
          currentCount: schema.guildQuests.currentCount,
          rewardGuildXp: schema.guildQuests.rewardGuildXp,
          rewardCoins: schema.guildQuests.rewardCoins,
          isCompleted: schema.guildQuests.isCompleted,
          weekEnd: schema.guildQuests.weekEnd,
        })
        .from(schema.guildQuests)
        .where(and(eq(schema.guildQuests.id, questId), eq(schema.guildQuests.guildId, guildId)))
        .for("update");
      const quest = questResult[0];
      if (!quest) throw notFound("Quest not found");
      if (quest.isCompleted) throw badRequest("This quest has already been completed");

      // 3. Per-day rate limit: max 100 contributions per user per quest
      const dailyCountResult = await orm
        .select({ dailyCount: sql<number>`COUNT(*)::int` })
        .from(schema.guildQuestContributions)
        .where(
          and(
            eq(schema.guildQuestContributions.questId, questId),
            eq(schema.guildQuestContributions.userId, userId),
            gt(schema.guildQuestContributions.createdAt, sql`NOW() - INTERVAL '1 day'`)
          )
        );
      const dailyCount = dailyCountResult[0]?.dailyCount ?? 0;
      if (dailyCount >= 100) {
        throw badRequest(
          "You have reached the maximum of 100 contributions per day for this quest"
        );
      }

      // 4. Insert contribution and update quest in a transaction
      const newCount = await orm.transaction(async (tx) => {
        // Insert contribution
        await tx.insert(schema.guildQuestContributions).values({
          questId,
          userId,
          amount: 1,
        });

        // Increment quest current_count
        const updateResult = await tx
          .update(schema.guildQuests)
          .set({ currentCount: sql`${schema.guildQuests.currentCount} + 1` })
          .where(eq(schema.guildQuests.id, questId))
          .returning({ currentCount: schema.guildQuests.currentCount });
        const updatedCount = updateResult[0]?.currentCount ?? quest.currentCount + 1;

        // 5. Check for quest completion
        if (updatedCount >= quest.targetCount) {
          // Mark quest complete
          await tx
            .update(schema.guildQuests)
            .set({ isCompleted: true, completedAt: sql`NOW()` })
            .where(eq(schema.guildQuests.id, questId));

          // Award guild XP to the guild
          await tx
            .update(schema.guilds)
            .set({
              guildXp: sql`${schema.guilds.guildXp} + ${quest.rewardGuildXp}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.guilds.id, guildId));

          // Distribute reward coins to all guild members
          if (quest.rewardCoins > 0) {
            const membersResult = await tx
              .select({ userId: schema.guildMembers.userId })
              .from(schema.guildMembers)
              .where(eq(schema.guildMembers.guildId, guildId));
            const memberCount = membersResult.length;
            if (memberCount > 0) {
              const coinsPerMember = Math.floor(quest.rewardCoins / memberCount);
              if (coinsPerMember > 0) {
                // SYS-CL-05: most severe bug in the review — every member in the loop
                // shared the identical `questId` reference under transaction_type
                // 'quest_reward', so the second member's INSERT hit the unique
                // constraint and rolled back the *entire* transaction for any
                // multi-member quest. Scope the reference per member.
                for (const member of membersResult) {
                  await creditCoins(
                    member.userId,
                    coinsPerMember,
                    "quest_reward",
                    `guild_quest_reward:${questId}:${member.userId}`,
                    `Quest completion reward`,
                    { guildId, questId },
                    tx
                  );
                }
              }
            }
          }
        }

        // 6. Award XP to the contributing user (direct DB update)
        const baseXp = calculateXPForAction("guild_quest_contribution", { amount: 1 });
        if (baseXp > 0) {
          await tx
            .update(schema.users)
            .set({
              xpTotal: sql`${schema.users.xpTotal} + ${baseXp}`,
              legacyScore: sql`${schema.users.legacyScore} + ${baseXp}`,
              xpCompetitor: sql`${schema.users.xpCompetitor} + ${baseXp}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.users.id, userId));

          // xp_ledger has no `multiplier` column — naming it made this INSERT
          // throw and roll back every guild quest contribution.
          await tx.insert(schema.xpLedger).values({
            userId,
            amount: baseXp,
            track: "competitor",
            source: "guild_quest_contribution",
            baseAmount: baseXp,
          });
        }

        return updatedCount;
      });

      const isCompleted = newCount >= quest.targetCount;

      // Publish XP notification for the contributor
      const contributorXp = calculateXPForAction("guild_quest_contribution", { amount: 1 });
      if (contributorXp > 0) {
        publishRealtimeEvent(`user:${userId}`, "reward_earned", {
          type: "xp",
          amount: contributorXp,
        }).catch(() => {});
      }

      // Trigger daily quest progress for the contributor (fire-and-forget)
      void triggerActivityQuestProgress(userId, "guild_quest", orm);

      // When the guild quest completes, notify every member of their coin share
      if (isCompleted && quest.rewardCoins > 0) {
        orm
          .select({ userId: schema.guildMembers.userId })
          .from(schema.guildMembers)
          .where(eq(schema.guildMembers.guildId, guildId))
          .then((members) => {
            if (members.length === 0) return;
            const coinsPerMember = Math.floor(quest.rewardCoins / members.length);
            if (coinsPerMember <= 0) return;
            for (const member of members) {
              publishRealtimeEvent(`user:${member.userId}`, "reward_earned", {
                type: "credits",
                amount: coinsPerMember,
              }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      return NextResponse.json({
        success: true,
        data: {
          contribution: {
            questId,
            userId,
            newCount,
            isCompleted,
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

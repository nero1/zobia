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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { calculateXPForAction } from "@/lib/xp/engine";
import { creditCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestRow {
  id: string;
  guild_id: string;
  target_count: number;
  current_count: number;
  reward_guild_xp: number;
  reward_coins: number;
  is_completed: boolean;
  week_end: string;
}

interface DailyContribRow {
  daily_count: number;
}

interface MemberRow {
  user_id: string;
}

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

      // 1. Verify guild membership
      const guildCheck = await db.query<{ id: string }>(
        `SELECT id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!guildCheck.rows[0]) throw notFound("Guild not found");

      const memberCheck = await db.query<{ role: string }>(
        `SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
        [guildId, userId]
      );
      if (!memberCheck.rows[0]) throw forbidden("You are not a member of this guild");

      // 2. Fetch the quest and verify it belongs to this guild and is active
      const questResult = await db.query<QuestRow>(
        `SELECT id, guild_id, target_count, current_count, reward_guild_xp,
                reward_coins, is_completed, week_end
         FROM guild_quests
         WHERE id = $1 AND guild_id = $2
         FOR UPDATE`,
        [questId, guildId]
      );
      const quest = questResult.rows[0];
      if (!quest) throw notFound("Quest not found");
      if (quest.is_completed) throw badRequest("This quest has already been completed");

      // 3. Per-day rate limit: max 100 contributions per user per quest
      const dailyCountResult = await db.query<DailyContribRow>(
        `SELECT COUNT(*)::int AS daily_count
         FROM guild_quest_contributions
         WHERE quest_id = $1 AND user_id = $2
           AND created_at > NOW() - INTERVAL '1 day'`,
        [questId, userId]
      );
      const dailyCount = dailyCountResult.rows[0]?.daily_count ?? 0;
      if (dailyCount >= 100) {
        throw badRequest(
          "You have reached the maximum of 100 contributions per day for this quest"
        );
      }

      // 4. Insert contribution and update quest in a transaction
      const newCount = await db.transaction(async (tx) => {
        // Insert contribution
        await tx.query(
          `INSERT INTO guild_quest_contributions (quest_id, user_id, amount, created_at)
           VALUES ($1, $2, 1, NOW())`,
          [questId, userId]
        );

        // Increment quest current_count
        const updateResult = await tx.query<{ current_count: number }>(
          `UPDATE guild_quests
           SET current_count = current_count + 1
           WHERE id = $1
           RETURNING current_count`,
          [questId]
        );
        const updatedCount = updateResult.rows[0]?.current_count ?? quest.current_count + 1;

        // 5. Check for quest completion
        if (updatedCount >= quest.target_count) {
          // Mark quest complete
          await tx.query(
            `UPDATE guild_quests
             SET is_completed = TRUE, completed_at = NOW()
             WHERE id = $1`,
            [questId]
          );

          // Award guild XP to the guild
          await tx.query(
            `UPDATE guilds
             SET guild_xp = guild_xp + $1, updated_at = NOW()
             WHERE id = $2`,
            [quest.reward_guild_xp, guildId]
          );

          // Distribute reward coins to all guild members
          if (quest.reward_coins > 0) {
            const membersResult = await tx.query<MemberRow>(
              `SELECT user_id FROM guild_members WHERE guild_id = $1`,
              [guildId]
            );
            const memberCount = membersResult.rows.length;
            if (memberCount > 0) {
              const coinsPerMember = Math.floor(quest.reward_coins / memberCount);
              if (coinsPerMember > 0) {
                // SYS-CL-05: most severe bug in the review — every member in the loop
                // shared the identical `questId` reference under transaction_type
                // 'quest_reward', so the second member's INSERT hit the unique
                // constraint and rolled back the *entire* transaction for any
                // multi-member quest. Scope the reference per member.
                for (const member of membersResult.rows) {
                  await creditCoins(
                    member.user_id,
                    coinsPerMember,
                    "quest_reward",
                    `guild_quest_reward:${questId}:${member.user_id}`,
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
          await tx.query(
            `UPDATE users
             SET xp_total = xp_total + $1,
                 legacy_score = legacy_score + $1,
                 xp_competitor = xp_competitor + $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [baseXp, userId]
          );

          await tx.query(
            `INSERT INTO xp_ledger (user_id, amount, track, source, multiplier, base_amount)
             VALUES ($1, $2, 'competitor', 'guild_quest_contribution', 1.00, $2)`,
            [userId, baseXp]
          );
        }

        return updatedCount;
      });

      const isCompleted = newCount >= quest.target_count;

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

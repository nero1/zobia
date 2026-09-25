export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim/route.ts
 *
 * Season Pass milestone claim endpoint.
 *
 * GET  /api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim
 *   - Returns the milestone definition including required_plan, and whether the
 *     calling user has already claimed it.
 *
 * POST /api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim
 *   - Verifies the user has enough season XP to unlock the milestone
 *   - Checks the milestone matches the user's pass tier:
 *       · Free milestones: available to all pass holders
 *       · Paid milestones: require a paid (premium) pass
 *   - Extended rewards (required_plan = 'pro' | 'max'): require Pro or Max plan
 *   - Awards the milestone reward (coins, XP, badge, sticker pack, title) atomically
 *   - Marks the milestone as claimed (idempotent — returns 409 if already claimed)
 *
 * Security: SELECT FOR UPDATE on user_season_passes prevents race conditions.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  badRequest,
  notFound,
  conflict,
  forbidden,
} from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Reward helpers
// ---------------------------------------------------------------------------

interface MilestoneRewardPayload {
  coins?: number;
  xp?: number;
  badgeId?: string;
  stickerPackId?: string;
  title?: string;
}

/**
 * Normalise the reward JSON stored in the milestone row (jsonb column, so it
 * arrives already parsed — this just narrows/defaults the shape).
 */
function parseRewardValue(raw: unknown): MilestoneRewardPayload {
  if (!raw || typeof raw !== "object") return {};
  return raw as MilestoneRewardPayload;
}

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { seasonId: string; milestoneId: string };
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { seasonId, milestoneId } = params;
      const userId = auth.user.sub;

      const orm = await getDb();

      const result = await orm.transaction(async (tx) => {
        // 1. Verify the season exists
        const [season] = await tx
          .select({ id: schema.seasons.id, name: schema.seasons.name, isActive: schema.seasons.isActive, endsAt: schema.seasons.endsAt })
          .from(schema.seasons)
          .where(eq(schema.seasons.id, seasonId))
          .limit(1);
        if (!season) throw notFound("Season not found");

        // 2. Load the milestone definition
        const [milestone] = await tx
          .select({
            id: schema.seasonPassMilestones.id,
            seasonId: schema.seasonPassMilestones.seasonId,
            xpRequired: schema.seasonPassMilestones.milestoneXp,
            tier: schema.seasonPassMilestones.tier,
            requiredPlan: schema.seasonPassMilestones.requiredPlan,
            rewardType: schema.seasonPassMilestones.rewardType,
            rewardValue: schema.seasonPassMilestones.rewardValue,
            label: schema.seasonPassMilestones.displayName,
            sortOrder: schema.seasonPassMilestones.sortOrder,
          })
          .from(schema.seasonPassMilestones)
          .where(and(eq(schema.seasonPassMilestones.id, milestoneId), eq(schema.seasonPassMilestones.seasonId, seasonId)));
        if (!milestone) throw notFound("Milestone not found");
        const isPaidOnly = milestone.tier === "paid";

        // 3. Lock the user's season pass row (SELECT FOR UPDATE prevents races)
        const [pass] = await tx
          .select({
            id: schema.userSeasonPasses.id,
            userId: schema.userSeasonPasses.userId,
            seasonId: schema.userSeasonPasses.seasonId,
            isPaid: schema.userSeasonPasses.isPaid,
            seasonXp: schema.userSeasonPasses.seasonXp,
          })
          .from(schema.userSeasonPasses)
          .where(and(eq(schema.userSeasonPasses.userId, userId), eq(schema.userSeasonPasses.seasonId, seasonId)))
          .for("update");
        if (!pass) throw notFound("Season pass not found — purchase or unlock a pass first");

        // 4. Check pass tier eligibility
        if (isPaidOnly && !pass.isPaid) {
          throw forbidden(
            "This milestone requires the paid season pass",
            "PAID_PASS_REQUIRED"
          );
        }

        // 4b. Check Pro/Max plan requirement for extended season pass rewards (PRD §3)
        if (milestone.requiredPlan) {
          const [userPlanRow] = await tx
            .select({ plan: schema.users.plan })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .limit(1);
          const userPlan = userPlanRow?.plan ?? "free";
          const planRank: Record<string, number> = { free: 0, plus: 1, pro: 2, max: 3 };
          const requiredRank = planRank[milestone.requiredPlan] ?? 0;
          const userRank = planRank[userPlan] ?? 0;
          if (userRank < requiredRank) {
            throw forbidden("This milestone requires the Pro or Max plan");
          }
        }

        // 5. Check XP requirement
        const seasonXp = Number(pass.seasonXp);
        if (seasonXp < milestone.xpRequired) {
          throw badRequest(
            `Not enough season XP. Need ${milestone.xpRequired} XP, you have ${seasonXp}.`,
            "INSUFFICIENT_SEASON_XP"
          );
        }

        // 6. Idempotency — check if already claimed
        const [existingClaim] = await tx
          .select({ id: schema.userSeasonMilestoneClaims.id })
          .from(schema.userSeasonMilestoneClaims)
          .where(and(eq(schema.userSeasonMilestoneClaims.userId, userId), eq(schema.userSeasonMilestoneClaims.milestoneId, milestoneId)))
          .limit(1);
        if (existingClaim) {
          throw conflict("Milestone reward already claimed", "MILESTONE_ALREADY_CLAIMED");
        }

        // 7. Record the claim
        await tx.insert(schema.userSeasonMilestoneClaims).values({ userId, seasonId, milestoneId });

        // 8. Award the reward atomically
        const reward = parseRewardValue(milestone.rewardValue);
        const awardsGiven: Record<string, unknown> = {};

        // Coins reward.
        // SYS-CL-08: reference includes userId, so every user claiming the same
        // milestone doesn't collide on the coin_ledger unique index.
        if (milestone.rewardType === "coins" && reward.coins && reward.coins > 0) {
          await creditCoins(
            userId,
            reward.coins,
            "season_milestone",
            `season_milestone:${milestoneId}:${userId}`,
            `Season pass milestone: ${milestone.label ?? milestoneId}`,
            { seasonId, milestoneId },
            tx
          );
          awardsGiven.coins = reward.coins;
        }

        // XP reward
        if (milestone.rewardType === "xp" && reward.xp && reward.xp > 0) {
          await tx.insert(schema.xpLedger).values({
            userId,
            amount: reward.xp,
            track: "main",
            source: "season_milestone",
            referenceId: `season_milestone:${milestoneId}`,
            baseAmount: reward.xp,
          });
          await tx
            .update(schema.users)
            .set({ xpTotal: sql`COALESCE(${schema.users.xpTotal}, 0) + ${reward.xp}`, updatedAt: new Date() })
            .where(eq(schema.users.id, userId));
          awardsGiven.xp = reward.xp;
        }

        // Badge reward
        if (milestone.rewardType === "badge" && reward.badgeId) {
          await tx
            .insert(schema.userBadges)
            .values({ userId, badgeType: reward.badgeId, badgeKey: reward.badgeId })
            .onConflictDoNothing({
              target: [schema.userBadges.userId, schema.userBadges.badgeKey],
              where: sql`badge_key IS NOT NULL`,
            });
          awardsGiven.badgeId = reward.badgeId;
        }

        // Sticker pack reward
        // BUG-062: reward_value may store a pack name instead of a UUID.
        // Resolve to UUID by looking up by id first, then by name as fallback.
        if (milestone.rewardType === "sticker_pack" && reward.stickerPackId) {
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let resolvedPackId: string | null = UUID_RE.test(reward.stickerPackId)
            ? reward.stickerPackId
            : null;
          if (!resolvedPackId) {
            const [pack] = await tx
              .select({ id: schema.stickerPacks.id })
              .from(schema.stickerPacks)
              .where(and(eq(schema.stickerPacks.name, reward.stickerPackId), eq(schema.stickerPacks.isActive, true)))
              .limit(1);
            resolvedPackId = pack?.id ?? null;
          }
          if (resolvedPackId) {
            await tx
              .insert(schema.userStickerPacks)
              .values({ userId, packId: resolvedPackId })
              .onConflictDoNothing({
                target: [schema.userStickerPacks.userId, schema.userStickerPacks.packId],
              });
            awardsGiven.stickerPackId = resolvedPackId;
          }
        }

        // Title reward
        if (milestone.rewardType === "title" && reward.title) {
          await tx
            .insert(schema.userTitles)
            .values({ userId, title: reward.title })
            .onConflictDoNothing({
              target: [schema.userTitles.userId, schema.userTitles.title],
            });
          awardsGiven.title = reward.title;
        }

        return {
          milestoneId,
          rewardType: milestone.rewardType,
          requiredPlan: milestone.requiredPlan,
          awardsGiven,
        };
      });

      return NextResponse.json(
        {
          success: true,
          data: result,
          error: null,
        },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim
// ---------------------------------------------------------------------------

/**
 * Returns the milestone definition (including required_plan) and whether the
 * calling user has already claimed it.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { seasonId: string; milestoneId: string };
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { seasonId, milestoneId } = params;
      const userId = auth.user.sub;

      const orm = await getDb();

      // Load milestone definition
      const [milestone] = await orm
        .select({
          id: schema.seasonPassMilestones.id,
          seasonId: schema.seasonPassMilestones.seasonId,
          xpRequired: schema.seasonPassMilestones.milestoneXp,
          tier: schema.seasonPassMilestones.tier,
          requiredPlan: schema.seasonPassMilestones.requiredPlan,
          rewardType: schema.seasonPassMilestones.rewardType,
          rewardValue: schema.seasonPassMilestones.rewardValue,
          label: schema.seasonPassMilestones.displayName,
          sortOrder: schema.seasonPassMilestones.sortOrder,
        })
        .from(schema.seasonPassMilestones)
        .where(and(eq(schema.seasonPassMilestones.id, milestoneId), eq(schema.seasonPassMilestones.seasonId, seasonId)));
      if (!milestone) throw notFound("Milestone not found");

      // Check if the user has already claimed this milestone
      const [claim] = await orm
        .select({ id: schema.userSeasonMilestoneClaims.id })
        .from(schema.userSeasonMilestoneClaims)
        .where(and(eq(schema.userSeasonMilestoneClaims.userId, userId), eq(schema.userSeasonMilestoneClaims.milestoneId, milestoneId)))
        .limit(1);

      return NextResponse.json({
        success: true,
        data: {
          milestone: {
            id: milestone.id,
            seasonId: milestone.seasonId,
            xpRequired: milestone.xpRequired,
            isPaidOnly: milestone.tier === "paid",
            required_plan: milestone.requiredPlan,
            rewardType: milestone.rewardType,
            rewardValue: milestone.rewardValue ? parseRewardValue(milestone.rewardValue) : null,
            label: milestone.label,
            sortOrder: milestone.sortOrder,
          },
          claimed: Boolean(claim),
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

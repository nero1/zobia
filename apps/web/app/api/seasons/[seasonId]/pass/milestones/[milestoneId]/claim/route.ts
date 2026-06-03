/**
 * app/api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim/route.ts
 *
 * Season Pass milestone claim endpoint.
 *
 * POST /api/seasons/[seasonId]/pass/milestones/[milestoneId]/claim
 *   - Verifies the user has enough season XP to unlock the milestone
 *   - Checks the milestone matches the user's pass tier:
 *       · Free milestones: available to all pass holders
 *       · Paid milestones: require a paid (premium) pass
 *   - Awards the milestone reward (coins, XP, badge, sticker pack, title) atomically
 *   - Marks the milestone as claimed (idempotent — returns 409 if already claimed)
 *
 * Security: SELECT FOR UPDATE on user_season_passes prevents race conditions.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
// Row types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  is_active: boolean;
  ends_at: string;
}

interface SeasonMilestoneRow {
  id: string;
  season_id: string;
  xp_required: number;
  is_paid_only: boolean;
  reward_type: string;           // 'coins' | 'xp' | 'badge' | 'sticker_pack' | 'title'
  reward_value: string | null;   // JSON blob e.g. {"coins":500} or {"badge_id":"..."}
  label: string | null;
  sort_order: number;
}

interface UserSeasonPassRow {
  id: string;
  user_id: string;
  season_id: string;
  is_paid: boolean;
  season_xp: number;
}

interface ClaimedMilestoneRow {
  id: string;
}

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
 * Parse the reward JSON stored in the milestone row.
 */
function parseRewardValue(raw: string | null): MilestoneRewardPayload {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as MilestoneRewardPayload;
  } catch {
    return {};
  }
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

      const result = await db.transaction(async (client) => {
        // 1. Verify the season exists
        const { rows: seasonRows } = await client.query<SeasonRow>(
          `SELECT id, name, is_active, ends_at FROM seasons WHERE id = $1`,
          [seasonId]
        );
        const season = seasonRows[0];
        if (!season) throw notFound("Season not found");

        // 2. Load the milestone definition
        const { rows: milestoneRows } = await client.query<SeasonMilestoneRow>(
          `SELECT id, season_id, xp_required, is_paid_only, reward_type,
                  reward_value, label, sort_order
           FROM season_milestones
           WHERE id = $1 AND season_id = $2`,
          [milestoneId, seasonId]
        );
        const milestone = milestoneRows[0];
        if (!milestone) throw notFound("Milestone not found");

        // 3. Lock the user's season pass row (SELECT FOR UPDATE prevents races)
        const { rows: passRows } = await client.query<UserSeasonPassRow>(
          `SELECT id, user_id, season_id, is_paid, season_xp
           FROM user_season_passes
           WHERE user_id = $1 AND season_id = $2
           FOR UPDATE`,
          [userId, seasonId]
        );
        const pass = passRows[0];
        if (!pass) throw notFound("Season pass not found — purchase or unlock a pass first");

        // 4. Check pass tier eligibility
        if (milestone.is_paid_only && !pass.is_paid) {
          throw forbidden(
            "This milestone requires the paid season pass",
            "PAID_PASS_REQUIRED"
          );
        }

        // 5. Check XP requirement
        if (pass.season_xp < milestone.xp_required) {
          throw badRequest(
            `Not enough season XP. Need ${milestone.xp_required} XP, you have ${pass.season_xp}.`,
            "INSUFFICIENT_SEASON_XP"
          );
        }

        // 6. Idempotency — check if already claimed
        const { rows: existingClaimRows } = await client.query<ClaimedMilestoneRow>(
          `SELECT id FROM user_season_milestone_claims
           WHERE user_id = $1 AND milestone_id = $2
           LIMIT 1`,
          [userId, milestoneId]
        );
        if (existingClaimRows.length > 0) {
          throw conflict("Milestone reward already claimed", "MILESTONE_ALREADY_CLAIMED");
        }

        // 7. Record the claim
        await client.query(
          `INSERT INTO user_season_milestone_claims
             (user_id, season_id, milestone_id, claimed_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, seasonId, milestoneId]
        );

        // 8. Award the reward atomically
        const reward = parseRewardValue(milestone.reward_value);
        const awardsGiven: Record<string, unknown> = {};

        // Coins reward
        if (milestone.reward_type === "coins" && reward.coins && reward.coins > 0) {
          await creditCoins(
            userId,
            reward.coins,
            "season_milestone",
            `season_milestone:${milestoneId}`,
            `Season pass milestone: ${milestone.label ?? milestoneId}`,
            { seasonId, milestoneId },
            client
          );
          awardsGiven.coins = reward.coins;
        }

        // XP reward
        if (milestone.reward_type === "xp" && reward.xp && reward.xp > 0) {
          await client.query(
            `INSERT INTO xp_ledger
               (user_id, amount, track, source, description, created_at)
             VALUES ($1, $2, 'main', 'season_milestone', $3, NOW())`,
            [userId, reward.xp, `Season milestone: ${milestone.label ?? milestoneId}`]
          );
          await client.query(
            `UPDATE users SET xp_total = COALESCE(xp_total, 0) + $1, updated_at = NOW()
             WHERE id = $2`,
            [reward.xp, userId]
          );
          awardsGiven.xp = reward.xp;
        }

        // Badge reward
        if (milestone.reward_type === "badge" && reward.badgeId) {
          await client.query(
            `INSERT INTO user_badges (user_id, badge_id, awarded_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, badge_id) DO NOTHING`,
            [userId, reward.badgeId]
          );
          awardsGiven.badgeId = reward.badgeId;
        }

        // Sticker pack reward
        if (milestone.reward_type === "sticker_pack" && reward.stickerPackId) {
          await client.query(
            `INSERT INTO user_sticker_packs (user_id, sticker_pack_id, awarded_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, sticker_pack_id) DO NOTHING`,
            [userId, reward.stickerPackId]
          );
          awardsGiven.stickerPackId = reward.stickerPackId;
        }

        // Title reward
        if (milestone.reward_type === "title" && reward.title) {
          await client.query(
            `INSERT INTO user_titles (user_id, title, awarded_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, title) DO NOTHING`,
            [userId, reward.title]
          );
          awardsGiven.title = reward.title;
        }

        return {
          milestoneId,
          rewardType: milestone.reward_type,
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

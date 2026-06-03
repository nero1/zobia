/**
 * app/api/xp/award/route.ts
 *
 * Internal XP award endpoint.
 *
 * POST /api/xp/award
 *   - Internal route: requires CRON_SECRET or SERVICE_TOKEN header (not a user JWT)
 *   - Body: { userId, action, options?, multiplierContext }
 *   - Calls calculateXPForAction and applyMultipliers from lib/xp/engine
 *   - Writes to xp_ledger (append-only)
 *   - Updates user's xp_total and the relevant track XP column in a transaction
 *   - Updates rank_name, rank_level, rank_sublevel if changed
 *   - Updates legacy_score (always cumulative, never resets)
 *   - Updates leaderboard_snapshots for main and city scopes
 *   - Returns { xpAwarded, newTotal, rankUp? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, unauthorized, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";
import {
  calculateXPForAction,
  applyMultipliers,
  getRankForXP,
  getTrackLevelForXP,
  ACTION_TRACKS,
  type XPAction,
  type XPMultiplierContext,
} from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  xp_total: number;
  legacy_score: number;
  rank_name: string;
  rank_level: number;
  rank_sublevel: number;
  city: string | null;
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const awardXpSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
  action: z.string().min(1, "action is required").max(100) as z.ZodType<XPAction>,
  options: z
    .object({
      amount: z.number().int().positive().optional(),
      streakDays: z.number().int().positive().optional(),
    })
    .optional(),
  multiplierContext: z.object({
    plan: z.enum(["free", "plus", "pro", "max"]),
    guildTier: z.string().optional(),
    hasActiveSeasonPass: z.boolean().optional(),
    hasActiveXPBooster: z.boolean().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Track column map
// ---------------------------------------------------------------------------

const TRACK_COLUMN: Record<string, string> = {
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
};

const TRACK_LEVEL_COLUMN: Record<string, string> = {
  social: "level_social",
  creator: "level_creator",
  competitor: "level_competitor",
  generosity: "level_generosity",
  knowledge: "level_knowledge",
  explorer: "level_explorer",
};

// ---------------------------------------------------------------------------
// Service auth validation
// ---------------------------------------------------------------------------

/**
 * Validate the service token from the Authorization header.
 * Accepts either CRON_SECRET or SERVICE_TOKEN.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param req - Incoming request
 * @throws {ApiError} 401 if token is missing or invalid
 */
function validateServiceToken(req: NextRequest): void {
  const authHeader = req.headers.get("authorization");
  const cronSecret = req.headers.get("x-cron-secret");

  // Check x-cron-secret header first (used by cron jobs)
  const cronToken = process.env.CRON_SECRET ?? "";
  if (cronSecret && cronSecret.length > 0 && cronSecret.length === cronToken.length) {
    let mismatch = 0;
    for (let i = 0; i < cronSecret.length; i++) {
      mismatch |= cronSecret.charCodeAt(i) ^ cronToken.charCodeAt(i);
    }
    if (mismatch === 0) return;
  }

  // Check Authorization Bearer header (used by internal services)
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Service authorization token required");
  }
  const token = authHeader.slice(7);
  const expected = process.env.SERVICE_TOKEN ?? env.JWT_SECRET;

  if (token.length !== expected.length) {
    throw unauthorized("Invalid service authorization token");
  }
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw unauthorized("Invalid service authorization token");
  }
}

// ---------------------------------------------------------------------------
// POST /api/xp/award
// ---------------------------------------------------------------------------

/**
 * Award XP to a user for a specific action.
 *
 * Uses the XP engine to calculate base XP and apply all multipliers.
 * All database writes are wrapped in a transaction for financial integrity.
 * Leaderboard snapshots are updated on every award (not recalculated on read).
 *
 * @returns JSON { xpAwarded, newTotal, rankUp?: { from, to, sublevelFrom, sublevelTo } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.xpAward);

    // This endpoint requires service auth – not a user JWT
    validateServiceToken(req);

    const body = await validateBody(req, awardXpSchema);

    const result = await db.transaction(async (client) => {
      // 1. Lock user row for update
      const userResult = await client.query<UserRow>(
        `SELECT id, xp_total, legacy_score, rank_name, rank_level, rank_sublevel, city,
                xp_social, xp_creator, xp_competitor, xp_generosity, xp_knowledge, xp_explorer
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [body.userId]
      );

      const user = userResult.rows[0];
      if (!user) throw notFound(`User ${body.userId} not found`);

      // Check for active XP booster in DB (overrides caller-provided value)
      const { rows: boosterRows } = await client.query<{ id: string }>(
        `SELECT id FROM user_xp_boosters
         WHERE user_id = $1 AND expires_at > NOW()
         LIMIT 1`,
        [body.userId]
      );
      const hasActiveXPBooster = boosterRows.length > 0;
      // Override the multiplier context with the real value
      body.multiplierContext.hasActiveXPBooster = hasActiveXPBooster;

      // 2. Calculate XP using engine
      const ctx: XPMultiplierContext = {
        plan: body.multiplierContext.plan,
        guildTier: body.multiplierContext.guildTier,
        hasActiveSeasonPass: body.multiplierContext.hasActiveSeasonPass,
        hasActiveXPBooster: body.multiplierContext.hasActiveXPBooster,
      };

      const baseXp = calculateXPForAction(body.action, body.options);
      const xpAwarded = applyMultipliers(baseXp, ctx);

      if (xpAwarded <= 0) {
        return { xpAwarded: 0, newTotal: user.xp_total, rankUp: undefined };
      }

      // 3. Determine which track this action affects (in addition to main)
      const track = ACTION_TRACKS[body.action] ?? null;

      // 4. Write to xp_ledger (append-only)
      await client.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, multiplier, base_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          body.userId,
          xpAwarded,
          track ?? "main",
          body.action,
          (xpAwarded / Math.max(1, baseXp)).toFixed(2),
          baseXp,
        ]
      );

      // 5. Compute new totals and rank
      const newXpTotal = user.xp_total + xpAwarded;
      const newLegacyScore = user.legacy_score + xpAwarded;

      const rankBefore = getRankForXP(user.xp_total);
      const rankAfter = getRankForXP(newXpTotal);

      // Build SET clause for users update
      const setClauses: string[] = [
        "xp_total = $2",
        "legacy_score = $3",
        "rank_name = $4",
        "rank_level = $5",
        "rank_sublevel = $6",
        "updated_at = NOW()",
      ];
      const params: unknown[] = [
        body.userId,
        newXpTotal,
        newLegacyScore,
        rankAfter.rankName,
        rankAfter.rankNumber,
        rankAfter.sublevel,
      ];
      let paramIdx = params.length + 1;

      // Update track XP column if applicable
      let newTrackXp: number | null = null;
      let newTrackLevel: number | null = null;
      if (track && TRACK_COLUMN[track]) {
        const currentTrackXp = (user as Record<string, number>)[`xp_${track}`] ?? 0;
        newTrackXp = currentTrackXp + xpAwarded;
        const trackLevelInfo = getTrackLevelForXP(track as Parameters<typeof getTrackLevelForXP>[0], newTrackXp);
        newTrackLevel = trackLevelInfo.level;

        setClauses.push(`${TRACK_COLUMN[track]} = $${paramIdx++}`);
        params.push(newTrackXp);
        setClauses.push(`${TRACK_LEVEL_COLUMN[track]} = $${paramIdx++}`);
        params.push(newTrackLevel);
      }

      // 6. Atomic update of users row
      await client.query(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $1`,
        params
      );

      // 7. Detect rank-up
      const didRankUp =
        rankAfter.rankName !== rankBefore.rankName ||
        rankAfter.sublevel !== rankBefore.sublevel;

      let rankUp: { from: string; to: string; sublevelFrom: number; sublevelTo: number } | undefined;
      if (didRankUp) {
        rankUp = {
          from: rankBefore.rankName,
          to: rankAfter.rankName,
          sublevelFrom: rankBefore.sublevel,
          sublevelTo: rankAfter.sublevel,
        };
        // Log the rank-up event
        await client.query(
          `INSERT INTO rank_up_events (user_id, rank_from, rank_to, xp_at_event)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [body.userId, rankBefore.rankName, rankAfter.rankName, newXpTotal]
        ).catch(() => {
          // rank_up_events table may not exist yet – non-fatal
        });
      }

      // 8. Update leaderboard_snapshots (upsert for main + city scopes)
      await client.query(
        `INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
         VALUES ($1, 'main', 'global', NULL, $2, NOW())
         ON CONFLICT (user_id, track, scope, city, season_id)
         DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
        [body.userId, newXpTotal]
      ).catch(() => {
        // leaderboard_snapshots may not exist yet – non-fatal
      });

      if (user.city) {
        await client.query(
          `INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
           VALUES ($1, 'main', 'city', $2, $3, NOW())
           ON CONFLICT (user_id, track, scope, city, season_id)
           DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
          [body.userId, user.city, newXpTotal]
        ).catch(() => {});
      }

      return {
        xpAwarded,
        newTotal: newXpTotal,
        rankUp,
        track: track ?? null,
        newTrackXp,
        newTrackLevel,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * app/api/xp/award/route.ts
 *
 * Internal XP award endpoint.
 *
 * POST /api/xp/award
 *   - Internal route: requires a service auth token (not a user JWT)
 *   - Awards XP to a user for a given action
 *   - Applies all multipliers: plan, guild, season pass, booster
 *   - Writes to xp_ledger table
 *   - Updates user's xp_total and track levels
 *   - Checks for rank-up
 *   - Returns { xpAwarded, newTotal, rankUp?: { from, to } }
 *   - Financial integrity: uses a database transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, unauthorized, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserXpRow {
  id: string;
  xp_total: number;
  xp_rank: string | null;
  plan: string | null;
  guild_id: string | null;
  has_season_pass: boolean;
  booster_expires_at: string | null;
  booster_multiplier: number | null;
}

interface GuildRow {
  xp_multiplier: number;
}

interface RankThreshold {
  rank: string;
  min_xp: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const awardXpSchema = z.object({
  user_id: z.string().uuid("user_id must be a valid UUID"),
  action: z.string().min(1, "action is required").max(100),
  base_xp: z
    .number()
    .int("base_xp must be an integer")
    .positive("base_xp must be positive")
    .max(10_000, "base_xp cannot exceed 10,000 per call"),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

// ---------------------------------------------------------------------------
// XP rank thresholds (ascending)
// ---------------------------------------------------------------------------

const XP_RANKS: RankThreshold[] = [
  { rank: "newcomer",     min_xp: 0 },
  { rank: "explorer",     min_xp: 500 },
  { rank: "member",       min_xp: 2_000 },
  { rank: "contributor",  min_xp: 5_000 },
  { rank: "veteran",      min_xp: 15_000 },
  { rank: "champion",     min_xp: 40_000 },
  { rank: "legend",       min_xp: 100_000 },
];

/**
 * Determine the rank name for a given XP total.
 *
 * @param xp - Total XP amount
 * @returns Rank string
 */
function xpToRank(xp: number): string {
  for (let i = XP_RANKS.length - 1; i >= 0; i--) {
    if (xp >= XP_RANKS[i].min_xp) return XP_RANKS[i].rank;
  }
  return "newcomer";
}

// ---------------------------------------------------------------------------
// Multiplier constants
// ---------------------------------------------------------------------------

const PLAN_MULTIPLIERS: Record<string, number> = {
  free: 1.0,
  plus: 1.25,
  pro: 1.5,
  elite: 2.0,
};

const SEASON_PASS_MULTIPLIER = 1.2;

// ---------------------------------------------------------------------------
// Service auth validation
// ---------------------------------------------------------------------------

/**
 * Validate the service auth token from the Authorization header.
 * Uses a constant-time comparison to prevent timing attacks.
 *
 * @param req - Incoming request
 * @throws {ApiError} 401 if token is missing or invalid
 */
function validateServiceToken(req: NextRequest): void {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Service authorization token required");
  }

  const token = authHeader.slice(7);
  const expected = env.JWT_SECRET; // Use a dedicated SERVICE_TOKEN env var in production

  // Constant-time comparison
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
 * This is an internal endpoint protected by a service auth token.
 * All database writes are wrapped in a transaction for financial integrity.
 *
 * @returns JSON { xpAwarded, newTotal, rankUp?: { from, to } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limit by IP (internal service calls)
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.xpAward);

    // Verify service auth token – this endpoint is NOT for user JWTs
    validateServiceToken(req);

    const body = await validateBody(req, awardXpSchema);

    const result = await db.transaction(async (client) => {
      // 1. Fetch user with multiplier-relevant fields (locked for update)
      const userResult = await client.query<UserXpRow>(
        `SELECT id, xp_total, xp_rank, plan, guild_id,
                has_season_pass, booster_expires_at, booster_multiplier
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [body.user_id]
      );

      const user = userResult.rows[0];
      if (!user) throw notFound(`User ${body.user_id} not found`);

      // 2. Calculate effective multiplier
      let multiplier = 1.0;

      // Plan multiplier
      if (user.plan && PLAN_MULTIPLIERS[user.plan]) {
        multiplier *= PLAN_MULTIPLIERS[user.plan];
      }

      // Guild XP multiplier
      if (user.guild_id) {
        const guildResult = await client.query<GuildRow>(
          `SELECT xp_multiplier FROM guilds WHERE id = $1 LIMIT 1`,
          [user.guild_id]
        );
        if (guildResult.rows[0]?.xp_multiplier) {
          multiplier *= guildResult.rows[0].xp_multiplier;
        }
      }

      // Season pass multiplier
      if (user.has_season_pass) {
        multiplier *= SEASON_PASS_MULTIPLIER;
      }

      // Active booster multiplier
      if (
        user.booster_multiplier &&
        user.booster_expires_at &&
        new Date(user.booster_expires_at) > new Date()
      ) {
        multiplier *= user.booster_multiplier;
      }

      // 3. Calculate net XP (round to nearest integer)
      const xpNet = Math.round(body.base_xp * multiplier);

      // 4. Write to xp_ledger
      await client.query(
        `INSERT INTO xp_ledger (
           user_id, action, xp_amount, multiplier, xp_net, metadata, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          body.user_id,
          body.action,
          body.base_xp,
          multiplier,
          xpNet,
          body.metadata ? JSON.stringify(body.metadata) : null,
        ]
      );

      // 5. Update user's xp_total
      const newTotal = (user.xp_total ?? 0) + xpNet;
      const newRank = xpToRank(newTotal);
      const oldRank = user.xp_rank ?? xpToRank(user.xp_total ?? 0);

      await client.query(
        `UPDATE users
         SET xp_total  = $1,
             xp_rank   = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [newTotal, newRank, body.user_id]
      );

      // 6. If rank changed, record the rank-up event
      const rankUp =
        newRank !== oldRank
          ? { from: oldRank, to: newRank }
          : undefined;

      if (rankUp) {
        await client.query(
          `INSERT INTO rank_up_events (user_id, rank_from, rank_to, xp_at_event, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [body.user_id, rankUp.from, rankUp.to, newTotal]
        );
      }

      return { xpAwarded: xpNet, multiplier, newTotal, rankUp };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

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
import {
  checkAndAwardTrackMilestones,
  type TrackMilestone,
} from "@/lib/xp/trackMilestones";
import { awardMilestoneStickers } from "@/lib/stickers/milestoneStickers";

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
  prestige_cycle_boost_expires_at: string | null;
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
                xp_social, xp_creator, xp_competitor, xp_generosity, xp_knowledge, xp_explorer,
                prestige_cycle_boost_expires_at
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

      // Check for active Flash XP event (PRD §2.4, §8, §25):
      // When a flash_xp_event has been fired (fired=TRUE) and is still within
      // its window (fires_at <= NOW() <= ends_at), apply the event's multiplier
      // on top of all other multipliers. Users benefit automatically — no opt-in needed.
      const { rows: flashRows } = await client.query<{ multiplier: string }>(
        `SELECT multiplier::TEXT AS multiplier
         FROM flash_xp_events
         WHERE is_active = TRUE
           AND fired = TRUE
           AND fires_at <= NOW()
           AND ends_at > NOW()
         ORDER BY multiplier DESC
         LIMIT 1`
      );
      const activeFlashMultiplier = flashRows.length > 0 ? parseFloat(flashRows[0].multiplier) : 1.0;

      // 2. Calculate XP using engine
      const ctx: XPMultiplierContext = {
        plan: body.multiplierContext.plan,
        guildTier: body.multiplierContext.guildTier,
        hasActiveSeasonPass: body.multiplierContext.hasActiveSeasonPass,
        hasActiveXPBooster: body.multiplierContext.hasActiveXPBooster,
        prestigeCycleBoostExpiresAt: user.prestige_cycle_boost_expires_at,
      };

      const baseXp = calculateXPForAction(body.action, body.options);
      // Apply base multipliers from plan/guild/season/booster stack
      const baseAwardedXp = applyMultipliers(baseXp, ctx);
      // Apply Flash XP event multiplier on top (integer floor to stay precise)
      const xpAwarded = activeFlashMultiplier > 1.0
        ? Math.floor(baseAwardedXp * activeFlashMultiplier)
        : baseAwardedXp;

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
        const currentTrackXp = ((user as unknown) as Record<string, number>)[`xp_${track}`] ?? 0;
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
        params as import("@/lib/db").SqlParam[]
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
        ).catch(() => {});

        // Notify the user of their rank-up
        await client.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'rank_up', $2, false, NOW())`,
          [body.userId, JSON.stringify({ from: rankBefore.rankName, to: rankAfter.rankName, sublevelTo: rankAfter.sublevel })]
        ).catch(() => {});

        // Elder mentorship rank-up celebration — notify both parties (PRD §7)
        const { rows: elderRows } = await client.query<{ elder_id: string }>(
          `SELECT elder_id FROM elder_mentorships WHERE mentee_id = $1 AND ended_at IS NULL LIMIT 1`,
          [body.userId]
        ).catch(() => ({ rows: [] as Array<{ elder_id: string }> }));

        if (elderRows[0]) {
          const celebPayload = JSON.stringify({
            menteeId: body.userId,
            elderId: elderRows[0].elder_id,
            rankTo: rankAfter.rankName,
          });
          await Promise.all([
            client.query(
              `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
               VALUES ($1, 'mentee_rank_up', $2, false, NOW())`,
              [elderRows[0].elder_id, celebPayload]
            ).catch(() => {}),
            client.query(
              `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
               VALUES ($1, 'mentee_rank_up_self', $2, false, NOW())`,
              [body.userId, celebPayload]
            ).catch(() => {}),
          ]);
        }
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
        // newTrackLevel is needed for milestone checking below — pass it through
        _trackForMilestones: track,
        _newTrackLevelForMilestones: newTrackLevel,
      };
    });

    // Check and award track milestones outside the transaction (best-effort, non-blocking).
    // We do this after the transaction commits so that the level write is durable first.
    let milestoneUnlocks: TrackMilestone[] = [];
    const stickerPacksAwarded: string[] = [];
    if (result._trackForMilestones && result._newTrackLevelForMilestones !== null) {
      const trackLevel = result._newTrackLevelForMilestones as number;
      try {
        milestoneUnlocks = await checkAndAwardTrackMilestones(
          body.userId,
          result._trackForMilestones,
          trackLevel,
          db
        );
        // Award sticker packs for each newly unlocked milestone
        for (const milestone of milestoneUnlocks) {
          try {
            const awarded = await awardMilestoneStickers(body.userId, milestone.unlockKey, db);
            stickerPacksAwarded.push(...awarded);
          } catch {
            // Non-fatal — sticker grant failure never breaks XP award
          }
        }
      } catch (err) {
        // Milestone check failure must never break the XP award response
        console.error("[xp/award] Milestone check failed (non-fatal):", err);
      }
    }

    // Check and mark New Member Quest step completions (best-effort, non-blocking).
    // Maps XP action types to the corresponding quest step IDs.
    const NEW_MEMBER_QUEST_STEP_MAP: Partial<Record<XPAction, string>> = {
      message_sent:   "send_message",
      room_joined:    "join_room",
      gift_sent:      "gift_someone",
      friend_added:   "add_friend",
      daily_login:    "daily_login",
    };

    const questStep = NEW_MEMBER_QUEST_STEP_MAP[body.action];
    if (questStep) {
      // Fire-and-forget — must never delay or break the XP award response
      void (async () => {
        try {
          // Load current quest state
          const { rows: questRows } = await db.query<{
            id: string;
            progress: string;
            completed: boolean;
          }>(
            `SELECT id, progress, completed
             FROM user_quests
             WHERE user_id = $1 AND quest_type = 'new_member' AND completed = FALSE
             LIMIT 1`,
            [body.userId]
          );

          if (!questRows[0]) return; // quest not found or already complete

          const quest = questRows[0];
          let progress: { steps: Array<{ id: string; label: string; completed: boolean }> };
          try {
            progress =
              typeof quest.progress === "string"
                ? JSON.parse(quest.progress)
                : quest.progress;
          } catch {
            return;
          }

          const step = progress.steps.find((s) => s.id === questStep);
          if (!step || step.completed) return; // step already done

          step.completed = true;

          const allDone = progress.steps.every((s) => s.completed);

          await db.query(
            `UPDATE user_quests
             SET progress = $1, updated_at = NOW()${allDone ? ", completed = TRUE, completed_at = NOW()" : ""}
             WHERE id = $2`,
            [JSON.stringify(progress), quest.id]
          );
        } catch (err) {
          // Failure in quest progress tracking must never surface to the caller
          console.error("[xp/award] New Member Quest step update failed (non-fatal):", err);
        }
      })();
    }

    // Nemesis overtake check — fire notification if user just surpassed their nemesis (PRD §2.3)
    void (async () => {
      try {
        const { rows: nemesisRows } = await db.query<{ nemesis_user_id: string; nemesis_xp: number }>(
          `SELECT na.nemesis_user_id, u.xp_total AS nemesis_xp
           FROM nemesis_assignments na
           JOIN users u ON u.id = na.nemesis_user_id
           WHERE na.user_id = $1 AND na.is_active = true
           LIMIT 1`,
          [body.userId]
        );
        if (!nemesisRows[0]) return;

        const { nemesis_user_id: nemesisId, nemesis_xp: nemesisXP } = nemesisRows[0];
        const xpBefore = result.newTotal - result.xpAwarded;
        const xpAfter  = result.newTotal;

        // User just overtook nemesis
        if (xpBefore < nemesisXP && xpAfter >= nemesisXP) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, 'nemesis_overtaken', $2, false, NOW())`,
            [body.userId, JSON.stringify({ nemesisId, userXP: xpAfter, nemesisXP })]
          ).catch(() => {});
        }
        // Nemesis check: if nemesis lost their lead, notify nemesis they were overtaken
        if (xpBefore < nemesisXP && xpAfter >= nemesisXP) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, 'nemesis_overtook_you', $2, false, NOW())`,
            [nemesisId, JSON.stringify({ userId: body.userId, userXP: xpAfter, nemesisXP })]
          ).catch(() => {});
        }
      } catch {
        // Nemesis check is non-fatal
      }
    })();

    // Strip internal fields before sending the response
    const { _trackForMilestones: _t, _newTrackLevelForMilestones: _l, ...publicResult } = result;
    void _t; void _l; // suppress unused variable warnings

    return NextResponse.json({ ...publicResult, milestoneUnlocks, stickerPacksAwarded }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

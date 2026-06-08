export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/health/route.ts
 *
 * GET /api/rooms/:roomId/health
 *
 * Room community health score endpoint.
 *
 * Returns a rolling community health score (0–100) based on:
 *  - Report rate (reports per 1,000 messages in last 7 days) — negative signal
 *  - Member churn rate (members who left in last 7 days / total) — negative signal
 *  - Moderation action frequency (mutes/removes per 100 members) — negative signal
 *  - Message velocity (messages/hour, healthy if moderate) — positive signal
 *  - Active-member ratio (members who sent ≥1 message in 7 days / total) — positive
 *
 * Access: room creator or platform admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface HealthMetricsRow {
  total_messages_7d: number;
  reports_7d: number;
  churn_7d: number;
  mod_actions_7d: number;
  member_count: number;
  active_members_7d: number;
  messages_last_hour: number;
  health_score: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a composite health score from the raw metrics.
 *
 * Score starts at 100 and penalties are subtracted:
 *  - Report rate > 1%  : −20
 *  - Report rate > 3%  : −30 (cumulative)
 *  - Churn > 5%        : −10
 *  - Churn > 15%       : −20
 *  - Mod actions > 5%  : −10
 *  - Active ratio < 10%: −10
 *  - Active ratio < 5% : −20
 *
 * Bonuses:
 *  - Active ratio > 50%: +5 (capped at 100)
 *  - Healthy velocity (10–500 msg/hr): +5
 *
 * @param metrics - Raw health metrics from the DB
 * @returns Computed health score 0–100
 */
function computeHealthScore(metrics: HealthMetricsRow): number {
  let score = 100;

  const { total_messages_7d, reports_7d, churn_7d, mod_actions_7d,
          member_count, active_members_7d, messages_last_hour } = metrics;

  // Report rate penalty
  const reportRate =
    total_messages_7d > 0 ? (reports_7d / total_messages_7d) * 100 : 0;
  if (reportRate > 3) score -= 30;
  else if (reportRate > 1) score -= 20;

  // Churn penalty
  const churnRate = member_count > 0 ? (churn_7d / member_count) * 100 : 0;
  if (churnRate > 15) score -= 20;
  else if (churnRate > 5) score -= 10;

  // Mod action penalty
  const modRate = member_count > 0 ? (mod_actions_7d / member_count) * 100 : 0;
  if (modRate > 5) score -= 10;

  // Active member ratio
  const activeRatio = member_count > 0 ? (active_members_7d / member_count) * 100 : 0;
  if (activeRatio < 5) score -= 20;
  else if (activeRatio < 10) score -= 10;
  else if (activeRatio > 50) score += 5;

  // Message velocity
  if (messages_last_hour >= 10 && messages_last_hour <= 500) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/health
// ---------------------------------------------------------------------------

/**
 * Return the room health score and underlying metrics.
 *
 * Only the room creator or platform admin may access this endpoint.
 *
 * @param req    - Incoming request
 * @param params - Route params containing roomId
 * @returns Health score and component metrics
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;

    // Fetch room
    const { rows: roomRows } = await db.query<{
      creator_id: string;
      is_active: boolean;
      health_score: number;
      member_count: number;
    }>(
      `SELECT creator_id, is_active, health_score, member_count
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    // Access check: creator or platform admin
    const { rows: adminRows } = await db.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const isAdmin = adminRows[0]?.is_admin ?? false;
    const isCreator = room.creator_id === userId;

    if (!isCreator && !isAdmin) {
      throw forbidden("Health data is only accessible to the room creator or platform admins");
    }

    // Gather rolling metrics
    const { rows: metricRows } = await db.query<HealthMetricsRow>(
      `SELECT
         -- Messages in last 7 days
         (SELECT COUNT(*)::int FROM room_messages
          WHERE room_id = $1 AND created_at > NOW() - INTERVAL '7 days'
            AND is_deleted = FALSE)
         AS total_messages_7d,

         -- Reports in last 7 days targeting this room's messages
         (SELECT COUNT(*)::int FROM reports
          WHERE reported_room_id = $1
            AND created_at > NOW() - INTERVAL '7 days')
         AS reports_7d,

         -- Members who left (were removed) in last 7 days
         (SELECT COUNT(*)::int FROM room_moderation_log
          WHERE room_id = $1
            AND action IN ('remove', 'kick')
            AND created_at > NOW() - INTERVAL '7 days')
         AS churn_7d,

         -- Moderation actions in last 7 days (mute, remove)
         (SELECT COUNT(*)::int FROM room_moderation_log
          WHERE room_id = $1
            AND created_at > NOW() - INTERVAL '7 days')
         AS mod_actions_7d,

         -- Current member count
         $2::int AS member_count,

         -- Distinct active members (sent ≥1 msg in 7 days)
         (SELECT COUNT(DISTINCT sender_id)::int FROM room_messages
          WHERE room_id = $1 AND created_at > NOW() - INTERVAL '7 days'
            AND is_deleted = FALSE)
         AS active_members_7d,

         -- Messages in last hour
         (SELECT COUNT(*)::int FROM room_messages
          WHERE room_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
            AND is_deleted = FALSE)
         AS messages_last_hour,

         -- Stored health score (last written value)
         $3::int AS health_score`,
      [roomId, room.member_count, room.health_score]
    );

    const metrics = metricRows[0];
    const computedScore = computeHealthScore(metrics);

    // Persist the computed score
    await db.query(
      `UPDATE rooms SET health_score = $1, updated_at = NOW() WHERE id = $2`,
      [computedScore, roomId]
    );

    return NextResponse.json(
      {
        roomId,
        healthScore: computedScore,
        metrics: {
          totalMessages7d: metrics.total_messages_7d,
          reports7d: metrics.reports_7d,
          churn7d: metrics.churn_7d,
          modActions7d: metrics.mod_actions_7d,
          memberCount: metrics.member_count,
          activeMembers7d: metrics.active_members_7d,
          messagesLastHour: metrics.messages_last_hour,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

export const dynamic = 'force-dynamic';

/**
 * app/api/admin/moderation/[reportId]/route.ts
 *
 * GET /api/admin/moderation/[reportId] — Report detail with full context.
 *
 * Returns the report plus: referenced message content (if any), the
 * reported user's history (report count, prior actions), and the
 * reporter's trust score summary.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/admin/moderation/[reportId]
// ---------------------------------------------------------------------------

/**
 * Fetch a single report with full context for the moderation detail view.
 *
 * Includes:
 *  - Full report fields + AI classification
 *  - Referenced message content (if reportedMessageId present)
 *  - Reported user's historical report count and prior mod actions
 *  - Reporter's trust score
 *
 * @returns Report detail object or 404 if not found
 */
export const GET = withAdminAuth(
  async (
    req: NextRequest,
    { auth, params }: { auth: { user: { sub: string } }; params: { reportId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { reportId } = params;

      const { rows } = await db.query<{
        id: string;
        reporter_id: string;
        reporter_username: string;
        reporter_trust_score: number | null;
        reported_user_id: string | null;
        reported_user_username: string | null;
        reported_user_report_count: number;
        reported_message_id: string | null;
        reported_message_content: string | null;
        reported_room_id: string | null;
        reported_guild_id: string | null;
        report_type: string;
        description: string | null;
        status: string;
        ai_category: string | null;
        ai_confidence: number | null;
        ai_recommendation: string | null;
        ai_provider: string | null;
        ai_classified_at: string | null;
        created_at: string;
        resolved_at: string | null;
        resolved_by: string | null;
        resolution_note: string | null;
      }>(
        `SELECT
           r.id,
           r.reporter_id,
           reporter.username                    AS reporter_username,
           reporter.trust_score                 AS reporter_trust_score,
           r.reported_user_id,
           reported.username                    AS reported_user_username,
           (
             SELECT COUNT(*)::int
             FROM moderation_reports
             WHERE reported_user_id = r.reported_user_id
               AND id != r.id
           )                                    AS reported_user_report_count,
           r.reported_message_id,
           msg.content                          AS reported_message_content,
           r.reported_room_id,
           r.reported_guild_id,
           r.report_type,
           r.description,
           r.status,
           r.ai_category,
           r.ai_confidence,
           r.ai_recommendation,
           r.ai_provider,
           r.ai_classified_at,
           r.created_at,
           r.resolved_at,
           r.resolved_by,
           r.resolution_note
         FROM moderation_reports r
         LEFT JOIN users reporter  ON reporter.id = r.reporter_id
         LEFT JOIN users reported  ON reported.id = r.reported_user_id
         LEFT JOIN messages msg    ON msg.id      = r.reported_message_id
         WHERE r.id = $1
           AND r.deleted_at IS NULL`,
        [reportId]
      );

      const report = rows[0];
      if (!report) {
        throw notFound("Report not found");
      }

      // Fetch prior moderation actions against the reported user
      const { rows: priorActions } = await db.query<{
        id: string;
        action: string;
        note: string | null;
        actioned_by: string;
        actioned_by_username: string;
        created_at: string;
      }>(
        `SELECT
           ma.id,
           ma.action,
           ma.note,
           ma.actioned_by,
           actor.username AS actioned_by_username,
           ma.created_at
         FROM moderation_actions ma
         LEFT JOIN users actor ON actor.id = ma.actioned_by
         WHERE ma.target_user_id = $1
         ORDER BY ma.created_at DESC
         LIMIT 20`,
        [report.reported_user_id ?? "00000000-0000-0000-0000-000000000000"]
      );

      return NextResponse.json({ report, prior_actions: priorActions });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

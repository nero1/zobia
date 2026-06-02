/**
 * app/api/admin/moderation/[reportId]/action/route.ts
 *
 * POST /api/admin/moderation/[reportId]/action — Take a moderation action.
 *
 * Actions:
 *  - dismiss          — No violation found; close the report
 *  - warn             — Issue a warning to the reported user
 *  - remove_content   — Delete the reported message/content
 *  - suspend_user     — Temporarily suspend the reported user
 *  - ban_user         — Permanently ban the reported user
 *
 * All actions are logged to moderation_actions for audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ActionBodySchema = z.object({
  action: z.enum([
    "dismiss",
    "warn",
    "remove_content",
    "suspend_user",
    "ban_user",
  ]),
  /** Optional moderator note, visible in audit log. */
  note: z.string().max(500).optional(),
  /** Duration in hours — required for suspend_user. */
  duration_hours: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/admin/moderation/[reportId]/action
// ---------------------------------------------------------------------------

/**
 * Apply a moderation action to a pending report.
 *
 * Records the action in moderation_actions and updates the report status.
 * For suspend_user/ban_user, updates the users table accordingly.
 * For remove_content, soft-deletes the referenced message.
 *
 * @returns Updated report status + action record
 */
export const POST = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: {
      auth: { user: { sub: string } };
      params: { reportId: string };
    }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { reportId } = params;

      const body = await req.json().catch(() => ({}));
      const parsed = ActionBodySchema.safeParse(body);
      if (!parsed.success) {
        return badRequest("Invalid action payload", parsed.error.flatten());
      }

      const { action, note, duration_hours } = parsed.data;

      if (action === "suspend_user" && !duration_hours) {
        return badRequest("duration_hours is required for suspend_user");
      }

      // Load the report
      const { rows: reportRows } = await db.query<{
        id: string;
        reported_user_id: string | null;
        reported_message_id: string | null;
        status: string;
      }>(
        `SELECT id, reported_user_id, reported_message_id, status
         FROM moderation_reports
         WHERE id = $1 AND deleted_at IS NULL`,
        [reportId]
      );

      const report = reportRows[0];
      if (!report) {
        return notFound("Report not found");
      }

      if (report.status !== "pending") {
        return badRequest(`Report is already ${report.status}`);
      }

      // Execute within a transaction
      await db.transaction(async (tx) => {
        // 1. Log the moderation action
        await tx.query(
          `INSERT INTO moderation_actions
             (report_id, target_user_id, action, note, duration_hours,
              actioned_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            reportId,
            report.reported_user_id ?? null,
            action,
            note ?? null,
            duration_hours ?? null,
            auth.user.sub,
          ]
        );

        // 2. Update report status
        const resolvedStatus =
          action === "dismiss" ? "dismissed" : "resolved";
        await tx.query(
          `UPDATE moderation_reports
           SET status        = $1,
               resolved_at   = NOW(),
               resolved_by   = $2,
               resolution_note = $3
           WHERE id = $4`,
          [resolvedStatus, auth.user.sub, note ?? null, reportId]
        );

        // 3. Apply side effects
        if (report.reported_user_id) {
          if (action === "warn") {
            await tx.query(
              `UPDATE users
               SET warning_count = COALESCE(warning_count, 0) + 1
               WHERE id = $1`,
              [report.reported_user_id]
            );
          } else if (action === "suspend_user" && duration_hours) {
            const suspendUntil = new Date(
              Date.now() + duration_hours * 60 * 60 * 1000
            ).toISOString();
            await tx.query(
              `UPDATE users
               SET suspended_until = $1, is_suspended = true
               WHERE id = $2`,
              [suspendUntil, report.reported_user_id]
            );
          } else if (action === "ban_user") {
            await tx.query(
              `UPDATE users
               SET is_banned = true, banned_at = NOW(), banned_by = $1
               WHERE id = $2`,
              [auth.user.sub, report.reported_user_id]
            );
          }
        }

        // 4. Remove content if requested
        if (
          action === "remove_content" &&
          report.reported_message_id
        ) {
          await tx.query(
            `UPDATE messages
             SET deleted_at = NOW(), deleted_by = $1
             WHERE id = $2`,
            [auth.user.sub, report.reported_message_id]
          );
        }
      });

      return NextResponse.json({
        ok: true,
        reportId,
        action,
        applied_at: new Date().toISOString(),
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

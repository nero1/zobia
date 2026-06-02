/**
 * app/api/admin/alerts/[alertId]/resolve/route.ts
 *
 * POST /api/admin/alerts/[alertId]/resolve
 *
 * Marks a system alert as resolved.
 * Admin-only — is_admin verified from DATABASE.
 *
 * Body (optional): { note: string }
 *
 * Response: { alertId: string, resolvedAt: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  withAdminAuth,
  validateBody,
  type AdminContext,
} from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const resolveAlertSchema = z.object({
  /** Optional admin note explaining the resolution. */
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Resolve a system alert with an optional admin note.
 * Admin-only — is_admin verified from DATABASE by withAdminAuth middleware.
 * Idempotent: resolving an already-resolved alert returns success.
 */
export const POST = withAdminAuth(
  async (
    req: NextRequest,
    ctx: AdminContext,
    params: { alertId: string }
  ) => {
    try {
      const { alertId } = params;

      // Parse optional body (note field)
      let note: string | undefined;
      try {
        const body = await validateBody(req, resolveAlertSchema);
        note = body.note;
      } catch {
        // Body is optional — proceed without note if parsing fails
      }

      const resolvedAt = new Date().toISOString();

      const result = await db.query<{ id: string; resolved: boolean }>(
        `UPDATE system_alerts
         SET resolved        = true,
             resolved_at     = $1,
             resolved_by     = $2,
             resolution_note = $3,
             updated_at      = NOW()
         WHERE id = $4
         RETURNING id, resolved`,
        [resolvedAt, ctx.user.sub, note ?? null, alertId]
      );

      if (result.rows.length === 0) {
        throw badRequest(`Alert '${alertId}' not found.`, "ALERT_NOT_FOUND");
      }

      return NextResponse.json({
        success: true,
        data: {
          alertId,
          resolvedAt,
          resolvedBy: ctx.user.sub,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

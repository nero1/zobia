export const dynamic = 'force-dynamic';

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
 *
 * NOTE: `lib/db/schema.ts`'s `systemAlerts` table is missing several
 * columns this route needs (escalation_complete, next_escalation_at, and
 * the rest of the Level 1/2 escalation-schedule columns used by
 * ../route.ts) — a genuine schema gap. Kept as a raw SQL statement executed
 * via `orm.execute(sql...)` (getDb()'s pg pool) rather than `db.query`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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
    { params, auth }: { params: { alertId: string }; auth: { user: { sub: string }; isAdmin: true } }
  ) => {
    try {
      const { alertId } = await params as { alertId: string };

      // Parse optional body (note field)
      let note: string | undefined;
      try {
        const body = await validateBody(req, resolveAlertSchema);
        note = body.note;
      } catch {
        // Body is optional — proceed without note if parsing fails
      }

      const resolvedAt = new Date().toISOString();

      const orm = await getDb();

      // Resolving stops the Level 1/2 escalation schedule immediately — no more
      // pages for this alert until a fresh trigger reopens it (see raiseAlert()).
      const result = await orm.execute<{ id: string; resolved: boolean }>(sql`
        UPDATE system_alerts
        SET resolved            = true,
            resolved_at         = ${resolvedAt},
            resolved_by         = ${auth.user.sub},
            resolution_note     = ${note ?? null},
            escalation_complete = true,
            next_escalation_at  = NULL,
            updated_at          = NOW()
        WHERE id = ${alertId}
        RETURNING id, resolved
      `);

      if (result.rows.length === 0) {
        throw badRequest(`Alert '${alertId}' not found.`, "ALERT_NOT_FOUND");
      }

      return NextResponse.json({
        success: true,
        data: {
          alertId,
          resolvedAt,
          resolvedBy: auth.user.sub,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

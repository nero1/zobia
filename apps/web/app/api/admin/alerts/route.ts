export const dynamic = 'force-dynamic';

/**
 * app/api/admin/alerts/route.ts
 *
 * Admin-only system alert endpoints.
 *
 * GET  /api/admin/alerts
 *   Returns all active (unresolved) system alerts.
 *   Admin-only — is_admin verified from DATABASE.
 *   Response: { alerts: Alert[] }
 *
 * POST /api/admin/alerts/[alertId]/resolve  →  see [alertId]/resolve/route.ts
 *   Marks an alert resolved with an optional admin note.
 *
 * Alert types include:
 *  - payout_low_balance: Treasury balance below configured threshold
 *  - ai_provider_failure: Both AI providers (DeepSeek + Gemini) failing
 *  - cron_failure: A scheduled CRON job failed or did not run
 *  - moderation_queue_spike: Pending report count exceeded threshold
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
}

interface Alert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/alerts
// ---------------------------------------------------------------------------

/**
 * Returns all active system alerts for the admin dashboard.
 * Admin-only — is_admin verified from DATABASE by withAdminAuth middleware.
 */
export const GET = withAdminAuth(async (req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
  try {
    const { searchParams } = new URL(req.url);
    const includeResolved = searchParams.get("include_resolved") === "true";

    const whereClause = includeResolved ? "" : "WHERE resolved = false";

    const result = await db.query<AlertRow>(
      `SELECT id, type, severity, message, metadata,
              resolved, resolved_at, resolved_by, resolution_note, created_at
       FROM system_alerts
       ${whereClause}
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'warning'  THEN 2
           WHEN 'info'     THEN 3
           ELSE 4
         END,
         created_at DESC
       LIMIT 200`
    );

    const alerts: Alert[] = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity as Alert["severity"],
      message: row.message,
      metadata: row.metadata,
      resolved: row.resolved,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: { alerts, total: alerts.length },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

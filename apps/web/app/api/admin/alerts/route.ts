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
 *
 * NOTE: `lib/db/schema.ts`'s `systemAlerts` table only defines
 * id/type/severity/message/metadata/resolved/resolvedAt/resolvedBy/
 * resolutionNote/createdAt/updatedAt — it is missing title, priority_level,
 * category, notify_admin, notify_mods, escalation_stage, escalation_phase,
 * escalation_complete, next_escalation_at, first_notified_at,
 * last_notified_at, sms_sent_count, channels_sent, all of which this route
 * reads. This is a genuine schema gap. Kept as a raw SQL statement executed
 * via `orm.execute(sql...)` (getDb()'s pg pool) rather than `db.query`.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  priority_level: number;
  category: string;
  notify_admin: boolean;
  notify_mods: boolean;
  escalation_stage: number;
  escalation_phase: string;
  escalation_complete: boolean;
  next_escalation_at: string | null;
  first_notified_at: string | null;
  last_notified_at: string | null;
  sms_sent_count: number;
  channels_sent: string[] | null;
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
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  priorityLevel: number;
  category: string;
  notifyAdmin: boolean;
  notifyMods: boolean;
  escalationStage: number;
  escalationPhase: string;
  escalationComplete: boolean;
  nextEscalationAt: string | null;
  firstNotifiedAt: string | null;
  lastNotifiedAt: string | null;
  smsSentCount: number;
  channelsSent: string[];
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

    const orm = await getDb();
    const whereClause = includeResolved ? sql`` : sql`WHERE resolved = false`;

    const result = await orm.execute(sql`
      SELECT id, type, severity, title, message, metadata, priority_level, category,
             notify_admin, notify_mods, escalation_stage, escalation_phase, escalation_complete,
             next_escalation_at, first_notified_at, last_notified_at, sms_sent_count, channels_sent,
             resolved, resolved_at, resolved_by, resolution_note, created_at
      FROM system_alerts
      ${whereClause}
      ORDER BY priority_level ASC, created_at DESC
      LIMIT 200
    `);

    const alerts: Alert[] = (result.rows as unknown as AlertRow[]).map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity as Alert["severity"],
      title: row.title,
      message: row.message,
      metadata: row.metadata,
      priorityLevel: row.priority_level,
      category: row.category,
      notifyAdmin: row.notify_admin,
      notifyMods: row.notify_mods,
      escalationStage: row.escalation_stage,
      escalationPhase: row.escalation_phase,
      escalationComplete: row.escalation_complete,
      nextEscalationAt: row.next_escalation_at,
      firstNotifiedAt: row.first_notified_at,
      lastNotifiedAt: row.last_notified_at,
      smsSentCount: row.sms_sent_count,
      channelsSent: row.channels_sent ?? [],
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

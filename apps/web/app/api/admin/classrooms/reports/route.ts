export const dynamic = "force-dynamic";

/**
 * app/api/admin/classrooms/reports/route.ts
 *
 * GET /api/admin/classrooms/reports?scope=escalated|pending|resolved
 *
 * Platform-wide view of classroom community reports for staff
 * (/gate44/classrooms). Classroom creators/moderators handle their own
 * queue in the creator panel; staff see everything, with items that
 * collected 3+ reports flagged `escalated` and listed first.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb } from "@/lib/db/drizzle";
import { REPORT_SELECT, toReportView, type ReportRow } from "@/lib/classroom/community";

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const scope = new URL(req.url).searchParams.get("scope") ?? "escalated";
    const where =
      scope === "resolved"
        ? sql`r.status <> 'pending'`
        : scope === "pending"
          ? sql`r.status = 'pending'`
          : sql`r.status = 'pending' AND r.escalated = TRUE`;

    const orm = await getDb();
    const { rows } = await orm.execute<ReportRow>(sql`
      ${sql.raw(REPORT_SELECT)}
       WHERE ${where}
       ORDER BY r.escalated DESC, r.created_at DESC
       LIMIT 200
    `);
    return NextResponse.json({ success: true, data: { reports: rows.map(toReportView) }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

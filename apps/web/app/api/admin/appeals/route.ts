export const dynamic = "force-dynamic";

/**
 * GET /api/admin/appeals
 *
 * Admin/moderator: list account (suspension/ban) appeals.
 *
 * Query params:
 *   status — filter by status (default: "pending"); use "all" for no filter
 *   limit  — max records (default 50, max 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface AdminAppealRow {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  is_suspended: boolean;
  is_banned: boolean;
  suspension_reason: string | null;
  suspended_until: string | null;
  ban_reason: string | null;
  appeal_type: string;
  reason: string;
  contact_email: string | null;
  status: string;
  refusal_count: number;
  ai_triage_result: Record<string, unknown> | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (status !== "all") {
      conditions.push(`aa.status = $${params.length + 1}`);
      params.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const { rows } = await db.query<AdminAppealRow>(
      `SELECT aa.id, aa.user_id, u.username, u.email,
              u.is_suspended, u.is_banned, u.suspension_reason, u.suspended_until, u.ban_reason,
              aa.appeal_type, aa.reason, aa.contact_email, aa.status, aa.refusal_count,
              aa.ai_triage_result, aa.admin_notes, aa.reviewed_by, aa.reviewed_at,
              aa.created_at, aa.updated_at
       FROM account_appeals aa
       JOIN users u ON u.id = aa.user_id
       ${whereClause}
       ORDER BY aa.created_at ASC
       LIMIT $${params.length}`,
      params
    );

    return NextResponse.json({
      success: true,
      data: {
        appeals: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          email: r.email,
          currentlySuspended: r.is_suspended,
          currentlyBanned: r.is_banned,
          suspensionReason: r.suspension_reason,
          suspendedUntil: r.suspended_until,
          banReason: r.ban_reason,
          appealType: r.appeal_type,
          reason: r.reason,
          contactEmail: r.contact_email,
          status: r.status,
          refusalCount: r.refusal_count,
          aiTriageResult: r.ai_triage_result,
          adminNotes: r.admin_notes,
          reviewedBy: r.reviewed_by,
          reviewedAt: r.reviewed_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

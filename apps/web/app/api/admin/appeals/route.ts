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
import { asc, eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);

    const orm = await getDb();
    const aa = schema.accountAppeals;
    const u = schema.users;

    const rows = await orm
      .select({
        id: aa.id,
        user_id: aa.userId,
        username: u.username,
        email: u.email,
        is_suspended: u.isSuspended,
        is_banned: u.isBanned,
        suspension_reason: u.suspensionReason,
        suspended_until: u.suspendedUntil,
        ban_reason: u.banReason,
        appeal_type: aa.appealType,
        reason: aa.reason,
        contact_email: aa.contactEmail,
        status: aa.status,
        refusal_count: aa.refusalCount,
        ai_triage_result: aa.aiTriageResult,
        admin_notes: aa.adminNotes,
        reviewed_by: aa.reviewedBy,
        reviewed_at: aa.reviewedAt,
        created_at: aa.createdAt,
        updated_at: aa.updatedAt,
      })
      .from(aa)
      .innerJoin(u, eq(u.id, aa.userId))
      .where(status !== "all" ? eq(aa.status, status) : undefined)
      .orderBy(asc(aa.createdAt))
      .limit(limit);

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

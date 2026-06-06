/**
 * app/api/admin/community-notes/route.ts
 *
 * Admin community-note review management.
 *
 * GET /api/admin/community-notes
 *   List community notes by status (default: "pending").
 *
 *   Query params:
 *     status  – "pending" | "approved" | "rejected" | "all"  (default: "pending")
 *     limit   – max records                                   (default: 50, max: 200)
 *     offset  – pagination offset                             (default: 0)
 *
 * POST /api/admin/community-notes
 *   Approve, reject, or escalate a pending community note.
 *   Body: { noteId, action: "approve" | "reject" | "escalate", adminComment? }
 *
 * Auth: admin only (withAdminAuth – live database is_admin check).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const updateNoteSchema = z.object({
  noteId: z.string().uuid(),
  action: z.enum(["approve", "reject", "escalate"]),
  adminComment: z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CommunityNoteRow {
  id: string;
  author_id: string;
  author_username: string | null;
  target_id: string;
  target_type: string;
  content: string;
  status: string;
  reviewed_by: string | null;
  reviewer_username: string | null;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/community-notes
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

    const validStatuses = ["pending", "approved", "rejected", "escalated", "all"] as const;
    if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
      throw badRequest("Invalid status filter", "INVALID_STATUS");
    }

    const whereStatus =
      status === "all" ? "" : `WHERE cn.status = '${status}'`;

    const { rows } = await db.query<CommunityNoteRow>(
      `SELECT cn.id,
              cn.author_id,
              author.username         AS author_username,
              cn.target_id,
              cn.target_type,
              cn.content,
              cn.status,
              cn.reviewed_by,
              reviewer.username       AS reviewer_username,
              cn.admin_comment,
              cn.created_at,
              cn.reviewed_at
       FROM community_notes cn
       LEFT JOIN users author   ON author.id   = cn.author_id
       LEFT JOIN users reviewer ON reviewer.id = cn.reviewed_by
       ${whereStatus}
       ORDER BY cn.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM community_notes cn ${whereStatus}`
    );

    return NextResponse.json({
      success: true,
      data: {
        notes: rows,
        total: parseInt(countRows[0]?.total ?? "0", 10),
        limit,
        offset,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/community-notes
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, updateNoteSchema);

    // Fetch the note to ensure it exists and is in a reviewable state
    const { rows: noteRows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM community_notes WHERE id = $1 LIMIT 1`,
      [body.noteId]
    );

    const note = noteRows[0];
    if (!note) {
      throw notFound("Community note not found");
    }

    if (note.status !== "pending") {
      throw badRequest(
        `Cannot ${body.action} a note that is already "${note.status}"`,
        "NOTE_ALREADY_REVIEWED"
      );
    }

    const newStatus =
      body.action === "approve"
        ? "approved"
        : body.action === "reject"
        ? "rejected"
        : "escalated";

    const { rows: updatedRows } = await db.query<{ id: string; status: string; reviewed_at: string }>(
      `UPDATE community_notes
       SET status       = $1,
           reviewed_by  = $2,
           admin_comment = $3,
           reviewed_at  = NOW()
       WHERE id = $4
       RETURNING id, status, reviewed_at`,
      [newStatus, auth.user.sub, body.adminComment ?? null, body.noteId]
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new Error("Failed to update community note");
    }

    return NextResponse.json({
      success: true,
      data: {
        noteId: updated.id,
        status: updated.status,
        reviewedAt: updated.reviewed_at,
        reviewedBy: auth.user.sub,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

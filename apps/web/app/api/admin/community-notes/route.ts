export const dynamic = 'force-dynamic';

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
import { count, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
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
// GET /api/admin/community-notes
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
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

    const orm = await getDb();
    const cn = schema.communityNotes;
    const author = alias(schema.users, "author");
    const reviewer = alias(schema.users, "reviewer");
    const statusFilter = status === "all" ? undefined : eq(cn.status, status);

    const rows = await orm
      .select({
        id: cn.id,
        author_id: cn.authorId,
        author_username: author.username,
        target_id: cn.targetId,
        target_type: cn.targetType,
        content: cn.content,
        status: cn.status,
        reviewed_by: cn.reviewedBy,
        reviewer_username: reviewer.username,
        admin_comment: cn.adminComment,
        created_at: cn.createdAt,
        reviewed_at: cn.reviewedAt,
      })
      .from(cn)
      .leftJoin(author, eq(author.id, cn.authorId))
      .leftJoin(reviewer, eq(reviewer.id, cn.reviewedBy))
      .where(statusFilter)
      .orderBy(desc(cn.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total: totalRaw }] = await orm
      .select({ total: count() })
      .from(cn)
      .where(statusFilter);

    return NextResponse.json({
      success: true,
      data: {
        notes: rows,
        total: Number(totalRaw ?? 0),
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

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, updateNoteSchema);

    const orm = await getDb();
    const cn = schema.communityNotes;

    // Fetch the note to ensure it exists and is in a reviewable state
    const [note] = await orm
      .select({ id: cn.id, status: cn.status })
      .from(cn)
      .where(eq(cn.id, body.noteId))
      .limit(1);

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

    const [updated] = await orm
      .update(cn)
      .set({
        status: newStatus,
        reviewedBy: auth.user.sub,
        adminComment: body.adminComment ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(cn.id, body.noteId))
      .returning({ id: cn.id, status: cn.status, reviewed_at: cn.reviewedAt });

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

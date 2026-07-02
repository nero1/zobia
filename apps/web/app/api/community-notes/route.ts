export const dynamic = 'force-dynamic';

/**
 * app/api/community-notes/route.ts
 *
 * Community notes — crowdsourced context on flagged content.
 *
 * GET /api/community-notes?targetType=&targetId=
 *   Fetch notes for one target. Returns notes with status='shown' plus any
 *   notes authored by the caller.
 *
 * GET /api/community-notes?status=&cursor=&limit=
 *   FIX: the platform-wide Community Notes feed (web app/(app)/community-notes
 *   and its Android mirror) has always called this endpoint with no
 *   targetType/targetId — every request 400'd. When both are omitted this
 *   now returns a global, cursor-paginated feed ordered by created_at DESC,
 *   optionally filtered by status (needs_review | shown | hidden).
 *
 * POST /api/community-notes
 *   Submit a new community note. Inserted with status 'needs_review'.
 *   Body: { targetType, targetId, content }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyAccessToken, extractBearerToken } from "@/lib/auth/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createNoteSchema = z.object({
  targetType: z.enum(["message", "room", "user", "guild"]),
  targetId: z.string().uuid(),
  content: z.string().min(10).max(500),
});

// ---------------------------------------------------------------------------
// Helper: optional auth
// ---------------------------------------------------------------------------

async function tryGetUserId(req: NextRequest): Promise<string | null> {
  try {
    const bearerToken = extractBearerToken(req.headers.get("authorization"));
    const token = bearerToken ?? req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
    if (!token) return null;
    const payload = await verifyAccessToken(token);
    return payload.sub;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommunityNoteRow {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  author_username: string;
  author_avatar_emoji: string;
  content: string;
  helpful_votes: number;
  unhelpful_votes: number;
  status: string;
  created_at: string;
  updated_at: string;
  user_helpful: boolean | null;
}

const AUTHOR_JOIN_SELECT = `cn.id, cn.target_type, cn.target_id, cn.author_id,
       u.username AS author_username, u.avatar_emoji AS author_avatar_emoji,
       cn.content, cn.helpful_votes, cn.unhelpful_votes, cn.status,
       cn.created_at, cn.updated_at`;

// ---------------------------------------------------------------------------
// GET /api/community-notes
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const targetType = searchParams.get("targetType");
    const targetId = searchParams.get("targetId");
    const userId = await tryGetUserId(req);

    // Per-target lookup (message/room/user/guild flagged-content notes).
    if (targetType || targetId) {
      if (!targetType || !targetId) {
        throw badRequest("targetType and targetId are required together");
      }
      const validTargetTypes = ["message", "room", "user", "guild"];
      if (!validTargetTypes.includes(targetType)) {
        throw badRequest("Invalid targetType");
      }

      const { rows } = await db.query<CommunityNoteRow>(
        `SELECT ${AUTHOR_JOIN_SELECT},
                (SELECT helpful FROM community_note_votes cnv WHERE cnv.note_id = cn.id AND cnv.user_id = $3) AS user_helpful
         FROM community_notes cn
         JOIN users u ON u.id = cn.author_id
         WHERE cn.target_type = $1
           AND cn.target_id = $2
           AND (cn.status = 'shown' OR cn.author_id = $3)
         ORDER BY cn.helpful_votes DESC, cn.created_at DESC`,
        [targetType, targetId, userId]
      );

      return NextResponse.json({ items: rows, nextCursor: null, hasMore: false });
    }

    // Global feed — no target filter.
    const status = searchParams.get("status");
    const validStatuses = ["needs_review", "shown", "hidden"];
    const cursor = searchParams.get("cursor");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);

    const conditions: string[] = [];
    const params: (string | number | null)[] = [];
    let i = 1;
    if (status && validStatuses.includes(status)) {
      conditions.push(`cn.status = $${i++}`);
      params.push(status);
    }
    if (cursor) {
      conditions.push(`cn.created_at < $${i++}`);
      params.push(new Date(parseInt(cursor, 10) || 0).toISOString());
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(userId);
    const userIdParamIdx = i++;
    params.push(limit);
    const limitParamIdx = i;

    const { rows } = await db.query<CommunityNoteRow>(
      `SELECT ${AUTHOR_JOIN_SELECT},
              (SELECT helpful FROM community_note_votes cnv WHERE cnv.note_id = cn.id AND cnv.user_id = $${userIdParamIdx}) AS user_helpful
       FROM community_notes cn
       JOIN users u ON u.id = cn.author_id
       ${whereClause}
       ORDER BY cn.created_at DESC
       LIMIT $${limitParamIdx}`,
      params
    );

    const last = rows[rows.length - 1];
    const nextCursor = last && rows.length === limit ? String(new Date(last.created_at).getTime()) : null;

    return NextResponse.json({ items: rows, nextCursor, hasMore: nextCursor !== null });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/community-notes
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await requireFeatureEnabled("communityNotes");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createNoteSchema);

    const { rows } = await db.query<Omit<CommunityNoteRow, "author_username" | "author_avatar_emoji" | "user_helpful">>(
      `INSERT INTO community_notes
         (target_type, target_id, author_id, content,
          helpful_votes, unhelpful_votes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, 'needs_review', NOW(), NOW())
       RETURNING id, target_type, target_id, author_id, content,
                 helpful_votes, unhelpful_votes, status, created_at, updated_at`,
      [body.targetType, body.targetId, userId, body.content]
    );

    const { rows: authorRows } = await db.query<{ username: string; avatar_emoji: string }>(
      `SELECT username, avatar_emoji FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    const note: CommunityNoteRow = {
      ...rows[0],
      author_username: authorRows[0]?.username ?? "",
      author_avatar_emoji: authorRows[0]?.avatar_emoji ?? "😊",
      user_helpful: null,
    };

    return NextResponse.json(
      { success: true, data: { note }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

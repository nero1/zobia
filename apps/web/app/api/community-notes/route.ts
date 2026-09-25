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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();
      const { rows } = await orm.execute<CommunityNoteRow & Record<string, unknown>>(sql`
         SELECT ${sql.raw(AUTHOR_JOIN_SELECT)},
                (SELECT helpful FROM community_note_votes cnv WHERE cnv.note_id = cn.id AND cnv.user_id = ${userId}) AS user_helpful
         FROM community_notes cn
         JOIN users u ON u.id = cn.author_id
         WHERE cn.target_type = ${targetType}
           AND cn.target_id = ${targetId}
           AND (cn.status = 'shown' OR cn.author_id = ${userId})
         ORDER BY cn.helpful_votes DESC, cn.created_at DESC
      `);

      return NextResponse.json({ items: rows, nextCursor: null, hasMore: false });
    }

    // Global feed — no target filter.
    const status = searchParams.get("status");
    const validStatuses = ["needs_review", "shown", "hidden"];
    const cursor = searchParams.get("cursor");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);

    const conditions: ReturnType<typeof sql>[] = [];
    if (status && validStatuses.includes(status)) {
      conditions.push(sql`cn.status = ${status}`);
    }
    if (cursor) {
      const cursorMs = parseInt(cursor, 10);
      if (!Number.isFinite(cursorMs) || cursorMs <= 0) throw badRequest("Invalid cursor");
      conditions.push(sql`cn.created_at < ${new Date(cursorMs).toISOString()}`);
    }
    const whereClause = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const orm = await getDb();
    const { rows } = await orm.execute<CommunityNoteRow & Record<string, unknown>>(sql`
       SELECT ${sql.raw(AUTHOR_JOIN_SELECT)},
              (SELECT helpful FROM community_note_votes cnv WHERE cnv.note_id = cn.id AND cnv.user_id = ${userId}) AS user_helpful
       FROM community_notes cn
       JOIN users u ON u.id = cn.author_id
       ${whereClause}
       ORDER BY cn.created_at DESC
       LIMIT ${limit}
    `);

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

    const orm = await getDb();
    const [inserted] = await orm
      .insert(schema.communityNotes)
      .values({
        targetType: body.targetType,
        targetId: body.targetId,
        authorId: userId,
        content: body.content,
        helpfulVotes: 0,
        unhelpfulVotes: 0,
        status: "needs_review",
      })
      .returning({
        id: schema.communityNotes.id,
        target_type: schema.communityNotes.targetType,
        target_id: schema.communityNotes.targetId,
        author_id: schema.communityNotes.authorId,
        content: schema.communityNotes.content,
        helpful_votes: schema.communityNotes.helpfulVotes,
        unhelpful_votes: schema.communityNotes.unhelpfulVotes,
        status: schema.communityNotes.status,
        created_at: schema.communityNotes.createdAt,
        updated_at: schema.communityNotes.updatedAt,
      });

    const [authorRow] = await orm
      .select({ username: schema.users.username, avatar_emoji: schema.users.avatarEmoji })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    const note: CommunityNoteRow = {
      ...inserted,
      author_username: authorRow?.username ?? "",
      author_avatar_emoji: authorRow?.avatar_emoji ?? "😊",
      user_helpful: null,
    } as unknown as CommunityNoteRow;

    return NextResponse.json(
      { success: true, data: { note }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

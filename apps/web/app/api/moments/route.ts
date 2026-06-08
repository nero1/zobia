export const dynamic = 'force-dynamic';

/**
 * app/api/moments/route.ts
 *
 * GET  /api/moments  — Followed users' non-expired moments feed
 * POST /api/moments  — Create a new moment (expires in 24h, max 5 active)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const createMomentSchema = z.object({
  content: z.string().min(1).max(500),
  content_type: z.enum(["text", "image", "video"]).default("text"),
  media_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  caption: z.string().max(200).optional(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const cursor = req.nextUrl.searchParams.get("cursor");
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10), 50);

    const { rows } = await db.query(
      `SELECT m.id, m.user_id,
              u.username, u.avatar_emoji, u.avatar_url,
              m.content, m.content_type, m.media_url, m.caption,
              m.view_count, m.expires_at, m.created_at,
              (EXISTS (
                SELECT 1 FROM moment_views mv
                WHERE mv.moment_id = m.id AND mv.viewer_id = $1
              )) AS has_viewed
       FROM moments m
       JOIN users u ON u.id = m.user_id
       WHERE m.expires_at > NOW()
         AND (
           m.user_id = $1
           OR m.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
         )
         ${cursor ? "AND m.created_at < $3" : ""}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      cursor ? [userId, limit, cursor] : [userId, limit]
    );

    const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
    return NextResponse.json({ success: true, data: { moments: rows, nextCursor }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const userId = auth.user.sub;
    const body = await validateBody(req, createMomentSchema);

    if (body.content_type !== "text" && !body.media_url) {
      throw badRequest("media_url is required for image/video moments");
    }

    const { rows: countRows } = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM moments WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );
    if (parseInt(countRows[0]?.cnt ?? "0") >= 5) {
      throw badRequest("You can have at most 5 active moments at a time");
    }

    const { rows } = await db.query<{ id: string; expires_at: string }>(
      `INSERT INTO moments (user_id, content, content_type, media_url, thumbnail_url, caption)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [userId, body.content, body.content_type, body.media_url ?? null, body.thumbnail_url ?? null, body.caption ?? null]
    );

    return NextResponse.json({ success: true, data: rows[0], error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

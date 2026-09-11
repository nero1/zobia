export const dynamic = 'force-dynamic';

/**
 * app/api/tweets/route.ts
 *
 * GET  /api/tweets  — Feed, one endpoint with a `?tab=` selector:
 *   - foryou    (default): query-time "hot" ranking (likes decayed by age,
 *                boosted for friends/follows) — no cron/background job.
 *   - friends:    tweets AND retweets from mutual (accepted) friendships,
 *                 newest first, each retweet row attributed "X retweeted".
 *   - following:  same, for one-directional follows.
 *   - mentions:   tweets/replies that @mention the caller, newest first.
 *   - `?authorId=<id>` (any tab, or alone): a single author's own tweets +
 *     retweets for their profile — pinned tweet first, then the rest
 *     newest-first.
 *   - `?parentTweetId=<id>`: a reply thread — replies to that Tweet,
 *     chronological (oldest first), cursor-paginated.
 * POST /api/tweets — Create a new Tweet (or, with `parent_tweet_id`, a reply).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isAllowedMediaUrl } from "@/lib/security/mediaUrl";
import { createTweet, parseTweetVideo, TWEETS_HARD_CHAR_CAP } from "@/lib/tweets/service";

// ---------------------------------------------------------------------------
// Shared row projections
// ---------------------------------------------------------------------------

/** Plain tweet/reply row — no retweet attribution. */
const TWEET_COLUMNS = `
  t.id, t.user_id, t.parent_tweet_id, u.username, u.avatar_emoji, u.avatar_url,
  u.is_verified, u.prestige_count, u.xp_total,
  t.content, t.image_url, t.video_provider, t.video_url, t.video_embed_id,
  t.is_pinned, t.likes_count, t.replies_count, t.retweets_count, t.created_at,
  (EXISTS (SELECT 1 FROM tweet_likes tl WHERE tl.tweet_id = t.id AND tl.user_id = $1)) AS liked,
  (EXISTS (SELECT 1 FROM tweet_retweets tr2 WHERE tr2.tweet_id = t.id AND tr2.user_id = $1)) AS retweeted,
  NULL::uuid AS retweeted_by_id, NULL::text AS retweeted_by_username, NULL::text AS retweet_quote_content,
  t.created_at AS activity_at
`;

/** A retweet, attributed to the retweeter, carrying the original tweet's content. */
const RETWEET_COLUMNS = `
  t.id, t.user_id, t.parent_tweet_id, u.username, u.avatar_emoji, u.avatar_url,
  u.is_verified, u.prestige_count, u.xp_total,
  t.content, t.image_url, t.video_provider, t.video_url, t.video_embed_id,
  false AS is_pinned, t.likes_count, t.replies_count, t.retweets_count, t.created_at,
  (EXISTS (SELECT 1 FROM tweet_likes tl WHERE tl.tweet_id = t.id AND tl.user_id = $1)) AS liked,
  (EXISTS (SELECT 1 FROM tweet_retweets tr2 WHERE tr2.tweet_id = t.id AND tr2.user_id = $1)) AS retweeted,
  rt.user_id AS retweeted_by_id, ru.username AS retweeted_by_username, rt.quote_content AS retweet_quote_content,
  rt.created_at AS activity_at
`;

// ---------------------------------------------------------------------------
// GET /api/tweets
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const params = req.nextUrl.searchParams;
    const authorId = params.get("authorId");
    const parentTweetId = params.get("parentTweetId");
    const tab = params.get("tab") ?? "foryou";
    const cursor = params.get("cursor");
    const limit = Math.min(parseInt(params.get("limit") ?? "20", 10) || 20, 50);

    // ---- Reply thread: chronological (oldest first) -----------------------
    if (parentTweetId) {
      const { rows } = await db.query(
        `SELECT ${TWEET_COLUMNS}
         FROM tweets t JOIN users u ON u.id = t.user_id
         WHERE t.parent_tweet_id = $2 AND t.deleted_at IS NULL
           ${cursor ? "AND t.created_at > $4" : ""}
         ORDER BY t.created_at ASC
         LIMIT $3`,
        cursor ? [userId, parentTweetId, limit, cursor] : [userId, parentTweetId, limit]
      );
      const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
      return NextResponse.json({ success: true, data: { tweets: rows, nextCursor }, error: null });
    }

    // ---- Profile mode: a single author's tweets + retweets, pinned first --
    if (authorId) {
      const { rows: pinnedRows } = cursor
        ? { rows: [] as Record<string, unknown>[] }
        : await db.query(
            `SELECT ${TWEET_COLUMNS}
             FROM tweets t JOIN users u ON u.id = t.user_id
             WHERE t.user_id = $2 AND t.deleted_at IS NULL AND t.is_pinned = true AND t.parent_tweet_id IS NULL
             LIMIT 1`,
            [userId, authorId]
          );

      const { rows } = await db.query(
        `SELECT * FROM (
           SELECT ${TWEET_COLUMNS}
           FROM tweets t JOIN users u ON u.id = t.user_id
           WHERE t.user_id = $2 AND t.deleted_at IS NULL AND t.is_pinned = false AND t.parent_tweet_id IS NULL
           UNION ALL
           SELECT ${RETWEET_COLUMNS}
           FROM tweet_retweets rt
           JOIN tweets t ON t.id = rt.tweet_id AND t.deleted_at IS NULL
           JOIN users u ON u.id = t.user_id
           JOIN users ru ON ru.id = rt.user_id
           WHERE rt.user_id = $2
         ) feed
         WHERE ${cursor ? "activity_at < $4" : "TRUE"}
         ORDER BY activity_at DESC
         LIMIT $3`,
        cursor ? [userId, authorId, limit, cursor] : [userId, authorId, limit]
      );

      const tweets = [...pinnedRows, ...rows];
      const nextCursor = rows.length === limit ? rows[rows.length - 1].activity_at : null;
      return NextResponse.json({ success: true, data: { tweets, nextCursor }, error: null });
    }

    // ---- Mentions: tweets/replies that @mention the caller, newest first --
    if (tab === "mentions") {
      const { rows } = await db.query(
        `SELECT ${TWEET_COLUMNS}
         FROM tweet_mentions tm
         JOIN tweets t ON t.id = tm.tweet_id AND t.deleted_at IS NULL
         JOIN users u ON u.id = t.user_id
         WHERE tm.mentioned_user_id = $1
           ${cursor ? "AND t.created_at < $3" : ""}
         ORDER BY t.created_at DESC
         LIMIT $2`,
        cursor ? [userId, limit, cursor] : [userId, limit]
      );
      const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
      return NextResponse.json({ success: true, data: { tweets: rows, nextCursor }, error: null });
    }

    // ---- Friends: accepted friendships (either direction) — tweets AND
    // retweets by any friend, newest first, retweets attributed "X retweeted".
    if (tab === "friends") {
      const { rows } = await db.query(
        `SELECT * FROM (
           SELECT ${TWEET_COLUMNS}
           FROM tweets t JOIN users u ON u.id = t.user_id
           WHERE t.deleted_at IS NULL AND t.parent_tweet_id IS NULL
             AND EXISTS (
               SELECT 1 FROM friendships f
               WHERE f.status = 'accepted'
                 AND ((f.requester_id = $1 AND f.addressee_id = t.user_id)
                   OR (f.addressee_id = $1 AND f.requester_id = t.user_id))
             )
           UNION ALL
           SELECT ${RETWEET_COLUMNS}
           FROM tweet_retweets rt
           JOIN tweets t ON t.id = rt.tweet_id AND t.deleted_at IS NULL
           JOIN users u ON u.id = t.user_id
           JOIN users ru ON ru.id = rt.user_id
           WHERE EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.status = 'accepted'
               AND ((f.requester_id = $1 AND f.addressee_id = rt.user_id)
                 OR (f.addressee_id = $1 AND f.requester_id = rt.user_id))
           )
         ) feed
         WHERE ${cursor ? "activity_at < $3" : "TRUE"}
         ORDER BY activity_at DESC
         LIMIT $2`,
        cursor ? [userId, limit, cursor] : [userId, limit]
      );
      const nextCursor = rows.length === limit ? rows[rows.length - 1].activity_at : null;
      return NextResponse.json({ success: true, data: { tweets: rows, nextCursor }, error: null });
    }

    // ---- Following: one-directional follows — tweets AND retweets --------
    if (tab === "following") {
      const { rows } = await db.query(
        `SELECT * FROM (
           SELECT ${TWEET_COLUMNS}
           FROM tweets t JOIN users u ON u.id = t.user_id
           WHERE t.deleted_at IS NULL AND t.parent_tweet_id IS NULL
             AND EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.following_id = t.user_id)
           UNION ALL
           SELECT ${RETWEET_COLUMNS}
           FROM tweet_retweets rt
           JOIN tweets t ON t.id = rt.tweet_id AND t.deleted_at IS NULL
           JOIN users u ON u.id = t.user_id
           JOIN users ru ON ru.id = rt.user_id
           WHERE EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.following_id = rt.user_id)
         ) feed
         WHERE ${cursor ? "activity_at < $3" : "TRUE"}
         ORDER BY activity_at DESC
         LIMIT $2`,
        cursor ? [userId, limit, cursor] : [userId, limit]
      );
      const nextCursor = rows.length === limit ? rows[rows.length - 1].activity_at : null;
      return NextResponse.json({ success: true, data: { tweets: rows, nextCursor }, error: null });
    }

    // ---- For You: query-time "hot" ranking (top-level tweets only) --------
    // score = likes decayed by age (standard "hot" formula: likes / (age_h + 2)^1.5),
    // boosted 1.5x when the author is a friend or someone the viewer follows.
    // Computed per-request — no cron/background job. Cursor is a base64 JSON
    // {score, id} pair, since the ranking key isn't a plain column.
    let cursorScore: number | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { score: number; id: string };
        cursorScore = decoded.score;
        cursorId = decoded.id;
      } catch {
        throw badRequest("Invalid cursor", "INVALID_CURSOR");
      }
    }

    const { rows } = await db.query(
      `WITH scored AS (
         SELECT ${TWEET_COLUMNS},
           (t.likes_count::float / POWER(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600.0 + 2, 1.5))
           * (CASE WHEN (
                EXISTS (
                  SELECT 1 FROM friendships f
                  WHERE f.status = 'accepted'
                    AND ((f.requester_id = $1 AND f.addressee_id = t.user_id)
                      OR (f.addressee_id = $1 AND f.requester_id = t.user_id))
                )
                OR EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.following_id = t.user_id)
              ) THEN 1.5 ELSE 1.0 END) AS score
         FROM tweets t JOIN users u ON u.id = t.user_id
         WHERE t.deleted_at IS NULL AND t.parent_tweet_id IS NULL
       )
       SELECT * FROM scored
       WHERE $3::float8 IS NULL OR (score, id) < ($3::float8, $4::uuid)
       ORDER BY score DESC, id DESC
       LIMIT $2`,
      [userId, limit, cursorScore, cursorId]
    );

    const nextCursor =
      rows.length === limit
        ? Buffer.from(JSON.stringify({ score: rows[rows.length - 1].score, id: rows[rows.length - 1].id })).toString("base64")
        : null;
    return NextResponse.json({ success: true, data: { tweets: rows, nextCursor }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tweets
// ---------------------------------------------------------------------------

const createTweetSchema = z
  .object({
    content: z.string().max(TWEETS_HARD_CHAR_CAP).optional(),
    image_url: z
      .string()
      .url()
      .refine(isAllowedMediaUrl, { message: "Image URL must be from allowed domain" })
      .optional(),
    video_provider: z.enum(["youtube", "tiktok"]).optional(),
    video_url: z.string().url().optional(),
    /** Set to post a reply — a reply is a Tweet with parent_tweet_id set. */
    parent_tweet_id: z.string().uuid().optional(),
  })
  .refine((b) => Boolean(b.content?.trim()) || Boolean(b.image_url) || Boolean(b.video_provider), {
    message: "A Tweet needs text, an image, or a video.",
  })
  .refine((b) => !b.video_provider || Boolean(b.video_url), { message: "video_url is required when video_provider is set" });

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const userId = auth.user.sub;
    const body = await validateBody(req, createTweetSchema);

    const video =
      body.video_provider && body.video_url ? await parseTweetVideo(body.video_provider, body.video_url) : null;

    const result = await createTweet({
      userId,
      content: body.content ?? null,
      imageUrl: body.image_url ?? null,
      video,
      parentTweetId: body.parent_tweet_id ?? null,
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

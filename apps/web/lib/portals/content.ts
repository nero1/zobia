/**
 * lib/portals/content.ts
 *
 * Tag-filtered content queries behind a portal page: the mini discovery feed
 * and the per-primitive sections (rooms, guilds, people, forum, wiki, Q&A...).
 *
 * Every content type is joined to `content_hashtags` (indexed by
 * hashtag_id + created_at / content_type) and filtered with the SAME
 * visibility rules the Home Feed uses (lib/feed/aggregator.ts), so a portal
 * can never surface private, expired, draft or deleted content even when a
 * stale link row exists. Each per-type branch is LIMIT-bounded, so one noisy
 * type cannot dominate the page or blow up query cost.
 *
 * Column names/tables are hardcoded literals (never interpolated from input);
 * only the hashtag id, limits and cursor values are bound parameters.
 *
 * @module lib/portals/content
 */

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { deepLinkPathFor } from "@/lib/feed/deeplink";
import type { FeedContentType } from "@/lib/feed/types";
import type {
  PortalFeedItem,
  PortalFeedPage,
  PortalForumBoard,
  PortalGuildCard,
  PortalPersonCard,
  PortalRoomCard,
} from "@zobia/shared/types";

/** Content types that can appear as generic feed cards on a portal page. */
export type PortalFeedType = Extract<
  FeedContentType,
  "moment" | "tweet" | "blog_post" | "forum_thread" | "forum_question" | "room" | "classroom" | "wiki_page" | "poll" | "quiz"
>;

export const ALL_PORTAL_FEED_TYPES: readonly PortalFeedType[] = [
  "moment",
  "tweet",
  "blog_post",
  "forum_thread",
  "forum_question",
  "room",
  "classroom",
  "wiki_page",
  "poll",
  "quiz",
] as const;

const PER_TYPE_LIMIT = 40;
const MAX_TOP_OFFSET = 100;

interface Row {
  content_type: string;
  content_id: string;
  author_id: string | null;
  title: string | null;
  excerpt: string | null;
  image_url: string | null;
  created_at: string | Date;
  popularity: string | number;
  [k: string]: unknown;
}

/**
 * One branch per type, all with the same aliased output columns:
 * content_type, content_id, author_id, title, excerpt, image_url, created_at, popularity.
 */
function branch(type: PortalFeedType, tagId: string, limit: number): SQL {
  // EVERY column carries an explicit alias in EVERY branch: a UNION takes its
  // output names from the first branch only, and which type comes first
  // depends on the caller (a "forum" section passes just forum_thread), so
  // un-aliased later branches would leave `popularity`/`created_at` unnamed.
  switch (type) {
    case "moment":
      return sql`(SELECT 'moment'::text AS content_type, t.id::text AS content_id, t.user_id::text AS author_id, NULL::text AS title,
          CASE WHEN t.content_type = 'text' THEN t.content ELSE t.caption END AS excerpt, t.media_url AS image_url, t.created_at AS created_at,
          (t.view_count + t.reactions_count * 3)::numeric AS popularity
        FROM content_hashtags ch JOIN moments t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'moment' AND t.expires_at > NOW()
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "tweet":
      return sql`(SELECT 'tweet'::text AS content_type, t.id::text AS content_id, t.user_id::text AS author_id, NULL::text AS title,
          t.content AS excerpt, t.image_url AS image_url, t.created_at AS created_at,
          (t.likes_count * 2 + t.replies_count * 3 + t.retweets_count * 2)::numeric AS popularity
        FROM content_hashtags ch JOIN tweets t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'tweet' AND t.deleted_at IS NULL AND t.parent_tweet_id IS NULL
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "blog_post":
      return sql`(SELECT 'blog_post'::text AS content_type, t.id::text AS content_id, t.author_id::text AS author_id, t.title AS title,
          t.excerpt AS excerpt, t.featured_image_url AS image_url, t.created_at AS created_at,
          (t.view_count + t.like_count * 5 + t.comment_count * 4 + t.share_count * 3)::numeric AS popularity
        FROM content_hashtags ch JOIN blog_posts t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'blog_post' AND t.deleted_at IS NULL AND t.status = 'published'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "forum_thread":
      return sql`(SELECT 'forum_thread'::text AS content_type, t.id::text AS content_id, t.author_id::text AS author_id, t.title AS title,
          NULL::text AS excerpt, NULL::text AS image_url, t.created_at AS created_at,
          (t.view_count + t.reply_count * 4)::numeric AS popularity
        FROM content_hashtags ch JOIN bb_threads t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'forum_thread' AND t.deleted_at IS NULL AND t.status = 'visible'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "forum_question":
      return sql`(SELECT 'forum_question'::text AS content_type, t.id::text AS content_id, t.author_id::text AS author_id, t.title AS title,
          t.body AS excerpt, NULL::text AS image_url, t.created_at AS created_at,
          (t.vote_score * 3 + t.answer_count * 4 + t.favorite_count * 2)::numeric AS popularity
        FROM content_hashtags ch JOIN forum_questions t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'forum_question' AND t.deleted_at IS NULL AND t.status = 'visible'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "room":
      return sql`(SELECT 'room'::text AS content_type, t.id::text AS content_id, t.creator_id::text AS author_id, t.name AS title,
          t.description AS excerpt, t.cover_image_url AS image_url, t.created_at AS created_at,
          (t.member_count * 3 + t.total_messages)::numeric AS popularity
        FROM content_hashtags ch JOIN rooms t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'room' AND t.deleted_at IS NULL AND t.status = 'active'
          AND t.is_public = true AND t.type <> 'classroom'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "classroom":
      return sql`(SELECT 'classroom'::text AS content_type, t.id::text AS content_id, t.creator_id::text AS author_id, t.name AS title,
          t.description AS excerpt, t.cover_image_url AS image_url, t.created_at AS created_at,
          (t.member_count * 3 + t.total_messages)::numeric AS popularity
        FROM content_hashtags ch JOIN rooms t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'classroom' AND t.deleted_at IS NULL AND t.status = 'active'
          AND t.is_public = true AND t.type = 'classroom'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "wiki_page":
      return sql`(SELECT 'wiki_page'::text AS content_type, t.id::text AS content_id, t.created_by::text AS author_id, t.title AS title,
          NULL::text AS excerpt, NULL::text AS image_url, t.created_at AS created_at,
          (t.view_count + t.revision_count * 2)::numeric AS popularity
        FROM content_hashtags ch JOIN wiki_pages t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'wiki_page' AND t.deleted_at IS NULL AND t.status = 'published'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "poll":
      return sql`(SELECT 'poll'::text AS content_type, t.id::text AS content_id, t.creator_id::text AS author_id, t.title AS title,
          t.description AS excerpt, NULL::text AS image_url, t.created_at AS created_at,
          (t.voter_count * 3 + t.view_count + t.share_count * 2)::numeric AS popularity
        FROM content_hashtags ch JOIN polls t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'poll' AND t.deleted_at IS NULL AND t.status = 'active'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
    case "quiz":
      return sql`(SELECT 'quiz'::text AS content_type, t.id::text AS content_id, t.creator_id::text AS author_id, t.title AS title,
          t.description AS excerpt, NULL::text AS image_url, t.created_at AS created_at,
          (t.attempt_count * 3 + t.view_count + t.share_count * 2)::numeric AS popularity
        FROM content_hashtags ch JOIN quizzes t ON t.id = ch.content_id
        WHERE ch.hashtag_id = ${tagId} AND ch.content_type = 'quiz' AND t.deleted_at IS NULL AND t.status = 'active'
        ORDER BY ch.created_at DESC LIMIT ${limit})`;
  }
}

function toItem(r: Row): PortalFeedItem {
  const type = r.content_type as FeedContentType;
  return {
    contentType: type,
    contentId: r.content_id,
    authorId: r.author_id,
    title: r.title,
    excerpt: r.excerpt ? String(r.excerpt).slice(0, 280) : null,
    imageUrl: r.image_url,
    url: deepLinkPathFor(type, r.content_id),
    createdAt: new Date(r.created_at).toISOString(),
    metrics: { score: Number(r.popularity) || 0 },
  };
}

function encodeCursor(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString("base64");
}

function decodeCursor<T>(cursor: string | null | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export interface TaggedFeedOptions {
  types?: readonly PortalFeedType[];
  sort: "new" | "top";
  limit: number;
  cursor?: string | null;
}

/**
 * Paged, tag-filtered feed.
 *  - `new`: keyset on (created_at, content_id), unbounded depth.
 *  - `top`: time-decayed popularity (same "hot" shape as lib/feed/ranking.ts
 *    velocityScore), offset-paged and capped at MAX_TOP_OFFSET items.
 */
export async function fetchTaggedFeed(hashtagId: string, opts: TaggedFeedOptions): Promise<PortalFeedPage> {
  const types = opts.types && opts.types.length > 0 ? opts.types : ALL_PORTAL_FEED_TYPES;
  const limit = Math.max(1, Math.min(opts.limit, 50));
  const union = sql.join(types.map((t) => branch(t, hashtagId, PER_TYPE_LIMIT)), sql` UNION ALL `);
  const orm = await getDb();

  if (opts.sort === "top") {
    const cur = decodeCursor<{ offset: number }>(opts.cursor);
    const offset = Math.max(0, Math.min(cur?.offset ?? 0, MAX_TOP_OFFSET));
    const { rows } = await orm.execute<Row>(sql`
      SELECT * FROM (${union}) feed
      ORDER BY ((popularity + 1) / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0, 0) + 2, 1.5)) DESC, created_at DESC, content_id DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `);
    const hasMore = rows.length > limit && offset + limit < MAX_TOP_OFFSET;
    return { items: rows.slice(0, limit).map(toItem), nextCursor: hasMore ? encodeCursor({ offset: offset + limit }) : null };
  }

  const cur = decodeCursor<{ createdAt: string; id: string }>(opts.cursor);
  const { rows } = await orm.execute<Row>(sql`
    SELECT * FROM (${union}) feed
    WHERE ${cur?.createdAt ?? null}::timestamptz IS NULL
       OR created_at < ${cur?.createdAt ?? null}::timestamptz
       OR (created_at = ${cur?.createdAt ?? null}::timestamptz AND content_id < ${cur?.id ?? null})
    ORDER BY created_at DESC, content_id DESC
    LIMIT ${limit + 1}
  `);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: new Date(last.created_at).toISOString(), id: last.content_id }) : null,
  };
}

/** Top-N items of specific types for a section (no cursor). */
export async function fetchSectionItems(hashtagId: string, types: readonly PortalFeedType[], limit: number): Promise<PortalFeedItem[]> {
  return (await fetchTaggedFeed(hashtagId, { types, sort: "top", limit })).items;
}

// ---------------------------------------------------------------------------
// Rich sections
// ---------------------------------------------------------------------------

function cityPattern(city: string | null): string | null {
  const c = city?.trim();
  return c ? `%${c.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
}

export async function fetchPortalRooms(hashtagId: string, city: string | null, limit = 12): Promise<PortalRoomCard[]> {
  const orm = await getDb();
  const pattern = cityPattern(city);
  const { rows } = await orm.execute<{ id: string; slug: string | null; name: string; description: string | null; cover_image_url: string | null; cover_emoji: string | null; member_count: number; is_classroom: boolean } & Record<string, unknown>>(sql`
    SELECT r.id::text AS id, r.slug, r.name, r.description, r.cover_image_url, r.cover_emoji, r.member_count, (r.type = 'classroom') AS is_classroom
    FROM rooms r
    WHERE r.deleted_at IS NULL AND r.status = 'active' AND r.is_public = true
      AND (
        EXISTS (SELECT 1 FROM content_hashtags ch WHERE ch.hashtag_id = ${hashtagId} AND ch.content_type IN ('room', 'classroom') AND ch.content_id = r.id)
        OR (${pattern}::text IS NOT NULL AND r.city ILIKE ${pattern})
      )
    ORDER BY r.member_count DESC, r.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    coverImageUrl: r.cover_image_url,
    coverEmoji: r.cover_emoji,
    memberCount: Number(r.member_count),
    isClassroom: !!r.is_classroom,
  }));
}

export async function fetchPortalGuilds(hashtagId: string, city: string | null, limit = 12): Promise<PortalGuildCard[]> {
  const orm = await getDb();
  const pattern = cityPattern(city);
  const { rows } = await orm.execute<{ id: string; name: string; crest_emoji: string; description: string | null; city: string | null; member_count: number } & Record<string, unknown>>(sql`
    SELECT g.id::text AS id, g.name, g.crest_emoji, g.description, g.city, g.member_count
    FROM guilds g
    WHERE g.is_active = true AND g.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM content_hashtags ch WHERE ch.hashtag_id = ${hashtagId} AND ch.content_type = 'guild' AND ch.content_id = g.id)
        OR (${pattern}::text IS NOT NULL AND g.city ILIKE ${pattern})
      )
    ORDER BY g.member_count DESC, g.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map((g) => ({ id: g.id, name: g.name, crestEmoji: g.crest_emoji, description: g.description, city: g.city, memberCount: Number(g.member_count) }));
}

/**
 * Top contributors: authors ranked by tagged-post count. Users who chose to
 * hide from public leaderboards are excluded (conservative: the hide flag is
 * honoured even if their paid eligibility has since lapsed).
 */
export async function fetchPortalPeople(hashtagId: string, limit = 12): Promise<PortalPersonCard[]> {
  const orm = await getDb();
  const { rows } = await orm.execute<{ user_id: string; username: string; display_name: string; avatar_emoji: string | null; avatar_url: string | null; post_count: number } & Record<string, unknown>>(sql`
    SELECT u.id::text AS user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url, COUNT(*)::int AS post_count
    FROM content_hashtags ch
    JOIN users u ON u.id = ch.author_id
    WHERE ch.hashtag_id = ${hashtagId}
      AND u.deleted_at IS NULL AND u.is_banned = false AND u.hide_from_leaderboards = false
    GROUP BY u.id
    ORDER BY post_count DESC, MAX(ch.created_at) DESC
    LIMIT ${limit}
  `);
  return rows.map((p) => ({
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    avatarEmoji: p.avatar_emoji,
    avatarUrl: p.avatar_url,
    postCount: Number(p.post_count),
  }));
}

export async function fetchForumBoard(boardId: string | null): Promise<PortalForumBoard | null> {
  if (!boardId) return null;
  const orm = await getDb();
  const { rows } = await orm.execute<{ id: string; slug: string; name: string; description: string | null; thread_count: number } & Record<string, unknown>>(sql`
    SELECT id::text AS id, slug, name, description, thread_count FROM bb_boards WHERE id = ${boardId} AND is_active = true LIMIT 1
  `);
  const b = rows[0];
  return b ? { id: b.id, slug: b.slug, name: b.name, description: b.description, threadCount: Number(b.thread_count) } : null;
}

/** Latest threads of the portal's official board (shown in the forum section when a board is linked). */
export async function fetchBoardThreads(boardId: string, limit = 6): Promise<PortalFeedItem[]> {
  const orm = await getDb();
  const { rows } = await orm.execute<Row>(sql`
    SELECT 'forum_thread'::text AS content_type, t.id::text AS content_id, t.author_id::text AS author_id, t.title, NULL::text AS excerpt,
           NULL::text AS image_url, t.created_at, (t.view_count + t.reply_count * 4)::numeric AS popularity
    FROM bb_threads t
    WHERE t.board_id = ${boardId} AND t.deleted_at IS NULL AND t.status = 'visible'
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `);
  return rows.map(toItem);
}

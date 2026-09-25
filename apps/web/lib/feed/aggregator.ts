/**
 * lib/feed/aggregator.ts
 *
 * Builds Home Feed candidate pools (expensive, cross-table — runs only from
 * the /api/cron/feed-refresh job, at most once per homeFeed.cacheTtlSeconds)
 * and serves per-request pages from the cached pool (cheap — see
 * lib/feed/cache.ts for the two-tier memory+Redis cache this relies on).
 *
 * SCOPE NOTE: `friends` and `new` cover a curated subset of content types
 * (moments, tweets, blog posts, forum questions, rooms, classrooms, wiki
 * pages, games, polls, quizzes) — not bbforum threads or business page
 * posts — to keep their per-request UNION query bounded and index-friendly.
 * The precomputed `for_you`/`trending` pools (built by the CRON, not
 * per-request) cover every boostable content type. This is a documented
 * simplification, not a platform limitation — extending the friends/new
 * UNION to the remaining two types is mechanical if product wants full
 * parity later.
 */

import { getDb } from "@/lib/db/drizzle";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { FeedContentType, FeedItem, FeedPage, FeedTab, FeedTier } from "./types";
import { computeFinalScore, interestMatchScore, mergeTiers, normalizeScores, velocityScore, businessTierScore } from "./ranking";
import { getBoostableContentSummary } from "@/lib/ads/repo";
import { deepLinkPathFor } from "./deeplink";
import { getCandidatePool, setCandidatePool } from "./cache";

// ---------------------------------------------------------------------------
// Per-content-type "popular"/"trending" source queries.
//
// Column names/tables are hardcoded here (never interpolated from input),
// only numeric LIMITs are parameterised — safe from SQL injection by
// construction. Each query is independently LIMIT-bounded so a single
// content type can never dominate the candidate pool or blow up query cost.
// ---------------------------------------------------------------------------

const PER_TYPE_LIMIT = 100; // bounded candidates per content type per tier, per cron run

interface RawCandidateRow {
  content_type: FeedContentType;
  content_id: string;
  author_id: string | null;
  title: string | null;
  excerpt: string | null;
  image_url: string | null;
  created_at: string;
  popularity_score: string | number;
  tag: string | null;
}

/**
 * All-time popularity source query per content type (tier: organic_popular).
 *
 * EVERY column must carry an explicit alias matching RawCandidateRow. These
 * run as STANDALONE queries (fetchRawCandidates issues one db.query per
 * entry) — they are not branches of a UNION, so none of them inherits column
 * names from the first entry. Without the aliases, pg returns the driver's
 * default names (`?column?` for literals/expressions, `id`, `user_id`, …) and
 * every RawCandidateRow field reads back `undefined`, which renders feed cards
 * with no title, no image and a literal "feedTabs.contentType.undefined"
 * label. Keep the alias list in sync with RawCandidateRow above.
 */
const POPULAR_SOURCES: { sql: string }[] = [
  {
    sql: `SELECT 'moment' AS content_type, id::text AS content_id, user_id::text AS author_id,
            NULL::text AS title, content AS excerpt, media_url AS image_url, created_at,
            (view_count + reactions_count * 3)::numeric AS popularity_score, NULL::text AS tag
          FROM moments WHERE expires_at > NOW()
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'tweet' AS content_type, id::text AS content_id, user_id::text AS author_id,
            NULL::text AS title, content AS excerpt, image_url AS image_url, created_at,
            (likes_count * 2 + replies_count * 3 + retweets_count * 2)::numeric AS popularity_score,
            NULL::text AS tag
          FROM tweets WHERE deleted_at IS NULL AND parent_tweet_id IS NULL
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'blog_post' AS content_type, id::text AS content_id, author_id::text AS author_id,
            title AS title, excerpt AS excerpt, featured_image_url AS image_url, created_at,
            (view_count + like_count * 5 + comment_count * 4 + share_count * 3)::numeric AS popularity_score,
            NULL::text AS tag
          FROM blog_posts WHERE deleted_at IS NULL AND status = 'published'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'forum_thread' AS content_type, id::text AS content_id, author_id::text AS author_id,
            title AS title, NULL::text AS excerpt, NULL::text AS image_url, created_at,
            (view_count + reply_count * 4)::numeric AS popularity_score, NULL::text AS tag
          FROM bb_threads WHERE deleted_at IS NULL AND status = 'visible'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'forum_question' AS content_type, id::text AS content_id, author_id::text AS author_id,
            title AS title, body AS excerpt, NULL::text AS image_url, created_at,
            (vote_score * 3 + answer_count * 4 + favorite_count * 2)::numeric AS popularity_score,
            NULL::text AS tag
          FROM forum_questions WHERE deleted_at IS NULL AND status = 'visible'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'room' AS content_type, id::text AS content_id, creator_id::text AS author_id,
            name AS title, description AS excerpt, cover_image_url AS image_url, created_at,
            (member_count * 3 + total_messages)::numeric AS popularity_score, category AS tag
          FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type <> 'classroom'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'classroom' AS content_type, id::text AS content_id, creator_id::text AS author_id,
            name AS title, description AS excerpt, cover_image_url AS image_url, created_at,
            (member_count * 3 + total_messages)::numeric AS popularity_score, category AS tag
          FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type = 'classroom'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'wiki_page' AS content_type, id::text AS content_id, created_by::text AS author_id,
            title AS title, NULL::text AS excerpt, NULL::text AS image_url, created_at,
            (view_count + revision_count * 2)::numeric AS popularity_score, NULL::text AS tag
          FROM wiki_pages WHERE deleted_at IS NULL AND status = 'published'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'game' AS content_type, id::text AS content_id, creator_id::text AS author_id,
            name AS title, description AS excerpt, cover_image_url AS image_url, created_at,
            (play_count + avg_rating * rating_count * 2 + favorite_count * 3)::numeric AS popularity_score,
            category AS tag
          FROM games
          WHERE deleted_at IS NULL AND is_active = true AND is_public = true
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'poll' AS content_type, id::text AS content_id, creator_id::text AS author_id,
            title AS title, description AS excerpt, NULL::text AS image_url, created_at,
            (voter_count * 3 + view_count + share_count * 2)::numeric AS popularity_score, NULL::text AS tag
          FROM polls WHERE deleted_at IS NULL AND status = 'active'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
  {
    sql: `SELECT 'quiz' AS content_type, id::text AS content_id, creator_id::text AS author_id,
            title AS title, description AS excerpt, NULL::text AS image_url, created_at,
            (attempt_count * 3 + view_count + share_count * 2)::numeric AS popularity_score, NULL::text AS tag
          FROM quizzes WHERE deleted_at IS NULL AND status = 'active'
          ORDER BY popularity_score DESC LIMIT $1`,
  },
];

/** Recent-window velocity source query per content type (tier: organic_trending). Same shape, filtered to last 14 days. */
function trendingSourceFor(popularSql: string): string {
  // Reuse the popular query's SELECT list but restrict to a recent window and
  // let JS compute the velocity score (raw popularity / age) after fetch —
  // avoids duplicating the popularity expression in SQL twice.
  return popularSql.replace(
    /WHERE /,
    `WHERE created_at > NOW() - INTERVAL '14 days' AND `
  );
}

async function fetchRawCandidates(sources: { sql: string }[], limitPerType: number): Promise<RawCandidateRow[]> {
  const orm = await getDb();
  // limitPerType is always an internal constant (PER_TYPE_LIMIT), never
  // user input, so splicing it into the query text via sql.raw is safe —
  // the source SQL text itself is a hardcoded literal, never built from
  // request input either.
  const results = await Promise.allSettled(
    sources.map((s) =>
      orm.execute<RawCandidateRow & Record<string, unknown>>(sql.raw(s.sql.replace("$1", String(limitPerType))))
    )
  );
  const rows: RawCandidateRow[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") rows.push(...r.value.rows);
    else logger.error({ err: r.reason }, "[feed] candidate source query failed — skipping");
  }
  return rows;
}

function toFeedItem(row: RawCandidateRow, tier: FeedTier, inTierScore: number): FeedItem {
  const tags = [row.content_type, row.tag].filter((t): t is string => !!t);
  return {
    contentType: row.content_type,
    contentId: row.content_id,
    authorId: row.author_id,
    title: row.title,
    excerpt: row.excerpt,
    imageUrl: row.image_url,
    url: deepLinkPathFor(row.content_type, row.content_id),
    createdAt: new Date(row.created_at).toISOString(),
    tags,
    engagementScore: Number(row.popularity_score) || 0,
    isBoosted: false,
    isInHouseBoosted: false,
    businessTier: null,
    tier,
    finalScore: computeFinalScore(tier, inTierScore),
  };
}

// ---------------------------------------------------------------------------
// Tier 6/2 — boosted content, split into "boosted" vs "in_house_boosted" by
// the content author's role. Bounded to active campaigns only (typically a
// small set), so a per-row content lookup is acceptable here — this only
// runs from the CRON, not per page request.
// ---------------------------------------------------------------------------

interface ActiveBoostRow {
  campaign_id: string;
  boosted_content_type: FeedContentType;
  boosted_content_id: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  created_at: string;
}

async function fetchBoostedTiers(): Promise<{ boosted: FeedItem[]; inHouse: FeedItem[] }> {
  const orm = await getDb();
  const { rows } = await orm.execute<ActiveBoostRow & Record<string, unknown>>(sql`
    SELECT c.id AS campaign_id, c.boosted_content_type, c.boosted_content_id,
            cr.title, cr.body, cr.image_url, c.created_at
     FROM ad_campaigns c
     JOIN ad_creatives cr ON cr.campaign_id = c.id
     WHERE c.objective IN ('boost_content', 'boost_post', 'boost_room')
       AND c.status = 'active'
       AND c.moderation_status = 'approved'
       AND c.deleted_at IS NULL
       AND c.boosted_content_type IS NOT NULL
       AND c.boosted_content_id IS NOT NULL
       AND (c.start_at IS NULL OR c.start_at <= NOW())
       AND (c.end_at IS NULL OR c.end_at >= NOW())
     ORDER BY c.created_at DESC
     LIMIT 200
  `);

  const boosted: FeedItem[] = [];
  const inHouse: FeedItem[] = [];

  for (const row of rows) {
    const content = await getBoostableContentSummary(row.boosted_content_type, row.boosted_content_id).catch(() => null);
    if (!content) continue; // content deleted since the campaign was created

    let isStaffAuthor = false;
    if (content.ownerId) {
      const { rows: authorRows } = await orm.execute<{ is_admin: boolean; is_moderator: boolean }>(
        sql`SELECT is_admin, is_moderator FROM users WHERE id = ${content.ownerId} LIMIT 1`
      );
      isStaffAuthor = !!(authorRows[0]?.is_admin || authorRows[0]?.is_moderator);
    }

    const tier: FeedTier = isStaffAuthor ? "in_house_boosted" : "boosted";
    const item: FeedItem = {
      contentType: row.boosted_content_type,
      contentId: row.boosted_content_id,
      authorId: content.ownerId,
      title: row.title ?? content.title,
      excerpt: row.body ?? content.body,
      imageUrl: row.image_url ?? content.imageUrl,
      url: deepLinkPathFor(row.boosted_content_type, row.boosted_content_id),
      createdAt: new Date(row.created_at).toISOString(),
      tags: [row.boosted_content_type],
      engagementScore: 0,
      isBoosted: !isStaffAuthor,
      isInHouseBoosted: isStaffAuthor,
      businessTier: null,
      tier,
      // Boosted items sort by campaign recency within their tier — good
      // enough for a small, bounded active-campaign set.
      finalScore: computeFinalScore(tier, 1),
    };
    (isStaffAuthor ? inHouse : boosted).push(item);
  }

  // Re-normalize in-tier score by recency so newer boosts edge out older ones.
  const applyRecency = (items: FeedItem[]) => {
    const scores = normalizeScores(items.map((i) => new Date(i.createdAt).getTime()));
    items.forEach((item, idx) => { item.finalScore = computeFinalScore(item.tier, scores[idx]); });
  };
  applyRecency(boosted);
  applyRecency(inHouse);

  return { boosted, inHouse };
}

// ---------------------------------------------------------------------------
// Tier 3 — non-boosted business page posts, weighted by business_accounts.tier
// ---------------------------------------------------------------------------

interface BusinessPostRow {
  content_id: string;
  author_id: string;
  title: string;
  excerpt: string | null;
  image_url: string | null;
  created_at: string;
  business_tier: string;
}

async function fetchBusinessTier(limit: number): Promise<FeedItem[]> {
  const orm = await getDb();
  const { rows } = await orm.execute<BusinessPostRow & Record<string, unknown>>(sql`
    SELECT p.id::text AS content_id, ba.user_id::text AS author_id, p.title, p.body AS excerpt,
            p.image_url, p.created_at, ba.tier AS business_tier
     FROM business_page_posts p
     JOIN business_pages bp ON bp.id = p.page_id
     JOIN business_accounts ba ON ba.id = bp.business_account_id
     WHERE p.deleted_at IS NULL AND p.status = 'published'
       AND NOT EXISTS (
         SELECT 1 FROM ad_campaigns c
         WHERE c.boosted_content_type = 'business_page_post' AND c.boosted_content_id = p.id
           AND c.status = 'active' AND c.moderation_status = 'approved' AND c.deleted_at IS NULL
       )
     ORDER BY p.created_at DESC
     LIMIT ${limit}
  `);

  const scores = normalizeScores(rows.map((r) => businessTierScore(r.business_tier)));
  return rows.map((row, idx) => ({
    contentType: "business_page_post" as const,
    contentId: row.content_id,
    authorId: row.author_id,
    title: row.title,
    excerpt: row.excerpt,
    imageUrl: row.image_url,
    url: deepLinkPathFor("business_page_post", row.content_id),
    createdAt: new Date(row.created_at).toISOString(),
    tags: ["business_page_post"],
    engagementScore: businessTierScore(row.business_tier),
    isBoosted: false,
    isInHouseBoosted: false,
    businessTier: row.business_tier as FeedItem["businessTier"],
    tier: "business" as const,
    finalScore: computeFinalScore("business", scores[idx]),
  }));
}

// ---------------------------------------------------------------------------
// Candidate pool computation (CRON-only — see app/api/cron/feed-refresh)
// ---------------------------------------------------------------------------

/**
 * Compute the full "for_you" candidate pool: every tier, merged and deduped.
 * Interest-tier (tier 1) scoring is intentionally NOT user-personalized here
 * — the pool is shared across all users; fetchFeedPage() re-weights the
 * already-cached pool per-viewer using their own user_interests rows
 * (a cheap, single small-table read) rather than recomputing the whole pool
 * per user.
 */
export async function computeCandidatePool(tab: "for_you" | "trending"): Promise<FeedItem[]> {
  if (tab === "trending") {
    const raw = await fetchRawCandidates(
      POPULAR_SOURCES.map((s) => ({ sql: trendingSourceFor(s.sql) })),
      PER_TYPE_LIMIT
    );
    const withVelocity = raw.map((r) => ({ row: r, v: velocityScore(Number(r.popularity_score) || 0, r.created_at) }));
    const normalized = normalizeScores(withVelocity.map((x) => x.v));
    const items = withVelocity.map((x, idx) => toFeedItem(x.row, "organic_trending", normalized[idx]));
    return mergeTiers([items]).slice(0, 500);
  }

  // for_you: all tiers.
  const [popularRaw, boostedTiers, businessItems] = await Promise.all([
    fetchRawCandidates(POPULAR_SOURCES, PER_TYPE_LIMIT),
    fetchBoostedTiers(),
    fetchBusinessTier(PER_TYPE_LIMIT),
  ]);

  const popScores = normalizeScores(popularRaw.map((r) => Number(r.popularity_score) || 0));
  const popularItems = popularRaw.map((r, idx) => toFeedItem(r, "organic_popular", popScores[idx]));

  // Trending is also included in the for_you pool as its own tier (distinct
  // from all-time popularity) so genuinely fresh, fast-rising content still
  // surfaces even before it accumulates enough all-time engagement.
  const trendingRaw = await fetchRawCandidates(
    POPULAR_SOURCES.map((s) => ({ sql: trendingSourceFor(s.sql) })),
    PER_TYPE_LIMIT
  );
  const trendVel = trendingRaw.map((r) => velocityScore(Number(r.popularity_score) || 0, r.created_at));
  const trendScores = normalizeScores(trendVel);
  const trendingItems = trendingRaw.map((r, idx) => toFeedItem(r, "organic_trending", trendScores[idx]));

  const merged = mergeTiers([boostedTiers.boosted, popularItems, trendingItems, businessItems, boostedTiers.inHouse]);
  return merged.slice(0, 500);
}

/** Recompute and cache both precomputable pools. Called by the CRON job. */
export async function refreshCandidatePools(): Promise<{ forYouCount: number; trendingCount: number }> {
  const [forYou, trending] = await Promise.all([
    computeCandidatePool("for_you"),
    computeCandidatePool("trending"),
  ]);
  await Promise.all([setCandidatePool("for_you", forYou), setCandidatePool("trending", trending)]);
  return { forYouCount: forYou.length, trendingCount: trending.length };
}

// ---------------------------------------------------------------------------
// Per-request page serving
// ---------------------------------------------------------------------------

interface Cursor { offset: number }

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset } satisfies Cursor)).toString("base64");
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as Cursor;
    return Math.max(0, parsed.offset | 0);
  } catch {
    return 0;
  }
}

function toPublicItem(item: FeedItem): FeedPage["items"][number] {
  const { tier: _tier, finalScore: _finalScore, ...pub } = item;
  return pub;
}

/** Small, single-table read — a user's own interest weights, keyed by lowercased tag. */
async function loadUserInterestWeights(userId: string): Promise<Map<string, number>> {
  const orm = await getDb();
  const { rows } = await orm.execute<{ interest_tag: string; weight: string }>(
    sql`SELECT interest_tag, weight FROM user_interests WHERE user_id = ${userId} ORDER BY weight DESC LIMIT 100`
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.interest_tag.toLowerCase(), (map.get(r.interest_tag.toLowerCase()) ?? 0) + Number(r.weight));
  return map;
}

/**
 * Re-rank the cached "for_you" pool's interest tier (and lightly re-weight
 * everything else by a small interest bonus) for one viewer, then page it.
 * This is the only per-request personalization work — cheap: one small
 * user_interests read + an in-memory re-sort of an already-bounded (<=500
 * item) array. No per-request cross-table aggregation.
 */
async function personalizeAndPaginate(
  pool: FeedItem[],
  userId: string | null,
  cursor: string | null,
  limit: number
): Promise<FeedPage> {
  let items = pool;
  if (userId) {
    const weights = await loadUserInterestWeights(userId);
    if (weights.size > 0) {
      items = pool.map((item) => {
        if (item.tier !== "interest" && item.tier !== "recency") return item;
        const score = interestMatchScore(item, weights);
        return { ...item, finalScore: computeFinalScore(item.tier, Math.min(1, score)) };
      });
      items = [...items].sort((a, b) => b.finalScore - a.finalScore);
    }
  }

  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + limit);
  const nextCursor = offset + limit < items.length ? encodeCursor(offset + limit) : null;
  return { items: page.map(toPublicItem), nextCursor };
}

/** Pure reverse-chronological across a curated content-type subset (see file header). */
async function fetchNewPage(cursor: string | null, limit: number): Promise<FeedPage> {
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { createdAt: string; id: string };
      cursorCreatedAt = decoded.createdAt;
      cursorId = decoded.id;
    } catch {
      // ignore malformed cursor — start from the top
    }
  }

  const orm = await getDb();
  const { rows } = await orm.execute<RawCandidateRow & Record<string, unknown>>(
    // The whole UNION is wrapped in an outer subquery so the cursor WHERE,
    // ORDER BY and LIMIT apply to the COMBINED result. Written inline after
    // the last branch they would bind to that branch alone, where the
    // first branch's output names aren't in scope — pg rejects that with
    // `column "content_id" does not exist` ("...there is a column named
    // content_id in table "*SELECT* 1", but it cannot be referenced from
    // this part of the query"), 500ing the whole tab.
    sql`SELECT * FROM (
       SELECT * FROM (
         SELECT 'moment' AS content_type, id::text AS content_id, user_id::text AS author_id,
                NULL::text AS title, content AS excerpt, media_url AS image_url, created_at,
                0::numeric AS popularity_score, NULL::text AS tag
         FROM moments WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'tweet', id::text, user_id::text, NULL, content, image_url, created_at, 0::numeric, NULL
         FROM tweets WHERE deleted_at IS NULL AND parent_tweet_id IS NULL ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'blog_post', id::text, author_id::text, title, excerpt, featured_image_url, created_at, 0::numeric, NULL
         FROM blog_posts WHERE deleted_at IS NULL AND status = 'published' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'forum_question', id::text, author_id::text, title, body, NULL, created_at, 0::numeric, NULL
         FROM forum_questions WHERE deleted_at IS NULL AND status = 'visible' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'room', id::text, creator_id::text, name, description, cover_image_url, created_at, 0::numeric, category
         FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type <> 'classroom' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'classroom', id::text, creator_id::text, name, description, cover_image_url, created_at, 0::numeric, category
         FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type = 'classroom' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'wiki_page', id::text, created_by::text, title, NULL, NULL, created_at, 0::numeric, NULL
         FROM wiki_pages WHERE deleted_at IS NULL AND status = 'published' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'game', id::text, creator_id::text, name, description, cover_image_url, created_at, 0::numeric, category
         FROM games WHERE deleted_at IS NULL AND is_active = true AND is_public = true ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'poll', id::text, creator_id::text, title, description, NULL, created_at, 0::numeric, NULL
         FROM polls WHERE deleted_at IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 50
       ) x
       UNION ALL
       SELECT * FROM (
         SELECT 'quiz', id::text, creator_id::text, title, description, NULL, created_at, 0::numeric, NULL
         FROM quizzes WHERE deleted_at IS NULL AND status = 'active' ORDER BY created_at DESC LIMIT 50
       ) x
     ) feed
     WHERE ${cursorCreatedAt}::timestamptz IS NULL OR created_at < ${cursorCreatedAt}::timestamptz OR (created_at = ${cursorCreatedAt}::timestamptz AND content_id < ${cursorId})
     ORDER BY created_at DESC, content_id DESC
     LIMIT ${limit}
  `
  );

  const items = rows.map((r) => toFeedItem(r, "recency", 0.5));
  const nextCursor =
    rows.length === limit
      ? Buffer.from(JSON.stringify({ createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].content_id })).toString("base64")
      : null;
  return { items: items.map(toPublicItem), nextCursor };
}

/** Content authored by the viewer's accepted friends OR follows, newest first (curated content-type subset — see file header). */
async function fetchFriendsPage(userId: string, cursor: string | null, limit: number): Promise<FeedPage> {
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { createdAt: string; id: string };
      cursorCreatedAt = decoded.createdAt;
      cursorId = decoded.id;
    } catch {
      // ignore malformed cursor
    }
  }

  // Applied against each source table's RAW author column, which is a uuid.
  // The previous version filtered one level out, against the projected
  // `author_id` alias — but that alias is `<col>::text`, so comparing it to
  // friendships/follows' uuid columns raised
  // `operator does not exist: uuid = text` and 500'd the tab. Filtering on the
  // uuid column directly also keeps the friendships/follows indexes usable.
  const connectedTo = (col: string) => sql`(
    EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND ((f.requester_id = ${userId} AND f.addressee_id = ${sql.raw(col)}) OR (f.addressee_id = ${userId} AND f.requester_id = ${sql.raw(col)})))
    OR EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = ${userId} AND fo.following_id = ${sql.raw(col)})
  )`;

  // As in fetchNewPage, the cursor WHERE/ORDER BY/LIMIT must sit on an outer
  // subquery wrapping the entire UNION, not trail the final branch.
  const orm = await getDb();
  const { rows } = await orm.execute<RawCandidateRow & Record<string, unknown>>(
    sql`SELECT * FROM (
       SELECT * FROM (
         SELECT 'moment' AS content_type, id::text AS content_id, user_id::text AS author_id,
                NULL::text AS title, content AS excerpt, media_url AS image_url, created_at,
                0::numeric AS popularity_score, NULL::text AS tag
         FROM moments WHERE expires_at > NOW() AND ${connectedTo("user_id")}
         ORDER BY created_at DESC LIMIT 30
       ) a
       UNION ALL
       SELECT * FROM (
         SELECT 'tweet', id::text, user_id::text, NULL, content, image_url, created_at, 0::numeric, NULL
         FROM tweets WHERE deleted_at IS NULL AND parent_tweet_id IS NULL AND ${connectedTo("user_id")}
         ORDER BY created_at DESC LIMIT 30
       ) b
       UNION ALL
       SELECT * FROM (
         SELECT 'blog_post', id::text, author_id::text, title, excerpt, featured_image_url, created_at, 0::numeric, NULL
         FROM blog_posts WHERE deleted_at IS NULL AND status = 'published' AND ${connectedTo("author_id")}
         ORDER BY created_at DESC LIMIT 30
       ) c
       UNION ALL
       SELECT * FROM (
         SELECT 'room', id::text, creator_id::text, name, description, cover_image_url, created_at, 0::numeric, category
         FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type <> 'classroom' AND ${connectedTo("creator_id")}
         ORDER BY created_at DESC LIMIT 30
       ) d
       UNION ALL
       SELECT * FROM (
         SELECT 'classroom', id::text, creator_id::text, name, description, cover_image_url, created_at, 0::numeric, category
         FROM rooms WHERE deleted_at IS NULL AND status = 'active' AND type = 'classroom' AND ${connectedTo("creator_id")}
         ORDER BY created_at DESC LIMIT 30
       ) e
       UNION ALL
       SELECT * FROM (
         SELECT 'poll', id::text, creator_id::text, title, description, NULL, created_at, 0::numeric, NULL
         FROM polls WHERE deleted_at IS NULL AND status = 'active' AND ${connectedTo("creator_id")}
         ORDER BY created_at DESC LIMIT 30
       ) f
       UNION ALL
       SELECT * FROM (
         SELECT 'quiz', id::text, creator_id::text, title, description, NULL, created_at, 0::numeric, NULL
         FROM quizzes WHERE deleted_at IS NULL AND status = 'active' AND ${connectedTo("creator_id")}
         ORDER BY created_at DESC LIMIT 30
       ) g
     ) feed
     WHERE ${cursorCreatedAt}::timestamptz IS NULL OR created_at < ${cursorCreatedAt}::timestamptz OR (created_at = ${cursorCreatedAt}::timestamptz AND content_id < ${cursorId})
     ORDER BY created_at DESC, content_id DESC
     LIMIT ${limit}
  `
  );

  const items = rows.map((r) => toFeedItem(r, "recency", 0.5));
  const nextCursor =
    rows.length === limit
      ? Buffer.from(JSON.stringify({ createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].content_id })).toString("base64")
      : null;
  return { items: items.map(toPublicItem), nextCursor };
}

// ---------------------------------------------------------------------------
// Public entry point — app/api/feed reads only from here.
// ---------------------------------------------------------------------------

export async function fetchFeedPage(
  tab: FeedTab,
  userId: string | null,
  cursor: string | null,
  limit: number
): Promise<FeedPage> {
  if (tab === "new") return fetchNewPage(cursor, limit);
  if (tab === "friends") {
    if (!userId) return { items: [], nextCursor: null };
    return fetchFriendsPage(userId, cursor, limit);
  }

  // for_you / trending — served from the cached candidate pool (see cache.ts).
  const pool = await getCandidatePool(tab === "trending" ? "trending" : "for_you", () => computeCandidatePool(tab === "trending" ? "trending" : "for_you"));
  return personalizeAndPaginate(pool, userId, cursor, limit);
}

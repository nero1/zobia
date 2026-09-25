export const dynamic = 'force-dynamic';

/**
 * app/api/search/route.ts
 *
 * GET /api/search?q=<term>&types=people,blogs,wikis,answers,games&range=all&offset=0
 *
 * Unified sitewide search across public content. Aggregates one query per
 * requested content type (same pattern as app/api/users/search/route.ts and
 * app/api/help/search/route.ts — no dedicated search engine, no new
 * infrastructure) into a single UNION ALL, and paginates the merged result
 * set 20 at a time.
 *
 * Matching + ranking (migration 0014_search_trgm_fts.sql):
 * - Each branch matches on EITHER Postgres full-text search
 *   (`search_vector @@ websearch_to_tsquery('english', q)`, a generated
 *   tsvector column, GIN indexed) OR a trigram-indexed `ILIKE '%term%'`
 *   fallback (`pg_trgm`, also GIN indexed). FTS alone would miss short/
 *   partial-word queries ("zob" won't stem-match "zobia"); ILIKE alone has
 *   no ranking or stemming. Combining both keeps every query that used to
 *   match still matching, while adding relevance ranking + stemming for
 *   whole-word queries.
 * - When `q` is non-empty, results are ordered by `ts_rank(search_vector,
 *   tsquery)` (highest relevance first), falling back to recency as a
 *   tiebreak. When `q` is empty (the default "browse" view), rank is a
 *   constant 0 for every row and the order is pure recency, same as before.
 *
 * Each branch only reads columns already indexed for its table's normal
 * listing pages (id/slug, status, deleted_at) — see docs/SEARCH.md for the
 * scalability notes on this approach (a dedicated search service is not
 * needed unless pg_trgm/full-text search stops being fast enough at scale).
 */

import { NextRequest, NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export type SearchContentType = "people" | "blogs" | "wikis" | "answers" | "games";
const ALL_TYPES: SearchContentType[] = ["people", "blogs", "wikis", "answers", "games"];

export type SearchDateRange = "week" | "month" | "quarter" | "year" | "all";
const RANGE_DAYS: Record<Exclude<SearchDateRange, "all">, number> = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

const PAGE_SIZE = 20;

interface SearchResultRow {
  type: SearchContentType;
  id: string;
  title: string;
  snippet: string | null;
  thumbnail_url: string | null;
  url: string;
  published_at: string;
  rank: number;
}

function sinceDate(range: SearchDateRange): Date | null {
  if (range === "all") return null;
  const days = RANGE_DAYS[range];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Per-branch cap, independent of the outer page size. Bounds the amount of
 * work Postgres does per content type before the outer query re-sorts and
 * paginates the merged set — without it, an empty/wide query (the "default
 * browse" view, or a common word) would force a full-table ORDER BY on every
 * table on every request. 100 per type is generous for a "Load more" list
 * that only ever shows 20 at a time; see docs/SEARCH.md for the tradeoff.
 */
const PER_BRANCH_CAP = 100;

/**
 * Build one UNION ALL branch for a content type. `likePattern`, `since` and
 * `q` are always bound in the same order across every branch, since they're
 * spliced together into one query. Each branch is parenthesized so its own
 * ORDER BY/LIMIT applies only to that branch, not to the outer UNION ALL.
 *
 * `q` is the raw (non-empty) search term when present, `null` for the
 * default "browse" view. When present, each branch matches on full-text
 * search OR the trigram-indexed ILIKE fallback (see the file header comment)
 * and computes a `rank` column via `ts_rank` for the outer query to order
 * by; when absent, `rank` is a constant 0 and `likePattern` is `'%'`, so the
 * ILIKE condition alone matches every row exactly as before.
 */
function branchFor(type: SearchContentType, likePattern: string, since: Date | null, q: string | null): SQL {
  const rankExpr = (vectorCol: SQL) =>
    q === null ? sql`0::real` : sql`ts_rank(${vectorCol}, websearch_to_tsquery('english', ${q}))`;
  const ftsOr = (vectorCol: SQL) => (q === null ? sql`` : sql`OR ${vectorCol} @@ websearch_to_tsquery('english', ${q})`);

  switch (type) {
    case "people":
      return sql`
        (SELECT 'people' AS type, u.id::text AS id, u.display_name AS title,
               u.bio AS snippet, NULL::text AS thumbnail_url,
               ('/u/' || u.username) AS url, u.created_at AS published_at,
               ${rankExpr(sql`u.search_vector`)} AS rank
        FROM users u
        WHERE u.deleted_at IS NULL AND u.is_banned = false
          AND (u.username ILIKE ${likePattern} OR u.display_name ILIKE ${likePattern} OR u.bio ILIKE ${likePattern}
               ${ftsOr(sql`u.search_vector`)})
          AND (${since}::timestamptz IS NULL OR u.created_at >= ${since})
        ORDER BY rank DESC, u.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "blogs":
      return sql`
        (SELECT 'blogs' AS type, p.id::text AS id, p.title AS title,
               p.excerpt AS snippet, p.featured_image_url AS thumbnail_url,
               ('/b/' || b.slug || '/' || p.slug) AS url, p.published_at AS published_at,
               ${rankExpr(sql`p.search_vector`)} AS rank
        FROM blog_posts p
        JOIN blogs b ON b.id = p.blog_id
        WHERE p.deleted_at IS NULL AND p.status = 'published'
          AND b.deleted_at IS NULL AND b.status = 'active'
          AND (p.title ILIKE ${likePattern} OR p.excerpt ILIKE ${likePattern} ${ftsOr(sql`p.search_vector`)})
          AND (${since}::timestamptz IS NULL OR p.published_at >= ${since})
        ORDER BY rank DESC, p.published_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "wikis":
      return sql`
        (SELECT 'wikis' AS type, wp.id::text AS id, wp.title AS title,
               NULL::text AS snippet, NULL::text AS thumbnail_url,
               ('/w/' || w.slug || '/' || wp.slug) AS url, wp.created_at AS published_at,
               ${rankExpr(sql`wp.search_vector`)} AS rank
        FROM wiki_pages wp
        JOIN wikis w ON w.id = wp.wiki_id
        WHERE wp.deleted_at IS NULL AND wp.status = 'published'
          AND w.deleted_at IS NULL AND w.status = 'active'
          AND (wp.title ILIKE ${likePattern} ${ftsOr(sql`wp.search_vector`)})
          AND (${since}::timestamptz IS NULL OR wp.created_at >= ${since})
        ORDER BY rank DESC, wp.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "answers":
      return sql`
        (SELECT 'answers' AS type, q.id::text AS id, q.title AS title,
               q.body AS snippet, NULL::text AS thumbnail_url,
               ('/a/' || COALESCE(q.slug, q.id::text)) AS url, q.created_at AS published_at,
               ${rankExpr(sql`q.search_vector`)} AS rank
        FROM forum_questions q
        WHERE q.deleted_at IS NULL AND q.status = 'visible'
          AND (q.title ILIKE ${likePattern} OR q.body ILIKE ${likePattern} ${ftsOr(sql`q.search_vector`)})
          AND (${since}::timestamptz IS NULL OR q.created_at >= ${since})
        ORDER BY rank DESC, q.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "games":
      return sql`
        (SELECT 'games' AS type, g.id::text AS id, g.name AS title,
               g.tagline AS snippet, g.cover_image_url AS thumbnail_url,
               ('/g/' || g.slug) AS url, g.created_at AS published_at,
               ${rankExpr(sql`g.search_vector`)} AS rank
        FROM games g
        WHERE g.deleted_at IS NULL AND g.is_public = true AND g.is_active = true
          AND (g.name ILIKE ${likePattern} OR g.tagline ILIKE ${likePattern} OR g.description ILIKE ${likePattern}
               ${ftsOr(sql`g.search_vector`)})
          AND (${since}::timestamptz IS NULL OR g.created_at >= ${since})
        ORDER BY rank DESC, g.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
  }
}

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";
    // Empty query = the default "most relevant recent stuff across
    // categories" browse view (spec: "Default lists the most relevant stuff
    // from the various content categories"). A 1-character query is neither
    // useful nor cheap to ILIKE-scan, so it's the only rejected case.
    if (q.length === 1) {
      throw badRequest("Search query must be at least 2 characters");
    }
    const likePattern = q.length === 0 ? "%" : `%${q}%`;

    const requestedTypes = (searchParams.get("types")?.split(",").map((t) => t.trim()) ?? ALL_TYPES)
      .filter((t): t is SearchContentType => (ALL_TYPES as string[]).includes(t));
    const types = requestedTypes.length > 0 ? requestedTypes : ALL_TYPES;

    const rangeParam = searchParams.get("range") ?? "all";
    const range: SearchDateRange = (["week", "month", "quarter", "year", "all"] as const).includes(
      rangeParam as SearchDateRange
    )
      ? (rangeParam as SearchDateRange)
      : "all";

    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const since = sinceDate(range);
    const rankQuery = q.length === 0 ? null : q;

    const branches = types.map((t) => branchFor(t, likePattern, since, rankQuery));
    const query = sql`
      SELECT * FROM (
        ${sql.join(branches, sql`\n        UNION ALL\n`)}
      ) results
      ORDER BY rank DESC, published_at DESC
      LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;

    // Fetch one extra row to know whether a "Load more" is warranted without
    // a separate COUNT(*) query (COUNT over a multi-branch UNION ALL scan is
    // expensive and we don't need an exact total, just "is there more").
    const orm = await getDb();
    const { rows } = await orm.execute<SearchResultRow & Record<string, unknown>>(query);

    const hasMore = rows.length > PAGE_SIZE;
    // `rank` only exists to drive the SQL ORDER BY above — not part of the
    // public response shape.
    const results = rows.slice(0, PAGE_SIZE).map((row) => {
      const { type, id, title, snippet, thumbnail_url, url, published_at } = row;
      return { type, id, title, snippet, thumbnail_url, url, published_at };
    });

    return NextResponse.json({
      success: true,
      data: {
        results,
        hasMore,
        nextOffset: hasMore ? offset + PAGE_SIZE : null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

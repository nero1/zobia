export const dynamic = 'force-dynamic';

/**
 * app/api/search/route.ts
 *
 * GET /api/search?q=<term>&types=people,blogs,wikis,answers,games&range=all&offset=0
 *
 * Unified sitewide search across public content. Aggregates one ILIKE query
 * per requested content type (same pattern as app/api/users/search/route.ts
 * and app/api/help/search/route.ts — no dedicated search engine, no new
 * infrastructure) into a single UNION ALL, ordered by recency, and paginates
 * the merged result set 20 at a time.
 *
 * Each branch only reads columns already indexed for its table's normal
 * listing pages (id/slug, status, deleted_at) — see docs/SEARCH.md for the
 * scalability notes on this approach (Postgres ILIKE now, pg_trgm index or a
 * dedicated search service later if query volume/table size ever demands it).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
 * Build one UNION ALL branch for a content type. `like` and `since` are
 * always bound as $1/$2 — every branch uses the same two placeholders, since
 * they're spliced together into one query with identical parameter order.
 * Each branch is parenthesized so its own ORDER BY/LIMIT applies only to
 * that branch, not to the outer UNION ALL.
 */
function branchFor(type: SearchContentType): string {
  switch (type) {
    case "people":
      return `
        (SELECT 'people' AS type, u.id::text AS id, u.display_name AS title,
               u.bio AS snippet, NULL::text AS thumbnail_url,
               ('/u/' || u.username) AS url, u.created_at AS published_at
        FROM users u
        WHERE u.deleted_at IS NULL AND u.is_banned = false
          AND (u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.bio ILIKE $1)
          AND ($2::timestamptz IS NULL OR u.created_at >= $2)
        ORDER BY u.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "blogs":
      return `
        (SELECT 'blogs' AS type, p.id::text AS id, p.title AS title,
               p.excerpt AS snippet, p.featured_image_url AS thumbnail_url,
               ('/b/' || b.slug || '/' || p.slug) AS url, p.published_at AS published_at
        FROM blog_posts p
        JOIN blogs b ON b.id = p.blog_id
        WHERE p.deleted_at IS NULL AND p.status = 'published'
          AND b.deleted_at IS NULL AND b.status = 'active'
          AND (p.title ILIKE $1 OR p.excerpt ILIKE $1)
          AND ($2::timestamptz IS NULL OR p.published_at >= $2)
        ORDER BY p.published_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "wikis":
      return `
        (SELECT 'wikis' AS type, wp.id::text AS id, wp.title AS title,
               NULL::text AS snippet, NULL::text AS thumbnail_url,
               ('/w/' || w.slug || '/' || wp.slug) AS url, wp.created_at AS published_at
        FROM wiki_pages wp
        JOIN wikis w ON w.id = wp.wiki_id
        WHERE wp.deleted_at IS NULL AND wp.status = 'published'
          AND w.deleted_at IS NULL AND w.status = 'active'
          AND wp.title ILIKE $1
          AND ($2::timestamptz IS NULL OR wp.created_at >= $2)
        ORDER BY wp.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "answers":
      return `
        (SELECT 'answers' AS type, q.id::text AS id, q.title AS title,
               q.body AS snippet, NULL::text AS thumbnail_url,
               ('/a/' || COALESCE(q.slug, q.id::text)) AS url, q.created_at AS published_at
        FROM forum_questions q
        WHERE q.deleted_at IS NULL AND q.status = 'visible'
          AND (q.title ILIKE $1 OR q.body ILIKE $1)
          AND ($2::timestamptz IS NULL OR q.created_at >= $2)
        ORDER BY q.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
    case "games":
      return `
        (SELECT 'games' AS type, g.id::text AS id, g.name AS title,
               g.tagline AS snippet, g.cover_image_url AS thumbnail_url,
               ('/g/' || g.slug) AS url, g.created_at AS published_at
        FROM games g
        WHERE g.deleted_at IS NULL AND g.is_public = true AND g.is_active = true
          AND (g.name ILIKE $1 OR g.tagline ILIKE $1 OR g.description ILIKE $1)
          AND ($2::timestamptz IS NULL OR g.created_at >= $2)
        ORDER BY g.created_at DESC LIMIT ${PER_BRANCH_CAP})`;
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

    const query = `
      SELECT * FROM (
        ${types.map(branchFor).join("\n        UNION ALL\n")}
      ) results
      ORDER BY published_at DESC
      LIMIT $3 OFFSET $4`;

    // Fetch one extra row to know whether a "Load more" is warranted without
    // a separate COUNT(*) query (COUNT over a multi-branch UNION ALL LIKE
    // scan is expensive and we don't need an exact total, just "is there more").
    const { rows } = await db.query<SearchResultRow>(query, [
      likePattern,
      sinceDate(range),
      PAGE_SIZE + 1,
      offset,
    ]);

    const hasMore = rows.length > PAGE_SIZE;
    const results = rows.slice(0, PAGE_SIZE);

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

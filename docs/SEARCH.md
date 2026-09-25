# Sitewide Search

## What it is

A universal search icon/menu item (web, PWA, and the Capacitor Android app)
opens `/search`, a single results page that searches across content
categories at once: **People, Blogs, Wikis, Answers, Games**. It supports:

- Multi-select category filters (search only the categories you pick).
- A date-published filter: This week / This month / This quarter / This
  year / All time.
- A default "browse" view (no query typed) that shows the most recent public
  content across the selected categories — same endpoint, just an empty `q`.
- Results paginated 20 at a time behind a "Load more" button.
- Ad slots at the top, after the 3rd result, after the 8th result, and at
  the bottom of the loaded list (`search_top` / `search_after_3` /
  `search_after_8` / `search_bottom` — see
  `db/migrations/0011_search_ad_placements.sql`), all going through the
  existing `<AdSlot/>` component, which already enforces per-plan ad
  visibility server-side. No new ad logic was added for this feature.

## How it works

`GET /api/search?q=&types=&range=&offset=` (`apps/web/app/api/search/route.ts`)
runs one `SELECT` per requested category, `UNION ALL`s them into a single
ordered, paginated result set, and returns it. This mirrors the existing
search endpoints in the codebase (`/api/users/search`, `/api/help/search`)
rather than introducing a new search stack — no
Elasticsearch/Algolia/Meilisearch, no separate index to keep in sync, no
extra service to pay for or operate.

**Matching + ranking** (migration `0014_search_trgm_fts.sql` — both of the
upgrades described below have now been applied): each category branch
matches rows on EITHER Postgres full-text search
(`search_vector @@ websearch_to_tsquery('english', q)`, a generated `tsvector`
column per table, GIN-indexed) OR a `pg_trgm`-indexed `ILIKE '%term%'`
fallback. Both conditions are indexed, so this is still a single
index-accelerated query per branch, not a sequential scan:

- Full-text search alone would miss short/partial-word queries — "zob" does
  not stem-match "zobia" — so the trigram `ILIKE` fallback keeps every query
  that used to match still matching.
- The `ILIKE`-only approach had no ranking or stemming, so `search_vector` +
  `ts_rank` is layered on top to order whole/stemmed-word matches by
  relevance instead of pure recency.
- When `q` is non-empty, each branch is ordered by `ts_rank(search_vector,
  tsquery) DESC`, falling back to recency as a tiebreak, and the outer
  `UNION ALL` re-sorts the merged set the same way. When `q` is empty (the
  default "browse" view), rank is a constant `0` for every row and ordering
  is pure recency, unchanged from before this migration.
- `search_vector` is a `GENERATED ALWAYS AS (...) STORED` column — Postgres
  keeps it in sync on every insert/update automatically, no trigger or
  application code required.

Each category branch only reads rows that are already publicly visible on
their own listing pages (published/active, not deleted, not banned), so
search can never surface gated or removed content, and each branch is capped
at 100 rows (`PER_BRANCH_CAP`) before the outer query re-sorts and paginates
the merged set — this bounds the worst case (an empty query, or a common
word matching a huge fraction of a table) to a fixed amount of per-request
work regardless of how large any one table grows.

The Capacitor Android app calls the exact same `GET /api/search` endpoint
(`apps/android/src/routes/search.tsx`) — there is only one search backend,
so behavior never drifts between platforms.

## Scalability & resource notes (read before this needs to change)

**Where this approach is fine as-is:**
- Low-to-moderate query-per-second search volume (this is a niche action —
  most users use per-page search, e.g. Blogs' own list filter — sitewide
  search is a convenience layer on top, not the primary browse path).
- Table sizes where a `ILIKE '%term%'` scan over an indexed `(status,
  deleted_at, created_at)` filtered subset stays fast — Postgres can use a
  partial/composite index to narrow the scan before the `ILIKE`, and each
  branch's row cap keeps the sort/limit cost flat.
- The current infra: no dedicated search service, no additional Redis calls
  (this endpoint makes **zero** Redis calls — it's pure Postgres, which
  matters on a free/low-tier Redis plan), no background indexing job to
  maintain.

**Where this approach starts to hurt, and what to do about it:**
1. ~~**`ILIKE '%term%'` can't use a plain B-tree index**~~ — **done**
   (migration `0014_search_trgm_fts.sql`). The leading `%` in `ILIKE
   '%term%'` defeats plain B-tree prefix matching, so at small-to-medium
   table sizes Postgres was sequential-scanning the filtered set; once any
   one searched table reaches the high hundreds-of-thousands to
   low-millions of rows, that scan starts showing up in query latency. The
   `pg_trgm` extension is now enabled with a `GIN` trigram index per
   searched column (`CREATE INDEX ... USING gin (title gin_trgm_ops)`),
   which turns `ILIKE '%term%'` into an index-accelerated lookup.
2. ~~**No relevance ranking**~~ — **done** (migration
   `0014_search_trgm_fts.sql`). Results used to be ordered purely by
   recency (no term-frequency scoring, no typo tolerance, no stemming).
   Each searched table now has a generated `search_vector` `tsvector`
   column (GIN indexed), and `app/api/search/route.ts` matches with
   `websearch_to_tsquery('english', q)` and orders by `ts_rank(...)` when a
   query is present — real relevance ranking and stemming, entirely inside
   Postgres, no new service.
3. **A dedicated search engine** (Meilisearch/Typesense/OpenSearch/Algolia)
   only becomes worth the operational cost (a service to run and pay for,
   an index to keep in sync with Postgres via triggers/CDC/a queue) once
   you need things Postgres genuinely can't do well: fuzzy/typo-tolerant
   matching at scale, faceted search UIs, sub-50ms latency at high QPS
   across tens of millions of rows, or search-as-you-type autocomplete.
   Given this app's current infra constraints (serverless/Vercel Hobby,
   free-tier Redis, no dedicated search cluster), that point is likely far
   off — cross it only when `pg_trgm`/full-text stops being fast enough in
   practice, not preemptively.
4. **Cost/resource shape today**: one Postgres query per search request,
   fanned out into up to 5 `UNION ALL` branches (fewer if the user
   deselects categories) — this is the dominant cost, entirely inside the
   existing Postgres connection pool, with no Redis, no external API calls,
   and no background jobs. The `PER_BRANCH_CAP` (100 rows/branch) is the
   main scalability lever available without any infra change: lowering it
   reduces worst-case query cost at the expense of how deep "Load more" can
   page within a single category.

## Files

- `apps/web/app/api/search/route.ts` — the search endpoint (web + Android +
  PWA all call this one endpoint).
- `apps/web/app/(app)/search/page.tsx` — web/PWA results page.
- `apps/android/src/routes/search.tsx` — Capacitor Android results page.
- `apps/web/components/layout/Navbar.tsx` / `Sidebar.tsx` — search icon +
  menu item (web).
- `apps/android/src/components/layout/TopBar.tsx` — search icon + menu item
  (Android).
- `db/migrations/0011_search_ad_placements.sql` — registers the four ad
  placement keys this page uses.
- `db/migrations/0014_search_trgm_fts.sql` — enables `pg_trgm`, adds a GIN
  trigram index per searched column, and adds a generated `search_vector`
  tsvector column (+ GIN index) per searched table for `ts_rank` relevance
  ranking.

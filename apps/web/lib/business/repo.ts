/**
 * lib/business/repo.ts
 *
 * Business Pages — read/write queries. Mirrors lib/blogs/repo.ts's row-shape
 * and stats-tier conventions (business pages are the Business Accounts
 * equivalent of a blog: owner-managed, slugged, with a lightweight post
 * feed and per-day stats rollup).
 */

import { db } from "@/lib/db";

/** Minimal shape of a DB client exposing a parameterised `query` — accepts either `db` or a transaction client. */
interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface BusinessPageRow {
  id: string;
  business_account_id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  status: string;
  status_reason: string | null;
  view_count: number;
  post_count: number;
  created_at: string;
  updated_at: string;
}

const PAGE_SELECT = `
  SELECT id, business_account_id, slug, name, bio, avatar_url, cover_image_url,
         status, status_reason, view_count, post_count, created_at, updated_at
  FROM business_pages
  WHERE deleted_at IS NULL
`;

export async function getBusinessPageById(pageId: string, client: Queryable = db): Promise<BusinessPageRow | null> {
  const { rows } = await client.query<BusinessPageRow>(`${PAGE_SELECT} AND id = $1 LIMIT 1`, [pageId]);
  return rows[0] ?? null;
}

export async function getBusinessPageBySlug(slug: string, client: Queryable = db): Promise<BusinessPageRow | null> {
  const { rows } = await client.query<BusinessPageRow>(`${PAGE_SELECT} AND slug = $1 LIMIT 1`, [slug]);
  return rows[0] ?? null;
}

export async function listBusinessPagesForAccount(
  businessAccountId: string,
  client: Queryable = db
): Promise<BusinessPageRow[]> {
  const { rows } = await client.query<BusinessPageRow>(
    `${PAGE_SELECT} AND business_account_id = $1 ORDER BY created_at ASC`,
    [businessAccountId]
  );
  return rows;
}

export async function countActiveBusinessPages(businessAccountId: string, client: Queryable = db): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM business_pages
     WHERE business_account_id = $1 AND deleted_at IS NULL AND status <> 'deactivated'`,
    [businessAccountId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface BusinessPagePostRow {
  id: string;
  page_id: string;
  title: string;
  body: string;
  image_url: string | null;
  status: string;
  view_count: number;
  created_at: string;
  updated_at: string;
}

const POST_SELECT = `
  SELECT id, page_id, title, body, image_url, status, view_count, created_at, updated_at
  FROM business_page_posts
  WHERE deleted_at IS NULL
`;

export async function listBusinessPagePosts(
  pageId: string,
  opts: { publishedOnly?: boolean } = {},
  client: Queryable = db
): Promise<BusinessPagePostRow[]> {
  const { rows } = await client.query<BusinessPagePostRow>(
    `${POST_SELECT} AND page_id = $1 ${opts.publishedOnly ? "AND status = 'published'" : ""} ORDER BY created_at DESC`,
    [pageId]
  );
  return rows;
}

export async function getBusinessPagePostById(postId: string, client: Queryable = db): Promise<BusinessPagePostRow | null> {
  const { rows } = await client.query<BusinessPagePostRow>(`${POST_SELECT} AND id = $1 LIMIT 1`, [postId]);
  return rows[0] ?? null;
}

/**
 * Record one page view. Deduped client-side via localStorage (mirrors
 * lib/blogs/service.ts recordView) so this stays a cheap single UPDATE +
 * daily-stats upsert, not a per-view DB row.
 */
export async function recordBusinessPageView(pageId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE business_pages SET view_count = view_count + 1 WHERE id = $1 AND deleted_at IS NULL`, [pageId]);
    await tx.query(
      `INSERT INTO business_page_daily_stats (page_id, date, views) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (page_id, date) DO UPDATE SET views = business_page_daily_stats.views + 1`,
      [pageId]
    );
  });
}

// ---------------------------------------------------------------------------
// Stats (mirrors lib/blogs/repo.ts getBlogStatsTotals / *Breakdown / *DailyStats)
// ---------------------------------------------------------------------------

export interface BusinessStatsTotals {
  page_count: number;
  total_views: number;
  total_post_views: number;
  total_ad_impressions: number;
  total_ad_clicks: number;
}

export async function getBusinessStatsTotals(businessAccountId: string): Promise<BusinessStatsTotals> {
  const { rows } = await db.query<BusinessStatsTotals>(
    `SELECT
       COUNT(DISTINCT p.id)::int AS page_count,
       COALESCE(SUM(p.view_count), 0)::int AS total_views,
       COALESCE((SELECT SUM(s.post_views) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = $1), 0)::int AS total_post_views,
       COALESCE((SELECT SUM(s.ad_impressions) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = $1), 0)::int AS total_ad_impressions,
       COALESCE((SELECT SUM(s.ad_clicks) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = $1), 0)::int AS total_ad_clicks
     FROM business_pages p
     WHERE p.business_account_id = $1 AND p.deleted_at IS NULL`,
    [businessAccountId]
  );
  return rows[0] ?? { page_count: 0, total_views: 0, total_post_views: 0, total_ad_impressions: 0, total_ad_clicks: 0 };
}

export interface BusinessPageStatsRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  view_count: number;
  post_count: number;
  ad_impressions: number;
  ad_clicks: number;
}

export async function getBusinessPageStatsBreakdown(businessAccountId: string): Promise<BusinessPageStatsRow[]> {
  const { rows } = await db.query<BusinessPageStatsRow>(
    `SELECT p.id, p.name, p.slug, p.status, p.view_count, p.post_count,
            COALESCE((SELECT SUM(s.ad_impressions) FROM business_page_daily_stats s WHERE s.page_id = p.id), 0)::int AS ad_impressions,
            COALESCE((SELECT SUM(s.ad_clicks) FROM business_page_daily_stats s WHERE s.page_id = p.id), 0)::int AS ad_clicks
     FROM business_pages p
     WHERE p.business_account_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.created_at ASC`,
    [businessAccountId]
  );
  return rows;
}

export interface BusinessDailyStatsRow {
  date: string;
  page_id: string;
  page_name: string;
  views: number;
  post_views: number;
  ad_impressions: number;
  ad_clicks: number;
}

export async function getBusinessDailyStats(businessAccountId: string, days: number): Promise<BusinessDailyStatsRow[]> {
  const { rows } = await db.query<BusinessDailyStatsRow>(
    `SELECT s.date::text, s.page_id, p.name AS page_name, s.views, s.post_views, s.ad_impressions, s.ad_clicks
     FROM business_page_daily_stats s
     JOIN business_pages p ON p.id = s.page_id
     WHERE p.business_account_id = $1 AND s.date >= CURRENT_DATE - $2::int
     ORDER BY s.date DESC, p.name ASC`,
    [businessAccountId, days]
  );
  return rows;
}

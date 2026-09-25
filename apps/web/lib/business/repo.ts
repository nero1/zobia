/**
 * lib/business/repo.ts
 *
 * Business Pages — read/write queries. Mirrors lib/blogs/repo.ts's row-shape
 * and stats-tier conventions (business pages are the Business Accounts
 * equivalent of a blog: owner-managed, slugged, with a lightweight post
 * feed and per-day stats rollup).
 */

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";

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

function toPageRow(row: typeof schema.businessPages.$inferSelect): BusinessPageRow {
  return {
    id: row.id,
    business_account_id: row.businessAccountId,
    slug: row.slug,
    name: row.name,
    bio: row.bio,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    status: row.status,
    status_reason: row.statusReason,
    view_count: row.viewCount,
    post_count: row.postCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function getBusinessPageById(pageId: string, client?: DbOrTx): Promise<BusinessPageRow | null> {
  const orm = client ?? (await getDb());
  const [row] = await orm
    .select()
    .from(schema.businessPages)
    .where(and(isNull(schema.businessPages.deletedAt), eq(schema.businessPages.id, pageId)))
    .limit(1);
  return row ? toPageRow(row) : null;
}

export async function getBusinessPageBySlug(slug: string, client?: DbOrTx): Promise<BusinessPageRow | null> {
  const orm = client ?? (await getDb());
  const [row] = await orm
    .select()
    .from(schema.businessPages)
    .where(and(isNull(schema.businessPages.deletedAt), eq(schema.businessPages.slug, slug)))
    .limit(1);
  return row ? toPageRow(row) : null;
}

export async function listBusinessPagesForAccount(
  businessAccountId: string,
  client?: DbOrTx
): Promise<BusinessPageRow[]> {
  const orm = client ?? (await getDb());
  const rows = await orm
    .select()
    .from(schema.businessPages)
    .where(and(isNull(schema.businessPages.deletedAt), eq(schema.businessPages.businessAccountId, businessAccountId)))
    .orderBy(asc(schema.businessPages.createdAt));
  return rows.map(toPageRow);
}

export async function countActiveBusinessPages(businessAccountId: string, client?: DbOrTx): Promise<number> {
  const orm = client ?? (await getDb());
  const [row] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.businessPages)
    .where(
      and(
        eq(schema.businessPages.businessAccountId, businessAccountId),
        isNull(schema.businessPages.deletedAt),
        ne(schema.businessPages.status, "deactivated")
      )
    );
  return row?.count ?? 0;
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

function toPostRow(row: typeof schema.businessPagePosts.$inferSelect): BusinessPagePostRow {
  return {
    id: row.id,
    page_id: row.pageId,
    title: row.title,
    body: row.body,
    image_url: row.imageUrl,
    status: row.status,
    view_count: row.viewCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listBusinessPagePosts(
  pageId: string,
  opts: { publishedOnly?: boolean } = {},
  client?: DbOrTx
): Promise<BusinessPagePostRow[]> {
  const orm = client ?? (await getDb());
  const rows = await orm
    .select()
    .from(schema.businessPagePosts)
    .where(
      and(
        isNull(schema.businessPagePosts.deletedAt),
        eq(schema.businessPagePosts.pageId, pageId),
        opts.publishedOnly ? eq(schema.businessPagePosts.status, "published") : undefined
      )
    )
    .orderBy(desc(schema.businessPagePosts.createdAt));
  return rows.map(toPostRow);
}

export async function getBusinessPagePostById(postId: string, client?: DbOrTx): Promise<BusinessPagePostRow | null> {
  const orm = client ?? (await getDb());
  const [row] = await orm
    .select()
    .from(schema.businessPagePosts)
    .where(and(isNull(schema.businessPagePosts.deletedAt), eq(schema.businessPagePosts.id, postId)))
    .limit(1);
  return row ? toPostRow(row) : null;
}

/**
 * Record one page view. Deduped client-side via localStorage (mirrors
 * lib/blogs/service.ts recordView) so this stays a cheap single UPDATE +
 * daily-stats upsert, not a per-view DB row.
 */
export async function recordBusinessPageView(pageId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx
      .update(schema.businessPages)
      .set({ viewCount: sql`${schema.businessPages.viewCount} + 1` })
      .where(and(eq(schema.businessPages.id, pageId), isNull(schema.businessPages.deletedAt)));

    await tx
      .insert(schema.businessPageDailyStats)
      .values({ pageId, date: sql`CURRENT_DATE`, views: 1 })
      .onConflictDoUpdate({
        target: [schema.businessPageDailyStats.pageId, schema.businessPageDailyStats.date],
        set: { views: sql`${schema.businessPageDailyStats.views} + 1` },
      });
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
  const orm = await getDb();
  const { rows } = await orm.execute<BusinessStatsTotals & Record<string, unknown>>(sql`
    SELECT
      COUNT(DISTINCT p.id)::int AS page_count,
      COALESCE(SUM(p.view_count), 0)::int AS total_views,
      COALESCE((SELECT SUM(s.post_views) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = ${businessAccountId}), 0)::int AS total_post_views,
      COALESCE((SELECT SUM(s.ad_impressions) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = ${businessAccountId}), 0)::int AS total_ad_impressions,
      COALESCE((SELECT SUM(s.ad_clicks) FROM business_page_daily_stats s JOIN business_pages pp ON pp.id = s.page_id WHERE pp.business_account_id = ${businessAccountId}), 0)::int AS total_ad_clicks
    FROM business_pages p
    WHERE p.business_account_id = ${businessAccountId} AND p.deleted_at IS NULL
  `);
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
  const orm = await getDb();
  const { rows } = await orm.execute<BusinessPageStatsRow & Record<string, unknown>>(sql`
    SELECT p.id, p.name, p.slug, p.status, p.view_count, p.post_count,
           COALESCE((SELECT SUM(s.ad_impressions) FROM business_page_daily_stats s WHERE s.page_id = p.id), 0)::int AS ad_impressions,
           COALESCE((SELECT SUM(s.ad_clicks) FROM business_page_daily_stats s WHERE s.page_id = p.id), 0)::int AS ad_clicks
    FROM business_pages p
    WHERE p.business_account_id = ${businessAccountId} AND p.deleted_at IS NULL
    ORDER BY p.created_at ASC
  `);
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
  const orm = await getDb();
  const { rows } = await orm.execute<BusinessDailyStatsRow & Record<string, unknown>>(sql`
    SELECT s.date::text, s.page_id, p.name AS page_name, s.views, s.post_views, s.ad_impressions, s.ad_clicks
    FROM business_page_daily_stats s
    JOIN business_pages p ON p.id = s.page_id
    WHERE p.business_account_id = ${businessAccountId} AND s.date >= CURRENT_DATE - ${days}::int
    ORDER BY s.date DESC, p.name ASC
  `);
  return rows;
}

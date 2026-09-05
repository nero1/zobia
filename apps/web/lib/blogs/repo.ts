/**
 * lib/blogs/repo.ts
 *
 * Blogs — read queries (discovery, single blog/post lookups, listings).
 * Mirrors lib/forum/repo.ts's cursor-pagination and row-shape conventions.
 */

import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import type { BlogMenuConfig } from "@/lib/blogs/menu";

export interface BlogSummaryRow {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  tagline: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  status: string;
  subscriber_count: number;
  show_subscriber_count: boolean;
  post_count: number;
  created_at: string;
  owner_username: string | null;
}

export type BlogTab = "popular" | "trending" | "new" | "random" | "subscribed";

const BLOG_SELECT = `
  SELECT b.id, b.owner_id, b.slug, b.title, b.tagline, b.avatar_url, b.cover_image_url,
         b.status, b.subscriber_count, b.show_subscriber_count, b.post_count, b.created_at,
         u.username AS owner_username
  FROM blogs b
  JOIN users u ON u.id = b.owner_id
  WHERE b.status = 'active' AND b.deleted_at IS NULL
`;

export interface ListBlogsResult {
  blogs: BlogSummaryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * "Subscribed" tab — blogs the given user is subscribed to, sorted by most
 * recently updated first. "Updated" means the most recent *published*
 * article (blogs.updated_at is not bumped when a draft is later published —
 * see lib/blogs/service.ts updatePost — so a MAX(published_at) drill-down
 * is used instead), falling back to the blog's creation date for blogs with
 * no published articles yet. Cursor-paginated on the compound
 * (sortKey, id) tuple since the sort key isn't the id itself.
 */
async function listSubscribedBlogs(
  userId: string,
  cursor: string | null,
  limit: number,
  search?: string
): Promise<ListBlogsResult> {
  const params: SqlParam[] = [userId];
  let where = "";
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    where += ` AND b.title ILIKE $${params.length}`;
  }

  let cursorClause = "";
  if (cursor) {
    const [cursorSortKey, cursorId] = cursor.split("_");
    if (cursorSortKey && cursorId) {
      params.push(cursorSortKey, cursorId);
      cursorClause = ` AND (COALESCE(lp.last_post_at, b.created_at), b.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
  }

  params.push(limit + 1);
  const { rows } = await db.query<BlogSummaryRow & { sort_key: string }>(
    `SELECT b.id, b.owner_id, b.slug, b.title, b.tagline, b.avatar_url, b.cover_image_url,
            b.status, b.subscriber_count, b.show_subscriber_count, b.post_count, b.created_at,
            u.username AS owner_username,
            COALESCE(lp.last_post_at, b.created_at) AS sort_key
     FROM blogs b
     JOIN users u ON u.id = b.owner_id
     JOIN blog_subscriptions sub ON sub.blog_id = b.id AND sub.user_id = $1
     LEFT JOIN LATERAL (
       SELECT MAX(p.published_at) AS last_post_at FROM blog_posts p
       WHERE p.blog_id = b.id AND p.status = 'published' AND p.deleted_at IS NULL
     ) lp ON true
     WHERE b.status = 'active' AND b.deleted_at IS NULL${where}${cursorClause}
     ORDER BY COALESCE(lp.last_post_at, b.created_at) DESC, b.id DESC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    blogs: page,
    nextCursor: hasMore && last ? `${new Date(last.sort_key).toISOString()}_${last.id}` : null,
    hasMore,
  };
}

export async function listBlogs(
  tab: BlogTab,
  cursor: string | null,
  limit: number,
  search?: string,
  userId?: string
): Promise<ListBlogsResult> {
  if (tab === "subscribed") {
    if (!userId) return { blogs: [], nextCursor: null, hasMore: false };
    return listSubscribedBlogs(userId, cursor, limit, search);
  }

  const params: SqlParam[] = [];
  let where = "";
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    where += ` AND b.title ILIKE $${params.length}`;
  }

  let orderBy = "b.subscriber_count DESC, b.post_count DESC";
  if (tab === "trending") orderBy = "b.subscriber_count DESC, b.created_at DESC";
  else if (tab === "new") orderBy = "b.created_at DESC";
  else if (tab === "random") orderBy = "RANDOM()";

  let cursorClause = "";
  if (cursor && tab !== "random") {
    params.push(cursor);
    cursorClause = ` AND b.id < $${params.length}::uuid`;
  }

  params.push(limit + 1);
  const { rows } = await db.query<BlogSummaryRow>(
    `${BLOG_SELECT}${where}${cursorClause} ORDER BY ${orderBy} LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    blogs: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
  };
}

export interface BlogRow {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  theme_store_item_id: string | null;
  active_theme_id: string;
  comments_enabled: boolean;
  comments_moderation_enabled: boolean;
  hide_author_info: boolean;
  show_subscriber_count: boolean;
  status: string;
  status_reason: string | null;
  subscriber_count: number;
  post_count: number;
  business_account_id: string | null;
  slot_source: string;
  slot_unlock_currency: string | null;
  slot_unlock_cost: number | null;
  slot_unlock_reference_id: string | null;
  menu_config: BlogMenuConfig;
  created_at: string;
  owner_username: string | null;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
}

export async function getBlogBySlug(slug: string): Promise<BlogRow | null> {
  const { rows } = await db.query<BlogRow>(
    `SELECT b.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM blogs b JOIN users u ON u.id = b.owner_id
     WHERE b.slug = $1 AND b.deleted_at IS NULL LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

/**
 * All blogs owned by a user — personal (business_account_id IS NULL) and,
 * since owner_id on a business blog is the business account's owner user,
 * business blogs too. This is the single query behind GET /api/blogs/me:
 * "my blogs across personal + business scopes" needs nothing more than
 * filtering this list by `business_account_id`.
 */
export async function getBlogsByOwner(ownerId: string): Promise<BlogRow[]> {
  const { rows } = await db.query<BlogRow>(
    `SELECT b.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM blogs b JOIN users u ON u.id = b.owner_id
     WHERE b.owner_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.created_at ASC`,
    [ownerId]
  );
  return rows;
}

/** Blogs belonging to a specific business account (business-scope blogs only). */
export async function getBlogsByBusinessAccount(businessAccountId: string): Promise<BlogRow[]> {
  const { rows } = await db.query<BlogRow>(
    `SELECT b.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM blogs b JOIN users u ON u.id = b.owner_id
     WHERE b.business_account_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.created_at ASC`,
    [businessAccountId]
  );
  return rows;
}

/** Active (non-deactivated, non-deleted) blog count for a scope — used by quota checks. Pass a TransactionClient to read under a row lock. */
export async function countActiveBlogsForScope(
  scope: { ownerId: string; businessAccountId: string | null },
  tx?: TransactionClient
): Promise<number> {
  const client = tx ?? db;
  const { rows } = await client.query<{ count: string }>(
    scope.businessAccountId
      ? `SELECT COUNT(*)::text AS count FROM blogs WHERE business_account_id = $1 AND deleted_at IS NULL AND status != 'deactivated'`
      : `SELECT COUNT(*)::text AS count FROM blogs WHERE owner_id = $1 AND business_account_id IS NULL AND deleted_at IS NULL AND status != 'deactivated'`,
    [scope.businessAccountId ?? scope.ownerId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

export interface BlogPostSummaryRow {
  id: string;
  blog_id: string;
  category_id: string | null;
  type: string;
  title: string;
  slug: string;
  /** 'about'|'privacy'|'contact' for an auto-generated default page (migration 0023), else null. */
  page_key: string | null;
  excerpt: string | null;
  featured_image_url: string | null;
  status: string;
  is_paywalled: boolean;
  paywall_credits_cost: number;
  word_count: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  sort_order: number;
  published_at: string | null;
  created_at: string;
  category_name: string | null;
}

export async function listBlogPosts(
  blogId: string,
  opts: {
    type?: "article" | "page";
    status?: "draft" | "published" | "all";
    categoryId?: string | null;
    cursor?: string | null;
    limit: number;
  }
): Promise<{ posts: BlogPostSummaryRow[]; nextCursor: string | null; hasMore: boolean }> {
  const params: SqlParam[] = [blogId];
  let where = "WHERE p.blog_id = $1 AND p.deleted_at IS NULL";

  if (opts.type) {
    params.push(opts.type);
    where += ` AND p.type = $${params.length}`;
  }
  if (!opts.status || opts.status === "published") {
    where += ` AND p.status = 'published'`;
  } else if (opts.status === "draft") {
    where += ` AND p.status = 'draft'`;
  }
  if (opts.categoryId) {
    params.push(opts.categoryId);
    where += ` AND p.category_id = $${params.length}`;
  }
  if (opts.cursor) {
    params.push(opts.cursor);
    where += ` AND p.id < $${params.length}::uuid`;
  }

  const orderBy = opts.type === "page" ? "p.sort_order ASC, p.created_at ASC" : "p.published_at DESC NULLS LAST, p.created_at DESC";

  params.push(opts.limit + 1);
  const { rows } = await db.query<BlogPostSummaryRow>(
    `SELECT p.id, p.blog_id, p.category_id, p.type, p.title, p.slug, p.page_key, p.excerpt, p.featured_image_url,
            p.status, p.is_paywalled, p.paywall_credits_cost, p.word_count, p.view_count, p.like_count,
            p.comment_count, p.sort_order, p.published_at, p.created_at,
            c.name AS category_name
     FROM blog_posts p
     LEFT JOIN blog_categories c ON c.id = p.category_id
     ${where}
     ORDER BY ${orderBy}
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    posts: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
  };
}

export interface BlogPostRow extends BlogPostSummaryRow {
  author_id: string;
  body_markdown: string;
  body_html: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
}

export async function getBlogPostBySlug(blogId: string, postSlug: string): Promise<BlogPostRow | null> {
  const { rows } = await db.query<BlogPostRow>(
    `SELECT p.*, c.name AS category_name,
            u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
     FROM blog_posts p
     LEFT JOIN blog_categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.author_id
     WHERE p.blog_id = $1 AND p.slug = $2 AND p.deleted_at IS NULL
     LIMIT 1`,
    [blogId, postSlug]
  );
  return rows[0] ?? null;
}

export interface BlogCategoryRow {
  id: string;
  blog_id: string;
  name: string;
  slug: string;
  sort_order: number;
  post_count: number;
}

export async function listBlogCategories(blogId: string): Promise<BlogCategoryRow[]> {
  const { rows } = await db.query<BlogCategoryRow>(
    `SELECT c.id, c.blog_id, c.name, c.slug, c.sort_order,
            COUNT(p.id) FILTER (WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.type = 'article')::int AS post_count
     FROM blog_categories c
     LEFT JOIN blog_posts p ON p.category_id = c.id
     WHERE c.blog_id = $1
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.name ASC`,
    [blogId]
  );
  return rows;
}

export interface BlogCommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  status: string;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  /** True when the commenter holds an active vip_badge gift purchase for this post's blog (unrelated blog_gift_tiers feature). */
  author_is_vip: boolean;
  /** Rewarded Gifts (migration 0026): label of the commenter's active sitewide gift_reward_grants row for this blog, if any. Distinct from author_is_vip above. */
  author_reward_label: string | null;
}

export async function listBlogComments(postId: string, includeStatuses: string[]): Promise<BlogCommentRow[]> {
  const { rows } = await db.query<BlogCommentRow>(
    `SELECT c.id, c.post_id, c.author_id, c.parent_comment_id, c.body, c.status, c.created_at,
            u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url,
            EXISTS (
              SELECT 1 FROM blog_gift_purchases gp
              WHERE gp.blog_id = p.blog_id AND gp.buyer_id = c.author_id
                AND gp.benefit_type = 'vip_badge' AND gp.status = 'active'
            ) AS author_is_vip,
            (
              SELECT rg.label FROM gift_reward_grants rg
              WHERE rg.context_type = 'blog' AND rg.context_id = p.blog_id AND rg.sender_id = c.author_id
                AND rg.benefit_type IN ('sender_badge', 'blog_privilege')
                AND rg.revoked_at IS NULL AND (rg.expires_at IS NULL OR rg.expires_at > NOW())
              ORDER BY rg.created_at DESC
              LIMIT 1
            ) AS author_reward_label
     FROM blog_post_comments c
     JOIN users u ON u.id = c.author_id
     JOIN blog_posts p ON p.id = c.post_id
     WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.status = ANY($2::text[])
     ORDER BY c.created_at ASC`,
    [postId, includeStatuses]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface BlogStatsTotals {
  post_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_unlocks: number;
  total_earnings_kobo: string;
}

export async function getBlogStatsTotals(blogId: string): Promise<BlogStatsTotals> {
  const { rows } = await db.query<BlogStatsTotals>(
    `SELECT
       COUNT(*) FILTER (WHERE p.status = 'published')::int AS post_count,
       COALESCE(SUM(p.view_count), 0)::int AS total_views,
       COALESCE(SUM(p.like_count), 0)::int AS total_likes,
       COALESCE(SUM(p.comment_count), 0)::int AS total_comments,
       (SELECT COUNT(*) FROM blog_post_unlocks u JOIN blog_posts pp ON pp.id = u.post_id WHERE pp.blog_id = $1)::int AS total_unlocks,
       COALESCE((SELECT SUM(e.net_amount_kobo)::text FROM creator_earnings e
                 WHERE e.creator_id = (SELECT owner_id FROM blogs WHERE id = $1) AND e.source_type = 'blog_paywall'), '0') AS total_earnings_kobo
     FROM blog_posts p
     WHERE p.blog_id = $1 AND p.deleted_at IS NULL`,
    [blogId]
  );
  return rows[0] ?? { post_count: 0, total_views: 0, total_likes: 0, total_comments: 0, total_unlocks: 0, total_earnings_kobo: "0" };
}

export interface BlogPostStatsRow {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  unlock_count: number;
  unlock_credits: number;
  published_at: string | null;
}

export async function getBlogPostStatsBreakdown(blogId: string): Promise<BlogPostStatsRow[]> {
  const { rows } = await db.query<BlogPostStatsRow>(
    `SELECT p.id, p.title, p.slug, p.type, p.status, p.view_count, p.like_count, p.comment_count,
            COALESCE((SELECT COUNT(*) FROM blog_post_unlocks u WHERE u.post_id = p.id), 0)::int AS unlock_count,
            COALESCE((SELECT SUM(u.credits_spent) FROM blog_post_unlocks u WHERE u.post_id = p.id), 0)::int AS unlock_credits,
            p.published_at
     FROM blog_posts p
     WHERE p.blog_id = $1 AND p.deleted_at IS NULL
     ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC`,
    [blogId]
  );
  return rows;
}

export interface BlogDailyStatsRow {
  date: string;
  post_id: string;
  post_title: string;
  views: number;
  likes: number;
  comments: number;
  unlock_count: number;
  unlock_credits: number;
}

export async function getBlogDailyStats(blogId: string, days: number): Promise<BlogDailyStatsRow[]> {
  const { rows } = await db.query<BlogDailyStatsRow>(
    `SELECT s.date::text, s.post_id, p.title AS post_title, s.views, s.likes, s.comments, s.unlock_count, s.unlock_credits
     FROM blog_post_daily_stats s
     JOIN blog_posts p ON p.id = s.post_id
     WHERE p.blog_id = $1 AND s.date >= CURRENT_DATE - $2::int
     ORDER BY s.date DESC, p.title ASC`,
    [blogId, days]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Rewarded Gifts (migration 0024) — read queries. Writes/purchase flow live
// in lib/blogs/service.ts.
// ---------------------------------------------------------------------------

export interface BlogGiftTierRow {
  id: string;
  blog_id: string;
  name: string;
  description: string | null;
  credits_price: number | null;
  stars_price: number | null;
  benefit_type: "vip_badge" | "vip_section_access" | "custom_reward";
  benefit_config: Record<string, unknown>;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const GIFT_TIER_SELECT = `
  SELECT id, blog_id, name, description, credits_price, stars_price, benefit_type,
         benefit_config, max_redemptions, redemption_count, expires_at, enabled, created_at, updated_at
  FROM blog_gift_tiers
`;

/** All tiers for a blog (owner dashboard view — includes disabled/expired). */
export async function listGiftTiersForOwner(blogId: string): Promise<BlogGiftTierRow[]> {
  const { rows } = await db.query<BlogGiftTierRow>(`${GIFT_TIER_SELECT} WHERE blog_id = $1 ORDER BY created_at ASC`, [blogId]);
  return rows;
}

/** Public, purchasable tiers for a blog's page (enabled, not expired, not sold out). */
export async function listPublicGiftTiers(blogId: string): Promise<BlogGiftTierRow[]> {
  const { rows } = await db.query<BlogGiftTierRow>(
    `${GIFT_TIER_SELECT}
     WHERE blog_id = $1 AND enabled = true
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_redemptions IS NULL OR redemption_count < max_redemptions)
     ORDER BY created_at ASC`,
    [blogId]
  );
  return rows;
}

export async function getGiftTierById(tierId: string): Promise<BlogGiftTierRow | null> {
  const { rows } = await db.query<BlogGiftTierRow>(`${GIFT_TIER_SELECT} WHERE id = $1 LIMIT 1`, [tierId]);
  return rows[0] ?? null;
}

export interface BlogGiftPurchaseRow {
  id: string;
  tier_id: string;
  blog_id: string;
  buyer_id: string;
  currency: "credits" | "stars";
  amount_paid: number;
  benefit_type: string;
  status: string;
  created_at: string;
  tier_name: string;
  buyer_username: string | null;
}

/** Purchases for a blog's tiers (owner dashboard — redemption feed). */
export async function listGiftPurchasesForBlog(blogId: string, limit = 100): Promise<BlogGiftPurchaseRow[]> {
  const { rows } = await db.query<BlogGiftPurchaseRow>(
    `SELECT p.id, p.tier_id, p.blog_id, p.buyer_id, p.currency, p.amount_paid, p.benefit_type, p.status, p.created_at,
            t.name AS tier_name, u.username AS buyer_username
     FROM blog_gift_purchases p
     JOIN blog_gift_tiers t ON t.id = p.tier_id
     JOIN users u ON u.id = p.buyer_id
     WHERE p.blog_id = $1
     ORDER BY p.created_at DESC LIMIT $2`,
    [blogId, limit]
  );
  return rows;
}

export interface AdminGiftTierRow extends BlogGiftTierRow {
  blog_slug: string;
  blog_title: string;
  owner_username: string | null;
}

/** All gift tiers across every blog, for the gate44 admin screen. */
export async function adminListAllGiftTiers(limit = 200): Promise<AdminGiftTierRow[]> {
  const { rows } = await db.query<AdminGiftTierRow>(
    `SELECT t.id, t.blog_id, t.name, t.description, t.credits_price, t.stars_price, t.benefit_type,
            t.benefit_config, t.max_redemptions, t.redemption_count, t.expires_at, t.enabled, t.created_at, t.updated_at,
            b.slug AS blog_slug, b.title AS blog_title, u.username AS owner_username
     FROM blog_gift_tiers t
     JOIN blogs b ON b.id = t.blog_id
     JOIN users u ON u.id = b.owner_id
     ORDER BY t.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/** A buyer's own purchase of a given tier, if any (used to gate the text-unlock reveal). */
export async function getGiftPurchaseForBuyer(tierId: string, buyerId: string): Promise<{ id: string } | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM blog_gift_purchases WHERE tier_id = $1 AND buyer_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
    [tierId, buyerId]
  );
  return rows[0] ?? null;
}

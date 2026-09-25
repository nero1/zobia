/**
 * lib/blogs/repo.ts
 *
 * Blogs — read queries (discovery, single blog/post lookups, listings).
 * Mirrors lib/forum/repo.ts's cursor-pagination and row-shape conventions.
 */

import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import type { BlogMenuConfig } from "@/lib/blogs/menu";
import { normalizeMenuConfig } from "@/lib/blogs/menu";

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

function toSummary(row: {
  id: string;
  ownerId: string;
  slug: string;
  title: string;
  tagline: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  status: string;
  subscriberCount: number;
  showSubscriberCount: boolean;
  postCount: number;
  createdAt: Date;
  ownerUsername: string | null;
}): BlogSummaryRow {
  return {
    id: row.id,
    owner_id: row.ownerId,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    status: row.status,
    subscriber_count: row.subscriberCount,
    show_subscriber_count: row.showSubscriberCount,
    post_count: row.postCount,
    created_at: row.createdAt.toISOString(),
    owner_username: row.ownerUsername,
  };
}

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
 *
 * The lateral MAX(published_at) join and compound-tuple cursor comparison
 * are expressed via a `sql` template rather than the query builder, to keep
 * the exact aggregation/pagination semantics unchanged.
 */
async function listSubscribedBlogs(
  userId: string,
  cursor: string | null,
  limit: number,
  search?: string
): Promise<ListBlogsResult> {
  const orm = await getDb();

  const searchClause = search?.trim() ? sql`AND b.title ILIKE ${`%${search.trim()}%`}` : sql``;
  let cursorClause = sql``;
  if (cursor) {
    const [cursorSortKey, cursorId] = cursor.split("_");
    if (cursorSortKey && cursorId) {
      cursorClause = sql`AND (COALESCE(lp.last_post_at, b.created_at), b.id) < (${cursorSortKey}::timestamptz, ${cursorId}::uuid)`;
    }
  }

  const { rows } = await orm.execute<BlogSummaryRow & { sort_key: string } & Record<string, unknown>>(sql`
    SELECT b.id, b.owner_id, b.slug, b.title, b.tagline, b.avatar_url, b.cover_image_url,
           b.status, b.subscriber_count, b.show_subscriber_count, b.post_count, b.created_at,
           u.username AS owner_username,
           COALESCE(lp.last_post_at, b.created_at) AS sort_key
    FROM blogs b
    JOIN users u ON u.id = b.owner_id
    JOIN blog_subscriptions sub ON sub.blog_id = b.id AND sub.user_id = ${userId}
    LEFT JOIN LATERAL (
      SELECT MAX(p.published_at) AS last_post_at FROM blog_posts p
      WHERE p.blog_id = b.id AND p.status = 'published' AND p.deleted_at IS NULL
    ) lp ON true
    WHERE b.status = 'active' AND b.deleted_at IS NULL ${searchClause} ${cursorClause}
    ORDER BY COALESCE(lp.last_post_at, b.created_at) DESC, b.id DESC
    LIMIT ${limit + 1}
  `);

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

  const orm = await getDb();

  const conditions: SQL[] = [eq(schema.blogs.status, "active"), isNull(schema.blogs.deletedAt)];
  if (search?.trim()) conditions.push(ilike(schema.blogs.title, `%${search.trim()}%`));
  if (cursor && tab !== "random") conditions.push(lt(schema.blogs.id, cursor));

  let orderBy: SQL[];
  if (tab === "trending") orderBy = [desc(schema.blogs.subscriberCount), desc(schema.blogs.createdAt)];
  else if (tab === "new") orderBy = [desc(schema.blogs.createdAt)];
  else if (tab === "random") orderBy = [sql`RANDOM()`];
  else orderBy = [desc(schema.blogs.subscriberCount), desc(schema.blogs.postCount)];

  const rows = await orm
    .select({
      id: schema.blogs.id,
      ownerId: schema.blogs.ownerId,
      slug: schema.blogs.slug,
      title: schema.blogs.title,
      tagline: schema.blogs.tagline,
      avatarUrl: schema.blogs.avatarUrl,
      coverImageUrl: schema.blogs.coverImageUrl,
      status: schema.blogs.status,
      subscriberCount: schema.blogs.subscriberCount,
      showSubscriberCount: schema.blogs.showSubscriberCount,
      postCount: schema.blogs.postCount,
      createdAt: schema.blogs.createdAt,
      ownerUsername: schema.users.username,
    })
    .from(schema.blogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const blogs = page.map(toSummary);
  return {
    blogs,
    nextCursor: hasMore ? blogs[blogs.length - 1]?.id ?? null : null,
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

function toBlogRow(row: {
  blog: typeof schema.blogs.$inferSelect;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
}): BlogRow {
  const b = row.blog;
  return {
    id: b.id,
    owner_id: b.ownerId,
    slug: b.slug,
    title: b.title,
    tagline: b.tagline,
    description: b.description,
    avatar_url: b.avatarUrl,
    cover_image_url: b.coverImageUrl,
    theme_store_item_id: b.themeStoreItemId,
    active_theme_id: b.activeThemeId,
    comments_enabled: b.commentsEnabled,
    comments_moderation_enabled: b.commentsModerationEnabled,
    hide_author_info: b.hideAuthorInfo,
    show_subscriber_count: b.showSubscriberCount,
    status: b.status,
    status_reason: b.statusReason,
    subscriber_count: b.subscriberCount,
    post_count: b.postCount,
    business_account_id: b.businessAccountId,
    slot_source: b.slotSource,
    slot_unlock_currency: b.slotUnlockCurrency,
    slot_unlock_cost: b.slotUnlockCost,
    slot_unlock_reference_id: b.slotUnlockReferenceId,
    menu_config: normalizeMenuConfig(b.menuConfig),
    created_at: b.createdAt.toISOString(),
    owner_username: row.ownerUsername,
    owner_display_name: row.ownerDisplayName,
    owner_avatar_url: row.ownerAvatarUrl,
  };
}

function blogWithOwnerSelection() {
  return {
    blog: schema.blogs,
    ownerUsername: schema.users.username,
    ownerDisplayName: schema.users.displayName,
    ownerAvatarUrl: schema.users.avatarUrl,
  };
}

export async function getBlogBySlug(slug: string): Promise<BlogRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select(blogWithOwnerSelection())
    .from(schema.blogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .where(and(eq(schema.blogs.slug, slug), isNull(schema.blogs.deletedAt)))
    .limit(1);
  return row ? toBlogRow(row) : null;
}

/**
 * All blogs owned by a user — personal (business_account_id IS NULL) and,
 * since owner_id on a business blog is the business account's owner user,
 * business blogs too. This is the single query behind GET /api/blogs/me:
 * "my blogs across personal + business scopes" needs nothing more than
 * filtering this list by `business_account_id`.
 */
export async function getBlogsByOwner(ownerId: string): Promise<BlogRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select(blogWithOwnerSelection())
    .from(schema.blogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .where(and(eq(schema.blogs.ownerId, ownerId), isNull(schema.blogs.deletedAt)))
    .orderBy(asc(schema.blogs.createdAt));
  return rows.map(toBlogRow);
}

/** Blogs belonging to a specific business account (business-scope blogs only). */
export async function getBlogsByBusinessAccount(businessAccountId: string): Promise<BlogRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select(blogWithOwnerSelection())
    .from(schema.blogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .where(and(eq(schema.blogs.businessAccountId, businessAccountId), isNull(schema.blogs.deletedAt)))
    .orderBy(asc(schema.blogs.createdAt));
  return rows.map(toBlogRow);
}

/** Active (non-deactivated, non-deleted) blog count for a scope — used by quota checks. Pass a transaction handle to read under a row lock. */
export async function countActiveBlogsForScope(
  scope: { ownerId: string; businessAccountId: string | null },
  tx?: DbOrTx
): Promise<number> {
  const orm = tx ?? (await getDb());
  const [row] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.blogs)
    .where(
      and(
        isNull(schema.blogs.deletedAt),
        ne(schema.blogs.status, "deactivated"),
        scope.businessAccountId
          ? eq(schema.blogs.businessAccountId, scope.businessAccountId)
          : and(eq(schema.blogs.ownerId, scope.ownerId), isNull(schema.blogs.businessAccountId))
      )
    );
  return row?.count ?? 0;
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

function toPostSummary(row: {
  id: string;
  blogId: string;
  categoryId: string | null;
  type: string;
  title: string;
  slug: string;
  pageKey: string | null;
  excerpt: string | null;
  featuredImageUrl: string | null;
  status: string;
  isPaywalled: boolean;
  paywallCreditsCost: number;
  wordCount: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  sortOrder: number;
  publishedAt: Date | null;
  createdAt: Date;
  categoryName: string | null;
}): BlogPostSummaryRow {
  return {
    id: row.id,
    blog_id: row.blogId,
    category_id: row.categoryId,
    type: row.type,
    title: row.title,
    slug: row.slug,
    page_key: row.pageKey,
    excerpt: row.excerpt,
    featured_image_url: row.featuredImageUrl,
    status: row.status,
    is_paywalled: row.isPaywalled,
    paywall_credits_cost: row.paywallCreditsCost,
    word_count: row.wordCount,
    view_count: row.viewCount,
    like_count: row.likeCount,
    comment_count: row.commentCount,
    sort_order: row.sortOrder,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    category_name: row.categoryName,
  };
}

function postSummarySelection() {
  return {
    id: schema.blogPosts.id,
    blogId: schema.blogPosts.blogId,
    categoryId: schema.blogPosts.categoryId,
    type: schema.blogPosts.type,
    title: schema.blogPosts.title,
    slug: schema.blogPosts.slug,
    pageKey: schema.blogPosts.pageKey,
    excerpt: schema.blogPosts.excerpt,
    featuredImageUrl: schema.blogPosts.featuredImageUrl,
    status: schema.blogPosts.status,
    isPaywalled: schema.blogPosts.isPaywalled,
    paywallCreditsCost: schema.blogPosts.paywallCreditsCost,
    wordCount: schema.blogPosts.wordCount,
    viewCount: schema.blogPosts.viewCount,
    likeCount: schema.blogPosts.likeCount,
    commentCount: schema.blogPosts.commentCount,
    sortOrder: schema.blogPosts.sortOrder,
    publishedAt: schema.blogPosts.publishedAt,
    createdAt: schema.blogPosts.createdAt,
    categoryName: schema.blogCategories.name,
  };
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
  const orm = await getDb();

  const conditions: SQL[] = [eq(schema.blogPosts.blogId, blogId), isNull(schema.blogPosts.deletedAt)];
  if (opts.type) conditions.push(eq(schema.blogPosts.type, opts.type));
  if (!opts.status || opts.status === "published") conditions.push(eq(schema.blogPosts.status, "published"));
  else if (opts.status === "draft") conditions.push(eq(schema.blogPosts.status, "draft"));
  if (opts.categoryId) conditions.push(eq(schema.blogPosts.categoryId, opts.categoryId));
  if (opts.cursor) conditions.push(lt(schema.blogPosts.id, opts.cursor));

  const orderBy: SQL[] =
    opts.type === "page"
      ? [asc(schema.blogPosts.sortOrder), asc(schema.blogPosts.createdAt)]
      : [desc(schema.blogPosts.publishedAt), desc(schema.blogPosts.createdAt)];

  const rows = await orm
    .select(postSummarySelection())
    .from(schema.blogPosts)
    .leftJoin(schema.blogCategories, eq(schema.blogCategories.id, schema.blogPosts.categoryId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const posts = page.map(toPostSummary);
  return {
    posts,
    nextCursor: hasMore ? posts[posts.length - 1]?.id ?? null : null,
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
  const orm = await getDb();
  const [row] = await orm
    .select({
      post: schema.blogPosts,
      categoryName: schema.blogCategories.name,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
      authorAvatarUrl: schema.users.avatarUrl,
    })
    .from(schema.blogPosts)
    .leftJoin(schema.blogCategories, eq(schema.blogCategories.id, schema.blogPosts.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.blogPosts.authorId))
    .where(and(eq(schema.blogPosts.blogId, blogId), eq(schema.blogPosts.slug, postSlug), isNull(schema.blogPosts.deletedAt)))
    .limit(1);
  if (!row) return null;
  return {
    ...toPostSummary({ ...row.post, categoryName: row.categoryName }),
    author_id: row.post.authorId,
    body_markdown: row.post.bodyMarkdown,
    body_html: row.post.bodyHtml,
    author_username: row.authorUsername,
    author_display_name: row.authorDisplayName,
    author_avatar_url: row.authorAvatarUrl,
  };
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
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.blogCategories.id,
      blogId: schema.blogCategories.blogId,
      name: schema.blogCategories.name,
      slug: schema.blogCategories.slug,
      sortOrder: schema.blogCategories.sortOrder,
      postCount: sql<number>`COUNT(${schema.blogPosts.id}) FILTER (WHERE ${schema.blogPosts.status} = 'published' AND ${schema.blogPosts.deletedAt} IS NULL AND ${schema.blogPosts.type} = 'article')::int`,
    })
    .from(schema.blogCategories)
    .leftJoin(schema.blogPosts, eq(schema.blogPosts.categoryId, schema.blogCategories.id))
    .where(eq(schema.blogCategories.blogId, blogId))
    .groupBy(schema.blogCategories.id)
    .orderBy(asc(schema.blogCategories.sortOrder), asc(schema.blogCategories.name));
  return rows.map((r) => ({
    id: r.id,
    blog_id: r.blogId,
    name: r.name,
    slug: r.slug,
    sort_order: r.sortOrder,
    post_count: r.postCount,
  }));
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
  const orm = await getDb();
  const { rows } = await orm.execute<BlogCommentRow & Record<string, unknown>>(sql`
    SELECT c.id, c.post_id, c.author_id, c.parent_comment_id, c.body, c.status, c.created_at,
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
    WHERE c.post_id = ${postId} AND c.deleted_at IS NULL AND c.status = ANY(${includeStatuses}::text[])
    ORDER BY c.created_at ASC
  `);
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
  const orm = await getDb();
  const { rows } = await orm.execute<BlogStatsTotals & Record<string, unknown>>(sql`
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'published')::int AS post_count,
      COALESCE(SUM(p.view_count), 0)::int AS total_views,
      COALESCE(SUM(p.like_count), 0)::int AS total_likes,
      COALESCE(SUM(p.comment_count), 0)::int AS total_comments,
      (SELECT COUNT(*) FROM blog_post_unlocks u JOIN blog_posts pp ON pp.id = u.post_id WHERE pp.blog_id = ${blogId})::int AS total_unlocks,
      COALESCE((SELECT SUM(e.net_amount_kobo)::text FROM creator_earnings e
                WHERE e.creator_id = (SELECT owner_id FROM blogs WHERE id = ${blogId}) AND e.source_type = 'blog_paywall'), '0') AS total_earnings_kobo
    FROM blog_posts p
    WHERE p.blog_id = ${blogId} AND p.deleted_at IS NULL
  `);
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
  const orm = await getDb();
  const { rows } = await orm.execute<BlogPostStatsRow & Record<string, unknown>>(sql`
    SELECT p.id, p.title, p.slug, p.type, p.status, p.view_count, p.like_count, p.comment_count,
           COALESCE((SELECT COUNT(*) FROM blog_post_unlocks u WHERE u.post_id = p.id), 0)::int AS unlock_count,
           COALESCE((SELECT SUM(u.credits_spent) FROM blog_post_unlocks u WHERE u.post_id = p.id), 0)::int AS unlock_credits,
           p.published_at
    FROM blog_posts p
    WHERE p.blog_id = ${blogId} AND p.deleted_at IS NULL
    ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
  `);
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
  const orm = await getDb();
  const { rows } = await orm.execute<BlogDailyStatsRow & Record<string, unknown>>(sql`
    SELECT s.date::text, s.post_id, p.title AS post_title, s.views, s.likes, s.comments, s.unlock_count, s.unlock_credits
    FROM blog_post_daily_stats s
    JOIN blog_posts p ON p.id = s.post_id
    WHERE p.blog_id = ${blogId} AND s.date >= CURRENT_DATE - ${days}::int
    ORDER BY s.date DESC, p.title ASC
  `);
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

function toGiftTierRow(row: typeof schema.blogGiftTiers.$inferSelect): BlogGiftTierRow {
  return {
    id: row.id,
    blog_id: row.blogId,
    name: row.name,
    description: row.description,
    credits_price: row.creditsPrice,
    stars_price: row.starsPrice,
    benefit_type: row.benefitType as BlogGiftTierRow["benefit_type"],
    benefit_config: row.benefitConfig as Record<string, unknown>,
    max_redemptions: row.maxRedemptions,
    redemption_count: row.redemptionCount,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** All tiers for a blog (owner dashboard view — includes disabled/expired). */
export async function listGiftTiersForOwner(blogId: string): Promise<BlogGiftTierRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.blogGiftTiers)
    .where(eq(schema.blogGiftTiers.blogId, blogId))
    .orderBy(asc(schema.blogGiftTiers.createdAt));
  return rows.map(toGiftTierRow);
}

/** Public, purchasable tiers for a blog's page (enabled, not expired, not sold out). */
export async function listPublicGiftTiers(blogId: string): Promise<BlogGiftTierRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.blogGiftTiers)
    .where(
      and(
        eq(schema.blogGiftTiers.blogId, blogId),
        eq(schema.blogGiftTiers.enabled, true),
        or(isNull(schema.blogGiftTiers.expiresAt), gt(schema.blogGiftTiers.expiresAt, new Date())),
        or(isNull(schema.blogGiftTiers.maxRedemptions), lt(schema.blogGiftTiers.redemptionCount, schema.blogGiftTiers.maxRedemptions))
      )
    )
    .orderBy(asc(schema.blogGiftTiers.createdAt));
  return rows.map(toGiftTierRow);
}

export async function getGiftTierById(tierId: string): Promise<BlogGiftTierRow | null> {
  const orm = await getDb();
  const [row] = await orm.select().from(schema.blogGiftTiers).where(eq(schema.blogGiftTiers.id, tierId)).limit(1);
  return row ? toGiftTierRow(row) : null;
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
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.blogGiftPurchases.id,
      tierId: schema.blogGiftPurchases.tierId,
      blogId: schema.blogGiftPurchases.blogId,
      buyerId: schema.blogGiftPurchases.buyerId,
      currency: schema.blogGiftPurchases.currency,
      amountPaid: schema.blogGiftPurchases.amountPaid,
      benefitType: schema.blogGiftPurchases.benefitType,
      status: schema.blogGiftPurchases.status,
      createdAt: schema.blogGiftPurchases.createdAt,
      tierName: schema.blogGiftTiers.name,
      buyerUsername: schema.users.username,
    })
    .from(schema.blogGiftPurchases)
    .innerJoin(schema.blogGiftTiers, eq(schema.blogGiftTiers.id, schema.blogGiftPurchases.tierId))
    .innerJoin(schema.users, eq(schema.users.id, schema.blogGiftPurchases.buyerId))
    .where(eq(schema.blogGiftPurchases.blogId, blogId))
    .orderBy(desc(schema.blogGiftPurchases.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    tier_id: r.tierId,
    blog_id: r.blogId,
    buyer_id: r.buyerId,
    currency: r.currency as "credits" | "stars",
    amount_paid: r.amountPaid,
    benefit_type: r.benefitType,
    status: r.status,
    created_at: r.createdAt.toISOString(),
    tier_name: r.tierName,
    buyer_username: r.buyerUsername,
  }));
}

export interface AdminGiftTierRow extends BlogGiftTierRow {
  blog_slug: string;
  blog_title: string;
  owner_username: string | null;
}

/** All gift tiers across every blog, for the gate44 admin screen. */
export async function adminListAllGiftTiers(limit = 200): Promise<AdminGiftTierRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select({
      tier: schema.blogGiftTiers,
      blogSlug: schema.blogs.slug,
      blogTitle: schema.blogs.title,
      ownerUsername: schema.users.username,
    })
    .from(schema.blogGiftTiers)
    .innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogGiftTiers.blogId))
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .orderBy(desc(schema.blogGiftTiers.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...toGiftTierRow(r.tier),
    blog_slug: r.blogSlug,
    blog_title: r.blogTitle,
    owner_username: r.ownerUsername,
  }));
}

/** A buyer's own purchase of a given tier, if any (used to gate the text-unlock reveal). */
export async function getGiftPurchaseForBuyer(tierId: string, buyerId: string): Promise<{ id: string } | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.blogGiftPurchases.id })
    .from(schema.blogGiftPurchases)
    .where(
      and(
        eq(schema.blogGiftPurchases.tierId, tierId),
        eq(schema.blogGiftPurchases.buyerId, buyerId),
        eq(schema.blogGiftPurchases.status, "active")
      )
    )
    .orderBy(desc(schema.blogGiftPurchases.createdAt))
    .limit(1);
  return row ?? null;
}

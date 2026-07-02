/**
 * lib/blogs/service.ts
 *
 * Blogs — mini blog/CMS system. Mirrors lib/forum/service.ts's structure:
 * feature flag -> eligibility/limits -> (optional charge) -> atomic write.
 * XP/creator-earnings rewards are awarded best-effort AFTER the write
 * transaction commits so a reward failure never blocks the user's action.
 *
 * Revenue-share note: paywall unlocks spend Credits the reader already
 * purchased earlier (fees/VAT on that purchase were already accounted for
 * at purchase time). The admin-configurable paystackFeePct/vatPct here are
 * applied to the kobo-equivalent value of the unlock per the product spec
 * (the platform does not re-charge a referral commission at unlock time —
 * that commission was already paid out when the reader bought the Credits).
 */

import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { debitCoins } from "@/lib/economy/coins";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { generateUniqueSlug, generateUniqueBlogPostSlug } from "@/lib/slug";
import { getMaxBlogPosts, getMaxWordsForPlan, getBlogRevSharePct, getBlogEconomyConfig } from "@/lib/blogs/limits";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { ApiError, badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { getBlogByOwner } from "@/lib/blogs/repo";

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export { isUserModeratorOrAdmin } from "@/lib/forum/service";

async function assertBlogWritable(blogId: string): Promise<{ ownerId: string; status: string }> {
  const { rows } = await db.query<{ owner_id: string; status: string }>(
    `SELECT owner_id, status FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [blogId]
  );
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.status !== "active" && blog.status !== "paused") {
    throw forbidden("This blog has been restricted by an administrator.", "BLOG_RESTRICTED");
  }
  return { ownerId: blog.owner_id, status: blog.status };
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Create / update a blog
// ---------------------------------------------------------------------------

export interface CreateBlogInput {
  userId: string;
  title: string;
  tagline?: string | null;
  description?: string | null;
}

export async function createBlog(input: CreateBlogInput): Promise<{ id: string; slug: string }> {
  await requireFeatureEnabled("blogs");

  const existing = await getBlogByOwner(input.userId);
  if (existing) throw conflict("You already have a blog.", "BLOG_ALREADY_EXISTS");

  const blogId = randomUUID();
  const slug = await generateUniqueSlug("blog", input.title, blogId);

  await db.query(
    `INSERT INTO blogs (id, owner_id, slug, title, tagline, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [blogId, input.userId, slug, input.title.trim(), input.tagline?.trim() || null, input.description?.trim() || null]
  );

  return { id: blogId, slug };
}

export interface UpdateBlogSettingsInput {
  title?: string;
  tagline?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  commentsEnabled?: boolean;
  commentsModerationEnabled?: boolean;
  hideAuthorInfo?: boolean;
  showSubscriberCount?: boolean;
}

export async function updateBlogSettings(blogId: string, callerId: string, input: UpdateBlogSettingsInput): Promise<void> {
  const { rows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.owner_id !== callerId) throw forbidden("Only the blog owner can update these settings.");

  const fields: string[] = [];
  const params: SqlParam[] = [blogId];
  const push = (col: string, value: SqlParam) => {
    params.push(value);
    fields.push(`${col} = $${params.length}`);
  };

  if (input.title !== undefined) push("title", input.title.trim());
  if (input.tagline !== undefined) push("tagline", input.tagline?.trim() || null);
  if (input.description !== undefined) push("description", input.description?.trim() || null);
  if (input.avatarUrl !== undefined) push("avatar_url", input.avatarUrl || null);
  if (input.coverImageUrl !== undefined) push("cover_image_url", input.coverImageUrl || null);
  if (input.commentsEnabled !== undefined) push("comments_enabled", input.commentsEnabled);
  if (input.commentsModerationEnabled !== undefined) push("comments_moderation_enabled", input.commentsModerationEnabled);
  if (input.hideAuthorInfo !== undefined) push("hide_author_info", input.hideAuthorInfo);
  if (input.showSubscriberCount !== undefined) push("show_subscriber_count", input.showSubscriberCount);

  if (fields.length === 0) return;
  await db.query(`UPDATE blogs SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(blogId: string, callerId: string, name: string): Promise<{ id: string; slug: string }> {
  const blog = await assertBlogWritable(blogId);
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can manage categories.");

  const categoryId = randomUUID();
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "category";
  let slug = base;
  for (let i = 2; i <= 50; i++) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM blog_categories WHERE blog_id = $1 AND slug = $2 LIMIT 1`, [blogId, slug]);
    if (!rows[0]) break;
    slug = `${base}-${i}`;
  }

  await db.query(`INSERT INTO blog_categories (id, blog_id, name, slug) VALUES ($1, $2, $3, $4)`, [categoryId, blogId, name.trim(), slug]);
  return { id: categoryId, slug };
}

// ---------------------------------------------------------------------------
// Posts / pages
// ---------------------------------------------------------------------------

export interface CreatePostInput {
  blogId: string;
  authorId: string;
  authorPlan: string;
  type: "article" | "page";
  title: string;
  excerpt?: string | null;
  bodyMarkdown: string;
  featuredImageUrl?: string | null;
  categoryId?: string | null;
  isPaywalled?: boolean;
  paywallCreditsCost?: number;
  status: "draft" | "published";
}

export async function createPost(input: CreatePostInput): Promise<{ id: string; slug: string; status: string }> {
  await requireFeatureEnabled("blogs");
  await assertBlogWritable(input.blogId);

  const { rows: ownerRows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1`, [input.blogId]);
  if (ownerRows[0]?.owner_id !== input.authorId) throw forbidden("Only the blog owner can publish posts on this blog.");

  const [maxPosts, maxWords] = await Promise.all([
    getMaxBlogPosts(input.authorPlan),
    getMaxWordsForPlan(input.authorPlan),
  ]);

  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM blog_posts WHERE blog_id = $1 AND deleted_at IS NULL`,
    [input.blogId]
  );
  if (parseInt(countRows[0]?.count ?? "0", 10) >= maxPosts) {
    throw forbidden(`Your plan allows a maximum of ${maxPosts} articles and pages. Upgrade your plan to publish more.`, "BLOG_POST_LIMIT_REACHED", { maxPosts });
  }

  const words = wordCount(input.bodyMarkdown);
  if (input.type === "article" && words > maxWords) {
    throw new ApiError(400, "BLOG_WORD_LIMIT_EXCEEDED", `Your plan allows articles up to ${maxWords} words. This article is ${words} words.`, undefined, undefined, { maxWords, words });
  }

  if (input.categoryId) {
    const { rows: catRows } = await db.query<{ id: string }>(`SELECT id FROM blog_categories WHERE id = $1 AND blog_id = $2 LIMIT 1`, [input.categoryId, input.blogId]);
    if (!catRows[0]) throw badRequest("Unknown category.", "BLOG_UNKNOWN_CATEGORY");
  }

  const postId = randomUUID();
  const slug = await generateUniqueBlogPostSlug(input.blogId, input.title, postId);
  const bodyHtml = sanitizeBlogPostHtml(input.bodyMarkdown);
  const isPaywalled = input.type === "article" && !!input.isPaywalled;
  const paywallCost = isPaywalled ? Math.max(0, Math.floor(input.paywallCreditsCost ?? 0)) : 0;
  const publishedAt = input.status === "published" ? new Date().toISOString() : null;

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO blog_posts
         (id, blog_id, author_id, category_id, type, title, slug, excerpt, body_markdown, body_html,
          featured_image_url, status, is_paywalled, paywall_credits_cost, word_count, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        postId, input.blogId, input.authorId, input.categoryId ?? null, input.type, input.title.trim(),
        slug, input.excerpt?.trim() || null, input.bodyMarkdown, bodyHtml,
        input.featuredImageUrl || null, input.status, isPaywalled, paywallCost, words, publishedAt,
      ]
    );
    await tx.query(`UPDATE blogs SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1`, [input.blogId]);
  });

  if (input.status === "published" && input.type === "article") {
    safeAwardXPFireAndForget(input.authorId, 10, "creator", "blog_post_published", `blog_post_reward:${postId}`);
    await notifySubscribers(input.blogId, postId, input.title, slug).catch((err) => {
      logger.error({ err, blogId: input.blogId, postId }, "[blogs/service] failed to notify subscribers");
    });
  }

  return { id: postId, slug, status: input.status };
}

export interface UpdatePostInput {
  title?: string;
  excerpt?: string | null;
  bodyMarkdown?: string;
  featuredImageUrl?: string | null;
  categoryId?: string | null;
  isPaywalled?: boolean;
  paywallCreditsCost?: number;
  status?: "draft" | "published";
  sortOrder?: number;
}

export async function updatePost(postId: string, callerId: string, callerPlan: string, input: UpdatePostInput): Promise<void> {
  const { rows } = await db.query<{ blog_id: string; author_id: string; type: string; status: string; slug: string }>(
    `SELECT blog_id, author_id, type, status, slug FROM blog_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [postId]
  );
  const post = rows[0];
  if (!post) throw notFound("Post not found");
  if (post.author_id !== callerId) throw forbidden("You can't edit this post.");

  const fields: string[] = [];
  const params: SqlParam[] = [postId];
  const push = (col: string, value: SqlParam) => {
    params.push(value);
    fields.push(`${col} = $${params.length}`);
  };

  if (input.title !== undefined) push("title", input.title.trim());
  if (input.excerpt !== undefined) push("excerpt", input.excerpt?.trim() || null);
  if (input.featuredImageUrl !== undefined) push("featured_image_url", input.featuredImageUrl || null);
  if (input.categoryId !== undefined) push("category_id", input.categoryId || null);
  if (input.sortOrder !== undefined) push("sort_order", input.sortOrder);

  if (input.bodyMarkdown !== undefined) {
    const maxWords = await getMaxWordsForPlan(callerPlan);
    const words = wordCount(input.bodyMarkdown);
    if (post.type === "article" && words > maxWords) {
      throw new ApiError(400, "BLOG_WORD_LIMIT_EXCEEDED", `Your plan allows articles up to ${maxWords} words. This article is ${words} words.`, undefined, undefined, { maxWords, words });
    }
    push("body_markdown", input.bodyMarkdown);
    push("body_html", sanitizeBlogPostHtml(input.bodyMarkdown));
    push("word_count", words);
  }

  if (input.isPaywalled !== undefined) push("is_paywalled", post.type === "article" && input.isPaywalled);
  if (input.paywallCreditsCost !== undefined) push("paywall_credits_cost", Math.max(0, Math.floor(input.paywallCreditsCost)));

  const wasPublished = post.status === "published";
  if (input.status !== undefined && input.status !== post.status) {
    push("status", input.status);
    if (input.status === "published" && !wasPublished) push("published_at", new Date().toISOString());
  }

  if (fields.length === 0) return;
  await db.query(`UPDATE blog_posts SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);

  if (input.status === "published" && !wasPublished && post.type === "article") {
    safeAwardXPFireAndForget(callerId, 10, "creator", "blog_post_published", `blog_post_reward:${postId}`);
    await notifySubscribers(post.blog_id, postId, input.title ?? post.slug, post.slug).catch(() => {});
  }
}

export async function deletePost(postId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const { rows } = await db.query<{ author_id: string; blog_id: string }>(
    `SELECT author_id, blog_id FROM blog_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [postId]
  );
  const post = rows[0];
  if (!post) throw notFound("Post not found");
  if (post.author_id !== callerId && !callerIsModerator) throw forbidden("You can't delete this post.");

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(`UPDATE blog_posts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [postId]);
    await tx.query(`UPDATE blogs SET post_count = GREATEST(post_count - 1, 0), updated_at = NOW() WHERE id = $1`, [post.blog_id]);
  });
}

// ---------------------------------------------------------------------------
// Subscriber notification
// ---------------------------------------------------------------------------

async function notifySubscribers(blogId: string, postId: string, postTitle: string, postSlug: string): Promise<void> {
  const { rows: blogRows } = await db.query<{ slug: string; title: string }>(`SELECT slug, title FROM blogs WHERE id = $1 LIMIT 1`, [blogId]);
  const blog = blogRows[0];
  if (!blog) return;

  const { rows: subRows } = await db.query<{ user_id: string }>(`SELECT user_id FROM blog_subscriptions WHERE blog_id = $1`, [blogId]);
  if (subRows.length === 0) return;

  await insertNotificationBatch(
    db,
    subRows.map((r) => r.user_id),
    "blog_new_post",
    `New post on ${blog.title}`,
    postTitle,
    { blogId, blogSlug: blog.slug, postId, postSlug }
  );
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

export async function toggleLike(postId: string, userId: string, next: boolean): Promise<{ likeCount: number }> {
  await requireFeatureEnabled("blogs");

  const result = await db.transaction(async (tx: TransactionClient) => {
    const { rows: postRows } = await tx.query<{ id: string; author_id: string; blog_id: string }>(
      `SELECT id, author_id, blog_id FROM blog_posts WHERE id = $1 AND deleted_at IS NULL AND status = 'published' FOR UPDATE`,
      [postId]
    );
    const post = postRows[0];
    if (!post) throw notFound("Post not found");

    let becameLiked = false;
    if (next) {
      const { rowCount } = await tx.query(`INSERT INTO blog_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING`, [postId, userId]);
      if (rowCount && rowCount > 0) {
        await tx.query(`UPDATE blog_posts SET like_count = like_count + 1 WHERE id = $1`, [postId]);
        becameLiked = true;
      }
    } else {
      const { rowCount } = await tx.query(`DELETE FROM blog_post_likes WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
      if (rowCount && rowCount > 0) await tx.query(`UPDATE blog_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [postId]);
    }

    if (becameLiked) {
      await tx.query(
        `INSERT INTO blog_post_daily_stats (post_id, date, likes) VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (post_id, date) DO UPDATE SET likes = blog_post_daily_stats.likes + 1`,
        [postId]
      );
    }

    const { rows } = await tx.query<{ like_count: number }>(`SELECT like_count FROM blog_posts WHERE id = $1`, [postId]);
    return { likeCount: rows[0].like_count, authorId: post.author_id, becameLiked };
  });

  if (result.becameLiked) {
    safeAwardXPFireAndForget(result.authorId, 1, "creator", "blog_post_liked", `blog_like_reward:${postId}:${userId}`);
  }

  return { likeCount: result.likeCount };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface AddCommentInput {
  postId: string;
  authorId: string;
  parentCommentId?: string | null;
  body: string;
}

export async function addComment(input: AddCommentInput): Promise<{ id: string; status: string }> {
  await requireFeatureEnabled("blogs");

  const { rows: postRows } = await db.query<{ id: string; blog_id: string }>(
    `SELECT id, blog_id FROM blog_posts WHERE id = $1 AND deleted_at IS NULL AND status = 'published' LIMIT 1`,
    [input.postId]
  );
  const post = postRows[0];
  if (!post) throw notFound("Post not found");

  const { rows: blogRows } = await db.query<{ comments_enabled: boolean; comments_moderation_enabled: boolean }>(
    `SELECT comments_enabled, comments_moderation_enabled FROM blogs WHERE id = $1 LIMIT 1`,
    [post.blog_id]
  );
  const blog = blogRows[0];
  if (!blog?.comments_enabled) throw forbidden("Comments are disabled on this blog.", "BLOG_COMMENTS_DISABLED");

  if (input.parentCommentId) {
    const { rows: parentRows } = await db.query<{ id: string }>(`SELECT id FROM blog_post_comments WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL LIMIT 1`, [input.parentCommentId, input.postId]);
    if (!parentRows[0]) throw notFound("Parent comment not found");
  }

  const status = blog.comments_moderation_enabled ? "pending" : "visible";
  const commentId = await db.transaction(async (tx: TransactionClient) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO blog_post_comments (post_id, author_id, parent_comment_id, body, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.postId, input.authorId, input.parentCommentId ?? null, input.body.trim(), status]
    );
    if (status === "visible") {
      await tx.query(`UPDATE blog_posts SET comment_count = comment_count + 1 WHERE id = $1`, [input.postId]);
      await tx.query(
        `INSERT INTO blog_post_daily_stats (post_id, date, comments) VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (post_id, date) DO UPDATE SET comments = blog_post_daily_stats.comments + 1`,
        [input.postId]
      );
    }
    return rows[0].id;
  });

  return { id: commentId, status };
}

export async function moderateComment(commentId: string, callerId: string, callerIsModerator: boolean, action: "approve" | "remove"): Promise<void> {
  const { rows } = await db.query<{ post_id: string; blog_owner_id: string }>(
    `SELECT c.post_id, b.owner_id AS blog_owner_id
     FROM blog_post_comments c
     JOIN blog_posts p ON p.id = c.post_id
     JOIN blogs b ON b.id = p.blog_id
     WHERE c.id = $1 AND c.deleted_at IS NULL LIMIT 1`,
    [commentId]
  );
  const row = rows[0];
  if (!row) throw notFound("Comment not found");
  if (row.blog_owner_id !== callerId && !callerIsModerator) throw forbidden("You can't moderate this comment.");

  if (action === "approve") {
    const { rowCount } = await db.query(`UPDATE blog_post_comments SET status = 'visible', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [commentId]);
    if (rowCount && rowCount > 0) await db.query(`UPDATE blog_posts SET comment_count = comment_count + 1 WHERE id = $1`, [row.post_id]);
  } else {
    const { rows: beforeRows } = await db.query<{ status: string }>(`SELECT status FROM blog_post_comments WHERE id = $1`, [commentId]);
    const wasVisible = beforeRows[0]?.status === "visible";
    await db.query(`UPDATE blog_post_comments SET status = 'removed', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [commentId]);
    if (wasVisible) await db.query(`UPDATE blog_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = $1`, [row.post_id]);
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function toggleSubscription(blogId: string, userId: string, next: boolean): Promise<{ subscriberCount: number }> {
  await requireFeatureEnabled("blogs");
  return db.transaction(async (tx: TransactionClient) => {
    const { rows: blogRows } = await tx.query<{ id: string }>(`SELECT id FROM blogs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [blogId]);
    if (!blogRows[0]) throw notFound("Blog not found");

    if (next) {
      const { rowCount } = await tx.query(`INSERT INTO blog_subscriptions (blog_id, user_id) VALUES ($1, $2) ON CONFLICT (blog_id, user_id) DO NOTHING`, [blogId, userId]);
      if (rowCount && rowCount > 0) await tx.query(`UPDATE blogs SET subscriber_count = subscriber_count + 1 WHERE id = $1`, [blogId]);
    } else {
      const { rowCount } = await tx.query(`DELETE FROM blog_subscriptions WHERE blog_id = $1 AND user_id = $2`, [blogId, userId]);
      if (rowCount && rowCount > 0) await tx.query(`UPDATE blogs SET subscriber_count = GREATEST(subscriber_count - 1, 0) WHERE id = $1`, [blogId]);
    }

    const { rows } = await tx.query<{ subscriber_count: number }>(`SELECT subscriber_count FROM blogs WHERE id = $1`, [blogId]);
    return { subscriberCount: rows[0].subscriber_count };
  });
}

// ---------------------------------------------------------------------------
// Views (called at most once per viewer per session — client dedupes via localStorage)
// ---------------------------------------------------------------------------

export async function recordView(postId: string): Promise<void> {
  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id = $1 AND deleted_at IS NULL`, [postId]);
    await tx.query(
      `INSERT INTO blog_post_daily_stats (post_id, date, views) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (post_id, date) DO UPDATE SET views = blog_post_daily_stats.views + 1`,
      [postId]
    );
  });
}

// ---------------------------------------------------------------------------
// Paywall unlock
// ---------------------------------------------------------------------------

export interface UnlockResult {
  alreadyUnlocked: boolean;
  creditsSpent: number;
}

export async function unlockPost(postId: string, userId: string, userPlan: string): Promise<UnlockResult> {
  await requireFeatureEnabled("blogs");

  const { rows: postRows } = await db.query<{ id: string; blog_id: string; author_id: string; is_paywalled: boolean; paywall_credits_cost: number }>(
    `SELECT id, blog_id, author_id, is_paywalled, paywall_credits_cost FROM blog_posts WHERE id = $1 AND deleted_at IS NULL AND status = 'published' LIMIT 1`,
    [postId]
  );
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (!post.is_paywalled || post.paywall_credits_cost <= 0) return { alreadyUnlocked: true, creditsSpent: 0 };
  if (post.author_id === userId) return { alreadyUnlocked: true, creditsSpent: 0 };

  const { rows: existingRows } = await db.query<{ id: string }>(`SELECT id FROM blog_post_unlocks WHERE post_id = $1 AND user_id = $2 LIMIT 1`, [postId, userId]);
  if (existingRows[0]) return { alreadyUnlocked: true, creditsSpent: 0 };

  const cost = post.paywall_credits_cost;
  const referenceId = `blog_paywall_unlock:${postId}:${userId}`;

  await db.transaction(async (tx: TransactionClient) => {
    await debitCoins(userId, cost, "blog_paywall_unlock", referenceId, "Unlocked a paywalled blog article", { postId, blogId: post.blog_id }, tx);
    await tx.query(`INSERT INTO blog_post_unlocks (post_id, user_id, credits_spent) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO NOTHING`, [postId, userId, cost]);
    await tx.query(
      `INSERT INTO blog_post_daily_stats (post_id, date, unlock_count, unlock_credits) VALUES ($1, CURRENT_DATE, 1, $2)
       ON CONFLICT (post_id, date) DO UPDATE SET unlock_count = blog_post_daily_stats.unlock_count + 1, unlock_credits = blog_post_daily_stats.unlock_credits + $2`,
      [postId, cost]
    );
  });

  await creditPaywallEarnings(post.author_id, postId, cost, referenceId).catch((err) => {
    logger.error({ err, postId, authorId: post.author_id }, "[blogs/service] failed to credit paywall earnings");
  });

  safeAwardXPFireAndForget(post.author_id, 5, "creator", "blog_paywall_unlocked", `blog_paywall_xp:${postId}:${userId}`);

  return { alreadyUnlocked: false, creditsSpent: cost };
}

/** Credits the creator's cash-equivalent earnings for a paywall unlock, using their plan's revenue-share rate. */
async function creditPaywallEarnings(creatorId: string, postId: string, creditsSpent: number, referenceId: string): Promise<void> {
  const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [creatorId]);
  const plan = rows[0]?.plan ?? "free";

  const [revSharePct, economy, manifest] = await Promise.all([getBlogRevSharePct(plan), getBlogEconomyConfig(), loadManifest()]);

  // Reuse the platform's existing Credit -> kobo conversion rate (coinToCashRate)
  // rather than introducing a second, blog-specific rate.
  const grossKobo = new Decimal(creditsSpent).mul(manifest.coinToCashRate);
  const afterProviderFee = grossKobo.mul(new Decimal(1).minus(new Decimal(economy.paystackFeePct).div(100)));
  const afterVat = afterProviderFee.mul(new Decimal(1).minus(new Decimal(economy.vatPct).div(100)));
  const netKobo = afterVat.mul(new Decimal(revSharePct).div(100)).floor();
  const platformFeeKobo = grossKobo.minus(netKobo);

  if (netKobo.lte(0)) return;

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO creator_earnings (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
       VALUES ($1, 'blog_paywall', $2, $3, $4, $5)
       ON CONFLICT (creator_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
      [creatorId, grossKobo.toFixed(0), platformFeeKobo.toFixed(0), netKobo.toFixed(0), referenceId]
    );
    await tx.query(
      `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [netKobo.toFixed(0), creatorId]
    );
  });
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

export type BlogAdminAction = "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete" | "transfer_ownership";

export async function logBlogModeration(moderatorId: string, blogId: string | null, postId: string | null, targetUserId: string | null, action: string, reason?: string | null, metadata?: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO blog_moderation_log (moderator_id, blog_id, post_id, target_user_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [moderatorId, blogId, postId, targetUserId, action, reason ?? null, JSON.stringify(metadata ?? {})]
  );
}

const STATUS_FOR_ACTION: Partial<Record<BlogAdminAction, string>> = {
  suspend: "suspended",
  ban: "banned",
  deactivate: "deactivated",
  pause: "paused",
  restore: "active",
};

export async function setBlogStatus(blogId: string, moderatorId: string, action: BlogAdminAction, reason?: string | null): Promise<void> {
  if (action === "delete") {
    const { rows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
    if (!rows[0]) throw notFound("Blog not found");
    await db.query(`UPDATE blogs SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [blogId]);
    await logBlogModeration(moderatorId, blogId, null, rows[0].owner_id, "delete", reason);
    return;
  }

  const status = STATUS_FOR_ACTION[action];
  if (!status) throw new ApiError(400, "BLOG_INVALID_ACTION", `Unsupported action: ${action}`);

  const { rows } = await db.query<{ owner_id: string }>(
    `UPDATE blogs SET status = $2, status_reason = $3, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING owner_id`,
    [blogId, status, reason ?? null]
  );
  if (!rows[0]) throw notFound("Blog not found");
  await logBlogModeration(moderatorId, blogId, null, rows[0].owner_id, action, reason);
}

export async function transferBlogOwnership(blogId: string, moderatorId: string, newOwnerId: string): Promise<void> {
  const { rows: userRows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [newOwnerId]);
  if (!userRows[0]) throw notFound("Target user not found");

  const existingBlog = await getBlogByOwner(newOwnerId);
  if (existingBlog) throw conflict("The target user already owns a blog.", "BLOG_OWNER_ALREADY_HAS_BLOG");

  const { rows } = await db.query<{ owner_id: string }>(
    `UPDATE blogs SET owner_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING owner_id`,
    [blogId, newOwnerId]
  );
  if (!rows[0]) throw notFound("Blog not found");

  await db.query(`UPDATE blog_posts SET author_id = $2 WHERE blog_id = $1 AND author_id != $2`, [blogId, newOwnerId]);
  await logBlogModeration(moderatorId, blogId, null, newOwnerId, "transfer_ownership", null, { previousOwnerId: rows[0].owner_id });
}

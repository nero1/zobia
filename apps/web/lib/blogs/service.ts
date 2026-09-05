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
import { debitCoins, checkAndDebit, creditCoins } from "@/lib/economy/coins";
import { debitStars, creditStars } from "@/lib/economy/stars";
import { sanitizeBlogPostHtml, plainTextToBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { generateUniqueSlug, generateUniqueBlogPostSlug, recordSlugRedirect } from "@/lib/slug";
import { normalizeMenuConfig, type BlogMenuConfig, type BlogMenuItem } from "@/lib/blogs/menu";
import { DEFAULT_PAGE_TITLES, getDefaultPageContent, type DefaultPageKey } from "@/lib/blogs/defaultPages";
import {
  getMaxBlogPosts,
  getMaxWordsForPlan,
  getBlogRevSharePct,
  getBlogEconomyConfig,
  getIncludedPersonalBlogCount,
  getIncludedBusinessBlogCount,
  getExtraBlogSlotCost,
  type BlogSlotCurrency,
} from "@/lib/blogs/limits";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import {
  countActiveBlogsForScope,
  listGiftTiersForOwner as repoListGiftTiersForOwner,
  listPublicGiftTiers as repoListPublicGiftTiers,
  listGiftPurchasesForBlog as repoListGiftPurchasesForBlog,
  getGiftTierById,
  getGiftPurchaseForBuyer,
  type BlogGiftTierRow,
} from "@/lib/blogs/repo";

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

/**
 * Blog slugs are derived from at most the first `maxWords` words of the
 * blog's title/name (product spec) rather than the full title — keeps slugs
 * short and readable for long blog names. `generateUniqueSlug` still does
 * the actual slugify() + de-dupe-suffix work; this just trims its input.
 */
function slugSourceWords(name: string, maxWords = 6): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

export type BlogPostContentFormat = "markdown" | "plaintext";

function renderBodyHtml(bodyMarkdown: string, contentFormat: BlogPostContentFormat): string {
  return contentFormat === "plaintext" ? plainTextToBlogPostHtml(bodyMarkdown) : sanitizeBlogPostHtml(bodyMarkdown);
}

// ---------------------------------------------------------------------------
// Create / update a blog
// ---------------------------------------------------------------------------

export interface CreateBlogInput {
  userId: string;
  title: string;
  tagline?: string | null;
  description?: string | null;
  /** Create as a blog belonging to this business account (must be owned by userId) instead of a personal blog. */
  businessAccountId?: string | null;
  /** Which currency to pay with if this blog is beyond the scope's included quota. Defaults to the first admin-accepted currency. */
  paymentCurrency?: BlogSlotCurrency;
}

export interface CreateBlogResult {
  id: string;
  slug: string;
  /** 'included' if this blog fit within the free quota, 'purchased' if an extra-slot unlock was charged. */
  slotSource: "included" | "purchased";
  slotUnlockCurrency: BlogSlotCurrency | null;
  slotUnlockCost: number | null;
}

/**
 * Creates a blog for the caller — either a personal blog (default) or a
 * business blog (`businessAccountId` set, must be a business account the
 * caller owns). Blogs are no longer 1:1 with an owner (migration 0018):
 * each scope (the user's personal blogs, and separately each business
 * account they own) gets an included-blog quota from lib/blogs/limits.ts;
 * a blog beyond that quota requires a one-time Credits/Stars unlock before
 * the row is created.
 */
export async function createBlog(input: CreateBlogInput): Promise<CreateBlogResult> {
  await requireFeatureEnabled("blogs");

  let businessAccountId: string | null = null;
  let businessTier: string | null = null;
  if (input.businessAccountId) {
    const { rows } = await db.query<{ id: string; user_id: string; tier: string; status: string }>(
      `SELECT id, user_id, tier, status FROM business_accounts WHERE id = $1 LIMIT 1`,
      [input.businessAccountId]
    );
    const account = rows[0];
    if (!account) throw notFound("Business account not found");
    if (account.user_id !== input.userId) throw forbidden("You don't own this business account.");
    if (account.status !== "active") {
      throw forbidden("Your business account must be active to create a blog.", "BUSINESS_ACCOUNT_INACTIVE");
    }
    businessAccountId = account.id;
    businessTier = account.tier;
  }

  const { rows: userRows } = await db.query<{ plan: string; level_creator: number }>(
    `SELECT plan, level_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.userId]
  );
  const user = userRows[0];
  if (!user) throw notFound("User not found");

  const includedCount = businessAccountId
    ? await getIncludedBusinessBlogCount(businessTier!)
    : await getIncludedPersonalBlogCount(user.plan, user.level_creator);

  const blogId = randomUUID();
  const slug = await generateUniqueSlug("blog", slugSourceWords(input.title), blogId);

  // Lock a stable row for the scope (the business account for a business
  // blog, the user for a personal blog) across the count-check + insert so
  // two concurrent creates for the same scope can't both slip in under the
  // quota — mirrors POST /api/business/pages's BIZ-PAGE-RACE guard.
  const lockSql = businessAccountId
    ? `SELECT id FROM business_accounts WHERE id = $1 FOR UPDATE`
    : `SELECT id FROM users WHERE id = $1 FOR UPDATE`;
  const lockParam = businessAccountId ?? input.userId;

  const outcome = await db.transaction(async (tx: TransactionClient) => {
    await tx.query(lockSql, [lockParam]);
    const used = await countActiveBlogsForScope({ ownerId: input.userId, businessAccountId }, tx);

    let slotSource: "included" | "purchased" = "included";
    let slotCurrency: BlogSlotCurrency | null = null;
    let slotCost: number | null = null;
    let referenceId: string | null = null;

    if (used >= includedCount) {
      slotSource = "purchased";
      const slotPricing = await getExtraBlogSlotCost(businessAccountId ? "business" : "personal");
      const currency: BlogSlotCurrency | undefined =
        input.paymentCurrency && slotPricing.acceptedCurrencies.includes(input.paymentCurrency)
          ? input.paymentCurrency
          : slotPricing.acceptedCurrencies[0];
      if (!currency) {
        throw forbidden("Extra blog slots are not available for purchase right now.", "BLOG_SLOT_PAYMENT_UNAVAILABLE");
      }

      // Not fully replay-safe (the timestamp makes each attempt's reference
      // unique) — a client retry after a network drop could double-charge.
      // Acceptable for now per product spec; a client-supplied idempotency
      // key would close this gap if it becomes a real issue.
      referenceId = `blog_extra_slot:${input.userId}:${Date.now()}`;
      if (currency === "credits") {
        await checkAndDebit(input.userId, slotPricing.credits, "blog_extra_slot", referenceId, "Unlocked an additional blog slot", { businessAccountId }, tx);
        slotCost = slotPricing.credits;
      } else {
        await debitStars(input.userId, slotPricing.stars, "blog_extra_slot", referenceId, "Unlocked an additional blog slot", tx);
        slotCost = slotPricing.stars;
      }
      slotCurrency = currency;
    }

    await tx.query(
      `INSERT INTO blogs
         (id, owner_id, slug, title, tagline, description, status, business_account_id, slot_source, slot_unlock_currency, slot_unlock_cost, slot_unlock_reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11)`,
      [
        blogId, input.userId, slug, input.title.trim(), input.tagline?.trim() || null, input.description?.trim() || null,
        businessAccountId, slotSource, slotCurrency, slotCost, referenceId,
      ]
    );

    await createDefaultPagesAndMenu(tx, blogId, input.userId, input.title.trim());

    return { slotSource, slotCurrency, slotCost };
  });

  return { id: blogId, slug, slotSource: outcome.slotSource, slotUnlockCurrency: outcome.slotCurrency, slotUnlockCost: outcome.slotCost };
}

// ---------------------------------------------------------------------------
// Default pages (About / Privacy / Contact) — migration 0023
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_KEYS: DefaultPageKey[] = ["about", "privacy", "contact"];

/**
 * Inserts the three auto-generated pages for a brand-new blog, and appends
 * them to its (still-default) menu_config. Runs inside createBlog's
 * transaction. Slugs are fixed ('about'/'privacy'/'contact') — safe because
 * the blog was just created in this same transaction, so nothing can
 * already occupy them.
 */
async function createDefaultPagesAndMenu(tx: TransactionClient, blogId: string, authorId: string, blogTitle: string): Promise<void> {
  const menuItems: BlogMenuItem[] = [];
  for (const key of DEFAULT_PAGE_KEYS) {
    const postId = randomUUID();
    const bodyMarkdown = getDefaultPageContent(key, blogTitle);
    const bodyHtml = renderBodyHtml(bodyMarkdown, "markdown");
    await tx.query(
      `INSERT INTO blog_posts (id, blog_id, author_id, type, page_key, title, slug, body_markdown, body_html, content_format, status, published_at, word_count)
       VALUES ($1, $2, $3, 'page', $4, $5, $4, $6, $7, 'markdown', 'published', NOW(), $8)`,
      [postId, blogId, authorId, key, DEFAULT_PAGE_TITLES[key], bodyMarkdown, bodyHtml, wordCount(bodyMarkdown)]
    );
    menuItems.push({ id: `page-${key}`, label: DEFAULT_PAGE_TITLES[key], type: "page", targetId: key });
  }
  await tx.query(`UPDATE blogs SET post_count = post_count + $2 WHERE id = $1`, [blogId, DEFAULT_PAGE_KEYS.length]);

  const { rows } = await tx.query<{ menu_config: BlogMenuConfig }>(`SELECT menu_config FROM blogs WHERE id = $1 LIMIT 1`, [blogId]);
  const current = normalizeMenuConfig(rows[0]?.menu_config);
  const nextConfig: BlogMenuConfig = { ...current, items: [...current.items, ...menuItems] };
  await tx.query(`UPDATE blogs SET menu_config = $2::jsonb WHERE id = $1`, [blogId, JSON.stringify(nextConfig)]);
}

/**
 * Regenerates one of the three default pages' content back to its
 * template, keeping the same post row (id/slug/page_key/status untouched)
 * — so any menu items or bookmarks pointing at it keep working. Owner or
 * moderator/admin only, mirroring updatePost's permission shape.
 */
export async function resetDefaultPage(blogId: string, callerId: string, callerIsModerator: boolean, pageKey: DefaultPageKey): Promise<void> {
  const { rows } = await db.query<{ id: string; owner_id: string; title: string }>(
    `SELECT p.id, b.owner_id, b.title
     FROM blog_posts p JOIN blogs b ON b.id = p.blog_id
     WHERE p.blog_id = $1 AND p.page_key = $2 AND p.deleted_at IS NULL LIMIT 1`,
    [blogId, pageKey]
  );
  const row = rows[0];
  if (!row) throw notFound("Default page not found");
  if (row.owner_id !== callerId && !callerIsModerator) throw forbidden("You can't manage this page.");

  const bodyMarkdown = getDefaultPageContent(pageKey, row.title);
  const bodyHtml = renderBodyHtml(bodyMarkdown, "markdown");
  await db.query(
    `UPDATE blog_posts SET title = $2, body_markdown = $3, body_html = $4, content_format = 'markdown', word_count = $5, updated_at = NOW()
     WHERE id = $1`,
    [row.id, DEFAULT_PAGE_TITLES[pageKey], bodyMarkdown, bodyHtml, wordCount(bodyMarkdown)]
  );
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
  menuConfig?: BlogMenuConfig;
}

/**
 * Renaming a blog regenerates its slug using the same first-6-words rule as
 * creation (lib/blogs/service.ts's slugSourceWords), and the old slug is
 * recorded in `slug_redirects` (the same table/mechanism the admin games
 * editor uses for its own renames — see app/api/admin/games/[id]/route.ts)
 * so old /b/<oldSlug> links 301 to the new one instead of 404ing. Trade-off:
 * this is a *pointer* redirect, not a slug-history log — only the most
 * recent old slug for a given blog resolves; anything older than that
 * (a blog renamed twice) stops resolving. Acceptable per the existing
 * precedent elsewhere in the app; a full history table would be
 * over-engineering for what's a rare, owner-initiated action.
 */
export async function updateBlogSettings(blogId: string, callerId: string, input: UpdateBlogSettingsInput): Promise<void> {
  const { rows } = await db.query<{ owner_id: string; title: string; slug: string }>(`SELECT owner_id, title, slug FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.owner_id !== callerId) throw forbidden("Only the blog owner can update these settings.");

  const fields: string[] = [];
  const params: SqlParam[] = [blogId];
  const push = (col: string, value: SqlParam, cast?: string) => {
    params.push(value);
    fields.push(`${col} = $${params.length}${cast ? `::${cast}` : ""}`);
  };

  let newSlug: string | null = null;
  if (input.title !== undefined) {
    const trimmedTitle = input.title.trim();
    push("title", trimmedTitle);
    if (trimmedTitle && trimmedTitle !== blog.title) {
      newSlug = await generateUniqueSlug("blog", slugSourceWords(trimmedTitle), blogId, db, blogId);
      if (newSlug !== blog.slug) push("slug", newSlug);
      else newSlug = null;
    }
  }
  if (input.tagline !== undefined) push("tagline", input.tagline?.trim() || null);
  if (input.description !== undefined) push("description", input.description?.trim() || null);
  if (input.avatarUrl !== undefined) push("avatar_url", input.avatarUrl || null);
  if (input.coverImageUrl !== undefined) push("cover_image_url", input.coverImageUrl || null);
  if (input.commentsEnabled !== undefined) push("comments_enabled", input.commentsEnabled);
  if (input.commentsModerationEnabled !== undefined) push("comments_moderation_enabled", input.commentsModerationEnabled);
  if (input.hideAuthorInfo !== undefined) push("hide_author_info", input.hideAuthorInfo);
  if (input.showSubscriberCount !== undefined) push("show_subscriber_count", input.showSubscriberCount);
  if (input.menuConfig !== undefined) push("menu_config", JSON.stringify(normalizeMenuConfig(input.menuConfig)), "jsonb");

  if (fields.length === 0) return;
  await db.query(`UPDATE blogs SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
  if (newSlug) await recordSlugRedirect("blog", blog.slug, blogId, newSlug).catch(() => {});
}

// ---------------------------------------------------------------------------
// Contact form (migration 0023) — open to every visitor, logged in or not,
// regardless of the blog's comment settings; see app/api/blogs/[slug]/contact.
// ---------------------------------------------------------------------------

export interface SubmitContactMessageInput {
  blogId: string;
  senderUserId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  message: string;
}

export async function submitContactMessage(input: SubmitContactMessageInput): Promise<{ id: string }> {
  await requireFeatureEnabled("blogs");

  const { rows: blogRows } = await db.query<{ id: string; owner_id: string; slug: string; title: string }>(
    `SELECT id, owner_id, slug, title FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.blogId]
  );
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO blog_contact_messages (blog_id, sender_user_id, sender_name, sender_email, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [blog.id, input.senderUserId ?? null, input.senderName?.trim() || null, input.senderEmail?.trim() || null, input.message.trim()]
  );

  await insertNotificationBatch(
    db,
    [blog.owner_id],
    "blog_contact_message",
    `New message on ${blog.title}`,
    input.message.trim().slice(0, 140),
    { blogId: blog.id, blogSlug: blog.slug, messageId: rows[0].id }
  ).catch((err) => {
    logger.error({ err, blogId: blog.id }, "[blogs/service] failed to notify blog owner of a contact message");
  });

  return { id: rows[0].id };
}

export interface BlogContactMessageRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export async function listContactMessages(blogId: string, callerId: string): Promise<BlogContactMessageRow[]> {
  const { rows: blogRows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.owner_id !== callerId) throw forbidden("Only the blog owner can view contact messages.");

  const { rows } = await db.query<BlogContactMessageRow>(
    `SELECT m.id, m.sender_name, m.sender_email, u.username AS sender_username, m.message, m.is_read, m.created_at
     FROM blog_contact_messages m LEFT JOIN users u ON u.id = m.sender_user_id
     WHERE m.blog_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
    [blogId]
  );
  return rows;
}

export async function markContactMessageRead(blogId: string, callerId: string, messageId: string): Promise<void> {
  const { rows: blogRows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.owner_id !== callerId) throw forbidden("Only the blog owner can manage contact messages.");
  await db.query(`UPDATE blog_contact_messages SET is_read = TRUE WHERE id = $1 AND blog_id = $2`, [messageId, blogId]);
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
  contentFormat?: BlogPostContentFormat;
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
  const contentFormat: BlogPostContentFormat = input.contentFormat === "plaintext" ? "plaintext" : "markdown";
  const bodyHtml = renderBodyHtml(input.bodyMarkdown, contentFormat);
  const isPaywalled = input.type === "article" && !!input.isPaywalled;
  const paywallCost = isPaywalled ? Math.max(0, Math.floor(input.paywallCreditsCost ?? 0)) : 0;
  const publishedAt = input.status === "published" ? new Date().toISOString() : null;

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO blog_posts
         (id, blog_id, author_id, category_id, type, title, slug, excerpt, body_markdown, body_html, content_format,
          featured_image_url, status, is_paywalled, paywall_credits_cost, word_count, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        postId, input.blogId, input.authorId, input.categoryId ?? null, input.type, input.title.trim(),
        slug, input.excerpt?.trim() || null, input.bodyMarkdown, bodyHtml, contentFormat,
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
  contentFormat?: BlogPostContentFormat;
  featuredImageUrl?: string | null;
  categoryId?: string | null;
  isPaywalled?: boolean;
  paywallCreditsCost?: number;
  status?: "draft" | "published";
  sortOrder?: number;
}

export async function updatePost(postId: string, callerId: string, callerPlan: string, input: UpdatePostInput): Promise<void> {
  const { rows } = await db.query<{ blog_id: string; author_id: string; type: string; status: string; slug: string; content_format: string }>(
    `SELECT blog_id, author_id, type, status, slug, content_format FROM blog_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
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

  if (input.contentFormat !== undefined) push("content_format", input.contentFormat);

  if (input.bodyMarkdown !== undefined) {
    const maxWords = await getMaxWordsForPlan(callerPlan);
    const words = wordCount(input.bodyMarkdown);
    if (post.type === "article" && words > maxWords) {
      throw new ApiError(400, "BLOG_WORD_LIMIT_EXCEEDED", `Your plan allows articles up to ${maxWords} words. This article is ${words} words.`, undefined, undefined, { maxWords, words });
    }
    const contentFormat: BlogPostContentFormat = (input.contentFormat ?? (post.content_format as BlogPostContentFormat)) === "plaintext" ? "plaintext" : "markdown";
    push("body_markdown", input.bodyMarkdown);
    push("body_html", renderBodyHtml(input.bodyMarkdown, contentFormat));
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

/**
 * Batch draft/delete for the owner's post-management screen (dashboard).
 * Scoped to a single blog + ownership check up front, then a single
 * `WHERE id = ANY($ids) AND blog_id = $blogId` write — mirrors the
 * single-SQL-statement style used elsewhere for scoped bulk writes (e.g.
 * business_pages slot sweeps) rather than looping per-post, since every
 * post here shares the same blog_id + owner_id and the same target status.
 */
export async function batchUpdatePosts(
  blogId: string,
  callerId: string,
  postIds: string[],
  action: "draft" | "delete"
): Promise<{ affected: number }> {
  if (postIds.length === 0) return { affected: 0 };
  const { rows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM blogs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [blogId]);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.owner_id !== callerId) throw forbidden("Only the blog owner can manage these posts.");

  if (action === "delete") {
    const result = await db.transaction(async (tx: TransactionClient) => {
      const { rowCount } = await tx.query(
        `UPDATE blog_posts SET deleted_at = NOW(), updated_at = NOW()
         WHERE blog_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [blogId, postIds]
      );
      const affected = rowCount ?? 0;
      if (affected > 0) {
        await tx.query(`UPDATE blogs SET post_count = GREATEST(post_count - $2, 0), updated_at = NOW() WHERE id = $1`, [blogId, affected]);
      }
      return affected;
    });
    return { affected: result };
  }

  const { rowCount } = await db.query(
    `UPDATE blog_posts SET status = 'draft', updated_at = NOW()
     WHERE blog_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL AND status != 'draft'`,
    [blogId, postIds]
  );
  return { affected: rowCount ?? 0 };
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

  // Best-effort: reward pot claim never blocks the comment itself. Product
  // decision — a comment counts toward the pot as soon as it's posted (not
  // only once approved by moderation), since the qualifying action is the
  // act of commenting, not its later visibility.
  await claimTreasuryReward(input.postId, input.authorId, "comment").catch((err) => {
    logger.error({ err, postId: input.postId, userId: input.authorId }, "[blogs/service] failed to claim treasury reward for comment");
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

/**
 * Owner (or moderator) CRUD delete of any comment on their blog, regardless
 * of its current status — moderateComment's "remove" action already sets
 * status='removed' + deleted_at, so this is a thin, explicitly-named alias
 * for the dashboard's "delete any comment" affordance (distinct from the
 * pending-queue's approve/remove actions, which read as moderation rather
 * than ordinary content management).
 */
export async function deleteComment(commentId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  await moderateComment(commentId, callerId, callerIsModerator, "remove");
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
  await requireFeatureEnabled("blogMonetization");

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

  // Blogs are no longer 1:1 with an owner (migration 0018) — a target user
  // already having other blogs is no longer a conflict, so there's nothing
  // to check here beyond the target existing.
  const { rows } = await db.query<{ owner_id: string }>(
    `UPDATE blogs SET owner_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING owner_id`,
    [blogId, newOwnerId]
  );
  if (!rows[0]) throw notFound("Blog not found");

  await db.query(`UPDATE blog_posts SET author_id = $2 WHERE blog_id = $1 AND author_id != $2`, [blogId, newOwnerId]);
  await logBlogModeration(moderatorId, blogId, null, newOwnerId, "transfer_ownership", null, { previousOwnerId: rows[0].owner_id });
}

// ---------------------------------------------------------------------------
// Per-post credit treasury/pot — the first `maxClaimants` people to comment
// on or share a post split `fundedAmount` Credits evenly (Credits only per
// product spec). See db/migrations/0020_blog_post_treasury.sql.
// ---------------------------------------------------------------------------

export interface TreasuryState {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

function toTreasuryState(row: { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string }): TreasuryState {
  return {
    id: row.id,
    fundedAmount: row.funded_amount,
    remainingAmount: row.remaining_amount,
    maxClaimants: row.max_claimants,
    claimantCount: row.claimant_count,
    status: row.status,
    rewardPerClaimant: row.max_claimants > 0 ? Math.floor(row.funded_amount / row.max_claimants) : 0,
  };
}

export async function getPostTreasury(postId: string): Promise<TreasuryState | null> {
  const { rows } = await db.query<{ id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string }>(
    `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status FROM blog_post_treasuries WHERE post_id = $1 LIMIT 1`,
    [postId]
  );
  return rows[0] ? toTreasuryState(rows[0]) : null;
}

/**
 * Fund (or top up) a post's reward pot. Only the post's author may fund it.
 * A top-up adds to funded_amount/remaining_amount and, if maxClaimants is
 * given, replaces it going forward — existing claimants already paid keep
 * what they got; the per-claim reward for remaining slots is always
 * recomputed from the current funded_amount/max_claimants at claim time.
 */
export async function fundPostTreasury(ownerId: string, postId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("blogs");
  await requireFeatureEnabled("blogMonetization");
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer.", "BLOG_TREASURY_INVALID_AMOUNT");
  if (!Number.isInteger(maxClaimants) || maxClaimants <= 0) throw badRequest("Max claimants must be a positive integer.", "BLOG_TREASURY_INVALID_MAX_CLAIMANTS");

  const { rows: postRows } = await db.query<{ author_id: string }>(`SELECT author_id FROM blog_posts WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [postId]);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (post.author_id !== ownerId) throw forbidden("Only the post's author can fund its reward pot.");

  const referenceId = `blog_treasury_fund:${postId}:${Date.now()}`;
  const result = await db.transaction(async (tx: TransactionClient) => {
    await checkAndDebit(ownerId, amount, "blog_treasury_fund", referenceId, "Funded a blog post reward pot", { postId }, tx);
    const { rows } = await tx.query<{ id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string }>(
      `INSERT INTO blog_post_treasuries (post_id, owner_id, funded_amount, remaining_amount, max_claimants)
       VALUES ($1, $2, $3, $3, $4)
       ON CONFLICT (post_id) DO UPDATE SET
         funded_amount = blog_post_treasuries.funded_amount + $3,
         remaining_amount = blog_post_treasuries.remaining_amount + $3,
         max_claimants = $4,
         status = CASE WHEN blog_post_treasuries.status = 'closed' THEN 'closed' ELSE 'active' END,
         updated_at = NOW()
       RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status`,
      [postId, ownerId, amount, maxClaimants]
    );
    return rows[0];
  });

  return toTreasuryState(result);
}

/**
 * Records that `userId` performed `claimType` on `postId`, and pays out the
 * pot's per-claimant reward if a treasury is active and slots remain. No-op
 * (returns null) when there's no active treasury, the claimant slots are
 * full, or this user already claimed — callers invoke this best-effort from
 * addComment()/recordShare() and never surface its absence as an error.
 */
export async function claimTreasuryReward(postId: string, userId: string, claimType: "comment" | "share"): Promise<{ amount: number } | null> {
  // Best-effort claim: a monetization kill-switch just means no payout, not
  // an error surfaced to the comment/share flow that triggered this.
  const manifest = await loadManifest();
  if (!manifest.features.blogMonetization) return null;

  return db.transaction(async (tx: TransactionClient) => {
    const { rows: treasuryRows } = await tx.query<{ id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string; owner_id: string }>(
      `SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, owner_id FROM blog_post_treasuries WHERE post_id = $1 FOR UPDATE`,
      [postId]
    );
    const treasury = treasuryRows[0];
    if (!treasury || treasury.status !== "active") return null;
    if (treasury.claimant_count >= treasury.max_claimants) return null;
    if (treasury.owner_id === userId) return null; // the author can't claim their own pot

    const rewardPerClaimant = Math.floor(treasury.funded_amount / treasury.max_claimants);
    if (rewardPerClaimant <= 0 || treasury.remaining_amount < rewardPerClaimant) return null;

    const { rowCount } = await tx.query(
      `INSERT INTO blog_post_treasury_claims (treasury_id, user_id, claim_type, amount) VALUES ($1, $2, $3, $4) ON CONFLICT (treasury_id, user_id) DO NOTHING`,
      [treasury.id, userId, claimType, rewardPerClaimant]
    );
    if (!rowCount || rowCount === 0) return null; // already claimed

    const newClaimantCount = treasury.claimant_count + 1;
    const newRemaining = treasury.remaining_amount - rewardPerClaimant;
    const newStatus = newClaimantCount >= treasury.max_claimants || newRemaining < rewardPerClaimant ? "exhausted" : "active";
    await tx.query(
      `UPDATE blog_post_treasuries SET claimant_count = $2, remaining_amount = $3, status = $4, updated_at = NOW() WHERE id = $1`,
      [treasury.id, newClaimantCount, newRemaining, newStatus]
    );

    await creditCoins(userId, rewardPerClaimant, "blog_treasury_claim", `blog_treasury_claim:${treasury.id}:${userId}`, "Reward pot claim", { postId, claimType }, tx);

    return { amount: rewardPerClaimant };
  });
}

/** Records a share event (idempotent per user/post) and attempts a treasury claim. */
export async function recordShare(postId: string, userId: string): Promise<{ shareCount: number; rewardClaimed: number | null }> {
  await requireFeatureEnabled("blogs");
  const { rows: postRows } = await db.query<{ id: string }>(`SELECT id FROM blog_posts WHERE id = $1 AND deleted_at IS NULL AND status = 'published' LIMIT 1`, [postId]);
  if (!postRows[0]) throw notFound("Post not found");

  const { rowCount } = await db.query(`INSERT INTO blog_post_shares (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING`, [postId, userId]);
  if (rowCount && rowCount > 0) {
    await db.query(`UPDATE blog_posts SET share_count = share_count + 1 WHERE id = $1`, [postId]);
  }

  const claim = await claimTreasuryReward(postId, userId, "share").catch((err) => {
    logger.error({ err, postId, userId }, "[blogs/service] failed to claim treasury reward for share");
    return null;
  });

  const { rows: countRows } = await db.query<{ share_count: number }>(`SELECT share_count FROM blog_posts WHERE id = $1`, [postId]);
  return { shareCount: countRows[0]?.share_count ?? 0, rewardClaimed: claim?.amount ?? null };
}

// ---------------------------------------------------------------------------
// Rewarded Gifts (migration 0024) — a blog owner defines purchasable "gift
// tiers"; a reader spends Credits or Stars to buy one and unlocks a benefit
// for themselves. Gated by feature_blogs + feature_blog_gifts +
// blog_monetization_enabled (all three, mirroring the paywall/treasury
// kill-switch wiring above). Blog-level reward pots for custom_reward tiers
// reuse blog_post_treasuries with post_id NULL / gift_tier_id set — see
// db/migrations/0024_blog_gifts.sql.
//
// Revenue share: gift purchases follow the exact same creator revenue-share
// convention as paywall unlocks (getBlogRevSharePct + provider fee/VAT for
// Credits, via creditPaywallEarnings's sibling below) rather than inventing
// a separate economic model. Stars purchases have no cash-equivalent
// conversion elsewhere in the codebase, so the owner is credited Stars
// directly, net of the same revenue-share percentage (no fee/VAT — those
// only apply to the cash-equivalent kobo ledger).
// ---------------------------------------------------------------------------

export type GiftBenefitType = "vip_badge" | "vip_section_access" | "custom_reward";
export type GiftCurrency = "credits" | "stars";

const GIFT_BENEFIT_TYPES: GiftBenefitType[] = ["vip_badge", "vip_section_access", "custom_reward"];

export interface GiftTierInput {
  name: string;
  description?: string | null;
  creditsPrice?: number | null;
  starsPrice?: number | null;
  benefitType: GiftBenefitType;
  /** vip_section_access: { unlockPostId }. custom_reward: { treasuryAmount?, textInstructions? }. */
  benefitConfig?: Record<string, unknown>;
  /** Generic cap shared by all benefit types; for custom_reward this is the "first X redeemers" limit. */
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}

async function assertGiftsEnabled(): Promise<void> {
  await requireFeatureEnabled("blogs");
  await requireFeatureEnabled("blogGifts");
  await requireFeatureEnabled("blogMonetization");
}

interface NormalizedGiftTier {
  name: string;
  description: string | null;
  creditsPrice: number | null;
  starsPrice: number | null;
  benefitType: GiftBenefitType;
  benefitConfig: Record<string, unknown>;
  maxRedemptions: number | null;
  expiresAt: string | null;
}

function normalizeGiftTierInput(input: GiftTierInput): NormalizedGiftTier {
  const name = input.name?.trim();
  if (!name) throw badRequest("A gift tier needs a name.", "BLOG_GIFT_INVALID_NAME");

  const creditsPrice = input.creditsPrice != null && Number.isFinite(input.creditsPrice) ? Math.trunc(input.creditsPrice) : null;
  const starsPrice = input.starsPrice != null && Number.isFinite(input.starsPrice) ? Math.trunc(input.starsPrice) : null;
  const finalCreditsPrice = creditsPrice != null && creditsPrice > 0 ? creditsPrice : null;
  const finalStarsPrice = starsPrice != null && starsPrice > 0 ? starsPrice : null;
  if (finalCreditsPrice == null && finalStarsPrice == null) {
    throw badRequest("Set at least one positive price (Credits and/or Stars).", "BLOG_GIFT_MISSING_PRICE");
  }

  if (!GIFT_BENEFIT_TYPES.includes(input.benefitType)) {
    throw badRequest("Unsupported benefit type.", "BLOG_GIFT_INVALID_BENEFIT");
  }
  const benefitConfig = input.benefitConfig ?? {};
  if (input.benefitType === "vip_section_access" && typeof benefitConfig.unlockPostId !== "string") {
    throw badRequest("vip_section_access requires benefitConfig.unlockPostId.", "BLOG_GIFT_MISSING_UNLOCK_TARGET");
  }

  const maxRedemptions = input.maxRedemptions != null && Number.isFinite(input.maxRedemptions) ? Math.trunc(input.maxRedemptions) : null;
  if (maxRedemptions != null && maxRedemptions <= 0) {
    throw badRequest("maxRedemptions must be a positive integer.", "BLOG_GIFT_INVALID_MAX_REDEMPTIONS");
  }

  return {
    name,
    description: input.description?.trim() || null,
    creditsPrice: finalCreditsPrice,
    starsPrice: finalStarsPrice,
    benefitType: input.benefitType,
    benefitConfig,
    maxRedemptions,
    expiresAt: input.expiresAt ?? null,
  };
}

export async function createGiftTier(ownerId: string, blogId: string, input: GiftTierInput): Promise<BlogGiftTierRow> {
  await assertGiftsEnabled();
  const blog = await assertBlogWritable(blogId);
  if (blog.ownerId !== ownerId) throw forbidden("Only the blog owner can manage gift tiers.");

  const n = normalizeGiftTierInput(input);
  const { rows } = await db.query<BlogGiftTierRow>(
    `INSERT INTO blog_gift_tiers (blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING id, blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, redemption_count, expires_at, enabled, created_at, updated_at`,
    [blogId, n.name, n.description, n.creditsPrice, n.starsPrice, n.benefitType, JSON.stringify(n.benefitConfig), n.maxRedemptions, n.expiresAt]
  );
  return rows[0];
}

export async function updateGiftTier(
  ownerId: string,
  tierId: string,
  patch: Partial<GiftTierInput> & { enabled?: boolean }
): Promise<BlogGiftTierRow> {
  await assertGiftsEnabled();

  const { rows: existingRows } = await db.query<{
    owner_id: string;
    name: string;
    description: string | null;
    credits_price: number | null;
    stars_price: number | null;
    benefit_type: GiftBenefitType;
    benefit_config: Record<string, unknown>;
    max_redemptions: number | null;
    expires_at: string | null;
    enabled: boolean;
  }>(
    `SELECT b.owner_id, t.name, t.description, t.credits_price, t.stars_price, t.benefit_type, t.benefit_config, t.max_redemptions, t.expires_at, t.enabled
     FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = $1 LIMIT 1`,
    [tierId]
  );
  const existing = existingRows[0];
  if (!existing) throw notFound("Gift tier not found");
  if (existing.owner_id !== ownerId) throw forbidden("Only the blog owner can manage gift tiers.");

  const merged = normalizeGiftTierInput({
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    creditsPrice: patch.creditsPrice !== undefined ? patch.creditsPrice : existing.credits_price,
    starsPrice: patch.starsPrice !== undefined ? patch.starsPrice : existing.stars_price,
    benefitType: patch.benefitType ?? existing.benefit_type,
    benefitConfig: patch.benefitConfig ?? existing.benefit_config,
    maxRedemptions: patch.maxRedemptions !== undefined ? patch.maxRedemptions : existing.max_redemptions,
    expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : existing.expires_at,
  });
  const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;

  const { rows } = await db.query<BlogGiftTierRow>(
    `UPDATE blog_gift_tiers
     SET name = $2, description = $3, credits_price = $4, stars_price = $5, benefit_type = $6,
         benefit_config = $7::jsonb, max_redemptions = $8, expires_at = $9, enabled = $10, updated_at = NOW()
     WHERE id = $1
     RETURNING id, blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, redemption_count, expires_at, enabled, created_at, updated_at`,
    [tierId, merged.name, merged.description, merged.creditsPrice, merged.starsPrice, merged.benefitType, JSON.stringify(merged.benefitConfig), merged.maxRedemptions, merged.expiresAt, enabled]
  );
  return rows[0];
}

/** Admin override (gate44/blogs/gifts): disable a tier platform-wide regardless of ownership. */
export async function adminSetGiftTierEnabled(tierId: string, enabled: boolean): Promise<void> {
  const { rowCount } = await db.query(`UPDATE blog_gift_tiers SET enabled = $2, updated_at = NOW() WHERE id = $1`, [tierId, enabled]);
  if (!rowCount) throw notFound("Gift tier not found");
}

export async function listGiftTiersForOwner(ownerId: string, blogId: string): Promise<BlogGiftTierRow[]> {
  const blog = await assertBlogWritable(blogId);
  if (blog.ownerId !== ownerId) throw forbidden("Only the blog owner can view its gift tiers.");
  return repoListGiftTiersForOwner(blogId);
}

/** Public tiers for a blog's page — empty when gifts are disabled site-wide rather than throwing (readers just see no gift section). */
export async function listPublicGiftTiers(blogId: string): Promise<BlogGiftTierRow[]> {
  const manifest = await loadManifest();
  if (!manifest.features.blogs || !manifest.features.blogGifts || !manifest.features.blogMonetization) return [];
  return repoListPublicGiftTiers(blogId);
}

export async function listGiftPurchasesForBlog(ownerId: string, blogId: string): Promise<Awaited<ReturnType<typeof repoListGiftPurchasesForBlog>>> {
  const blog = await assertBlogWritable(blogId);
  if (blog.ownerId !== ownerId) throw forbidden("Only the blog owner can view its gift redemptions.");
  return repoListGiftPurchasesForBlog(blogId);
}

export interface GiftTreasuryState {
  fundedAmount: number;
  remainingAmount: number;
}

export async function getGiftTierTreasury(tierId: string): Promise<GiftTreasuryState | null> {
  const { rows } = await db.query<{ funded_amount: number; remaining_amount: number }>(
    `SELECT funded_amount, remaining_amount FROM blog_post_treasuries WHERE gift_tier_id = $1 LIMIT 1`,
    [tierId]
  );
  return rows[0] ? { fundedAmount: rows[0].funded_amount, remainingAmount: rows[0].remaining_amount } : null;
}

/** Fund (or top up) a custom_reward tier's blog-level reward pot. Owner-only. */
export async function fundBlogGiftTreasury(ownerId: string, tierId: string, amount: number): Promise<GiftTreasuryState> {
  await assertGiftsEnabled();
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer.", "BLOG_GIFT_TREASURY_INVALID_AMOUNT");

  const { rows: tierRows } = await db.query<{ blog_id: string; owner_id: string; benefit_type: GiftBenefitType }>(
    `SELECT t.blog_id, b.owner_id, t.benefit_type FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = $1 LIMIT 1`,
    [tierId]
  );
  const tier = tierRows[0];
  if (!tier) throw notFound("Gift tier not found");
  if (tier.owner_id !== ownerId) throw forbidden("Only the blog owner can fund a gift tier's reward pot.");
  if (tier.benefit_type !== "custom_reward") throw badRequest("Only custom_reward tiers have a fundable reward pot.", "BLOG_GIFT_NOT_CUSTOM_REWARD");

  const referenceId = `blog_gift_treasury_fund:${tierId}:${Date.now()}`;
  const result = await db.transaction(async (tx: TransactionClient) => {
    await checkAndDebit(ownerId, amount, "blog_gift_treasury_fund", referenceId, "Funded a blog gift reward pot", { tierId }, tx);
    const { rows } = await tx.query<{ funded_amount: number; remaining_amount: number }>(
      `INSERT INTO blog_post_treasuries (blog_id, gift_tier_id, owner_id, funded_amount, remaining_amount)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (gift_tier_id) DO UPDATE SET
         funded_amount = blog_post_treasuries.funded_amount + $4,
         remaining_amount = blog_post_treasuries.remaining_amount + $4,
         status = CASE WHEN blog_post_treasuries.status = 'closed' THEN 'closed' ELSE 'active' END,
         updated_at = NOW()
       RETURNING funded_amount, remaining_amount`,
      [tier.blog_id, tierId, ownerId, amount]
    );
    return rows[0];
  });

  return { fundedAmount: result.funded_amount, remainingAmount: result.remaining_amount };
}

/** After purchasing a custom_reward tier, reveals its text instructions to the buyer. Returns null if not purchased. */
export async function getGiftTextReveal(buyerId: string, tierId: string): Promise<{ textInstructions: string | null } | null> {
  const purchase = await getGiftPurchaseForBuyer(tierId, buyerId);
  if (!purchase) return null;
  const tier = await getGiftTierById(tierId);
  if (!tier || tier.benefit_type !== "custom_reward") return null;
  const textInstructions = typeof tier.benefit_config?.textInstructions === "string" ? (tier.benefit_config.textInstructions as string) : null;
  return { textInstructions };
}

export interface GiftPurchaseResult {
  purchaseId: string;
  benefitType: GiftBenefitType;
  unlockedPostId?: string;
  treasuryPayout?: number;
  textInstructions?: string | null;
}

/**
 * Buy a gift tier: validates the feature is on, the tier is active/not
 * expired/under its redemption cap (checked atomically under FOR UPDATE,
 * mirroring claimTreasuryReward), debits the buyer, fulfills the benefit,
 * then credits the owner's earnings and notifies both parties best-effort.
 */
export async function sendGift(buyerId: string, tierId: string, currency: GiftCurrency): Promise<GiftPurchaseResult> {
  await assertGiftsEnabled();
  if (currency !== "credits" && currency !== "stars") throw badRequest("Invalid currency.", "BLOG_GIFT_INVALID_CURRENCY");

  const { rows: tierRows } = await db.query<{
    id: string; blog_id: string; owner_id: string; name: string;
    credits_price: number | null; stars_price: number | null;
    benefit_type: GiftBenefitType; benefit_config: Record<string, unknown>;
  }>(
    `SELECT t.id, t.blog_id, b.owner_id, t.name, t.credits_price, t.stars_price, t.benefit_type, t.benefit_config
     FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = $1 AND b.deleted_at IS NULL LIMIT 1`,
    [tierId]
  );
  const tier = tierRows[0];
  if (!tier) throw notFound("Gift tier not found");
  if (tier.owner_id === buyerId) throw forbidden("You can't send a gift to your own blog.", "BLOG_GIFT_SELF");

  const price = currency === "credits" ? tier.credits_price : tier.stars_price;
  if (price == null || price <= 0) throw badRequest(`This tier does not accept ${currency}.`, "BLOG_GIFT_CURRENCY_NOT_ACCEPTED");

  const referenceId = `blog_gift:${tierId}:${buyerId}:${Date.now()}`;

  const outcome = await db.transaction(async (tx: TransactionClient) => {
    const { rows: lockRows } = await tx.query<{ enabled: boolean; expires_at: string | null; max_redemptions: number | null; redemption_count: number }>(
      `SELECT enabled, expires_at, max_redemptions, redemption_count FROM blog_gift_tiers WHERE id = $1 FOR UPDATE`,
      [tierId]
    );
    const locked = lockRows[0];
    if (!locked) throw notFound("Gift tier not found");
    if (!locked.enabled) throw forbidden("This gift tier is no longer available.", "BLOG_GIFT_TIER_DISABLED");
    if (locked.expires_at && new Date(locked.expires_at) <= new Date()) throw forbidden("This gift tier has expired.", "BLOG_GIFT_TIER_EXPIRED");
    if (locked.max_redemptions != null && locked.redemption_count >= locked.max_redemptions) {
      throw forbidden("This gift tier is sold out.", "BLOG_GIFT_TIER_SOLD_OUT");
    }

    if (tier.benefit_type === "vip_badge") {
      const { rows: existingVip } = await tx.query<{ id: string }>(
        `SELECT id FROM blog_gift_purchases WHERE blog_id = $1 AND buyer_id = $2 AND benefit_type = 'vip_badge' AND status = 'active' LIMIT 1`,
        [tier.blog_id, buyerId]
      );
      if (existingVip[0]) throw badRequest("You already hold an active VIP badge for this blog.", "BLOG_GIFT_ALREADY_VIP");
    }

    if (currency === "credits") {
      await checkAndDebit(buyerId, price, "blog_gift_purchase", referenceId, `Gift: ${tier.name}`, { tierId, blogId: tier.blog_id }, tx);
    } else {
      await debitStars(buyerId, price, "blog_gift_purchase", referenceId, `Gift: ${tier.name}`, tx);
    }

    await tx.query(`UPDATE blog_gift_tiers SET redemption_count = redemption_count + 1, updated_at = NOW() WHERE id = $1`, [tierId]);

    const { rows: purchaseRows } = await tx.query<{ id: string }>(
      `INSERT INTO blog_gift_purchases (tier_id, blog_id, buyer_id, currency, amount_paid, benefit_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tierId, tier.blog_id, buyerId, currency, price, tier.benefit_type]
    );
    const purchaseId = purchaseRows[0].id;
    const result: GiftPurchaseResult = { purchaseId, benefitType: tier.benefit_type };

    if (tier.benefit_type === "vip_section_access") {
      const unlockPostId = typeof tier.benefit_config?.unlockPostId === "string" ? (tier.benefit_config.unlockPostId as string) : null;
      if (unlockPostId) {
        await tx.query(
          `INSERT INTO blog_post_unlocks (post_id, user_id, credits_spent) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO NOTHING`,
          [unlockPostId, buyerId, currency === "credits" ? price : 0]
        );
        result.unlockedPostId = unlockPostId;
      }
    } else if (tier.benefit_type === "custom_reward") {
      const config = tier.benefit_config ?? {};
      const treasuryAmount = typeof config.treasuryAmount === "number" && config.treasuryAmount > 0 ? Math.trunc(config.treasuryAmount) : null;
      const textInstructions = typeof config.textInstructions === "string" && config.textInstructions.trim() ? config.textInstructions.trim() : null;

      let payoutAmount: number | null = null;
      if (treasuryAmount != null) {
        const { rows: treasuryRows } = await tx.query<{ id: string; remaining_amount: number }>(
          `SELECT id, remaining_amount FROM blog_post_treasuries WHERE gift_tier_id = $1 FOR UPDATE`,
          [tierId]
        );
        const treasury = treasuryRows[0];
        if (treasury && treasury.remaining_amount >= treasuryAmount) {
          await tx.query(
            `UPDATE blog_post_treasuries SET remaining_amount = remaining_amount - $2, claimant_count = claimant_count + 1, updated_at = NOW() WHERE id = $1`,
            [treasury.id, treasuryAmount]
          );
          await creditCoins(buyerId, treasuryAmount, "blog_gift_treasury_claim", `blog_gift_treasury_claim:${purchaseId}`, "Gift reward pot payout", { tierId, purchaseId }, tx);
          payoutAmount = treasuryAmount;
        } else {
          logger.warn({ tierId, purchaseId }, "[blogs/service] gift custom_reward reward pot has insufficient funds; skipping payout");
        }
      }

      await tx.query(
        `INSERT INTO blog_gift_claims (purchase_id, treasury_payout_amount, text_revealed) VALUES ($1, $2, $3)`,
        [purchaseId, payoutAmount, textInstructions != null]
      );
      result.treasuryPayout = payoutAmount ?? undefined;
      result.textInstructions = textInstructions;
    }

    return result;
  });

  await creditGiftEarnings(tier.owner_id, price, currency, referenceId).catch((err) => {
    logger.error({ err, tierId, ownerId: tier.owner_id }, "[blogs/service] failed to credit gift earnings");
  });

  await insertNotificationBatch(
    db, [tier.owner_id], "blog_gift_received",
    `New gift: ${tier.name}`, `Someone sent your blog a "${tier.name}" gift.`,
    { blogId: tier.blog_id, tierId, purchaseId: outcome.purchaseId }
  ).catch((err) => logger.error({ err, tierId }, "[blogs/service] failed to notify blog owner of a gift"));

  await insertNotificationBatch(
    db, [buyerId], "blog_gift_sent",
    "Gift sent", `Your "${tier.name}" gift was sent successfully.`,
    { blogId: tier.blog_id, tierId, purchaseId: outcome.purchaseId }
  ).catch((err) => logger.error({ err, tierId }, "[blogs/service] failed to notify buyer of a gift"));

  safeAwardXPFireAndForget(tier.owner_id, 5, "creator", "blog_gift_received", `blog_gift_xp:${outcome.purchaseId}`);

  return outcome;
}

/** Credits the blog owner's earnings for a gift purchase, using the same revenue-share convention as paywall unlocks. */
async function creditGiftEarnings(creatorId: string, amountPaid: number, currency: GiftCurrency, referenceId: string): Promise<void> {
  const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [creatorId]);
  const plan = rows[0]?.plan ?? "free";
  const revSharePct = await getBlogRevSharePct(plan);

  if (currency === "stars") {
    // No Stars->cash conversion rate exists in this codebase (unlike coinToCashRate
    // for Credits) — credit the owner Stars directly, net of the same rev-share %.
    const netStars = new Decimal(amountPaid).mul(revSharePct).div(100).floor();
    if (netStars.lte(0)) return;
    await creditStars(creatorId, netStars.toNumber(), "blog_gift_earnings", `${referenceId}:earnings`, "Gift earnings share");
    return;
  }

  const [economy, manifest] = await Promise.all([getBlogEconomyConfig(), loadManifest()]);
  const grossKobo = new Decimal(amountPaid).mul(manifest.coinToCashRate);
  const afterProviderFee = grossKobo.mul(new Decimal(1).minus(new Decimal(economy.paystackFeePct).div(100)));
  const afterVat = afterProviderFee.mul(new Decimal(1).minus(new Decimal(economy.vatPct).div(100)));
  const netKobo = afterVat.mul(new Decimal(revSharePct).div(100)).floor();
  const platformFeeKobo = grossKobo.minus(netKobo);
  if (netKobo.lte(0)) return;

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO creator_earnings (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
       VALUES ($1, 'blog_gift', $2, $3, $4, $5)
       ON CONFLICT (creator_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
      [creatorId, grossKobo.toFixed(0), platformFeeKobo.toFixed(0), netKobo.toFixed(0), `${referenceId}:earnings`]
    );
    await tx.query(
      `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1, updated_at = NOW() WHERE id = $2`,
      [netKobo.toFixed(0), creatorId]
    );
  });
}

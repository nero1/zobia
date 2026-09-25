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
 *
 * DRIZZLE MIGRATION NOTES:
 *  - `lib/economy/coins.ts` and `lib/economy/stars.ts` (debitCoins,
 *    creditCoins, checkAndDebit, debitStars, creditStars) have already been
 *    migrated to Drizzle (they take `DbOrTx`), so every transaction below —
 *    including the ones sharing atomicity with those calls — runs as a
 *    Drizzle `orm.transaction()`.
 *  - `lib/slug.ts` (generateUniqueSlug, generateUniqueBlogPostSlug,
 *    recordSlugRedirect) and `lib/blogs/repo.ts` (countActiveBlogsForScope)
 *    are outside this migration's file list and still take the legacy
 *    `Queryable`/`TransactionClient` adapter — the raw `db` handle is kept
 *    in scope solely to pass into `generateUniqueSlug`, never for direct
 *    `db.query()`/`db.transaction()` calls here. `createBlog`'s active-blog
 *    count + row lock are done inline with Drizzle instead of calling
 *    `countActiveBlogsForScope` so its transaction can stay pure Drizzle.
 *  - The following columns/tables have no Drizzle definition in
 *    lib/db/schema.ts and are read/written via `sql` templates through the
 *    Drizzle instance instead of the query builder: `blogs.menu_config`,
 *    `blogs.active_theme_id`, `blog_posts.page_key`, the `blog_gift_tiers` /
 *    `blog_gift_purchases` / `blog_gift_claims` tables, and
 *    `blog_contact_messages`. Also, `blog_post_treasuries` is used here with
 *    `blog_id`/`gift_tier_id` columns and a nullable `post_id` for
 *    blog-level gift reward pots (see
 *    fundBlogGiftTreasury/sendGift/getGiftTierTreasury below), but the
 *    Drizzle schema only models it with a NOT NULL `post_id` and no
 *    `blog_id`/`gift_tier_id` columns — those specific statements also stay
 *    on `sql` templates. Flagged for the schema owner.
 */

import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
// `blogPostTreasuries` and `blogPostShares` are defined in lib/db/schema.ts
// but not included in that file's bundled `schema` registry object, so they
// are imported directly here instead of via `blogPostTreasuries`/
// `blogPostShares`.
import { blogPostTreasuries, blogPostShares } from "@/lib/db/schema";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
  const orm = await getDb();
  const rows = await orm
    .select({ ownerId: schema.blogs.ownerId, status: schema.blogs.status })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.status !== "active" && blog.status !== "paused") {
    throw forbidden("This blog has been restricted by an administrator.", "BLOG_RESTRICTED");
  }
  return { ownerId: blog.ownerId, status: blog.status };
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

  const orm = await getDb();

  let businessAccountId: string | null = null;
  let businessTier: string | null = null;
  if (input.businessAccountId) {
    const rows = await orm
      .select({ id: schema.businessAccounts.id, userId: schema.businessAccounts.userId, tier: schema.businessAccounts.tier, status: schema.businessAccounts.status })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.id, input.businessAccountId))
      .limit(1);
    const account = rows[0];
    if (!account) throw notFound("Business account not found");
    if (account.userId !== input.userId) throw forbidden("You don't own this business account.");
    if (account.status !== "active") {
      throw forbidden("Your business account must be active to create a blog.", "BUSINESS_ACCOUNT_INACTIVE");
    }
    businessAccountId = account.id;
    businessTier = account.tier;
  }

  const userRows = await orm
    .select({ plan: schema.users.plan, levelCreator: schema.users.levelCreator })
    .from(schema.users)
    .where(and(eq(schema.users.id, input.userId), isNull(schema.users.deletedAt)))
    .limit(1);
  const user = userRows[0];
  if (!user) throw notFound("User not found");

  const includedCount = businessAccountId
    ? await getIncludedBusinessBlogCount(businessTier!)
    : await getIncludedPersonalBlogCount(user.plan, user.levelCreator);

  const blogId = randomUUID();
  const slug = await generateUniqueSlug("blog", slugSourceWords(input.title), blogId);

  // Lock a stable row for the scope (the business account for a business
  // blog, the user for a personal blog) across the count-check + insert so
  // two concurrent creates for the same scope can't both slip in under the
  // quota — mirrors POST /api/business/pages's BIZ-PAGE-RACE guard.
  const outcome = await orm.transaction(async (tx) => {
    if (businessAccountId) {
      await tx.select({ id: schema.businessAccounts.id }).from(schema.businessAccounts).where(eq(schema.businessAccounts.id, businessAccountId)).for("update");
    } else {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId)).for("update");
    }

    const usedRows = businessAccountId
      ? await tx
          .select({ count: count() })
          .from(schema.blogs)
          .where(and(eq(schema.blogs.businessAccountId, businessAccountId), isNull(schema.blogs.deletedAt), ne(schema.blogs.status, "deactivated")))
      : await tx
          .select({ count: count() })
          .from(schema.blogs)
          .where(and(eq(schema.blogs.ownerId, input.userId), isNull(schema.blogs.businessAccountId), isNull(schema.blogs.deletedAt), ne(schema.blogs.status, "deactivated")));
    const used = usedRows[0]?.count ?? 0;

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

    await tx.insert(schema.blogs).values({
      id: blogId,
      ownerId: input.userId,
      slug,
      title: input.title.trim(),
      tagline: input.tagline?.trim() || null,
      description: input.description?.trim() || null,
      status: "active",
      businessAccountId,
      slotSource,
      slotUnlockCurrency: slotCurrency,
      slotUnlockCost: slotCost,
      slotUnlockReferenceId: referenceId,
    });

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
 *
 * Called from createBlog's Drizzle transaction above; `blogs.menu_config`
 * and `blog_posts.page_key` have no Drizzle column (schema gap — flagged
 * for the schema owner), so both are read/written via `sql` templates.
 */
async function createDefaultPagesAndMenu(tx: DbOrTx, blogId: string, authorId: string, blogTitle: string): Promise<void> {
  const menuItems: BlogMenuItem[] = [];
  for (const key of DEFAULT_PAGE_KEYS) {
    const postId = randomUUID();
    const bodyMarkdown = getDefaultPageContent(key, blogTitle);
    const bodyHtml = renderBodyHtml(bodyMarkdown, "markdown");
    await tx.execute(sql`
      INSERT INTO blog_posts (id, blog_id, author_id, type, page_key, title, slug, body_markdown, body_html, content_format, status, published_at, word_count)
      VALUES (${postId}, ${blogId}, ${authorId}, 'page', ${key}, ${DEFAULT_PAGE_TITLES[key]}, ${key}, ${bodyMarkdown}, ${bodyHtml}, 'markdown', 'published', NOW(), ${wordCount(bodyMarkdown)})
    `);
    menuItems.push({ id: `page-${key}`, label: DEFAULT_PAGE_TITLES[key], type: "page", targetId: key });
  }
  await tx
    .update(schema.blogs)
    .set({ postCount: sql`${schema.blogs.postCount} + ${DEFAULT_PAGE_KEYS.length}` })
    .where(eq(schema.blogs.id, blogId));

  const { rows } = await tx.execute<{ menu_config: BlogMenuConfig } & Record<string, unknown>>(sql`SELECT menu_config FROM blogs WHERE id = ${blogId} LIMIT 1`);
  const current = normalizeMenuConfig(rows[0]?.menu_config);
  const nextConfig: BlogMenuConfig = { ...current, items: [...current.items, ...menuItems] };
  await tx.execute(sql`UPDATE blogs SET menu_config = ${JSON.stringify(nextConfig)}::jsonb WHERE id = ${blogId}`);
}

/**
 * Regenerates one of the three default pages' content back to its
 * template, keeping the same post row (id/slug/page_key/status untouched)
 * — so any menu items or bookmarks pointing at it keep working. Owner or
 * moderator/admin only, mirroring updatePost's permission shape.
 */
export async function resetDefaultPage(blogId: string, callerId: string, callerIsModerator: boolean, pageKey: DefaultPageKey): Promise<void> {
  const orm = await getDb();
  const { rows } = await orm.execute<{ id: string; owner_id: string; title: string }>(sql`
    SELECT p.id, b.owner_id, b.title
    FROM blog_posts p JOIN blogs b ON b.id = p.blog_id
    WHERE p.blog_id = ${blogId} AND p.page_key = ${pageKey} AND p.deleted_at IS NULL LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw notFound("Default page not found");
  if (row.owner_id !== callerId && !callerIsModerator) throw forbidden("You can't manage this page.");

  const bodyMarkdown = getDefaultPageContent(pageKey, row.title);
  const bodyHtml = renderBodyHtml(bodyMarkdown, "markdown");
  await orm
    .update(schema.blogPosts)
    .set({
      title: DEFAULT_PAGE_TITLES[pageKey],
      bodyMarkdown,
      bodyHtml,
      contentFormat: "markdown",
      wordCount: wordCount(bodyMarkdown),
      updatedAt: sql`NOW()`,
    })
    .where(eq(schema.blogPosts.id, row.id));
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
  const orm = await getDb();
  const rows = await orm
    .select({ ownerId: schema.blogs.ownerId, title: schema.blogs.title, slug: schema.blogs.slug })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can update these settings.");

  const patch: Partial<typeof schema.blogs.$inferInsert> = {};
  let newSlug: string | null = null;
  if (input.title !== undefined) {
    const trimmedTitle = input.title.trim();
    patch.title = trimmedTitle;
    if (trimmedTitle && trimmedTitle !== blog.title) {
      // `db` (the legacy adapter) is passed through because generateUniqueSlug
      // (lib/slug.ts) is out of this migration's scope and still expects it.
      newSlug = await generateUniqueSlug("blog", slugSourceWords(trimmedTitle), blogId, db, blogId);
      if (newSlug !== blog.slug) patch.slug = newSlug;
      else newSlug = null;
    }
  }
  if (input.tagline !== undefined) patch.tagline = input.tagline?.trim() || null;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl || null;
  if (input.coverImageUrl !== undefined) patch.coverImageUrl = input.coverImageUrl || null;
  if (input.commentsEnabled !== undefined) patch.commentsEnabled = input.commentsEnabled;
  if (input.commentsModerationEnabled !== undefined) patch.commentsModerationEnabled = input.commentsModerationEnabled;
  if (input.hideAuthorInfo !== undefined) patch.hideAuthorInfo = input.hideAuthorInfo;
  if (input.showSubscriberCount !== undefined) patch.showSubscriberCount = input.showSubscriberCount;

  const hasMenuConfig = input.menuConfig !== undefined;
  if (Object.keys(patch).length === 0 && !hasMenuConfig) return;

  if (Object.keys(patch).length > 0) {
    await orm.update(schema.blogs).set({ ...patch, updatedAt: sql`NOW()` }).where(eq(schema.blogs.id, blogId));
  }
  // `blogs.menu_config` has no Drizzle column — kept as a `sql` template.
  if (hasMenuConfig) {
    await orm.execute(sql`UPDATE blogs SET menu_config = ${JSON.stringify(normalizeMenuConfig(input.menuConfig))}::jsonb, updated_at = NOW() WHERE id = ${blogId}`);
  }
  if (newSlug) await recordSlugRedirect("blog", blog.slug, blogId, newSlug).catch(() => {});
}

// ---------------------------------------------------------------------------
// Contact form (migration 0023) — open to every visitor, logged in or not,
// regardless of the blog's comment settings; see app/api/blogs/[slug]/contact.
// NOTE: `blog_contact_messages` has no Drizzle table definition — kept as
// `sql` templates.
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

  const orm = await getDb();
  const blogRows = await orm
    .select({ id: schema.blogs.id, ownerId: schema.blogs.ownerId, slug: schema.blogs.slug, title: schema.blogs.title })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, input.blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");

  const { rows } = await orm.execute<{ id: string }>(sql`
    INSERT INTO blog_contact_messages (blog_id, sender_user_id, sender_name, sender_email, message)
    VALUES (${blog.id}, ${input.senderUserId ?? null}, ${input.senderName?.trim() || null}, ${input.senderEmail?.trim() || null}, ${input.message.trim()})
    RETURNING id
  `);

  await insertNotificationBatch(
    orm,
    [blog.ownerId],
    "blog_contact_message",
    `New message on ${blog.title}`,
    input.message.trim().slice(0, 140),
    { blogId: blog.id, blogSlug: blog.slug, messageId: rows[0].id }
  ).catch((err) => {
    logger.error({ err, blogId: blog.id }, "[blogs/service] failed to notify blog owner of a contact message");
  });

  return { id: rows[0].id };
}

export type BlogContactMessageRow = {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
};

export async function listContactMessages(blogId: string, callerId: string): Promise<BlogContactMessageRow[]> {
  const orm = await getDb();
  const blogRows = await orm
    .select({ ownerId: schema.blogs.ownerId })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can view contact messages.");

  const { rows } = await orm.execute<BlogContactMessageRow>(sql`
    SELECT m.id, m.sender_name, m.sender_email, u.username AS sender_username, m.message, m.is_read, m.created_at
    FROM blog_contact_messages m LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.blog_id = ${blogId} ORDER BY m.created_at DESC LIMIT 200
  `);
  return rows;
}

export async function markContactMessageRead(blogId: string, callerId: string, messageId: string): Promise<void> {
  const orm = await getDb();
  const blogRows = await orm
    .select({ ownerId: schema.blogs.ownerId })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = blogRows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can manage contact messages.");
  await orm.execute(sql`UPDATE blog_contact_messages SET is_read = TRUE WHERE id = ${messageId} AND blog_id = ${blogId}`);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(blogId: string, callerId: string, name: string): Promise<{ id: string; slug: string }> {
  const blog = await assertBlogWritable(blogId);
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can manage categories.");

  const orm = await getDb();
  const categoryId = randomUUID();
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "category";
  let slug = base;
  for (let i = 2; i <= 50; i++) {
    const rows = await orm
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.blogId, blogId), eq(schema.blogCategories.slug, slug)))
      .limit(1);
    if (!rows[0]) break;
    slug = `${base}-${i}`;
  }

  await orm.insert(schema.blogCategories).values({ id: categoryId, blogId, name: name.trim(), slug });
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

  const orm = await getDb();
  const ownerRows = await orm.select({ ownerId: schema.blogs.ownerId }).from(schema.blogs).where(eq(schema.blogs.id, input.blogId));
  if (ownerRows[0]?.ownerId !== input.authorId) throw forbidden("Only the blog owner can publish posts on this blog.");

  const [maxPosts, maxWords] = await Promise.all([
    getMaxBlogPosts(input.authorPlan),
    getMaxWordsForPlan(input.authorPlan),
  ]);

  const countRows = await orm
    .select({ count: count() })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.blogId, input.blogId), isNull(schema.blogPosts.deletedAt)));
  if ((countRows[0]?.count ?? 0) >= maxPosts) {
    throw forbidden(`Your plan allows a maximum of ${maxPosts} articles and pages. Upgrade your plan to publish more.`, "BLOG_POST_LIMIT_REACHED", { maxPosts });
  }

  const words = wordCount(input.bodyMarkdown);
  if (input.type === "article" && words > maxWords) {
    throw new ApiError(400, "BLOG_WORD_LIMIT_EXCEEDED", `Your plan allows articles up to ${maxWords} words. This article is ${words} words.`, undefined, undefined, { maxWords, words });
  }

  if (input.categoryId) {
    const catRows = await orm
      .select({ id: schema.blogCategories.id })
      .from(schema.blogCategories)
      .where(and(eq(schema.blogCategories.id, input.categoryId), eq(schema.blogCategories.blogId, input.blogId)))
      .limit(1);
    if (!catRows[0]) throw badRequest("Unknown category.", "BLOG_UNKNOWN_CATEGORY");
  }

  const postId = randomUUID();
  const slug = await generateUniqueBlogPostSlug(input.blogId, input.title, postId);
  const contentFormat: BlogPostContentFormat = input.contentFormat === "plaintext" ? "plaintext" : "markdown";
  const bodyHtml = renderBodyHtml(input.bodyMarkdown, contentFormat);
  const isPaywalled = input.type === "article" && !!input.isPaywalled;
  const paywallCost = isPaywalled ? Math.max(0, Math.floor(input.paywallCreditsCost ?? 0)) : 0;
  const publishedAt = input.status === "published" ? new Date() : null;

  await orm.transaction(async (tx) => {
    await tx.insert(schema.blogPosts).values({
      id: postId,
      blogId: input.blogId,
      authorId: input.authorId,
      categoryId: input.categoryId ?? null,
      type: input.type,
      title: input.title.trim(),
      slug,
      excerpt: input.excerpt?.trim() || null,
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml,
      contentFormat,
      featuredImageUrl: input.featuredImageUrl || null,
      status: input.status,
      isPaywalled,
      paywallCreditsCost: paywallCost,
      wordCount: words,
      publishedAt,
    });
    await tx
      .update(schema.blogs)
      .set({ postCount: sql`${schema.blogs.postCount} + 1`, updatedAt: sql`NOW()` })
      .where(eq(schema.blogs.id, input.blogId));
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
  const orm = await getDb();
  const rows = await orm
    .select({
      blogId: schema.blogPosts.blogId,
      authorId: schema.blogPosts.authorId,
      type: schema.blogPosts.type,
      status: schema.blogPosts.status,
      slug: schema.blogPosts.slug,
      contentFormat: schema.blogPosts.contentFormat,
    })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt)))
    .limit(1);
  const post = rows[0];
  if (!post) throw notFound("Post not found");
  if (post.authorId !== callerId) throw forbidden("You can't edit this post.");

  const patch: Partial<typeof schema.blogPosts.$inferInsert> = {};

  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.excerpt !== undefined) patch.excerpt = input.excerpt?.trim() || null;
  if (input.featuredImageUrl !== undefined) patch.featuredImageUrl = input.featuredImageUrl || null;
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId || null;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (input.contentFormat !== undefined) patch.contentFormat = input.contentFormat;

  if (input.bodyMarkdown !== undefined) {
    const maxWords = await getMaxWordsForPlan(callerPlan);
    const words = wordCount(input.bodyMarkdown);
    if (post.type === "article" && words > maxWords) {
      throw new ApiError(400, "BLOG_WORD_LIMIT_EXCEEDED", `Your plan allows articles up to ${maxWords} words. This article is ${words} words.`, undefined, undefined, { maxWords, words });
    }
    const contentFormat: BlogPostContentFormat = (input.contentFormat ?? (post.contentFormat as BlogPostContentFormat)) === "plaintext" ? "plaintext" : "markdown";
    patch.bodyMarkdown = input.bodyMarkdown;
    patch.bodyHtml = renderBodyHtml(input.bodyMarkdown, contentFormat);
    patch.wordCount = words;
  }

  if (input.isPaywalled !== undefined) patch.isPaywalled = post.type === "article" && input.isPaywalled;
  if (input.paywallCreditsCost !== undefined) patch.paywallCreditsCost = Math.max(0, Math.floor(input.paywallCreditsCost));

  const wasPublished = post.status === "published";
  if (input.status !== undefined && input.status !== post.status) {
    patch.status = input.status;
    if (input.status === "published" && !wasPublished) patch.publishedAt = new Date();
  }

  if (Object.keys(patch).length === 0) return;
  await orm.update(schema.blogPosts).set({ ...patch, updatedAt: sql`NOW()` }).where(eq(schema.blogPosts.id, postId));

  if (input.status === "published" && !wasPublished && post.type === "article") {
    safeAwardXPFireAndForget(callerId, 10, "creator", "blog_post_published", `blog_post_reward:${postId}`);
    await notifySubscribers(post.blogId, postId, input.title ?? post.slug, post.slug).catch(() => {});
  }
}

export async function deletePost(postId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ authorId: schema.blogPosts.authorId, blogId: schema.blogPosts.blogId })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt)))
    .limit(1);
  const post = rows[0];
  if (!post) throw notFound("Post not found");
  if (post.authorId !== callerId && !callerIsModerator) throw forbidden("You can't delete this post.");

  await orm.transaction(async (tx) => {
    await tx.update(schema.blogPosts).set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` }).where(eq(schema.blogPosts.id, postId));
    await tx
      .update(schema.blogs)
      .set({ postCount: sql`GREATEST(${schema.blogs.postCount} - 1, 0)`, updatedAt: sql`NOW()` })
      .where(eq(schema.blogs.id, post.blogId));
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
  const orm = await getDb();
  const rows = await orm
    .select({ ownerId: schema.blogs.ownerId })
    .from(schema.blogs)
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .limit(1);
  const blog = rows[0];
  if (!blog) throw notFound("Blog not found");
  if (blog.ownerId !== callerId) throw forbidden("Only the blog owner can manage these posts.");

  if (action === "delete") {
    const result = await orm.transaction(async (tx) => {
      const updated = await tx
        .update(schema.blogPosts)
        .set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
        .where(and(eq(schema.blogPosts.blogId, blogId), inArray(schema.blogPosts.id, postIds), isNull(schema.blogPosts.deletedAt)))
        .returning({ id: schema.blogPosts.id });
      const affected = updated.length;
      if (affected > 0) {
        await tx
          .update(schema.blogs)
          .set({ postCount: sql`GREATEST(${schema.blogs.postCount} - ${affected}, 0)`, updatedAt: sql`NOW()` })
          .where(eq(schema.blogs.id, blogId));
      }
      return affected;
    });
    return { affected: result };
  }

  const updated = await orm
    .update(schema.blogPosts)
    .set({ status: "draft", updatedAt: sql`NOW()` })
    .where(and(eq(schema.blogPosts.blogId, blogId), inArray(schema.blogPosts.id, postIds), isNull(schema.blogPosts.deletedAt), ne(schema.blogPosts.status, "draft")))
    .returning({ id: schema.blogPosts.id });
  return { affected: updated.length };
}

// ---------------------------------------------------------------------------
// Subscriber notification
// ---------------------------------------------------------------------------

async function notifySubscribers(blogId: string, postId: string, postTitle: string, postSlug: string): Promise<void> {
  const orm = await getDb();
  const blogRows = await orm.select({ slug: schema.blogs.slug, title: schema.blogs.title }).from(schema.blogs).where(eq(schema.blogs.id, blogId)).limit(1);
  const blog = blogRows[0];
  if (!blog) return;

  const subRows = await orm.select({ userId: schema.blogSubscriptions.userId }).from(schema.blogSubscriptions).where(eq(schema.blogSubscriptions.blogId, blogId));
  if (subRows.length === 0) return;

  await insertNotificationBatch(
    orm,
    subRows.map((r) => r.userId),
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

  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    const postRows = await tx
      .select({ id: schema.blogPosts.id, authorId: schema.blogPosts.authorId, blogId: schema.blogPosts.blogId })
      .from(schema.blogPosts)
      .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt), eq(schema.blogPosts.status, "published")))
      .for("update");
    const post = postRows[0];
    if (!post) throw notFound("Post not found");

    let becameLiked = false;
    if (next) {
      const inserted = await tx
        .insert(schema.blogPostLikes)
        .values({ postId, userId })
        .onConflictDoNothing({ target: [schema.blogPostLikes.postId, schema.blogPostLikes.userId] })
        .returning({ postId: schema.blogPostLikes.postId });
      if (inserted.length > 0) {
        await tx.update(schema.blogPosts).set({ likeCount: sql`${schema.blogPosts.likeCount} + 1` }).where(eq(schema.blogPosts.id, postId));
        becameLiked = true;
      }
    } else {
      const deleted = await tx
        .delete(schema.blogPostLikes)
        .where(and(eq(schema.blogPostLikes.postId, postId), eq(schema.blogPostLikes.userId, userId)))
        .returning({ postId: schema.blogPostLikes.postId });
      if (deleted.length > 0) {
        await tx.update(schema.blogPosts).set({ likeCount: sql`GREATEST(${schema.blogPosts.likeCount} - 1, 0)` }).where(eq(schema.blogPosts.id, postId));
      }
    }

    if (becameLiked) {
      await tx
        .insert(schema.blogPostDailyStats)
        .values({ postId, date: sql`CURRENT_DATE`, likes: 1 })
        .onConflictDoUpdate({
          target: [schema.blogPostDailyStats.postId, schema.blogPostDailyStats.date],
          set: { likes: sql`${schema.blogPostDailyStats.likes} + 1` },
        });
    }

    const rows = await tx.select({ likeCount: schema.blogPosts.likeCount }).from(schema.blogPosts).where(eq(schema.blogPosts.id, postId));
    return { likeCount: rows[0].likeCount, authorId: post.authorId, becameLiked };
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

  const orm = await getDb();
  const postRows = await orm
    .select({ id: schema.blogPosts.id, blogId: schema.blogPosts.blogId })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, input.postId), isNull(schema.blogPosts.deletedAt), eq(schema.blogPosts.status, "published")))
    .limit(1);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");

  const blogRows = await orm
    .select({ commentsEnabled: schema.blogs.commentsEnabled, commentsModerationEnabled: schema.blogs.commentsModerationEnabled })
    .from(schema.blogs)
    .where(eq(schema.blogs.id, post.blogId))
    .limit(1);
  const blog = blogRows[0];
  if (!blog?.commentsEnabled) throw forbidden("Comments are disabled on this blog.", "BLOG_COMMENTS_DISABLED");

  if (input.parentCommentId) {
    const parentRows = await orm
      .select({ id: schema.blogPostComments.id })
      .from(schema.blogPostComments)
      .where(and(eq(schema.blogPostComments.id, input.parentCommentId), eq(schema.blogPostComments.postId, input.postId), isNull(schema.blogPostComments.deletedAt)))
      .limit(1);
    if (!parentRows[0]) throw notFound("Parent comment not found");
  }

  const status = blog.commentsModerationEnabled ? "pending" : "visible";
  const commentId = await orm.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.blogPostComments)
      .values({ postId: input.postId, authorId: input.authorId, parentCommentId: input.parentCommentId ?? null, body: input.body.trim(), status })
      .returning({ id: schema.blogPostComments.id });
    if (status === "visible") {
      await tx.update(schema.blogPosts).set({ commentCount: sql`${schema.blogPosts.commentCount} + 1` }).where(eq(schema.blogPosts.id, input.postId));
      await tx
        .insert(schema.blogPostDailyStats)
        .values({ postId: input.postId, date: sql`CURRENT_DATE`, comments: 1 })
        .onConflictDoUpdate({
          target: [schema.blogPostDailyStats.postId, schema.blogPostDailyStats.date],
          set: { comments: sql`${schema.blogPostDailyStats.comments} + 1` },
        });
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
  const orm = await getDb();
  const rows = await orm
    .select({ postId: schema.blogPostComments.postId, blogOwnerId: schema.blogs.ownerId })
    .from(schema.blogPostComments)
    .innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostComments.postId))
    .innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
    .where(and(eq(schema.blogPostComments.id, commentId), isNull(schema.blogPostComments.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound("Comment not found");
  if (row.blogOwnerId !== callerId && !callerIsModerator) throw forbidden("You can't moderate this comment.");

  if (action === "approve") {
    const updated = await orm
      .update(schema.blogPostComments)
      .set({ status: "visible", updatedAt: sql`NOW()` })
      .where(and(eq(schema.blogPostComments.id, commentId), eq(schema.blogPostComments.status, "pending")))
      .returning({ id: schema.blogPostComments.id });
    if (updated.length > 0) {
      await orm.update(schema.blogPosts).set({ commentCount: sql`${schema.blogPosts.commentCount} + 1` }).where(eq(schema.blogPosts.id, row.postId));
    }
  } else {
    const beforeRows = await orm.select({ status: schema.blogPostComments.status }).from(schema.blogPostComments).where(eq(schema.blogPostComments.id, commentId));
    const wasVisible = beforeRows[0]?.status === "visible";
    await orm
      .update(schema.blogPostComments)
      .set({ status: "removed", deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(eq(schema.blogPostComments.id, commentId));
    if (wasVisible) {
      await orm.update(schema.blogPosts).set({ commentCount: sql`GREATEST(${schema.blogPosts.commentCount} - 1, 0)` }).where(eq(schema.blogPosts.id, row.postId));
    }
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
  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const blogRows = await tx
      .select({ id: schema.blogs.id })
      .from(schema.blogs)
      .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
      .for("update");
    if (!blogRows[0]) throw notFound("Blog not found");

    if (next) {
      const inserted = await tx
        .insert(schema.blogSubscriptions)
        .values({ blogId, userId })
        .onConflictDoNothing({ target: [schema.blogSubscriptions.blogId, schema.blogSubscriptions.userId] })
        .returning({ blogId: schema.blogSubscriptions.blogId });
      if (inserted.length > 0) {
        await tx.update(schema.blogs).set({ subscriberCount: sql`${schema.blogs.subscriberCount} + 1` }).where(eq(schema.blogs.id, blogId));
      }
    } else {
      const deleted = await tx
        .delete(schema.blogSubscriptions)
        .where(and(eq(schema.blogSubscriptions.blogId, blogId), eq(schema.blogSubscriptions.userId, userId)))
        .returning({ blogId: schema.blogSubscriptions.blogId });
      if (deleted.length > 0) {
        await tx.update(schema.blogs).set({ subscriberCount: sql`GREATEST(${schema.blogs.subscriberCount} - 1, 0)` }).where(eq(schema.blogs.id, blogId));
      }
    }

    const rows = await tx.select({ subscriberCount: schema.blogs.subscriberCount }).from(schema.blogs).where(eq(schema.blogs.id, blogId));
    return { subscriberCount: rows[0].subscriberCount };
  });
}

// ---------------------------------------------------------------------------
// Views (called at most once per viewer per session — client dedupes via localStorage)
// ---------------------------------------------------------------------------

export async function recordView(postId: string): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx
      .update(schema.blogPosts)
      .set({ viewCount: sql`${schema.blogPosts.viewCount} + 1` })
      .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt)));
    await tx
      .insert(schema.blogPostDailyStats)
      .values({ postId, date: sql`CURRENT_DATE`, views: 1 })
      .onConflictDoUpdate({
        target: [schema.blogPostDailyStats.postId, schema.blogPostDailyStats.date],
        set: { views: sql`${schema.blogPostDailyStats.views} + 1` },
      });
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

  const orm = await getDb();
  const postRows = await orm
    .select({
      id: schema.blogPosts.id,
      blogId: schema.blogPosts.blogId,
      authorId: schema.blogPosts.authorId,
      isPaywalled: schema.blogPosts.isPaywalled,
      paywallCreditsCost: schema.blogPosts.paywallCreditsCost,
    })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt), eq(schema.blogPosts.status, "published")))
    .limit(1);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (!post.isPaywalled || post.paywallCreditsCost <= 0) return { alreadyUnlocked: true, creditsSpent: 0 };
  if (post.authorId === userId) return { alreadyUnlocked: true, creditsSpent: 0 };

  const existingRows = await orm
    .select({ id: schema.blogPostUnlocks.id })
    .from(schema.blogPostUnlocks)
    .where(and(eq(schema.blogPostUnlocks.postId, postId), eq(schema.blogPostUnlocks.userId, userId)))
    .limit(1);
  if (existingRows[0]) return { alreadyUnlocked: true, creditsSpent: 0 };

  const cost = post.paywallCreditsCost;
  const referenceId = `blog_paywall_unlock:${postId}:${userId}`;

  await orm.transaction(async (tx) => {
    await debitCoins(userId, cost, "blog_paywall_unlock", referenceId, "Unlocked a paywalled blog article", { postId, blogId: post.blogId }, tx);
    await tx
      .insert(schema.blogPostUnlocks)
      .values({ postId, userId, creditsSpent: cost })
      .onConflictDoNothing({ target: [schema.blogPostUnlocks.postId, schema.blogPostUnlocks.userId] });
    await tx
      .insert(schema.blogPostDailyStats)
      .values({ postId, date: sql`CURRENT_DATE`, unlockCount: 1, unlockCredits: cost })
      .onConflictDoUpdate({
        target: [schema.blogPostDailyStats.postId, schema.blogPostDailyStats.date],
        set: { unlockCount: sql`${schema.blogPostDailyStats.unlockCount} + 1`, unlockCredits: sql`${schema.blogPostDailyStats.unlockCredits} + ${cost}` },
      });
  });

  await creditPaywallEarnings(post.authorId, postId, cost, referenceId).catch((err) => {
    logger.error({ err, postId, authorId: post.authorId }, "[blogs/service] failed to credit paywall earnings");
  });

  safeAwardXPFireAndForget(post.authorId, 5, "creator", "blog_paywall_unlocked", `blog_paywall_xp:${postId}:${userId}`);

  return { alreadyUnlocked: false, creditsSpent: cost };
}

/** Credits the creator's cash-equivalent earnings for a paywall unlock, using their plan's revenue-share rate. */
async function creditPaywallEarnings(creatorId: string, postId: string, creditsSpent: number, referenceId: string): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
    .limit(1);
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

  await orm.transaction(async (tx) => {
    await tx
      .insert(schema.creatorEarnings)
      .values({
        creatorId,
        sourceType: "blog_paywall",
        grossAmountKobo: BigInt(grossKobo.toFixed(0)),
        platformFeeKobo: BigInt(platformFeeKobo.toFixed(0)),
        netAmountKobo: BigInt(netKobo.toFixed(0)),
        referenceId,
      })
      .onConflictDoNothing({ target: [schema.creatorEarnings.creatorId, schema.creatorEarnings.referenceId] });
    await tx
      .update(schema.users)
      .set({ availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${netKobo.toFixed(0)}`, updatedAt: sql`NOW()` })
      .where(eq(schema.users.id, creatorId));
  });
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

export type BlogAdminAction = "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete" | "transfer_ownership";

export async function logBlogModeration(moderatorId: string, blogId: string | null, postId: string | null, targetUserId: string | null, action: string, reason?: string | null, metadata?: Record<string, unknown>): Promise<void> {
  const orm = await getDb();
  await orm.insert(schema.blogModerationLog).values({
    moderatorId,
    blogId,
    postId,
    targetUserId,
    action,
    reason: reason ?? null,
    metadata: metadata ?? {},
  });
}

const STATUS_FOR_ACTION: Partial<Record<BlogAdminAction, string>> = {
  suspend: "suspended",
  ban: "banned",
  deactivate: "deactivated",
  pause: "paused",
  restore: "active",
};

export async function setBlogStatus(blogId: string, moderatorId: string, action: BlogAdminAction, reason?: string | null): Promise<void> {
  const orm = await getDb();
  if (action === "delete") {
    const rows = await orm
      .select({ ownerId: schema.blogs.ownerId })
      .from(schema.blogs)
      .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
      .limit(1);
    if (!rows[0]) throw notFound("Blog not found");
    await orm.update(schema.blogs).set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` }).where(eq(schema.blogs.id, blogId));
    await logBlogModeration(moderatorId, blogId, null, rows[0].ownerId, "delete", reason);
    return;
  }

  const status = STATUS_FOR_ACTION[action];
  if (!status) throw new ApiError(400, "BLOG_INVALID_ACTION", `Unsupported action: ${action}`);

  const rows = await orm
    .update(schema.blogs)
    .set({ status, statusReason: reason ?? null, updatedAt: sql`NOW()` })
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .returning({ ownerId: schema.blogs.ownerId });
  if (!rows[0]) throw notFound("Blog not found");
  await logBlogModeration(moderatorId, blogId, null, rows[0].ownerId, action, reason);
}

export async function transferBlogOwnership(blogId: string, moderatorId: string, newOwnerId: string): Promise<void> {
  const orm = await getDb();
  const userRows = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, newOwnerId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!userRows[0]) throw notFound("Target user not found");

  // Blogs are no longer 1:1 with an owner (migration 0018) — a target user
  // already having other blogs is no longer a conflict, so there's nothing
  // to check here beyond the target existing.
  const rows = await orm
    .update(schema.blogs)
    .set({ ownerId: newOwnerId, updatedAt: sql`NOW()` })
    .where(and(eq(schema.blogs.id, blogId), isNull(schema.blogs.deletedAt)))
    .returning({ ownerId: schema.blogs.ownerId });
  if (!rows[0]) throw notFound("Blog not found");

  await orm
    .update(schema.blogPosts)
    .set({ authorId: newOwnerId })
    .where(and(eq(schema.blogPosts.blogId, blogId), ne(schema.blogPosts.authorId, newOwnerId)));
  await logBlogModeration(moderatorId, blogId, null, newOwnerId, "transfer_ownership", null, { previousOwnerId: rows[0].ownerId });
}

// ---------------------------------------------------------------------------
// Per-post credit treasury/pot — the first `maxClaimants` people to comment
// on or share a post split `fundedAmount` Credits evenly (Credits only per
// product spec). See db/migrations/0001_consolidated_schema.sql.
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

function toTreasuryStateFromDrizzle(row: { id: string; fundedAmount: number; remainingAmount: number; maxClaimants: number; claimantCount: number; status: string }): TreasuryState {
  return toTreasuryState({
    id: row.id,
    funded_amount: row.fundedAmount,
    remaining_amount: row.remainingAmount,
    max_claimants: row.maxClaimants,
    claimant_count: row.claimantCount,
    status: row.status,
  });
}

export async function getPostTreasury(postId: string): Promise<TreasuryState | null> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: blogPostTreasuries.id,
      fundedAmount: blogPostTreasuries.fundedAmount,
      remainingAmount: blogPostTreasuries.remainingAmount,
      maxClaimants: blogPostTreasuries.maxClaimants,
      claimantCount: blogPostTreasuries.claimantCount,
      status: blogPostTreasuries.status,
    })
    .from(blogPostTreasuries)
    .where(eq(blogPostTreasuries.postId, postId))
    .limit(1);
  return rows[0] ? toTreasuryStateFromDrizzle(rows[0]) : null;
}

/**
 * Create a post's reward pot. Only the post's author may fund it, and only
 * when no pot already exists for it (or an earlier one was turned off —
 * see closePostTreasury). Once a pot exists, further changes go through
 * editPostTreasury (adjust amount/recipients) or closePostTreasury (turn it
 * off, refunding unclaimed funds) — a plain re-fund used to additively bump
 * funded_amount while overwriting max_claimants outright, which desynced
 * the per-claimant reward from what earlier claimants had already been
 * paid (see lib/contentTreasury.ts's fundContentTreasury, which this
 * mirrors — Polls/Quizzes/Wiki use that shared module; blog posts predate
 * it and keep their own copy of the same tables/logic).
 */
export async function fundPostTreasury(ownerId: string, postId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("blogs");
  await requireFeatureEnabled("blogMonetization");
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer.", "BLOG_TREASURY_INVALID_AMOUNT");
  if (!Number.isInteger(maxClaimants) || maxClaimants <= 0) throw badRequest("Max claimants must be a positive integer.", "BLOG_TREASURY_INVALID_MAX_CLAIMANTS");

  const orm = await getDb();
  const postRows = await orm.select({ authorId: schema.blogPosts.authorId }).from(schema.blogPosts).where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt))).limit(1);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (post.authorId !== ownerId) throw forbidden("Only the post's author can fund its reward pot.");

  const referenceId = `blog_treasury_fund:${postId}:${Date.now()}`;
  const result = await orm.transaction(async (tx) => {
    const { rows: existingRows } = await tx.execute<{ status: string } & Record<string, unknown>>(
      sql`SELECT status FROM blog_post_treasuries WHERE post_id = ${postId} FOR UPDATE`
    );
    if (existingRows[0] && existingRows[0].status !== "closed") {
      throw badRequest(
        "A reward pot already exists for this post. Edit it or turn it off instead of funding it again.",
        "BLOG_TREASURY_ALREADY_EXISTS"
      );
    }

    await checkAndDebit(ownerId, amount, "blog_treasury_fund", referenceId, "Funded a blog post reward pot", { postId }, tx);
    const { rows } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string } & Record<string, unknown>
    >(sql`
      INSERT INTO blog_post_treasuries (post_id, owner_id, funded_amount, remaining_amount, max_claimants)
      VALUES (${postId}, ${ownerId}, ${amount}, ${amount}, ${maxClaimants})
      ON CONFLICT (post_id) DO UPDATE SET
        owner_id = ${ownerId},
        funded_amount = ${amount},
        remaining_amount = ${amount},
        max_claimants = ${maxClaimants},
        claimant_count = 0,
        status = 'active',
        updated_at = NOW()
      RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status
    `);
    return rows[0];
  });

  return toTreasuryState(result);
}

/**
 * Edit an existing, still-open post reward pot's total amount and/or max
 * claimants. Debits the owner for any increase, refunds any decrease
 * (never below what's already been paid out to claimants), and recomputes
 * remaining_amount/status from the new totals — see editContentTreasury.
 */
export async function editPostTreasury(ownerId: string, postId: string, newAmount: number, newMaxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("blogs");
  await requireFeatureEnabled("blogMonetization");
  if (!Number.isInteger(newAmount) || newAmount <= 0) throw badRequest("Amount must be a positive integer.", "BLOG_TREASURY_INVALID_AMOUNT");
  if (!Number.isInteger(newMaxClaimants) || newMaxClaimants <= 0) {
    throw badRequest("Max claimants must be a positive integer.", "BLOG_TREASURY_INVALID_MAX_CLAIMANTS");
  }

  const orm = await getDb();
  const postRows = await orm.select({ authorId: schema.blogPosts.authorId }).from(schema.blogPosts).where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt))).limit(1);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (post.authorId !== ownerId) throw forbidden("Only the post's author can edit its reward pot.");

  return orm.transaction(async (tx) => {
    const { rows } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string } & Record<string, unknown>
    >(sql`
      SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status
      FROM blog_post_treasuries WHERE post_id = ${postId} FOR UPDATE
    `);
    const treasury = rows[0];
    if (!treasury) throw notFound("Reward pot not found.");
    if (treasury.status === "closed") throw badRequest("This reward pot is closed. Fund a new one instead.", "BLOG_TREASURY_CLOSED");

    if (newMaxClaimants < treasury.claimant_count) {
      throw badRequest(
        `Max claimants can't be less than the ${treasury.claimant_count} people who already claimed.`,
        "BLOG_TREASURY_INVALID_MAX_CLAIMANTS"
      );
    }

    const alreadyPaid = treasury.funded_amount - treasury.remaining_amount;
    if (newAmount < alreadyPaid) {
      throw badRequest(`Amount can't be less than the ${alreadyPaid} already paid out to claimants.`, "BLOG_TREASURY_INVALID_AMOUNT");
    }

    const delta = newAmount - treasury.funded_amount;
    if (delta > 0) {
      await checkAndDebit(ownerId, delta, "blog_treasury_fund", `blog_treasury_edit_debit:${treasury.id}:${Date.now()}`, "Increased a blog post reward pot", { postId }, tx);
    } else if (delta < 0) {
      await creditCoins(ownerId, -delta, "blog_treasury_refund", `blog_treasury_edit_refund:${treasury.id}:${Date.now()}`, "Reduced a blog post reward pot", { postId }, tx);
    }

    const newRemaining = newAmount - alreadyPaid;
    const rewardPerClaimant = Math.floor(newAmount / newMaxClaimants);
    const newStatus =
      treasury.claimant_count >= newMaxClaimants || rewardPerClaimant <= 0 || newRemaining < rewardPerClaimant
        ? "exhausted"
        : "active";

    const { rows: updated } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string } & Record<string, unknown>
    >(sql`
      UPDATE blog_post_treasuries SET funded_amount = ${newAmount}, remaining_amount = ${newRemaining}, max_claimants = ${newMaxClaimants}, status = ${newStatus}, updated_at = NOW()
      WHERE id = ${treasury.id}
      RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status
    `);
    return toTreasuryState(updated[0]);
  });
}

/**
 * Turn off a post's reward pot: refunds whatever's left unclaimed to the
 * author's Credits balance and marks it closed. See closeContentTreasury.
 */
export async function closePostTreasury(ownerId: string, postId: string): Promise<TreasuryState> {
  await requireFeatureEnabled("blogs");
  const orm = await getDb();
  const postRows = await orm.select({ authorId: schema.blogPosts.authorId }).from(schema.blogPosts).where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt))).limit(1);
  const post = postRows[0];
  if (!post) throw notFound("Post not found");
  if (post.authorId !== ownerId) throw forbidden("Only the post's author can turn off its reward pot.");

  return orm.transaction(async (tx) => {
    const { rows } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string } & Record<string, unknown>
    >(sql`
      SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status
      FROM blog_post_treasuries WHERE post_id = ${postId} FOR UPDATE
    `);
    const treasury = rows[0];
    if (!treasury) throw notFound("Reward pot not found.");
    if (treasury.status === "closed") throw badRequest("This reward pot is already off.", "BLOG_TREASURY_ALREADY_CLOSED");

    if (treasury.remaining_amount > 0) {
      await creditCoins(ownerId, treasury.remaining_amount, "blog_treasury_refund", `blog_treasury_close_refund:${treasury.id}`, "Reward pot turned off — unclaimed funds refunded", { postId }, tx);
    }

    const { rows: updated } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string } & Record<string, unknown>
    >(sql`
      UPDATE blog_post_treasuries SET remaining_amount = 0, status = 'closed', updated_at = NOW() WHERE id = ${treasury.id}
      RETURNING id, funded_amount, remaining_amount, max_claimants, claimant_count, status
    `);
    return toTreasuryState(updated[0]);
  });
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

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const { rows: treasuryRows } = await tx.execute<
      { id: string; funded_amount: number; remaining_amount: number; max_claimants: number; claimant_count: number; status: string; owner_id: string } & Record<string, unknown>
    >(sql`SELECT id, funded_amount, remaining_amount, max_claimants, claimant_count, status, owner_id FROM blog_post_treasuries WHERE post_id = ${postId} FOR UPDATE`);
    const treasury = treasuryRows[0];
    if (!treasury || treasury.status !== "active") return null;
    if (treasury.claimant_count >= treasury.max_claimants) return null;
    if (treasury.owner_id === userId) return null; // the author can't claim their own pot

    const rewardPerClaimant = Math.floor(treasury.funded_amount / treasury.max_claimants);
    if (rewardPerClaimant <= 0 || treasury.remaining_amount < rewardPerClaimant) return null;

    const { rowCount } = await tx.execute(
      sql`INSERT INTO blog_post_treasury_claims (treasury_id, user_id, claim_type, amount) VALUES (${treasury.id}, ${userId}, ${claimType}, ${rewardPerClaimant}) ON CONFLICT (treasury_id, user_id) DO NOTHING`
    );
    if (!rowCount || rowCount === 0) return null; // already claimed

    const newClaimantCount = treasury.claimant_count + 1;
    const newRemaining = treasury.remaining_amount - rewardPerClaimant;
    const newStatus = newClaimantCount >= treasury.max_claimants || newRemaining < rewardPerClaimant ? "exhausted" : "active";
    await tx.execute(
      sql`UPDATE blog_post_treasuries SET claimant_count = ${newClaimantCount}, remaining_amount = ${newRemaining}, status = ${newStatus}, updated_at = NOW() WHERE id = ${treasury.id}`
    );

    await creditCoins(userId, rewardPerClaimant, "blog_treasury_claim", `blog_treasury_claim:${treasury.id}:${userId}`, "Reward pot claim", { postId, claimType }, tx);

    return { amount: rewardPerClaimant };
  });
}

/** Records a share event (idempotent per user/post) and attempts a treasury claim. */
export async function recordShare(postId: string, userId: string): Promise<{ shareCount: number; rewardClaimed: number | null }> {
  await requireFeatureEnabled("blogs");
  const orm = await getDb();
  const postRows = await orm
    .select({ id: schema.blogPosts.id })
    .from(schema.blogPosts)
    .where(and(eq(schema.blogPosts.id, postId), isNull(schema.blogPosts.deletedAt), eq(schema.blogPosts.status, "published")))
    .limit(1);
  if (!postRows[0]) throw notFound("Post not found");

  const inserted = await orm
    .insert(blogPostShares)
    .values({ postId, userId })
    .onConflictDoNothing({ target: [blogPostShares.postId, blogPostShares.userId] })
    .returning({ postId: blogPostShares.postId });
  if (inserted.length > 0) {
    await orm.update(schema.blogPosts).set({ shareCount: sql`${schema.blogPosts.shareCount} + 1` }).where(eq(schema.blogPosts.id, postId));
  }

  const claim = await claimTreasuryReward(postId, userId, "share").catch((err) => {
    logger.error({ err, postId, userId }, "[blogs/service] failed to claim treasury reward for share");
    return null;
  });

  const countRows = await orm.select({ shareCount: schema.blogPosts.shareCount }).from(schema.blogPosts).where(eq(schema.blogPosts.id, postId));
  return { shareCount: countRows[0]?.shareCount ?? 0, rewardClaimed: claim?.amount ?? null };
}

// ---------------------------------------------------------------------------
// Rewarded Gifts (migration 0024) — a blog owner defines purchasable "gift
// tiers"; a reader spends Credits or Stars to buy one and unlocks a benefit
// for themselves. Gated by feature_blogs + feature_blog_gifts +
// blog_monetization_enabled (all three, mirroring the paywall/treasury
// kill-switch wiring above). Blog-level reward pots for custom_reward tiers
// reuse blog_post_treasuries with post_id NULL / gift_tier_id set — see
// db/migrations/0001_consolidated_schema.sql.
//
// Revenue share: gift purchases follow the exact same creator revenue-share
// convention as paywall unlocks (getBlogRevSharePct + provider fee/VAT for
// Credits, via creditPaywallEarnings's sibling below) rather than inventing
// a separate economic model. Stars purchases have no cash-equivalent
// conversion elsewhere in the codebase, so the owner is credited Stars
// directly, net of the same revenue-share percentage (no fee/VAT — those
// only apply to the cash-equivalent kobo ledger).
//
// `blog_gift_tiers`, `blog_gift_purchases` and `blog_gift_claims` have no
// Drizzle table definitions, and `blog_post_treasuries` is used here with
// `blog_id`/`gift_tier_id` columns and a nullable `post_id` that the
// Drizzle schema doesn't model either — this whole section stays on `sql`
// templates through the Drizzle instance.
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
  const orm = await getDb();
  const { rows } = await orm.execute(sql`
    INSERT INTO blog_gift_tiers (blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, expires_at)
    VALUES (${blogId}, ${n.name}, ${n.description}, ${n.creditsPrice}, ${n.starsPrice}, ${n.benefitType}, ${JSON.stringify(n.benefitConfig)}::jsonb, ${n.maxRedemptions}, ${n.expiresAt})
    RETURNING id, blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, redemption_count, expires_at, enabled, created_at, updated_at
  `);
  return rows[0] as unknown as BlogGiftTierRow;
}

export async function updateGiftTier(
  ownerId: string,
  tierId: string,
  patch: Partial<GiftTierInput> & { enabled?: boolean }
): Promise<BlogGiftTierRow> {
  await assertGiftsEnabled();

  const orm = await getDb();
  const { rows: existingRows } = await orm.execute<{
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
  }>(sql`
    SELECT b.owner_id, t.name, t.description, t.credits_price, t.stars_price, t.benefit_type, t.benefit_config, t.max_redemptions, t.expires_at, t.enabled
    FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = ${tierId} LIMIT 1
  `);
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

  const { rows } = await orm.execute(sql`
    UPDATE blog_gift_tiers
    SET name = ${merged.name}, description = ${merged.description}, credits_price = ${merged.creditsPrice}, stars_price = ${merged.starsPrice}, benefit_type = ${merged.benefitType},
        benefit_config = ${JSON.stringify(merged.benefitConfig)}::jsonb, max_redemptions = ${merged.maxRedemptions}, expires_at = ${merged.expiresAt}, enabled = ${enabled}, updated_at = NOW()
    WHERE id = ${tierId}
    RETURNING id, blog_id, name, description, credits_price, stars_price, benefit_type, benefit_config, max_redemptions, redemption_count, expires_at, enabled, created_at, updated_at
  `);
  return rows[0] as unknown as BlogGiftTierRow;
}

/** Admin override (gate44/blogs/gifts): disable a tier platform-wide regardless of ownership. */
export async function adminSetGiftTierEnabled(tierId: string, enabled: boolean): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`UPDATE blog_gift_tiers SET enabled = ${enabled}, updated_at = NOW() WHERE id = ${tierId}`);
  if (!result.rowCount) throw notFound("Gift tier not found");
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
  const orm = await getDb();
  const { rows } = await orm.execute<{ funded_amount: number; remaining_amount: number }>(
    sql`SELECT funded_amount, remaining_amount FROM blog_post_treasuries WHERE gift_tier_id = ${tierId} LIMIT 1`
  );
  return rows[0] ? { fundedAmount: rows[0].funded_amount, remainingAmount: rows[0].remaining_amount } : null;
}

/** Fund (or top up) a custom_reward tier's blog-level reward pot. Owner-only. */
export async function fundBlogGiftTreasury(ownerId: string, tierId: string, amount: number): Promise<GiftTreasuryState> {
  await assertGiftsEnabled();
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer.", "BLOG_GIFT_TREASURY_INVALID_AMOUNT");

  const orm = await getDb();
  const { rows: tierRows } = await orm.execute<{ blog_id: string; owner_id: string; benefit_type: GiftBenefitType }>(sql`
    SELECT t.blog_id, b.owner_id, t.benefit_type FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = ${tierId} LIMIT 1
  `);
  const tier = tierRows[0];
  if (!tier) throw notFound("Gift tier not found");
  if (tier.owner_id !== ownerId) throw forbidden("Only the blog owner can fund a gift tier's reward pot.");
  if (tier.benefit_type !== "custom_reward") throw badRequest("Only custom_reward tiers have a fundable reward pot.", "BLOG_GIFT_NOT_CUSTOM_REWARD");

  const referenceId = `blog_gift_treasury_fund:${tierId}:${Date.now()}`;
  const result = await orm.transaction(async (tx) => {
    await checkAndDebit(ownerId, amount, "blog_gift_treasury_fund", referenceId, "Funded a blog gift reward pot", { tierId }, tx);
    const { rows } = await tx.execute<{ funded_amount: number; remaining_amount: number } & Record<string, unknown>>(sql`
      INSERT INTO blog_post_treasuries (blog_id, gift_tier_id, owner_id, funded_amount, remaining_amount)
      VALUES (${tier.blog_id}, ${tierId}, ${ownerId}, ${amount}, ${amount})
      ON CONFLICT (gift_tier_id) DO UPDATE SET
        funded_amount = blog_post_treasuries.funded_amount + ${amount},
        remaining_amount = blog_post_treasuries.remaining_amount + ${amount},
        status = CASE WHEN blog_post_treasuries.status = 'closed' THEN 'closed' ELSE 'active' END,
        updated_at = NOW()
      RETURNING funded_amount, remaining_amount
    `);
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

  const orm = await getDb();
  const { rows: tierRows } = await orm.execute<{
    id: string; blog_id: string; owner_id: string; name: string;
    credits_price: number | null; stars_price: number | null;
    benefit_type: GiftBenefitType; benefit_config: Record<string, unknown>;
  }>(sql`
    SELECT t.id, t.blog_id, b.owner_id, t.name, t.credits_price, t.stars_price, t.benefit_type, t.benefit_config
    FROM blog_gift_tiers t JOIN blogs b ON b.id = t.blog_id WHERE t.id = ${tierId} AND b.deleted_at IS NULL LIMIT 1
  `);
  const tier = tierRows[0];
  if (!tier) throw notFound("Gift tier not found");
  if (tier.owner_id === buyerId) throw forbidden("You can't send a gift to your own blog.", "BLOG_GIFT_SELF");

  const price = currency === "credits" ? tier.credits_price : tier.stars_price;
  if (price == null || price <= 0) throw badRequest(`This tier does not accept ${currency}.`, "BLOG_GIFT_CURRENCY_NOT_ACCEPTED");

  const referenceId = `blog_gift:${tierId}:${buyerId}:${Date.now()}`;

  const outcome = await orm.transaction(async (tx) => {
    const { rows: lockRows } = await tx.execute<
      { enabled: boolean; expires_at: string | null; max_redemptions: number | null; redemption_count: number } & Record<string, unknown>
    >(sql`SELECT enabled, expires_at, max_redemptions, redemption_count FROM blog_gift_tiers WHERE id = ${tierId} FOR UPDATE`);
    const locked = lockRows[0];
    if (!locked) throw notFound("Gift tier not found");
    if (!locked.enabled) throw forbidden("This gift tier is no longer available.", "BLOG_GIFT_TIER_DISABLED");
    if (locked.expires_at && new Date(locked.expires_at) <= new Date()) throw forbidden("This gift tier has expired.", "BLOG_GIFT_TIER_EXPIRED");
    if (locked.max_redemptions != null && locked.redemption_count >= locked.max_redemptions) {
      throw forbidden("This gift tier is sold out.", "BLOG_GIFT_TIER_SOLD_OUT");
    }

    if (tier.benefit_type === "vip_badge") {
      const { rows: existingVip } = await tx.execute<{ id: string } & Record<string, unknown>>(
        sql`SELECT id FROM blog_gift_purchases WHERE blog_id = ${tier.blog_id} AND buyer_id = ${buyerId} AND benefit_type = 'vip_badge' AND status = 'active' LIMIT 1`
      );
      if (existingVip[0]) throw badRequest("You already hold an active VIP badge for this blog.", "BLOG_GIFT_ALREADY_VIP");
    }

    if (currency === "credits") {
      await checkAndDebit(buyerId, price, "blog_gift_purchase", referenceId, `Gift: ${tier.name}`, { tierId, blogId: tier.blog_id }, tx);
    } else {
      await debitStars(buyerId, price, "blog_gift_purchase", referenceId, `Gift: ${tier.name}`, tx);
    }

    await tx.execute(sql`UPDATE blog_gift_tiers SET redemption_count = redemption_count + 1, updated_at = NOW() WHERE id = ${tierId}`);

    const { rows: purchaseRows } = await tx.execute<{ id: string } & Record<string, unknown>>(sql`
      INSERT INTO blog_gift_purchases (tier_id, blog_id, buyer_id, currency, amount_paid, benefit_type)
      VALUES (${tierId}, ${tier.blog_id}, ${buyerId}, ${currency}, ${price}, ${tier.benefit_type}) RETURNING id
    `);
    const purchaseId = purchaseRows[0].id;
    const result: GiftPurchaseResult = { purchaseId, benefitType: tier.benefit_type };

    if (tier.benefit_type === "vip_section_access") {
      const unlockPostId = typeof tier.benefit_config?.unlockPostId === "string" ? (tier.benefit_config.unlockPostId as string) : null;
      if (unlockPostId) {
        await tx.execute(sql`
          INSERT INTO blog_post_unlocks (post_id, user_id, credits_spent) VALUES (${unlockPostId}, ${buyerId}, ${currency === "credits" ? price : 0}) ON CONFLICT (post_id, user_id) DO NOTHING
        `);
        result.unlockedPostId = unlockPostId;
      }
    } else if (tier.benefit_type === "custom_reward") {
      const config = tier.benefit_config ?? {};
      const treasuryAmount = typeof config.treasuryAmount === "number" && config.treasuryAmount > 0 ? Math.trunc(config.treasuryAmount) : null;
      const textInstructions = typeof config.textInstructions === "string" && config.textInstructions.trim() ? config.textInstructions.trim() : null;

      let payoutAmount: number | null = null;
      if (treasuryAmount != null) {
        const { rows: treasuryRows } = await tx.execute<{ id: string; remaining_amount: number } & Record<string, unknown>>(
          sql`SELECT id, remaining_amount FROM blog_post_treasuries WHERE gift_tier_id = ${tierId} FOR UPDATE`
        );
        const treasury = treasuryRows[0];
        if (treasury && treasury.remaining_amount >= treasuryAmount) {
          await tx.execute(sql`
            UPDATE blog_post_treasuries SET remaining_amount = remaining_amount - ${treasuryAmount}, claimant_count = claimant_count + 1, updated_at = NOW() WHERE id = ${treasury.id}
          `);
          await creditCoins(buyerId, treasuryAmount, "blog_gift_treasury_claim", `blog_gift_treasury_claim:${purchaseId}`, "Gift reward pot payout", { tierId, purchaseId }, tx);
          payoutAmount = treasuryAmount;
        } else {
          logger.warn({ tierId, purchaseId }, "[blogs/service] gift custom_reward reward pot has insufficient funds; skipping payout");
        }
      }

      await tx.execute(sql`
        INSERT INTO blog_gift_claims (purchase_id, treasury_payout_amount, text_revealed) VALUES (${purchaseId}, ${payoutAmount}, ${textInstructions != null})
      `);
      result.treasuryPayout = payoutAmount ?? undefined;
      result.textInstructions = textInstructions;
    }

    return result;
  });

  await creditGiftEarnings(tier.owner_id, price, currency, referenceId).catch((err) => {
    logger.error({ err, tierId, ownerId: tier.owner_id }, "[blogs/service] failed to credit gift earnings");
  });

  await insertNotificationBatch(
    orm, [tier.owner_id], "blog_gift_received",
    `New gift: ${tier.name}`, `Someone sent your blog a "${tier.name}" gift.`,
    { blogId: tier.blog_id, tierId, purchaseId: outcome.purchaseId }
  ).catch((err) => logger.error({ err, tierId }, "[blogs/service] failed to notify blog owner of a gift"));

  await insertNotificationBatch(
    orm, [buyerId], "blog_gift_sent",
    "Gift sent", `Your "${tier.name}" gift was sent successfully.`,
    { blogId: tier.blog_id, tierId, purchaseId: outcome.purchaseId }
  ).catch((err) => logger.error({ err, tierId }, "[blogs/service] failed to notify buyer of a gift"));

  safeAwardXPFireAndForget(tier.owner_id, 5, "creator", "blog_gift_received", `blog_gift_xp:${outcome.purchaseId}`);

  return outcome;
}

/** Credits the blog owner's earnings for a gift purchase, using the same revenue-share convention as paywall unlocks. */
async function creditGiftEarnings(creatorId: string, amountPaid: number, currency: GiftCurrency, referenceId: string): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
    .limit(1);
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

  await orm.transaction(async (tx) => {
    await tx
      .insert(schema.creatorEarnings)
      .values({
        creatorId,
        sourceType: "blog_gift",
        grossAmountKobo: BigInt(grossKobo.toFixed(0)),
        platformFeeKobo: BigInt(platformFeeKobo.toFixed(0)),
        netAmountKobo: BigInt(netKobo.toFixed(0)),
        referenceId: `${referenceId}:earnings`,
      })
      .onConflictDoNothing({ target: [schema.creatorEarnings.creatorId, schema.creatorEarnings.referenceId] });
    await tx
      .update(schema.users)
      .set({ availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${netKobo.toFixed(0)}`, updatedAt: sql`NOW()` })
      .where(eq(schema.users.id, creatorId));
  });
}

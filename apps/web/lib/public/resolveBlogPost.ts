/**
 * apps/web/lib/public/resolveBlogPost.ts
 *
 * Resolves a public, published blog article/page for the crawlable
 * /b/<blogSlug>/<postSlug> page — no auth required. Paywalled articles
 * always render a truncated preview server-side (good for SEO — crawlers
 * see real content + the "pay N credits" notice); the full body is fetched
 * client-side, only for a signed-in viewer who has unlocked it or is the
 * author (see components/blogs/PostBody.tsx).
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { sanitizeBlogPostHtml, plainTextToBlogPostHtml } from "@/lib/security/htmlSanitizer";

export interface PublicBlogPost {
  id: string;
  blog_id: string;
  author_id: string;
  category_id: string | null;
  category_name: string | null;
  type: string;
  status: string;
  title: string;
  slug: string;
  /** 'about'|'privacy'|'contact' for an auto-generated default page (migration 0023), else null. */
  page_key: string | null;
  excerpt: string | null;
  body_html: string;
  featured_image_url: string | null;
  is_paywalled: boolean;
  paywall_credits_cost: number;
  word_count: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  updated_at: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  locked: boolean;
}

/**
 * `allowUnpublished` powers the owner/admin "Preview" toggle (`?preview=1`
 * on /b/<slug>/<postSlug>) — the caller (the page component) is responsible
 * for verifying the viewer is actually the post's author or a staff member
 * before passing this true; this function itself does no auth.
 */
export async function resolvePublicBlogPost(blogId: string, postSlug: string, opts?: { allowUnpublished?: boolean }): Promise<PublicBlogPost | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.blogPosts.id,
      blogId: schema.blogPosts.blogId,
      authorId: schema.blogPosts.authorId,
      categoryId: schema.blogPosts.categoryId,
      categoryName: schema.blogCategories.name,
      type: schema.blogPosts.type,
      status: schema.blogPosts.status,
      title: schema.blogPosts.title,
      slug: schema.blogPosts.slug,
      pageKey: schema.blogPosts.pageKey,
      excerpt: schema.blogPosts.excerpt,
      bodyMarkdown: schema.blogPosts.bodyMarkdown,
      contentFormat: schema.blogPosts.contentFormat,
      featuredImageUrl: schema.blogPosts.featuredImageUrl,
      isPaywalled: schema.blogPosts.isPaywalled,
      paywallCreditsCost: schema.blogPosts.paywallCreditsCost,
      wordCount: schema.blogPosts.wordCount,
      viewCount: schema.blogPosts.viewCount,
      likeCount: schema.blogPosts.likeCount,
      commentCount: schema.blogPosts.commentCount,
      publishedAt: schema.blogPosts.publishedAt,
      updatedAt: schema.blogPosts.updatedAt,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
      authorAvatarUrl: schema.users.avatarUrl,
    })
    .from(schema.blogPosts)
    .leftJoin(schema.blogCategories, eq(schema.blogCategories.id, schema.blogPosts.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.blogPosts.authorId))
    .where(
      and(
        eq(schema.blogPosts.blogId, blogId),
        eq(schema.blogPosts.slug, postSlug),
        isNull(schema.blogPosts.deletedAt),
        opts?.allowUnpublished ? undefined : eq(schema.blogPosts.status, "published")
      )
    )
    .limit(1);
  if (!row) return null;

  const render = row.contentFormat === "plaintext" ? plainTextToBlogPostHtml : sanitizeBlogPostHtml;
  const locked = row.isPaywalled && row.paywallCreditsCost > 0;
  let bodyHtml: string;
  if (locked) {
    const previewWords = Math.max(100, Math.round(row.wordCount * 0.2));
    const truncated = row.bodyMarkdown.trim().split(/\s+/).slice(0, previewWords).join(" ");
    bodyHtml = render(truncated);
  } else {
    bodyHtml = render(row.bodyMarkdown);
  }

  return {
    id: row.id,
    blog_id: row.blogId,
    author_id: row.authorId,
    category_id: row.categoryId,
    category_name: row.categoryName,
    type: row.type,
    status: row.status,
    title: row.title,
    slug: row.slug,
    page_key: row.pageKey,
    excerpt: row.excerpt,
    body_html: bodyHtml,
    featured_image_url: row.featuredImageUrl,
    is_paywalled: row.isPaywalled,
    paywall_credits_cost: row.paywallCreditsCost,
    word_count: row.wordCount,
    view_count: row.viewCount,
    like_count: row.likeCount,
    comment_count: row.commentCount,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    updated_at: row.updatedAt.toISOString(),
    author_username: row.authorUsername,
    author_display_name: row.authorDisplayName,
    author_avatar_url: row.authorAvatarUrl,
    locked,
  };
}

export interface PublicBlogPostSummary {
  id: string;
  slug: string;
  type: string;
  title: string;
  excerpt: string | null;
  featured_image_url: string | null;
  is_paywalled: boolean;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  category_name: string | null;
  sort_order: number;
}

export async function listPublicBlogPosts(blogId: string, type: "article" | "page", limit = 20): Promise<PublicBlogPostSummary[]> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.blogPosts.id,
      slug: schema.blogPosts.slug,
      type: schema.blogPosts.type,
      title: schema.blogPosts.title,
      excerpt: schema.blogPosts.excerpt,
      featuredImageUrl: schema.blogPosts.featuredImageUrl,
      isPaywalled: schema.blogPosts.isPaywalled,
      viewCount: schema.blogPosts.viewCount,
      likeCount: schema.blogPosts.likeCount,
      commentCount: schema.blogPosts.commentCount,
      publishedAt: schema.blogPosts.publishedAt,
      sortOrder: schema.blogPosts.sortOrder,
      categoryName: schema.blogCategories.name,
      createdAt: schema.blogPosts.createdAt,
    })
    .from(schema.blogPosts)
    .leftJoin(schema.blogCategories, eq(schema.blogCategories.id, schema.blogPosts.categoryId))
    .where(
      and(
        eq(schema.blogPosts.blogId, blogId),
        eq(schema.blogPosts.status, "published"),
        isNull(schema.blogPosts.deletedAt),
        eq(schema.blogPosts.type, type)
      )
    )
    .orderBy(
      ...(type === "page"
        ? [asc(schema.blogPosts.sortOrder), asc(schema.blogPosts.createdAt)]
        : [desc(schema.blogPosts.publishedAt), desc(schema.blogPosts.createdAt)])
    )
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    type: r.type,
    title: r.title,
    excerpt: r.excerpt,
    featured_image_url: r.featuredImageUrl,
    is_paywalled: r.isPaywalled,
    view_count: r.viewCount,
    like_count: r.likeCount,
    comment_count: r.commentCount,
    published_at: r.publishedAt ? r.publishedAt.toISOString() : null,
    category_name: r.categoryName,
    sort_order: r.sortOrder,
  }));
}

export async function listPopularBlogPosts(blogId: string, limit = 5): Promise<PublicBlogPostSummary[]> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.blogPosts.id,
      slug: schema.blogPosts.slug,
      type: schema.blogPosts.type,
      title: schema.blogPosts.title,
      excerpt: schema.blogPosts.excerpt,
      featuredImageUrl: schema.blogPosts.featuredImageUrl,
      isPaywalled: schema.blogPosts.isPaywalled,
      viewCount: schema.blogPosts.viewCount,
      likeCount: schema.blogPosts.likeCount,
      commentCount: schema.blogPosts.commentCount,
      publishedAt: schema.blogPosts.publishedAt,
      sortOrder: schema.blogPosts.sortOrder,
      categoryName: schema.blogCategories.name,
    })
    .from(schema.blogPosts)
    .leftJoin(schema.blogCategories, eq(schema.blogCategories.id, schema.blogPosts.categoryId))
    .where(
      and(
        eq(schema.blogPosts.blogId, blogId),
        eq(schema.blogPosts.status, "published"),
        isNull(schema.blogPosts.deletedAt),
        eq(schema.blogPosts.type, "article")
      )
    )
    .orderBy(desc(schema.blogPosts.viewCount), desc(schema.blogPosts.likeCount))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    type: r.type,
    title: r.title,
    excerpt: r.excerpt,
    featured_image_url: r.featuredImageUrl,
    is_paywalled: r.isPaywalled,
    view_count: r.viewCount,
    like_count: r.likeCount,
    comment_count: r.commentCount,
    published_at: r.publishedAt ? r.publishedAt.toISOString() : null,
    category_name: r.categoryName,
    sort_order: r.sortOrder,
  }));
}

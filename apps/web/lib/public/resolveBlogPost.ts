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

import { db } from "@/lib/db";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";

export interface PublicBlogPost {
  id: string;
  blog_id: string;
  author_id: string;
  category_id: string | null;
  category_name: string | null;
  type: string;
  title: string;
  slug: string;
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
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  locked: boolean;
}

export async function resolvePublicBlogPost(blogId: string, postSlug: string): Promise<PublicBlogPost | null> {
  const { rows } = await db.query<{
    id: string; blog_id: string; author_id: string; category_id: string | null; category_name: string | null;
    type: string; title: string; slug: string; excerpt: string | null; body_markdown: string;
    featured_image_url: string | null; is_paywalled: boolean; paywall_credits_cost: number; word_count: number;
    view_count: number; like_count: number; comment_count: number; published_at: string | null;
    author_username: string | null; author_display_name: string | null; author_avatar_url: string | null;
  }>(
    `SELECT p.id, p.blog_id, p.author_id, p.category_id, c.name AS category_name,
            p.type, p.title, p.slug, p.excerpt, p.body_markdown, p.featured_image_url,
            p.is_paywalled, p.paywall_credits_cost, p.word_count, p.view_count, p.like_count, p.comment_count,
            p.published_at, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
     FROM blog_posts p
     LEFT JOIN blog_categories c ON c.id = p.category_id
     JOIN users u ON u.id = p.author_id
     WHERE p.blog_id = $1 AND p.slug = $2 AND p.status = 'published' AND p.deleted_at IS NULL
     LIMIT 1`,
    [blogId, postSlug]
  );
  const row = rows[0];
  if (!row) return null;

  const locked = row.is_paywalled && row.paywall_credits_cost > 0;
  let bodyHtml: string;
  if (locked) {
    const previewWords = Math.max(100, Math.round(row.word_count * 0.2));
    const truncated = row.body_markdown.trim().split(/\s+/).slice(0, previewWords).join(" ");
    bodyHtml = sanitizeBlogPostHtml(truncated);
  } else {
    bodyHtml = sanitizeBlogPostHtml(row.body_markdown);
  }

  return { ...row, body_html: bodyHtml, locked };
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
  const orderBy = type === "page" ? "p.sort_order ASC, p.created_at ASC" : "p.published_at DESC NULLS LAST, p.created_at DESC";
  const { rows } = await db.query<PublicBlogPostSummary>(
    `SELECT p.id, p.slug, p.type, p.title, p.excerpt, p.featured_image_url, p.is_paywalled,
            p.view_count, p.like_count, p.comment_count, p.published_at, p.sort_order,
            c.name AS category_name
     FROM blog_posts p
     LEFT JOIN blog_categories c ON c.id = p.category_id
     WHERE p.blog_id = $1 AND p.status = 'published' AND p.deleted_at IS NULL AND p.type = $2
     ORDER BY ${orderBy}
     LIMIT $3`,
    [blogId, type, limit]
  );
  return rows;
}

export async function listPopularBlogPosts(blogId: string, limit = 5): Promise<PublicBlogPostSummary[]> {
  const { rows } = await db.query<PublicBlogPostSummary>(
    `SELECT p.id, p.slug, p.type, p.title, p.excerpt, p.featured_image_url, p.is_paywalled,
            p.view_count, p.like_count, p.comment_count, p.published_at, p.sort_order,
            c.name AS category_name
     FROM blog_posts p
     LEFT JOIN blog_categories c ON c.id = p.category_id
     WHERE p.blog_id = $1 AND p.status = 'published' AND p.deleted_at IS NULL AND p.type = 'article'
     ORDER BY p.view_count DESC, p.like_count DESC
     LIMIT $2`,
    [blogId, limit]
  );
  return rows;
}

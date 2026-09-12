/**
 * app/(app)/blog-posts/[id]/page.tsx
 *
 * Id-based redirect shim for blog post deep links.
 *
 * The canonical, crawlable blog post URL is /b/<blogSlug>/<postSlug>
 * (app/b/[slug]/[postSlug]/page.tsx), but Home Feed items only carry a
 * content id (see lib/feed/types.ts FeedItem.contentId) — the feed
 * aggregator's candidate queries don't select slugs. Rather than widen
 * those queries (and every other consumer of deepLinkPathFor), this route
 * does one cheap id -> slug lookup and forwards to the real page so
 * "/blog-posts/<id>" (see lib/feed/deeplink.ts) always lands on working
 * content.
 */

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function BlogPostRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows } = await db.query<{ blog_slug: string; post_slug: string }>(
    `SELECT b.slug AS blog_slug, p.slug AS post_slug
     FROM blog_posts p
     JOIN blogs b ON b.id = p.blog_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND b.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );

  const row = rows[0];
  if (!row) notFound();

  redirect(`/b/${row.blog_slug}/${row.post_slug}`);
}

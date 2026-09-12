/**
 * app/(app)/wiki-pages/[id]/page.tsx
 *
 * Id-based redirect shim for wiki page deep links — mirrors
 * app/(app)/blog-posts/[id]/page.tsx. The canonical wiki page URL is
 * /wiki/<wikiSlug>/<pageSlug> (app/(app)/wiki/[slug]/[pageSlug]/page.tsx);
 * Home Feed items only carry wiki_pages.id, so this does one id -> slugs
 * lookup and forwards.
 */

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function WikiPageRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows } = await db.query<{ wiki_slug: string; page_slug: string }>(
    `SELECT w.slug AS wiki_slug, p.slug AS page_slug
     FROM wiki_pages p
     JOIN wikis w ON w.id = p.wiki_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND w.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );

  const row = rows[0];
  if (!row) notFound();

  redirect(`/wiki/${row.wiki_slug}/${row.page_slug}`);
}

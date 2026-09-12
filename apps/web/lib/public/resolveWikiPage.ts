/**
 * apps/web/lib/public/resolveWikiPage.ts
 *
 * Resolves a public, published wiki page for the crawlable
 * /w/<wikiSlug>/<pageSlug> page — no auth required. Thin wrapper around
 * lib/wiki/repo.ts's getWikiPageBySlug (only published, non-deleted pages
 * are returned). Mirrors resolveBlogPost.ts, minus the paywall handling
 * (wikis have no paywall concept) and minus per-page slug redirects — like
 * blog posts, wiki page slugs are only scoped/unique per wiki, and no
 * per-page redirect mechanism exists in the service layer (only wiki-level
 * redirects via slug_redirects), so a renamed page's old slug 404s here,
 * same as a renamed blog post's old slug would.
 */

import { getWikiPageBySlug, type WikiPageRow } from "@/lib/wiki/repo";

export type PublicWikiPage = WikiPageRow;

export async function resolvePublicWikiPage(wikiId: string, pageSlug: string): Promise<PublicWikiPage | null> {
  const page = await getWikiPageBySlug(wikiId, pageSlug);
  if (!page || page.status !== "published") return null;
  return page;
}

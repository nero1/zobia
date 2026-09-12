/**
 * app/w/[slug]/[pageSlug]/page.tsx
 *
 * Public, SSR, crawlable wiki page view at /w/<wikiSlug>/<pageSlug>.
 * Mirrors app/b/[slug]/[postSlug]/page.tsx (the blog article page) minus
 * the paywall handling — wikis have no paywall concept, content is
 * publicly readable in full. content_html is already sanitized server-side
 * at write time (lib/security/htmlSanitizer.ts, called from lib/wiki/
 * service.ts) so it's rendered here as-is via dangerouslySetInnerHTML,
 * same pattern as the blog article body.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePublicWiki } from "@/lib/public/resolveWiki";
import { resolvePublicWikiPage } from "@/lib/public/resolveWikiPage";
import { recordPageView } from "@/lib/wiki/service";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { generateStructuredData } from "@/lib/seo/metadata";
import { formatShortDate } from "@/lib/format/date";
import { WikiEditCta } from "@/components/wiki/WikiEditCta";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string; pageSlug: string }> }): Promise<Metadata> {
  const { slug, pageSlug } = await params;
  const resolved = await resolvePublicWiki(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  const page = await resolvePublicWikiPage(resolved.wiki.id, pageSlug).catch(() => null);
  if (!page) return NOT_FOUND_METADATA;

  const title = `${page.title} — ${resolved.wiki.name}`;
  const description = `Read "${page.title}" on ${resolved.wiki.name}.`;
  const image = resolved.wiki.cover_image_url || resolved.wiki.avatar_url || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image }], type: "article", siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: { canonical: `/w/${slug}/${pageSlug}` },
  };
}

export default async function PublicWikiPagePage({ params }: { params: Promise<{ slug: string; pageSlug: string }> }) {
  const { slug, pageSlug } = await params;
  const resolved = await resolvePublicWiki(slug).catch(() => null);
  if (!resolved) notFound();
  const { wiki } = resolved;

  const page = await resolvePublicWikiPage(wiki.id, pageSlug).catch(() => null);
  if (!page) notFound();

  const viewer = await getOptionalServerUser();

  // Best-effort, non-blocking — never let a view-count write fail the page.
  recordPageView(page.id).catch(() => {});

  const schema = generateStructuredData("Thing", {
    "@type": "Article",
    headline: page.title,
    description: `Read "${page.title}" on ${wiki.name}.`,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/w/${slug}/${pageSlug}`,
    image: wiki.cover_image_url ?? wiki.avatar_url ?? undefined,
    dateModified: page.updated_at,
    author: page.last_editor_username ? { "@type": "Person", name: page.last_editor_username } : undefined,
  });

  return (
    <main className="min-h-screen bg-background">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href={`/w/${wiki.slug}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← {wiki.name}
        </Link>

        <div className="mt-4 flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold text-foreground">{page.title}</h1>
          <WikiEditCta wikiSlug={wiki.slug} pageSlug={page.slug} variant="page" signedIn={!!viewer} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {page.last_editor_username && <span>Last edited by @{page.last_editor_username}</span>}
          <span>{formatShortDate(page.updated_at)}</span>
          <span>{page.revision_count} revision{page.revision_count === 1 ? "" : "s"}</span>
          <span>👁 {page.view_count} views</span>
        </div>

        <div className="mt-6">
          {/* eslint-disable-next-line react/no-danger */}
          <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: page.content_html }} />
        </div>
      </div>
    </main>
  );
}

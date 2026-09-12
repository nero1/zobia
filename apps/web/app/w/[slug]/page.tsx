/**
 * app/w/[slug]/page.tsx
 *
 * Public, SSR, crawlable wiki home page at /w/<slug>. Mirrors
 * app/b/[slug]/page.tsx (the blog home page): lists pages alphabetically,
 * shows stats, a simple server-driven search box, and a "Log in to
 * contribute" CTA for signed-out visitors — wikis are publicly readable by
 * anyone, but editing requires auth and happens on the authenticated
 * /wiki/<slug> equivalent (built separately).
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolvePublicWiki } from "@/lib/public/resolveWiki";
import { listWikiPages } from "@/lib/wiki/repo";
import { recordWikiView } from "@/lib/wiki/service";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { generateStructuredData } from "@/lib/seo/metadata";
import { WikiEditCta } from "@/components/wiki/WikiEditCta";
import { WikiSearchBox } from "@/components/wiki/WikiSearchBox";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;
const PAGE_LIST_LIMIT = 50;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicWiki(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;

  const { wiki } = resolved;
  const title = `${wiki.name} — Zobia Social`;
  const description = wiki.description?.slice(0, 155) ?? `Browse ${wiki.name} on Zobia Social.`;
  const image = wiki.cover_image_url || wiki.avatar_url || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image }], type: "website", siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: { canonical: `/w/${wiki.slug}` },
  };
}

export default async function PublicWikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const { slug } = await params;
  const { search } = await searchParams;
  const resolved = await resolvePublicWiki(slug).catch(() => null);
  if (!resolved) notFound();
  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/w/${resolved.canonicalRedirectSlug}`);
  }

  const { wiki } = resolved;
  const [{ pages }, viewer] = await Promise.all([
    listWikiPages(wiki.id, { limit: PAGE_LIST_LIMIT, search: search?.trim() || undefined }),
    getOptionalServerUser(),
  ]);

  // Best-effort, non-blocking — never let a view-count write fail the page.
  recordWikiView(wiki.id).catch(() => {});

  const websiteSchema = generateStructuredData("Thing", {
    "@type": "WebSite",
    name: wiki.name,
    description: wiki.description ?? undefined,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/w/${wiki.slug}`,
    image: wiki.cover_image_url ?? wiki.avatar_url ?? undefined,
  });

  return (
    <main className="min-h-screen bg-background">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: websiteSchema }} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6">
          {wiki.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wiki.cover_image_url} alt="" className="mb-4 h-40 w-full rounded-2xl object-cover" />
          )}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              {wiki.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wiki.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-xl bg-neutral-700 flex items-center justify-center text-lg">📖</div>
              )}
              <div>
                <h1 className="text-3xl font-bold text-foreground">{wiki.name}</h1>
                {wiki.description && <p className="mt-1 text-muted-foreground">{wiki.description}</p>}
                <p className="mt-1 text-sm text-muted-foreground">by @{wiki.owner_username}</p>
              </div>
            </div>
            <div className="shrink-0">
              <WikiEditCta wikiSlug={wiki.slug} variant="wiki" signedIn={!!viewer} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-3 text-sm text-muted-foreground">
            <span>📄 {wiki.page_count} pages</span>
            <span>👥 {wiki.contributor_count} contributors</span>
            <span>👁 {wiki.view_count} views</span>
            {wiki.status === "paused" && (
              <span className="rounded-full bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-400">Read-only</span>
            )}
          </div>
        </header>

        <div className="mb-6">
          <WikiSearchBox wikiSlug={wiki.slug} initialValue={search ?? ""} />
        </div>

        {pages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {search ? `No pages match "${search}".` : "This wiki has no pages yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {pages.map((p) => (
              <li key={p.id}>
                <Link href={`/w/${wiki.slug}/${p.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent transition-colors">
                  <span className="font-medium text-foreground">{p.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">👁 {p.view_count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8">
          <Link href="/wiki" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← More wikis
          </Link>
        </div>
      </div>
    </main>
  );
}

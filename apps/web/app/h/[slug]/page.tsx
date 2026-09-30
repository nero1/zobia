/**
 * app/h/[slug]/page.tsx
 *
 * Public, SSR, crawlable Portal page at /h/<slug> (e.g. /h/lagos, /h/uniben):
 * a hashtag-driven mini-portal that gathers content from every Zobia
 * primitive (feed, rooms, guilds, people, forum, Q&A, wiki, ...).
 *
 * The payload comes from the two-tier cache in lib/portals/cache.ts, so this
 * is "dynamic on first load, then cached". Merged hashtags 308-redirect to
 * the surviving portal; suppressed/blocked/unknown slugs 404. The vanity
 * `zobia.org/#/<slug>` alias is handled client-side (PortalHashRedirect).
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { loadManifest } from "@/lib/manifest";
import { resolvePortal } from "@/lib/portals/repo";
import { getPortalPayload } from "@/lib/portals/page";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { PortalView } from "@/components/portals/PortalView";
import { PortalNav } from "@/components/portals/PortalNav";
import { serializeJsonLd } from "@/lib/seo/metadata";
import { portalPath } from "@zobia/shared/utils";

// cache(): generateMetadata and the page both call this in one request.
const load = cache(async (slug: string) => {
  const manifest = await loadManifest();
  if (!manifest.features.portals) return null;
  const resolved = await resolvePortal(decodeURIComponent(slug)).catch(() => null);
  if (!resolved) return null;
  const payload = await getPortalPayload(resolved.row);
  return { resolved, payload };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) return NOT_FOUND_METADATA;

  const { portal } = data.payload;
  const title = `#${portal.slug}: ${portal.title} — Zobia Social`;
  const description = (portal.tagline ?? portal.description ?? `Everything about #${portal.slug} on Zobia Social: posts, rooms, people, forum and more.`).slice(0, 155);
  const thin = portal.status === "archived" || (portal.status !== "official" && data.payload.sections.feed.length < 3);

  return {
    title: { absolute: title },
    description,
    robots: thin ? { index: false, follow: true } : undefined,
    openGraph: { title, description, images: portal.coverImageUrl ? [{ url: portal.coverImageUrl }] : [], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: portal.coverImageUrl ? [portal.coverImageUrl] : [] },
    alternates: { canonical: portalPath(portal.slug) },
  };
}

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) notFound();

  if (data.resolved.canonicalSlug !== decodeURIComponent(slug)) {
    permanentRedirect(portalPath(data.resolved.canonicalSlug));
  }

  const { portal } = data.payload;
  const jsonLd = serializeJsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `#${portal.slug}: ${portal.title}`,
    description: portal.tagline ?? portal.description ?? undefined,
    url: portalPath(portal.slug),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: data.payload.sections.feed.slice(0, 10).map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.title ?? item.excerpt?.slice(0, 80) ?? item.contentType,
        url: item.url,
      })),
    },
  });

  return (
    <main className="min-h-screen bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <PortalNav redirectTo={portalPath(portal.slug)} />
      <PortalView initial={data.payload} />
    </main>
  );
}

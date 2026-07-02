/**
 * app/p/[slug]/page.tsx
 *
 * Public, SSR, crawlable Business Page at /p/<slug> (e.g. /p/cadbury) — the
 * Business Accounts equivalent of the Blogs public page (/b/<slug>).
 * Sponsored quests and adverts run by a business page link back here, so
 * "adverts run by this page are shown to come from this business page"
 * (PRD §17) always resolves to a real, brandable destination.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 * Referral links (?r=<code>) work here automatically via the global
 * ReferralCapture component mounted in the root layout.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolvePublicBusinessPage } from "@/lib/public/resolveBusinessPage";
import { listBusinessPagePosts } from "@/lib/business/repo";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { PageViewTracker } from "@/components/business/PageViewTracker";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicBusinessPage(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;

  const { page } = resolved;
  const title = `${page.name} — Zobia Social`;
  const description = page.bio?.slice(0, 155) ?? `${page.name} on Zobia Social.`;

  return {
    title,
    description,
    openGraph: { title, description, images: page.cover_image_url ? [{ url: page.cover_image_url }] : [], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: page.cover_image_url ? [page.cover_image_url] : [] },
    alternates: { canonical: `/p/${page.slug}` },
  };
}

export default async function PublicBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await resolvePublicBusinessPage(slug).catch(() => null);
  if (!resolved) notFound();
  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/p/${resolved.canonicalRedirectSlug}`);
  }

  const { page } = resolved;
  const posts = await listBusinessPagePosts(page.id, { publishedOnly: true });

  return (
    <main className="min-h-screen bg-background">
      <PageViewTracker pageId={page.id} />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-6">
          {page.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.cover_image_url} alt="" className="mb-4 h-40 w-full rounded-2xl object-cover" />
          )}
          <div className="flex items-start gap-4">
            {page.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.avatar_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-neutral-800 text-2xl">🏢</div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{page.name}</h1>
                {page.verified && (
                  <span className="rounded-full bg-teal-950/40 px-2 py-0.5 text-xs font-semibold text-teal-400">Verified ✓</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">A page by {page.business_name}</p>
              {page.bio && <p className="mt-2 text-sm text-muted-foreground">{page.bio}</p>}
            </div>
          </div>
        </header>

        <div className="space-y-4">
          {posts.length === 0 ? (
            <p className="text-muted-foreground">No updates yet.</p>
          ) : (
            posts.map((post) => (
              <article key={post.id} className="rounded-2xl border border-border bg-card p-4">
                {post.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.image_url} alt="" className="mb-3 h-40 w-full rounded-xl object-cover" />
                )}
                <h2 className="font-bold text-foreground">{post.title}</h2>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{post.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">{new Date(post.created_at).toLocaleDateString()}</p>
              </article>
            ))
          )}
        </div>

        <div className="mt-8">
          <a href="/business" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Zobia Business
          </a>
        </div>
      </div>
    </main>
  );
}

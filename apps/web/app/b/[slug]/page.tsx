/**
 * app/b/[slug]/page.tsx
 *
 * Public, SSR, crawlable blog home page at /b/<slug>. Lists articles in
 * reverse-chronological order, static pages in a mini top menu, and a
 * sidebar with categories + popular posts. Interactive bits (subscribe)
 * hydrate client-side — see components/blogs/SubscribeButton.tsx.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 * Referral links (?r=<code>) work here automatically via the global
 * ReferralCapture component mounted in the root layout.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolvePublicBlog } from "@/lib/public/resolveBlog";
import { listPublicBlogPosts, listPopularBlogPosts } from "@/lib/public/resolveBlogPost";
import { listBlogCategories } from "@/lib/blogs/repo";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { SubscribeButton } from "@/components/blogs/SubscribeButton";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;

  const { blog } = resolved;
  const title = `${blog.title} — Zobia Social`;
  const description = blog.tagline ?? blog.description?.slice(0, 155) ?? `Read ${blog.title} on Zobia Social.`;

  return {
    title,
    description,
    openGraph: { title, description, images: blog.cover_image_url ? [{ url: blog.cover_image_url }] : [], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: blog.cover_image_url ? [blog.cover_image_url] : [] },
    alternates: { canonical: `/b/${blog.slug}` },
  };
}

export default async function PublicBlogPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) notFound();
  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/b/${resolved.canonicalRedirectSlug}`);
  }

  const { blog } = resolved;
  const [articles, pages, popular, categories] = await Promise.all([
    listPublicBlogPosts(blog.id, "article", 20),
    listPublicBlogPosts(blog.id, "page", 20),
    listPopularBlogPosts(blog.id, 5),
    listBlogCategories(blog.id),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-6">
          {blog.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={blog.cover_image_url} alt="" className="mb-4 h-40 w-full rounded-2xl object-cover" />
          )}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-foreground">{blog.title}</h1>
              {blog.tagline && <p className="mt-1 text-muted-foreground">{blog.tagline}</p>}
              <p className="mt-1 text-sm text-muted-foreground">by @{blog.owner_username}</p>
            </div>
            <SubscribeButton blogSlug={blog.slug} showCount={blog.show_subscriber_count} initialCount={blog.subscriber_count} />
          </div>

          {pages.length > 0 && (
            <nav className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
              {pages.map((p) => (
                <Link key={p.id} href={`/b/${blog.slug}/${p.slug}`} className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-700">
                  {p.title}
                </Link>
              ))}
            </nav>
          )}
        </header>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            {articles.length === 0 ? (
              <p className="text-muted-foreground">No articles yet.</p>
            ) : (
              articles.map((a) => (
                <Link key={a.id} href={`/b/${blog.slug}/${a.slug}`} className="block rounded-2xl border border-border bg-card p-4 hover:border-primary/60 transition-colors">
                  <div className="flex gap-4">
                    {a.featured_image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.featured_image_url} alt="" className="h-20 w-20 flex-shrink-0 rounded-xl object-cover" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-foreground">{a.title}</h2>
                        {a.is_paywalled && <span className="text-[10px] rounded-full bg-amber-950/40 text-amber-400 px-1.5 py-0.5">🔒</span>}
                      </div>
                      {a.excerpt && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{a.excerpt}</p>}
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        {a.published_at && <span>{new Date(a.published_at).toLocaleDateString()}</span>}
                        {a.category_name && <span className="rounded-full bg-neutral-800 px-2 py-0.5">{a.category_name}</span>}
                        <span>👁 {a.view_count}</span>
                        <span>❤️ {a.like_count}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>

          <aside className="space-y-6">
            {categories.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Categories</h3>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <span key={c.id} className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300">{c.name} ({c.post_count})</span>
                  ))}
                </div>
              </div>
            )}
            {popular.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Popular</h3>
                <div className="space-y-2">
                  {popular.map((p) => (
                    <Link key={p.id} href={`/b/${blog.slug}/${p.slug}`} className="block text-sm text-foreground hover:text-primary truncate">
                      {p.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        <div className="mt-8">
          <Link href="/blogs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← More blogs
          </Link>
        </div>
      </div>
    </main>
  );
}

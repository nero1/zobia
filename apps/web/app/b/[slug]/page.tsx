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
import { BlogNavBar } from "@/components/blogs/BlogNavBar";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { generateBlogSchema } from "@/lib/seo/metadata";
import { getTheme, resolveLayout, DEFAULT_THEME_TOKENS } from "@/lib/blogs/themes";
import { BlogHomeLayout } from "@/components/blogs/layouts/BlogHomeLayout";
import { GiftTiersSection } from "@/components/blogs/GiftTiersSection";
import { listPublicGiftTiers } from "@/lib/blogs/service";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;

  const { blog } = resolved;
  const title = `${blog.title} — Zobia Social`;
  const description = blog.tagline ?? blog.description?.slice(0, 155) ?? `Read ${blog.title} on Zobia Social.`;
  const image = blog.cover_image_url || DEFAULT_OG_IMAGE;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image }], type: "website", siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
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
  const [articles, pages, popular, categories, viewer, theme, giftTiers] = await Promise.all([
    listPublicBlogPosts(blog.id, "article", 20),
    listPublicBlogPosts(blog.id, "page", 20),
    listPopularBlogPosts(blog.id, 5),
    listBlogCategories(blog.id),
    getOptionalServerUser(),
    getTheme(blog.active_theme_id).catch(() => null),
    listPublicGiftTiers(blog.id).catch(() => []),
  ]);
  const showOwnerToolbar = !!viewer && (viewer.userId === blog.owner_id || viewer.isAdmin || viewer.isModerator);
  const layoutVariant = theme ? resolveLayout(theme) : "classic";
  const tokens = theme?.config ?? DEFAULT_THEME_TOKENS;

  const websiteSchema = generateBlogSchema({
    name: blog.title,
    description: blog.tagline ?? blog.description ?? undefined,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/b/${blog.slug}`,
    image: blog.cover_image_url ?? undefined,
    authorName: blog.owner_display_name || blog.owner_username,
  });

  return (
    <main className="min-h-screen bg-background">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: websiteSchema }} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <BlogNavBar blogSlug={blog.slug} menuConfig={blog.menu_config} showOwnerToolbar={showOwnerToolbar} />
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
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span id="subscribe">
                <SubscribeButton blogSlug={blog.slug} showCount={blog.show_subscriber_count} initialCount={blog.subscriber_count} />
              </span>
              {/* Sitewide gift economy entry point — sending credits/coins to
                  @{blog.owner_username}. Deliberately labeled and styled
                  differently from the blog's OWN reward-tier GiftTiersSection
                  below so the two don't read as the same feature. */}
              <Link
                href={`/blogs/gift/${blog.slug}`}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title={`Send a site gift to @${blog.owner_username}`}
              >
                🎁 Send @{blog.owner_username} a gift
              </Link>
            </div>
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

        <BlogHomeLayout
          blogSlug={blog.slug}
          blogTitle={blog.title}
          layoutVariant={layoutVariant}
          tokens={tokens}
          articles={articles}
          pages={pages}
          popular={popular}
          categories={categories}
        />

        {giftTiers.length > 0 && <GiftTiersSection blogSlug={blog.slug} tiers={giftTiers} />}

        <div className="mt-8">
          <Link href="/blogs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← More blogs
          </Link>
        </div>
      </div>
    </main>
  );
}

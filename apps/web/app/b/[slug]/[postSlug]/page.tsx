/**
 * app/b/[slug]/[postSlug]/page.tsx
 *
 * Public, SSR, crawlable article/page view at /b/<blogSlug>/<postSlug>.
 * Paywalled articles render a truncated preview server-side (SEO-friendly)
 * — see lib/public/resolveBlogPost.ts. Interactive bits (like, comment,
 * subscribe, unlock) hydrate client-side.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePublicBlog } from "@/lib/public/resolveBlog";
import { resolvePublicBlogPost } from "@/lib/public/resolveBlogPost";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { generateArticleSchema } from "@/lib/seo/metadata";
import { formatShortDate } from "@/lib/format/date";
import { getPostTreasury } from "@/lib/blogs/service";
import { PostBody } from "@/components/blogs/PostBody";
import { PostActions } from "@/components/blogs/PostActions";
import { CommentsSection } from "@/components/blogs/CommentsSection";
import { BlogNavBar } from "@/components/blogs/BlogNavBar";
import { getOptionalServerUser } from "@/lib/auth/serverUser";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string; postSlug: string }> }): Promise<Metadata> {
  const { slug, postSlug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  const post = await resolvePublicBlogPost(resolved.blog.id, postSlug).catch(() => null);
  if (!post) return NOT_FOUND_METADATA;

  const title = `${post.title} — ${resolved.blog.title}`;
  const description = post.excerpt ?? `Read "${post.title}" on ${resolved.blog.title}.`;
  const image = post.featured_image_url || resolved.blog.cover_image_url || DEFAULT_OG_IMAGE;
  const ogType = post.type === "page" ? "website" : "article";

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image }], type: ogType, siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    alternates: { canonical: `/b/${slug}/${postSlug}` },
  };
}

export default async function PublicBlogPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; postSlug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug, postSlug } = await params;
  const { preview } = await searchParams;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) notFound();
  const { blog } = resolved;

  const viewer = await getOptionalServerUser();
  const showOwnerToolbar = !!viewer && (viewer.userId === blog.owner_id || viewer.isAdmin || viewer.isModerator);
  // ?preview=1 lets the owner/staff view a draft post as it would appear
  // published — gated server-side, never trusted from the query string
  // alone (a regular visitor requesting ?preview=1 on someone else's blog
  // still gets the normal published-only lookup, i.e. a 404 for a draft).
  const wantsPreview = preview === "1" && showOwnerToolbar;

  const post = await resolvePublicBlogPost(blog.id, postSlug, { allowUnpublished: wantsPreview }).catch(() => null);
  if (!post) notFound();

  const isPage = post.type === "page";
  const isDraft = post.status !== "published";
  const treasury = !isPage ? await getPostTreasury(post.id).catch(() => null) : null;
  const treasuryActive = treasury && treasury.status === "active" && treasury.claimantCount < treasury.maxClaimants;

  const schema = !isPage
    ? generateArticleSchema({
        title: post.title,
        description: post.excerpt ?? post.title,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/b/${slug}/${postSlug}`,
        image: post.featured_image_url ?? blog.cover_image_url ?? undefined,
        datePublished: post.published_at ?? new Date().toISOString(),
        dateModified: post.updated_at ?? post.published_at ?? new Date().toISOString(),
        authorName: post.author_display_name ?? post.author_username ?? undefined,
      })
    : null;

  return (
    <main className="min-h-screen bg-background">
      {schema && (
        // eslint-disable-next-line react/no-danger
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
      )}
      <div className="mx-auto max-w-2xl px-4 py-8">
        <BlogNavBar
          blogSlug={blog.slug}
          menuConfig={blog.menu_config}
          showOwnerToolbar={showOwnerToolbar}
          previewHref={isDraft ? `/b/${blog.slug}/${post.slug}${wantsPreview ? "" : "?preview=1"}` : null}
          previewActive={wantsPreview}
        />
        {isDraft && wantsPreview && (
          <div className="mb-4 rounded-lg border border-dashed border-amber-500/40 bg-amber-950/10 px-3 py-2 text-xs text-amber-400">
            This post is a draft — you&apos;re previewing it as it will appear once published. Visitors can&apos;t see it yet.
          </div>
        )}
        <Link href={`/b/${blog.slug}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← {blog.title}
        </Link>

        {post.featured_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.featured_image_url} alt="" className="my-4 h-56 w-full rounded-2xl object-cover" />
        )}

        <h1 className="mt-4 text-3xl font-bold text-foreground">{post.title}</h1>

        {!isPage && (
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            {post.published_at && <span>{formatShortDate(post.published_at)}</span>}
            {post.category_name && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs">{post.category_name}</span>}
          </div>
        )}

        {treasuryActive && treasury && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            {/* This page renders server-side without an i18n context (see the
               rest of this file's hardcoded English strings) — kept consistent
               rather than introducing a one-off server-i18n path. */}
            🎁 Reward pot: {treasury.rewardPerClaimant} credits each for the next {treasury.maxClaimants - treasury.claimantCount} people who comment or share!
          </div>
        )}

        {!isPage && !blog.hide_author_info && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            {post.author_avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.author_avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-neutral-700" />
            )}
            <div>
              <div className="text-sm font-medium text-foreground">{post.author_display_name ?? post.author_username}</div>
              {post.author_username && <div className="text-xs text-muted-foreground">@{post.author_username}</div>}
            </div>
          </div>
        )}

        <div className="mt-6">
          <PostBody
            blogSlug={blog.slug}
            postSlug={post.slug}
            serverHtml={post.body_html}
            isPaywalled={post.is_paywalled}
            paywallCreditsCost={post.paywall_credits_cost}
          />
        </div>

        {!isPage && (
          <>
            <div className="mt-6 flex items-center gap-2">
              <PostActions blogSlug={blog.slug} postSlug={post.slug} postId={post.id} initialLikeCount={post.like_count} />
              <span className="text-xs text-muted-foreground">👁 {post.view_count} views</span>
            </div>
            <CommentsSection blogSlug={blog.slug} postSlug={post.slug} commentsEnabled={blog.comments_enabled} />
          </>
        )}
      </div>
    </main>
  );
}

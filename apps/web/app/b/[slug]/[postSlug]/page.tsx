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
import { PostBody } from "@/components/blogs/PostBody";
import { PostActions } from "@/components/blogs/PostActions";
import { CommentsSection } from "@/components/blogs/CommentsSection";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; postSlug: string }> }): Promise<Metadata> {
  const { slug, postSlug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  const post = await resolvePublicBlogPost(resolved.blog.id, postSlug).catch(() => null);
  if (!post) return NOT_FOUND_METADATA;

  const title = `${post.title} — ${resolved.blog.title}`;
  const description = post.excerpt ?? `Read "${post.title}" on ${resolved.blog.title}.`;

  return {
    title,
    description,
    openGraph: { title, description, images: post.featured_image_url ? [{ url: post.featured_image_url }] : [], type: "article" },
    twitter: { card: "summary_large_image", title, description, images: post.featured_image_url ? [post.featured_image_url] : [] },
    alternates: { canonical: `/b/${slug}/${postSlug}` },
  };
}

export default async function PublicBlogPostPage({ params }: { params: Promise<{ slug: string; postSlug: string }> }) {
  const { slug, postSlug } = await params;
  const resolved = await resolvePublicBlog(slug).catch(() => null);
  if (!resolved) notFound();
  const post = await resolvePublicBlogPost(resolved.blog.id, postSlug).catch(() => null);
  if (!post) notFound();

  const { blog } = resolved;
  const isPage = post.type === "page";

  const schema = !isPage
    ? generateArticleSchema({
        title: post.title,
        description: post.excerpt ?? post.title,
        url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/b/${slug}/${postSlug}`,
        image: post.featured_image_url ?? undefined,
        datePublished: post.published_at ?? new Date().toISOString(),
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
            {post.published_at && <span>{new Date(post.published_at).toLocaleDateString()}</span>}
            {post.category_name && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs">{post.category_name}</span>}
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

/**
 * app/f/[slug]/page.tsx
 *
 * Public, SSR, crawlable forum thread page — the canonical short URL
 * (zobia.org/f/<thread-title-slug>) for the old-school BB-style forum.
 * Publicly readable; posting a reply/reacting/editing requires sign-in.
 *
 * Post bodies are stored as raw source (plain text or Markdown) and
 * sanitized to HTML here at render time via sanitizeForumPostContent —
 * never rendered from unsanitized client input.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getThreadBySlug, listPostsInThread, incrementThreadViewCount } from "@/lib/bbforum/repo";
import { db } from "@/lib/db";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { sanitizeForumPostContent } from "@/lib/security/htmlSanitizer";
import { ThreadPostsSection } from "@/components/bbforum/ThreadPostsSection";
import type { PostCardData } from "@/components/bbforum/PostCard";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const thread = await getThreadBySlug(slug);
  if (!thread) return { title: "Thread not found — Zobia Forum" };
  const description = thread.title;
  return {
    title: `${thread.title} — Zobia Forum`,
    description,
    alternates: { canonical: `${APP_URL}/f/${thread.slug}` },
    openGraph: { title: thread.title, description, url: `${APP_URL}/f/${thread.slug}`, type: "article" },
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ThreadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const thread = await getThreadBySlug(slug);
  if (!thread) notFound();

  const viewer = await getOptionalServerUser();

  const [posts, boardRows] = await Promise.all([
    listPostsInThread(thread.id, viewer?.userId ?? null),
    db.query<{ slug: string; name: string }>(`SELECT slug, name FROM bb_boards WHERE id = $1`, [thread.board_id]),
  ]);
  const board = boardRows.rows[0] ?? null;

  void incrementThreadViewCount(thread.id).catch(() => {});

  const postCards: PostCardData[] = posts.map((p) => ({
    id: p.id,
    bodyHtml: sanitizeForumPostContent(p.body, p.content_format),
    rawBody: p.body,
    contentFormat: p.content_format,
    imageUrl: p.image_url,
    isOp: p.is_op,
    authorId: p.author_id,
    authorName: p.author_display_name ?? p.author_username ?? "Unknown",
    authorAvatarEmoji: p.author_avatar_emoji ?? "👤",
    createdAt: p.created_at,
    editedAt: p.edited_at,
    reactionCount: p.reaction_count,
    myReaction: p.my_reaction,
    quotedAuthorName: p.quoted_author_display_name ?? p.quoted_author_username ?? null,
    quotedBodySnippet: p.quoted_body ? p.quoted_body.slice(0, 140) : null,
  }));

  const potRemaining = thread.pot_max_claims - thread.pot_claims_count;
  const showPotBanner = thread.pot_max_claims > 0 && !thread.pot_refunded_at;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    url: `${APP_URL}/f/${thread.slug}`,
    datePublished: thread.created_at,
    dateModified: thread.last_reply_at,
    commentCount: thread.reply_count,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CommentAction",
      userInteractionCount: thread.reply_count,
    },
    comment: posts.slice(1, 21).map((p) => ({
      "@type": "Comment",
      text: p.body,
      dateCreated: p.created_at,
      author: { "@type": "Person", name: p.author_display_name ?? p.author_username ?? "Zobia user" },
    })),
  });

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <Link href="/forum" className="hover:underline">Forum</Link>
        <span>/</span>
        {board && <Link href={`/forum/${board.slug}`} className="hover:underline">{board.name}</Link>}
      </div>

      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {thread.is_pinned && <span className="mr-1.5 text-amber-500">📌</span>}
        {thread.is_locked && <span className="mr-1.5 text-neutral-400">🔒</span>}
        {thread.title}
      </h1>
      <p className="mb-3 text-xs text-neutral-400">
        {thread.view_count} views · {thread.reply_count} replies
        {thread.edited_at && <span className="italic"> · edited {timeAgo(thread.edited_at)}</span>}
      </p>

      {showPotBanner && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          💰 This thread is paying <strong>{thread.pot_per_claim_credits} Credits</strong> to each of the first{" "}
          <strong>{thread.pot_max_claims}</strong> repliers.{" "}
          {potRemaining > 0 ? `${potRemaining} spot${potRemaining === 1 ? "" : "s"} left — reply to claim yours!` : "All spots claimed."}
        </div>
      )}

      <ThreadPostsSection
        threadSlug={thread.slug}
        locked={thread.is_locked}
        posts={postCards}
        viewerId={viewer?.userId ?? null}
        isModerator={!!(viewer?.isAdmin || viewer?.isModerator)}
      />
    </div>
  );
}

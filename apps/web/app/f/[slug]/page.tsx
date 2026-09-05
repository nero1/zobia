/**
 * app/f/[slug]/page.tsx
 *
 * Public, SSR, crawlable forum thread page — the canonical short URL
 * (zobia.org/f/<thread-title-slug>) for the old-school BB-style forum.
 * Publicly readable; posting a reply requires sign-in (see ReplyForm).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getThreadBySlug, listPostsInThread, incrementThreadViewCount } from "@/lib/bbforum/repo";
import { db } from "@/lib/db";
import { ReplyForm } from "@/components/bbforum/ReplyForm";

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

  const [posts, boardRows] = await Promise.all([
    listPostsInThread(thread.id),
    db.query<{ slug: string; name: string }>(`SELECT slug, name FROM bb_boards WHERE id = $1`, [thread.board_id]),
  ]);
  const board = boardRows.rows[0] ?? null;

  void incrementThreadViewCount(thread.id).catch(() => {});

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
      <p className="mb-6 text-xs text-neutral-400">{thread.view_count} views · {thread.reply_count} replies</p>

      <div className="space-y-3">
        {posts.map((post, i) => (
          <div key={post.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500">
              <span className="text-base">{post.author_avatar_emoji ?? "👤"}</span>
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">{post.author_display_name ?? post.author_username ?? "Unknown"}</span>
              {i === 0 && <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-300">OP</span>}
              <span>·</span>
              <span>{timeAgo(post.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{post.body}</p>
          </div>
        ))}
      </div>

      <ReplyForm threadSlug={thread.slug} locked={thread.is_locked} />
    </div>
  );
}

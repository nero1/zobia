/**
 * app/forum/[boardSlug]/page.tsx
 *
 * Public, SSR, crawlable thread list for one forum board.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBoardBySlug, listThreadsInBoard } from "@/lib/bbforum/repo";
import { NewThreadForm } from "@/components/bbforum/NewThreadForm";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export async function generateMetadata({ params }: { params: Promise<{ boardSlug: string }> }): Promise<Metadata> {
  const { boardSlug } = await params;
  const board = await getBoardBySlug(boardSlug);
  if (!board) return { title: "Board not found — Zobia Forum" };
  return {
    title: `${board.name} — Zobia Forum`,
    description: board.description ?? `Discussions in ${board.name} on the Zobia community forum.`,
    alternates: { canonical: `${APP_URL}/forum/${board.slug}` },
    openGraph: { title: board.name, description: board.description ?? undefined, url: `${APP_URL}/forum/${board.slug}`, type: "website" },
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

export default async function BoardPage({ params }: { params: Promise<{ boardSlug: string }> }) {
  const { boardSlug } = await params;
  const board = await getBoardBySlug(boardSlug);
  if (!board) notFound();

  const { threads } = await listThreadsInBoard(board.id, 30, null);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/forum" className="hover:underline">Forum</Link>
        <span>/</span>
        <span className="text-neutral-900 dark:text-neutral-100">{board.name}</span>
      </div>
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        <span className="mr-1.5">{board.icon_emoji}</span>{board.name}
      </h1>
      {board.description && <p className="mb-6 text-sm text-neutral-500">{board.description}</p>}

      <NewThreadForm boardSlug={board.slug} />

      {threads.length === 0 ? (
        <p className="text-sm text-neutral-400">No threads yet — be the first to post.</p>
      ) : (
        <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {threads.map((t) => (
            <Link key={t.id} href={`/f/${t.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {t.is_pinned && <span className="mr-1 text-amber-500">📌</span>}
                  {t.is_locked && <span className="mr-1 text-neutral-400">🔒</span>}
                  {t.title}
                </p>
                <p className="text-xs text-neutral-400">{t.reply_count} replies · {t.view_count} views · last reply {timeAgo(t.last_reply_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

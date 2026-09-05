/**
 * app/forum/page.tsx
 *
 * Public, SSR, crawlable home page for the old-school BB-style forum —
 * boards and sub-boards, vBulletin/SMF-style. Distinct from the "Answers"
 * Q&A feature at /answers. Individual threads get short canonical URLs at
 * /f/<slug> (see app/f/[slug]/page.tsx).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { listBoardTree } from "@/lib/bbforum/repo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

export const metadata: Metadata = {
  title: "Forum — Zobia",
  description: "Browse boards and join the discussion on the Zobia community forum.",
  alternates: { canonical: `${APP_URL}/forum` },
  openGraph: {
    title: "Zobia Forum",
    description: "Browse boards and join the discussion on the Zobia community forum.",
    url: `${APP_URL}/forum`,
    type: "website",
  },
};

export default async function ForumHomePage() {
  const boards = await listBoardTree();

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Forum</h1>
      <p className="mb-6 text-sm text-neutral-500">Boards and discussions from the Zobia community.</p>

      {boards.length === 0 ? (
        <p className="text-sm text-neutral-400">No boards yet.</p>
      ) : (
        <div className="space-y-4">
          {boards.map((board) => (
            <div key={board.id} className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <Link
                href={`/forum/${board.slug}`}
                className="flex items-center gap-3 rounded-t-xl px-4 py-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <span className="text-2xl">{board.icon_emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">{board.name}</p>
                  {board.description && <p className="truncate text-xs text-neutral-500">{board.description}</p>}
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-400">
                  <p>{board.thread_count} threads</p>
                  <p>{board.post_count} posts</p>
                </div>
              </Link>
              {board.subBoards.length > 0 && (
                <div className="divide-y divide-neutral-100 border-t border-neutral-100 dark:divide-neutral-800 dark:border-neutral-800">
                  {board.subBoards.map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/forum/${sub.slug}`}
                      className="flex items-center gap-2 px-4 py-2 pl-10 text-sm text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
                    >
                      <span>↳</span>
                      <span>{sub.icon_emoji}</span>
                      <span className="flex-1">{sub.name}</span>
                      <span className="text-xs text-neutral-400">{sub.thread_count} threads</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * apps/android/src/routes/forum/index.tsx
 *
 * Old-school BB-style forum home — mirrors apps/web/app/forum/page.tsx:
 * a flat list of boards, each with its direct sub-boards nested underneath.
 * Distinct from /answers (the Q&A mini-forum).
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface BoardRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  thread_count: number;
  post_count: number;
  subBoards: BoardRow[];
}

function ForumHomePage() {
  const { t } = useTranslation();

  const { data, status, refetch } = useQuery({
    queryKey: ['bbforum', 'boards'],
    queryFn: async () => (await apiClient.get<{ boards: BoardRow[] }>('/forum/boards')).data,
  });

  const boards = data?.boards ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="bg-white px-4 py-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900">{t('bbforum.forum.title')}</h1>
        <p className="text-xs text-neutral-500">{t('bbforum.forum.subtitle')}</p>
      </div>

      {status === 'pending' && (
        <div>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 border-b border-neutral-100 bg-white p-4 animate-pulse" />)}</div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">{t('android.error.retry')}</button>
        </div>
      )}

      {status === 'success' && boards.length === 0 && (
        <p className="p-6 text-center text-sm text-neutral-500">{t('bbforum.forum.noBoards')}</p>
      )}

      <div className="p-3 space-y-3">
        {boards.map((board) => (
          <div key={board.id} className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <Link to="/forum/$boardSlug" params={{ boardSlug: board.slug }} className="flex items-center gap-3 px-4 py-3.5">
              <span className="text-2xl">{board.icon_emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-neutral-900 text-sm">{board.name}</p>
                {board.description && <p className="truncate text-xs text-neutral-500">{board.description}</p>}
              </div>
              <div className="shrink-0 text-right text-xs text-neutral-400">
                <p>{board.thread_count} threads</p>
                <p>{board.post_count} posts</p>
              </div>
            </Link>
            {board.subBoards.length > 0 && (
              <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                {board.subBoards.map((sub) => (
                  <Link key={sub.id} to="/forum/$boardSlug" params={{ boardSlug: sub.slug }} className="flex items-center gap-2 px-4 py-2 pl-10 text-sm text-neutral-600">
                    <span>↳</span>
                    <span>{sub.icon_emoji}</span>
                    <span className="flex-1">{sub.name}</span>
                    <span className="text-xs text-neutral-400">{sub.thread_count}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/forum/')({
  component: ForumHomePage,
});

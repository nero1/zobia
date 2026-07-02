/**
 * apps/android/src/routes/moments/index.tsx
 *
 * Moments feed — mirrors apps/web/app/(app)/moments/page.tsx as closely as
 * possible for UI parity, adapted to this app's infinite-scroll convention
 * (see routes/home.tsx) instead of a manual "Load more" button.
 *
 * GET /api/moments — cursor-paginated, newest first, all users' moments.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useRef, useCallback, useState } from 'react';
import { apiClient } from '@/lib/api/client';

interface ReactionSummary {
  emoji: string;
  count: number;
  userReacted: boolean;
}

interface Moment {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatarEmoji: string;
  content: string;
  imageUrl: string | null;
  caption: string | null;
  reactionsCount: number;
  reactions: ReactionSummary[];
  createdAt: string;
}

interface MomentRow {
  id: string;
  user_id: string;
  username: string;
  avatar_emoji: string;
  content: string;
  media_url: string | null;
  caption: string | null;
  reactions_count: number;
  reactions: ReactionSummary[] | null;
  created_at: string;
}

function mapMoment(row: MomentRow): Moment {
  return {
    id: row.id,
    authorId: row.user_id,
    authorUsername: row.username,
    authorAvatarEmoji: row.avatar_emoji || '👤',
    content: row.content,
    imageUrl: row.media_url,
    caption: row.caption,
    reactionsCount: row.reactions_count ?? 0,
    reactions: row.reactions ?? [],
    createdAt: row.created_at,
  };
}

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '😮', '👏', '💯'];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function fetchMomentsPage({ pageParam }: { pageParam?: string }) {
  const params = new URLSearchParams({ limit: '20' });
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<{ moments: MomentRow[]; nextCursor: string | null }>(`/moments?${params}`);
  return {
    items: (data?.moments ?? []).map(mapMoment),
    nextCursor: data?.nextCursor ?? null,
  };
}

function MomentSkeleton() {
  return (
    <div className="bg-white border-b border-neutral-100 p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-neutral-200" />
        <div className="flex-1">
          <div className="h-4 bg-neutral-200 rounded w-24 mb-1" />
          <div className="h-3 bg-neutral-100 rounded w-16" />
        </div>
      </div>
      <div className="h-4 bg-neutral-200 rounded w-full mb-2" />
      <div className="h-4 bg-neutral-100 rounded w-3/4" />
    </div>
  );
}

function MomentCard({ moment, onReact }: { moment: Moment; onReact: (id: string, emoji: string) => void }) {
  const { t } = useTranslation();
  const [showReactions, setShowReactions] = useState(false);

  return (
    <article className="bg-white border-b border-neutral-100 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg">
          {moment.authorAvatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <Link to="/profile/$username" params={{ username: moment.authorUsername }} className="font-semibold text-neutral-900 text-sm">
            @{moment.authorUsername}
          </Link>
          <p className="text-neutral-400 text-xs">{timeAgo(moment.createdAt)} ago</p>
        </div>
      </div>

      <p className="text-neutral-800 text-sm leading-relaxed whitespace-pre-line">{moment.content}</p>

      {/* Optional image — capped at 300x300, lazy-loaded */}
      {moment.imageUrl && (
        <div className="mt-3 h-[300px] w-[300px] max-w-full overflow-hidden rounded-xl border border-neutral-200">
          <img
            src={moment.imageUrl}
            alt={moment.caption ?? 'Moment image'}
            width={300}
            height={300}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}
      {moment.caption && <p className="mt-2 text-xs text-neutral-500">{moment.caption}</p>}

      {moment.reactions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {moment.reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => onReact(moment.id, r.emoji)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                r.userReacted ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-neutral-50 text-neutral-600'
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setShowReactions((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600"
          >
            <span>😊</span>
            <span>{t('moments.react')}</span>
          </button>
          {showReactions && (
            <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { onReact(moment.id, emoji); setShowReactions(false); }}
                  className="rounded-lg p-1.5 text-lg active:bg-neutral-100"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-neutral-400">
          {moment.reactionsCount} {moment.reactionsCount === 1 ? t('moments.reaction') : t('moments.reactions')}
        </span>
      </div>
    </article>
  );
}

function MomentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['moments', 'feed'],
    queryFn: fetchMomentsPage,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const react = useMutation({
    mutationFn: ({ momentId, emoji }: { momentId: string; emoji: string }) =>
      apiClient.post<{ reactions: ReactionSummary[] }>(`/moments/${momentId}/reactions`, { emoji }),
    onSuccess: (res, { momentId }) => {
      const reactions = res.data?.reactions ?? [];
      qc.setQueryData<typeof data>(['moments', 'feed'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((m) =>
              m.id === momentId
                ? { ...m, reactions, reactionsCount: reactions.reduce((s, r) => s + r.count, 0) }
                : m
            ),
          })),
        };
      });
    },
  });

  const handleReact = useCallback(
    (momentId: string, emoji: string) => react.mutate({ momentId, emoji }),
    [react]
  );

  const observer = useRef<IntersectionObserver | null>(null);
  const loaderRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observer.current) observer.current.disconnect();
      if (node) {
        observer.current = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting && hasNextPage) {
            fetchNextPage();
          }
        });
        observer.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  const moments = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="flex items-center justify-between bg-white px-4 py-3 border-b border-neutral-100">
        <div>
          <h1 className="text-lg font-bold text-neutral-900">{t('moments.title')}</h1>
          <p className="text-xs text-neutral-500">{t('moments.subtitle')}</p>
        </div>
        <Link to="/moments/create" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
          + {t('moments.share')}
        </Link>
      </div>

      {status === 'pending' && (
        <div>{Array.from({ length: 4 }).map((_, i) => <MomentSkeleton key={i} />)}</div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && moments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl">🎬</div>
          <p className="font-semibold text-neutral-900 text-sm">{t('moments.empty')}</p>
          <p className="mt-1 text-xs text-neutral-500">{t('moments.emptyHint')}</p>
          <Link to="/moments/create" className="mt-4 rounded-xl bg-primary-600 px-5 py-2 text-sm font-semibold text-white">
            {t('moments.share')}
          </Link>
        </div>
      )}

      {moments.map((moment) => (
        <MomentCard key={moment.id} moment={moment} onReact={handleReact} />
      ))}

      <div ref={loaderRef} className="py-4">
        {isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/moments/')({
  component: MomentsPage,
});

/**
 * apps/android/src/routes/answers/index.tsx
 *
 * Zobia Answers (mini forum / Q&A) — mirrors apps/web/app/(app)/answers/page.tsx
 * as closely as possible for UI parity (unlike Rooms, this feature should
 * match mobile web/PWA closely per product requirements). Uses this app's
 * infinite-scroll convention instead of a manual "Load more" button.
 *
 * GET /api/answers/questions — cursor-paginated, tab-filtered.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useForumConfig } from '@/lib/hooks/useForumConfig';

type Tab = 'popular' | 'trending' | 'new' | 'favorites';

interface Author {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface QuestionSummary {
  id: string;
  title: string;
  body: string;
  author: Author;
  voteScore: number;
  answerCount: number;
  favoriteCount: number;
  isLocked: boolean;
  bestAnswerId: string | null;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isFavorited: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function fetchQuestionsPage({ pageParam, tab }: { pageParam?: string; tab: Tab }) {
  const params = new URLSearchParams({ tab, limit: '20' });
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<{ data: { questions: QuestionSummary[]; nextCursor: string | null } }>(`/answers/questions?${params}`);
  return { items: data?.data?.questions ?? [], nextCursor: data?.data?.nextCursor ?? null };
}

function QuestionCard({ q, onVote, onFavorite }: { q: QuestionSummary; onVote: (id: string, value: 1 | -1) => void; onFavorite: (id: string, next: boolean) => void }) {
  return (
    <div className="flex gap-3 bg-white border-b border-neutral-100 p-4">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <button onClick={() => onVote(q.id, 1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${q.myVote === 1 ? 'bg-primary-100 text-primary-700' : 'text-neutral-400'}`}>▲</button>
        <span className="text-sm font-semibold tabular-nums text-neutral-700">{q.voteScore}</span>
        <button onClick={() => onVote(q.id, -1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${q.myVote === -1 ? 'bg-red-100 text-red-700' : 'text-neutral-400'}`}>▼</button>
      </div>
      <div className="min-w-0 flex-1">
        <Link to="/answers/$questionId" params={{ questionId: q.id }} className="block">
          <h3 className="line-clamp-2 text-sm font-semibold text-neutral-900">
            {q.title}
            {q.isLocked && <span className="ml-1.5 text-xs text-neutral-400">🔒</span>}
            {q.bestAnswerId && <span className="ml-1.5 text-xs text-teal-600">✓ answered</span>}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{q.body}</p>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>@{q.author.username ?? 'unknown'}</span>
          <span>·</span>
          <span>{timeAgo(q.createdAt)}</span>
          <span>·</span>
          <span>{q.answerCount} {q.answerCount === 1 ? 'answer' : 'answers'}</span>
          <button onClick={() => onFavorite(q.id, !q.isFavorited)} className={`ml-auto rounded-full px-1.5 py-0.5 ${q.isFavorited ? 'text-amber-500' : 'text-neutral-300'}`}>
            {q.isFavorited ? '★' : '☆'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnswersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const forumConfig = useForumConfig();
  const [tab, setTab] = useState<Tab>('new');

  const queryKey = ['answers', 'questions', tab];

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, refetch } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchQuestionsPage({ pageParam, tab }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | -1 }) =>
      apiClient.post<{ data: { voteScore: number; myVote: -1 | 0 | 1 } }>(`/answers/questions/${id}/vote`, { value }),
    onSuccess: (res, { id }) => {
      qc.setQueryData<typeof data>(queryKey, (prev) => {
        if (!prev) return prev;
        return { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.map((q) => (q.id === id ? { ...q, voteScore: res.data?.data?.voteScore ?? q.voteScore, myVote: res.data?.data?.myVote ?? q.myVote } : q)) })) };
      });
    },
  });

  const favorite = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? apiClient.post(`/answers/questions/${id}/favorite`, {}) : apiClient.delete(`/answers/questions/${id}/favorite`),
    onSuccess: (_res, { id, next }) => {
      qc.setQueryData<typeof data>(queryKey, (prev) => {
        if (!prev) return prev;
        return { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.map((q) => (q.id === id ? { ...q, isFavorited: next } : q)) })) };
      });
    },
  });

  const observer = useRef<IntersectionObserver | null>(null);
  const loaderRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observer.current) observer.current.disconnect();
      if (node) {
        observer.current = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting && hasNextPage) fetchNextPage();
        });
        observer.current.observe(node);
      }
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage],
  );

  const questions = data?.pages.flatMap((p) => p.items) ?? [];
  const myLevel = (user as { rank_level?: number } | null)?.rank_level;
  const canPost = myLevel == null || myLevel >= forumConfig.minLevelToPost;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'popular', label: t('answers.tabs.popular'), icon: '🔥' },
    { key: 'trending', label: t('answers.tabs.trending'), icon: '📈' },
    { key: 'new', label: t('answers.tabs.new'), icon: '🆕' },
    { key: 'favorites', label: t('answers.tabs.favorites'), icon: '★' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="flex items-center justify-between bg-white px-4 py-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900">{t('answers.title')}</h1>
        {canPost ? (
          <Link to="/answers/ask" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
            + {t('answers.ask.cta')}
          </Link>
        ) : (
          <span className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-400">
            {t('answers.ask.levelTooLowShort', { level: forumConfig.minLevelToPost })}
          </span>
        )}
      </div>

      <div className="flex gap-1 bg-white px-3 py-2 border-b border-neutral-100">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${tab === key ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {status === 'pending' && (
        <div>{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 border-b border-neutral-100 bg-white p-4 animate-pulse" />)}</div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">{t('android.error.retry')}</button>
        </div>
      )}

      {status === 'success' && questions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl">❓</div>
          <p className="font-semibold text-neutral-900 text-sm">
            {tab === 'favorites' ? t('answers.empty.favorites') : t('answers.empty.default')}
          </p>
        </div>
      )}

      {questions.map((q) => (
        <QuestionCard key={q.id} q={q} onVote={(id, value) => vote.mutate({ id, value })} onFavorite={(id, next) => favorite.mutate({ id, next })} />
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

export const Route = createFileRoute('/answers/')({
  component: AnswersPage,
});

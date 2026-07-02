/**
 * apps/android/src/routes/community-notes.tsx
 *
 * Community Notes — mirrors apps/web/app/(app)/community-notes/page.tsx.
 * Global, cursor-paginated feed of crowdsourced notes with helpful/
 * unhelpful voting.
 *
 * CONTRACT FIX (see report): GET /api/community-notes required
 * targetType+targetId query params — the web page's "browse everything"
 * feed always 400'd. It now also supports a global feed (no target
 * filter, status + cursor instead) — see apps/web/app/api/community-notes/
 * route.ts. The vote endpoint's schema is { helpful: boolean }, not
 * { vote: "helpful"|"unhelpful" }.
 *
 * KNOWN GAP (not fixed, same as web): POST /api/community-notes requires
 * a specific { targetType, targetId } to attach the note to — there's no
 * target-picker UI anywhere in the product, so "submit a note" isn't
 * wired up here. This screen is read + vote only.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

type NoteStatus = 'needs_review' | 'shown' | 'hidden';

interface CommunityNoteRow {
  id: string;
  target_type: string;
  target_id: string;
  author_id: string;
  author_username: string;
  author_avatar_emoji: string;
  content: string;
  helpful_votes: number;
  unhelpful_votes: number;
  status: NoteStatus;
  created_at: string;
  user_helpful: boolean | null;
}

interface NotesPage {
  items: CommunityNoteRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

type FilterStatus = 'all' | NoteStatus;

const STATUS_BADGE: Record<NoteStatus, string> = {
  shown: 'bg-teal-100 text-teal-700',
  hidden: 'bg-danger-100 text-danger-700',
  needs_review: 'bg-amber-100 text-amber-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

async function fetchNotes({ pageParam, status }: { pageParam?: string; status: FilterStatus }): Promise<NotesPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (status !== 'all') params.set('status', status);
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<NotesPage>(`/community-notes?${params.toString()}`);
  return data;
}

async function voteNote(input: { noteId: string; helpful: boolean }) {
  const { data } = await apiClient.post<{ helpfulVotes: number; unhelpfulVotes: number; helpful: boolean; status: NoteStatus }>(
    `/community-notes/${input.noteId}/vote`,
    { helpful: input.helpful }
  );
  return data;
}

function CommunityNotesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [votingId, setVotingId] = useState<string | null>(null);

  const { data, status, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = useInfiniteQuery({
    queryKey: ['community-notes', filter],
    queryFn: ({ pageParam }) => fetchNotes({ pageParam, status: filter }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const notes = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleVote(noteId: string, helpful: boolean) {
    setVotingId(noteId);
    try {
      const result = await voteNote({ noteId, helpful });
      qc.setQueryData<{ pages: NotesPage[]; pageParams: unknown[] } | undefined>(['community-notes', filter], (prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((p) => ({
                ...p,
                items: p.items.map((n) =>
                  n.id === noteId
                    ? { ...n, helpful_votes: result.helpfulVotes, unhelpful_votes: result.unhelpfulVotes, status: result.status, user_helpful: result.helpful }
                    : n
                ),
              })),
            }
          : prev
      );
    } catch {
      // fail silently, matches web behavior
    } finally {
      setVotingId(null);
    }
  }

  const FILTERS: { label: string; value: FilterStatus }[] = [
    { label: t('communityNotes.filterAll'), value: 'all' },
    { label: t('communityNotes.filterPending'), value: 'needs_review' },
    { label: t('communityNotes.filterVisible'), value: 'shown' },
    { label: t('communityNotes.filterRemoved'), value: 'hidden' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{t('communityNotes.title')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('communityNotes.subtitle')}</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f.value ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {status === 'pending' ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-neutral-100 bg-white" />
          ))}
        </div>
      ) : status === 'error' ? (
        <div className="py-12 text-center">
          <p className="text-danger-600 text-sm font-medium">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="mt-3 text-sm text-primary-600">
            {t('communityNotes.tryAgain')}
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-4xl mb-3">📝</p>
          <p className="font-semibold text-neutral-700">{t('communityNotes.noNotes')}</p>
          <p className="mt-1 text-sm text-neutral-500">{t('communityNotes.noNotesHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => {
            const net = note.helpful_votes - note.unhelpful_votes;
            return (
              <div key={note.id} className="rounded-xl border border-neutral-100 bg-white p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-base">
                    {note.author_avatar_emoji || '👤'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-neutral-900">@{note.author_username}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[note.status]}`}>
                        {note.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs text-neutral-400">{timeAgo(note.created_at)}</span>
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${net > 0 ? 'text-success-600' : net < 0 ? 'text-danger-500' : 'text-neutral-400'}`}>
                    {net > 0 ? '+' : ''}{net}
                  </span>
                </div>

                <p className="text-sm text-neutral-700 leading-relaxed">{note.content}</p>

                {note.status !== 'hidden' && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleVote(note.id, true)}
                      disabled={votingId === note.id}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        note.user_helpful === true ? 'bg-success-100 text-success-700' : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      👍 {t('communityNotes.helpful', { count: note.helpful_votes })}
                    </button>
                    <button
                      onClick={() => handleVote(note.id, false)}
                      disabled={votingId === note.id}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        note.user_helpful === false ? 'bg-danger-100 text-danger-700' : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      👎 {t('communityNotes.notHelpful', { count: note.unhelpful_votes })}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {hasNextPage && (
            <div className="flex justify-center py-2">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-neutral-300 px-5 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
              >
                {isFetchingNextPage ? t('communityNotes.loading') : t('communityNotes.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/community-notes')({
  component: CommunityNotesPage,
});

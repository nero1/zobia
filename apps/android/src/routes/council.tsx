/**
 * apps/android/src/routes/council.tsx
 *
 * Platform Council — mirrors apps/web/app/(app)/council/page.tsx (member
 * list + community ideas with upvoting). GET /api/council and
 * GET /api/council/ideas.
 *
 * CONTRACT FIX (see report): both endpoints wrap their payload in
 * {success,data,error} but the web page used to read fields off the raw
 * response, and GET /api/council selected a nonexistent `avatar_url`
 * column instead of `avatar_emoji`. GET /api/council/ideas also didn't
 * join the author's username or report the caller's own vote — both were
 * added server-side (apps/web/app/api/council/ideas/route.ts). The vote
 * endpoint only supports a single upvote counter (no downvotes in the
 * schema), so this mirrors that — one "helpful" style upvote, no down.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface CouncilMember {
  userId: string;
  username: string;
  avatarEmoji: string;
  rank: number;
  legacyScore: number;
}

interface CouncilMemberRow {
  user_id: string;
  username: string;
  avatar_emoji: string;
  rank: number;
  legacy_score: number;
}

function mapMember(row: CouncilMemberRow): CouncilMember {
  return { userId: row.user_id, username: row.username, avatarEmoji: row.avatar_emoji, rank: row.rank, legacyScore: row.legacy_score };
}

interface CouncilIdea {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorUsername: string;
  votes: number;
  status: 'open' | 'under_review' | 'accepted' | 'rejected';
  createdAt: string;
  hasVoted: boolean;
}

interface CouncilIdeaRow {
  id: string;
  author_id: string;
  author_username: string;
  title: string;
  description: string;
  votes: number;
  status: string;
  created_at: string;
  has_voted: boolean;
}

function mapIdea(row: CouncilIdeaRow): CouncilIdea {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    authorId: row.author_id,
    authorUsername: row.author_username,
    votes: row.votes,
    status: (row.status as CouncilIdea['status']) ?? 'open',
    createdAt: row.created_at,
    hasVoted: row.has_voted,
  };
}

const IDEA_STATUS: Record<string, string> = {
  open: 'bg-neutral-100 text-neutral-600',
  under_review: 'bg-blue-100 text-blue-700',
  accepted: 'bg-teal-100 text-teal-700',
  rejected: 'bg-danger-100 text-danger-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

async function fetchMembers(): Promise<CouncilMember[]> {
  const { data } = await apiClient.get<{ data: { members: CouncilMemberRow[] } }>('/council');
  return data.data.members.map(mapMember);
}

async function fetchIdeas(): Promise<CouncilIdea[]> {
  const { data } = await apiClient.get<{ data: { ideas: CouncilIdeaRow[] } }>('/council/ideas');
  return data.data.ideas.map(mapIdea);
}

async function voteIdea(ideaId: string) {
  await apiClient.post(`/council/ideas/${ideaId}/vote`);
}

async function submitIdea(input: { title: string; description: string }) {
  const { data } = await apiClient.post<{ data: { idea: CouncilIdeaRow } }>('/council/ideas', input);
  return mapIdea(data.data.idea);
}

function IdeaCard({ idea, canVote, onVote, voting }: { idea: CouncilIdea; canVote: boolean; onVote: (id: string) => void; voting: boolean }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-neutral-900">{idea.title}</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${IDEA_STATUS[idea.status] ?? IDEA_STATUS.open}`}>
          {idea.status.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral-600 line-clamp-3">{idea.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <Link to="/profile/$username" params={{ username: idea.authorUsername }} className="font-medium text-primary-600">
            @{idea.authorUsername}
          </Link>
          <span>·</span>
          <span>{timeAgo(idea.createdAt)}</span>
        </div>
        <button
          onClick={() => canVote && !idea.hasVoted && onVote(idea.id)}
          disabled={!canVote || voting || idea.hasVoted}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            idea.hasVoted ? 'bg-teal-100 text-teal-700' : 'bg-neutral-100 text-neutral-600'
          }`}
        >
          ▲ {idea.votes}
        </button>
      </div>
    </div>
  );
}

function CouncilPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [votingId, setVotingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: members, status: membersStatus } = useQuery({ queryKey: ['council', 'members'], queryFn: fetchMembers });
  const { data: ideas, status: ideasStatus } = useQuery({ queryKey: ['council', 'ideas'], queryFn: fetchIdeas });

  const isCouncilMember = !!user?.id && (members ?? []).some((m) => m.userId === user.id);

  const voteMutation = useMutation({
    mutationFn: voteIdea,
    onMutate: (ideaId) => setVotingId(ideaId),
    onSettled: () => setVotingId(null),
    onSuccess: (_data, ideaId) => {
      qc.setQueryData<CouncilIdea[] | undefined>(['council', 'ideas'], (prev) =>
        prev?.map((i) => (i.id === ideaId ? { ...i, votes: i.votes + 1, hasVoted: true } : i))
      );
    },
  });

  const submitMutation = useMutation({
    mutationFn: submitIdea,
    onSuccess: (idea) => {
      qc.setQueryData<CouncilIdea[] | undefined>(['council', 'ideas'], (prev) => [idea, ...(prev ?? [])]);
      setTitle('');
      setDescription('');
      setShowForm(false);
      setFormError(null);
    },
    onError: () => setFormError(t('error.generic')),
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{t('council.title')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('council.subtitle')}</p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('council.membersSection')}</h2>
        <div className="rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
          {membersStatus === 'pending' ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-3">
                <div className="h-8 w-8 rounded-full bg-neutral-200" />
                <div className="h-3 flex-1 rounded bg-neutral-200" />
              </div>
            ))
          ) : (members ?? []).length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">{t('council.noMembers')}</div>
          ) : (
            (members ?? []).map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-center text-sm font-bold text-neutral-400">#{m.rank}</span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">{m.avatarEmoji}</span>
                <Link to="/profile/$username" params={{ username: m.username }} className="flex-1 text-sm font-semibold text-neutral-900">
                  @{m.username}
                </Link>
                <span className="text-sm font-bold text-amber-600">{m.legacyScore.toLocaleString()} ⚜️</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('council.ideasSection')}</h2>
          {isCouncilMember && !showForm && (
            <button onClick={() => setShowForm(true)} className="rounded-xl bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white">
              + {t('council.submitIdea')}
            </button>
          )}
        </div>

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitMutation.mutate({ title: title.trim(), description: description.trim() });
            }}
            className="mb-4 rounded-2xl border border-primary-200 bg-primary-50 p-4"
          >
            <h3 className="mb-3 font-semibold text-neutral-900">{t('council.newIdea')}</h3>
            {formError && <p className="mb-3 text-sm text-danger-600">{formError}</p>}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('council.ideaTitlePlaceholder')}
              required
              maxLength={120}
              className="mb-3 w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:outline-none"
              data-selectable
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('council.ideaDescPlaceholder')}
              required
              rows={3}
              maxLength={1000}
              className="mb-3 w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:outline-none"
              data-selectable
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700">
                {t('council.cancel')}
              </button>
              <button type="submit" disabled={submitMutation.isPending} className="flex-1 rounded-xl bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {submitMutation.isPending ? t('council.submitting') : t('council.submit')}
              </button>
            </div>
          </form>
        )}

        <div className="space-y-3">
          {ideasStatus === 'pending' ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-neutral-200 bg-white" />)
          ) : (ideas ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white py-16">
              <span className="text-4xl">💡</span>
              <p className="mt-3 font-semibold text-neutral-700">{t('council.noIdeas')}</p>
              <p className="mt-1 text-sm text-neutral-500">{t('council.noIdeasHint')}</p>
            </div>
          ) : (
            (ideas ?? []).map((idea) => (
              <IdeaCard key={idea.id} idea={idea} canVote={isCouncilMember} onVote={(id) => voteMutation.mutate(id)} voting={votingId === idea.id} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export const Route = createFileRoute('/council')({
  component: CouncilPage,
});

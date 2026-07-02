/**
 * apps/android/src/routes/answers/$questionId.tsx
 *
 * Zobia Answers question detail — mirrors apps/web/app/(app)/answers/[id]/page.tsx:
 * threaded (nested, indented) answers, upvote/downvote, "Mark as best answer",
 * inline reply composer with the level-gate/credit-bypass prompt, and
 * "Continue this thread" lazy-loading for deep reply chains.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

interface Author {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface QuestionDetail {
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
  isAuthor: boolean;
}

interface AnswerNode {
  id: string;
  questionId: string;
  parentAnswerId: string | null;
  depth: number;
  body: string;
  author: Author;
  voteScore: number;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isBestAnswer: boolean;
  replies: AnswerNode[];
  replyCount: number;
}

const MAX_VISUAL_DEPTH = 5;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function buildTreeFromFlat(flat: AnswerNode[], rootId: string): AnswerNode[] {
  const byParent = new Map<string, AnswerNode[]>();
  for (const node of flat) {
    if (node.id === rootId) continue;
    const key = node.parentAnswerId ?? '';
    const list = byParent.get(key) ?? [];
    list.push({ ...node, replies: [] });
    byParent.set(key, list);
  }
  function attach(nodes: AnswerNode[]): AnswerNode[] {
    return nodes.map((n) => {
      const children = byParent.get(n.id) ?? [];
      return { ...n, replies: attach(children), replyCount: children.length };
    });
  }
  return attach(byParent.get(rootId) ?? []);
}

function updateNodeInTree(nodes: AnswerNode[], id: string, updater: (n: AnswerNode) => AnswerNode): AnswerNode[] {
  return nodes.map((n) => {
    if (n.id === id) return updater(n);
    if (n.replies.length > 0) return { ...n, replies: updateNodeInTree(n.replies, id, updater) };
    return n;
  });
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; params?: { minLevel?: number; bypassCostCredits?: number } };
}

function QuestionDetailPage() {
  const { questionId } = Route.useParams();
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();

  const [sort, setSort] = useState<'best' | 'new'>('best');
  const [newAnswerBody, setNewAnswerBody] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [bypassPrompt, setBypassPrompt] = useState<{ minLevel: number; bypassCostCredits: number; parentAnswerId: string | null; body: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const questionQuery = useQuery({
    queryKey: ['answers', 'question', questionId],
    queryFn: async () => (await apiClient.get<{ data: QuestionDetail }>(`/answers/questions/${questionId}`)).data.data,
  });

  const answersQuery = useQuery({
    queryKey: ['answers', 'answers', questionId, sort],
    queryFn: async () => (await apiClient.get<{ data: { answers: AnswerNode[] } }>(`/answers/questions/${questionId}/answers?sort=${sort}&limit=25`)).data.data,
  });

  const voteQuestion = useMutation({
    mutationFn: (value: 1 | -1) => apiClient.post<{ data: { voteScore: number; myVote: -1 | 0 | 1 } }>(`/answers/questions/${questionId}/vote`, { value }),
    onSuccess: (res) => {
      qc.setQueryData<QuestionDetail>(['answers', 'question', questionId], (prev) => (prev ? { ...prev, voteScore: res.data.data.voteScore, myVote: res.data.data.myVote } : prev));
    },
  });

  const favoriteQuestion = useMutation({
    mutationFn: (next: boolean) => (next ? apiClient.post(`/answers/questions/${questionId}/favorite`, {}) : apiClient.delete(`/answers/questions/${questionId}/favorite`)),
    onSuccess: (_res, next) => {
      qc.setQueryData<QuestionDetail>(['answers', 'question', questionId], (prev) => (prev ? { ...prev, isFavorited: next, favoriteCount: prev.favoriteCount + (next ? 1 : -1) } : prev));
    },
  });

  const voteAnswer = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 1 | -1 }) => apiClient.post<{ data: { voteScore: number; myVote: -1 | 0 | 1 } }>(`/answers/questions/${questionId}/answers/${id}/vote`, { value }),
    onSuccess: (res, { id }) => {
      qc.setQueryData<{ answers: AnswerNode[] }>(['answers', 'answers', questionId, sort], (prev) => {
        if (!prev) return prev;
        return { answers: updateNodeInTree(prev.answers, id, (n) => ({ ...n, voteScore: res.data.data.voteScore, myVote: res.data.data.myVote })) };
      });
    },
  });

  const markBest = useMutation({
    mutationFn: (answerId: string) => apiClient.post(`/answers/questions/${questionId}/best-answer`, { answerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['answers', 'question', questionId] });
      qc.invalidateQueries({ queryKey: ['answers', 'answers', questionId] });
    },
  });

  const submitAnswer = useMutation({
    mutationFn: ({ body, parentAnswerId, payBypass }: { body: string; parentAnswerId: string | null; payBypass?: boolean }) =>
      apiClient.post('/answers/questions/' + questionId + '/answers', { body, parentAnswerId, payBypass }),
    onSuccess: () => {
      setNewAnswerBody('');
      setReplyBody('');
      setReplyingTo(null);
      setBypassPrompt(null);
      qc.invalidateQueries({ queryKey: ['answers', 'answers', questionId] });
      qc.invalidateQueries({ queryKey: ['answers', 'question', questionId] });
    },
    onError: (err, vars) => {
      if (isAxiosError<ApiErrorBody>(err)) {
        const code = err.response?.data?.error?.code;
        const params = err.response?.data?.error?.params;
        if ((code === 'FORUM_COMMENT_LEVEL_TOO_LOW' || code === 'INSUFFICIENT_FORUM_COMMENT_FUNDS') && params) {
          setBypassPrompt({ minLevel: params.minLevel ?? 1, bypassCostCredits: params.bypassCostCredits ?? 1, parentAnswerId: vars.parentAnswerId, body: vars.body });
          return;
        }
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  const handleExpandThread = useCallback(async (answerId: string) => {
    setExpandingId(answerId);
    try {
      const { data } = await apiClient.get<{ data: { thread: AnswerNode[] } }>(`/answers/questions/${questionId}/answers/${answerId}/thread`);
      const tree = buildTreeFromFlat(data.data.thread, answerId);
      qc.setQueryData<{ answers: AnswerNode[] }>(['answers', 'answers', questionId, sort], (prev) => {
        if (!prev) return prev;
        return { answers: updateNodeInTree(prev.answers, answerId, (n) => ({ ...n, replies: tree })) };
      });
    } finally {
      setExpandingId(null);
    }
  }, [questionId, sort, qc]);

  const question = questionQuery.data;
  const answers = answersQuery.data?.answers ?? [];
  const currencyName = bypassPrompt?.bypassCostCredits === 1 ? currency.softSingular : currency.softPlural;

  function AnswerNodeView({ node }: { node: AnswerNode }) {
    const showMoreCount = node.replyCount - node.replies.length;
    return (
      <div className={node.depth > 0 ? 'mt-2 border-l-2 border-neutral-200 pl-2' : 'mt-2'} style={{ marginLeft: Math.min(node.depth, MAX_VISUAL_DEPTH) > 0 && node.depth === 0 ? 0 : undefined }}>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-700">@{node.author.username ?? 'unknown'}</span>
            <span>·</span>
            <span>{timeAgo(node.createdAt)}</span>
            {node.isBestAnswer && <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-700">✓ Best</span>}
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-800">{node.body}</p>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button onClick={() => voteAnswer.mutate({ id: node.id, value: 1 })} className={`rounded px-1.5 py-0.5 ${node.myVote === 1 ? 'bg-primary-100 text-primary-700' : 'text-neutral-400'}`}>▲</button>
            <span className="font-semibold tabular-nums text-neutral-600">{node.voteScore}</span>
            <button onClick={() => voteAnswer.mutate({ id: node.id, value: -1 })} className={`rounded px-1.5 py-0.5 ${node.myVote === -1 ? 'bg-red-100 text-red-700' : 'text-neutral-400'}`}>▼</button>
            <button onClick={() => setReplyingTo(replyingTo === node.id ? null : node.id)} className="font-semibold text-neutral-500">{t('answers.reply')}</button>
            {question?.isAuthor && !question.bestAnswerId && (
              <button onClick={() => markBest.mutate(node.id)} className="font-semibold text-teal-600">{t('answers.markBest')}</button>
            )}
          </div>

          {replyingTo === node.id && (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value.slice(0, 3000))}
                rows={3}
                placeholder={t('answers.replyPlaceholder')}
                className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={() => setReplyingTo(null)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600">{t('answers.ask.cancel')}</button>
                <button
                  disabled={!replyBody.trim() || submitAnswer.isPending}
                  onClick={() => submitAnswer.mutate({ body: replyBody.trim(), parentAnswerId: node.id })}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t('answers.postReply')}
                </button>
              </div>
            </div>
          )}
        </div>

        {node.replies.map((child) => <AnswerNodeView key={child.id} node={child} />)}

        {showMoreCount > 0 && (
          <button onClick={() => handleExpandThread(node.id)} disabled={expandingId === node.id} className="mt-2 ml-2 text-xs font-semibold text-primary-600 disabled:opacity-50">
            {expandingId === node.id ? t('answers.loadingMore') : t('answers.viewMoreReplies', { count: showMoreCount })}
          </button>
        )}
      </div>
    );
  }

  if (questionQuery.isPending) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  }

  if (!question) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center">
        <p className="text-sm text-neutral-500">{t('answers.detail.notFound')}</p>
        <Link to="/answers" className="mt-3 inline-block text-sm font-semibold text-primary-600">← {t('answers.title')}</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex gap-3">
          <div className="flex flex-col items-center gap-1 pt-0.5">
            <button onClick={() => voteQuestion.mutate(1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${question.myVote === 1 ? 'bg-primary-100 text-primary-700' : 'text-neutral-400'}`}>▲</button>
            <span className="text-sm font-semibold tabular-nums text-neutral-700">{question.voteScore}</span>
            <button onClick={() => voteQuestion.mutate(-1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${question.myVote === -1 ? 'bg-red-100 text-red-700' : 'text-neutral-400'}`}>▼</button>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-neutral-900">
              {question.title}
              {question.isLocked && <span className="ml-2 text-sm text-neutral-400">🔒</span>}
            </h1>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{question.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>@{question.author.username ?? 'unknown'}</span>
              <span>·</span>
              <span>{timeAgo(question.createdAt)}</span>
              <button onClick={() => favoriteQuestion.mutate(!question.isFavorited)} className={`ml-auto rounded-full px-1.5 py-0.5 ${question.isFavorited ? 'text-amber-500' : 'text-neutral-300'}`}>
                {question.isFavorited ? '★' : '☆'} {question.favoriteCount}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!question.isLocked && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <textarea
            value={newAnswerBody}
            onChange={(e) => setNewAnswerBody(e.target.value.slice(0, 5000))}
            rows={4}
            placeholder={t('answers.answerPlaceholder')}
            className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              disabled={!newAnswerBody.trim() || submitAnswer.isPending}
              onClick={() => submitAnswer.mutate({ body: newAnswerBody.trim(), parentAnswerId: null })}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitAnswer.isPending ? t('answers.ask.posting') : t('answers.postAnswer')}
            </button>
          </div>
        </div>
      )}

      {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">
          {question.answerCount} {question.answerCount === 1 ? t('answers.answer') : t('answers.answers')}
        </h2>
        <div className="flex gap-1 text-xs">
          {(['best', 'new'] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={`rounded-lg px-2.5 py-1 font-semibold ${sort === s ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}>
              {s === 'best' ? t('answers.sortBest') : t('answers.sortNew')}
            </button>
          ))}
        </div>
      </div>

      {answersQuery.isPending ? (
        <div className="h-16 rounded bg-neutral-200 animate-pulse" />
      ) : answers.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('answers.noAnswers')}</p>
      ) : (
        answers.map((a) => <AnswerNodeView key={a.id} node={a} />)
      )}

      {bypassPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBypassPrompt(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setBypassPrompt(null)} className="absolute right-4 top-4 text-neutral-400" aria-label="Close">✕</button>
            <h2 className="mb-2 text-base font-bold text-neutral-900">{t('answers.bypass.title', { level: bypassPrompt.minLevel })}</h2>
            <p className="mb-4 text-sm text-neutral-600">
              {t('answers.bypass.message', { level: bypassPrompt.minLevel, cost: bypassPrompt.bypassCostCredits, currency: currencyName })}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBypassPrompt(null)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700">{t('answers.ask.cancel')}</button>
              <button
                onClick={() => submitAnswer.mutate({ body: bypassPrompt.body, parentAnswerId: bypassPrompt.parentAnswerId, payBypass: true })}
                className="flex-1 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-white"
              >
                {t('answers.bypass.confirm', { cost: bypassPrompt.bypassCostCredits, currency: currencyName })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/answers/$questionId')({
  component: QuestionDetailPage,
});

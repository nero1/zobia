/**
 * apps/android/src/routes/quizzes/$slug.tsx
 *
 * Quiz detail / take screen — mirrors apps/web/app/(app)/quizzes/[slug]/page.tsx.
 * Renders all questions at once (consistent with this app's other multi-field
 * form screens, e.g. routes/answers/ask.tsx), submits via the attempt
 * endpoint, and shows a results view (score/pass-fail/per-question
 * correctness) after submit. Owner gets a simple "fund reward pot" action,
 * matching polls/$slug.tsx.
 *
 * GET /api/quizzes/[slug], POST .../attempt, POST .../share,
 * GET/POST .../treasury, PATCH/DELETE /api/quizzes/[slug] (owner/mod).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { universalLink, PUBLIC_PATHS } from '@/lib/deeplinks/routes';

interface QuizOption {
  id: string;
  label: string;
  isCorrect?: boolean;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  type: 'single' | 'multiple' | 'true_false';
  points: number;
  options: QuizOption[];
}

interface BestAttempt {
  score: number;
  totalPoints: number;
  scorePercent: number;
  passed: boolean;
}

interface QuizDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: 'active' | 'closed' | 'disabled';
  passingScorePercent: number | null;
  maxAttemptsPerUser: number | null;
  viewCount: number;
  attemptCount: number;
  shareCount: number;
  createdAt: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  questions: QuizQuestion[];
  isOwner: boolean;
  myAttemptCount: number;
  myBestAttempt: BestAttempt | null;
}

interface Treasury {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

interface AttemptResult {
  score: number;
  totalPoints: number;
  scorePercent: number;
  passed: boolean;
  rewardClaimed: number | null;
  perQuestionResult: { questionId: string; isCorrect: boolean; correctOptionIds: string[] }[];
}

function FundTreasuryModal({ onClose, onSave, saving }: { onClose: () => void; onSave: (amount: number, maxClaimants: number) => void; saving: boolean }) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [amount, setAmount] = useState('');
  const [maxClaimants, setMaxClaimants] = useState('');
  const canSave = Number(amount) > 0 && Number(maxClaimants) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-bold text-neutral-900">{t('polls.treasury.title', 'Fund Reward Pot')}</p>
        <p className="mt-1 text-sm text-neutral-500">{t('polls.treasury.desc', 'Reward voters from a shared pot, split evenly among claimants.')}</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('polls.treasury.amount', 'Total Amount ({{currency}})', { currency: currency.softPlural })}</span>
          <input type="number" min="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('polls.treasury.maxClaimants', 'Max Claimants')}</span>
          <input type="number" min="1" inputMode="numeric" value={maxClaimants} onChange={(e) => setMaxClaimants(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('answers.ask.cancel')}
          </button>
          <button type="button" disabled={saving || !canSave} onClick={() => onSave(Number(amount), Number(maxClaimants))} className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? '…' : t('polls.treasury.fund', 'Fund')}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuizDetailPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const currency = useCurrency();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const quizQuery = useQuery({
    queryKey: ['quizzes', 'detail', slug],
    queryFn: async () => (await apiClient.get<QuizDetail>(`/quizzes/${slug}`)).data,
  });

  const treasuryQuery = useQuery({
    queryKey: ['quizzes', 'treasury', slug],
    queryFn: async () => (await apiClient.get<Treasury | null>(`/quizzes/${slug}/treasury`)).data,
    enabled: !!quizQuery.data,
  });

  const quiz = quizQuery.data;

  const attemptsExhausted = !!(quiz?.maxAttemptsPerUser && quiz.myAttemptCount >= quiz.maxAttemptsPerUser);
  const canAttempt = quiz?.status === 'active' && !attemptsExhausted;

  const submitAttempt = useMutation({
    mutationFn: () =>
      apiClient.post<AttemptResult>(`/quizzes/${slug}/attempt`, {
        answers: (quiz?.questions ?? []).map((q) => ({ questionId: q.id, selectedOptionIds: answers[q.id] ?? [] })),
      }),
    onSuccess: (res) => {
      if (res.data) setResult(res.data);
      qc.invalidateQueries({ queryKey: ['quizzes', 'detail', slug] });
      qc.invalidateQueries({ queryKey: ['quizzes', 'treasury', slug] });
    },
    onError: (err) => {
      if (isAxiosError<{ error?: { message?: string } }>(err)) {
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  const share = useMutation({
    mutationFn: () => apiClient.post<{ shareCount: number; rewardClaimed: number | null }>(`/quizzes/${slug}/share`, {}),
    onSuccess: (res) => {
      qc.setQueryData<QuizDetail>(['quizzes', 'detail', slug], (prev) => (prev ? { ...prev, shareCount: res.data?.shareCount ?? prev.shareCount } : prev));
    },
  });

  const fundTreasury = useMutation({
    mutationFn: ({ amount, maxClaimants }: { amount: number; maxClaimants: number }) => apiClient.post<Treasury>(`/quizzes/${slug}/treasury`, { amount, maxClaimants }),
    onSuccess: (res) => {
      qc.setQueryData(['quizzes', 'treasury', slug], res.data);
      setFundingOpen(false);
    },
    onError: (err) => {
      if (isAxiosError<{ error?: { message?: string } }>(err)) setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'closed' | 'disabled') => apiClient.patch(`/quizzes/${slug}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quizzes', 'detail', slug] }),
  });

  const deleteQuiz = useMutation({
    mutationFn: () => apiClient.delete(`/quizzes/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      navigate({ to: '/quizzes' });
    },
  });

  async function handleShare(): Promise<void> {
    const url = universalLink(PUBLIC_PATHS.quiz(slug));
    share.mutate();
    try {
      if (navigator.share) {
        await navigator.share({ title: quiz?.title, url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // no fallback UI available
    }
  }

  function toggleAnswer(question: QuizQuestion, optionId: string) {
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      if (question.type === 'multiple') {
        const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
        return { ...prev, [question.id]: next };
      }
      return { ...prev, [question.id]: [optionId] };
    });
  }

  if (quizQuery.isPending) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  }

  if (!quiz) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center">
        <p className="text-sm text-neutral-500">{t('quizzes.notFound', 'Quiz not found')}</p>
        <Link to="/quizzes" className="mt-3 inline-block text-sm font-semibold text-primary-600">← {t('quizzes.title', 'Quizzes')}</Link>
      </div>
    );
  }

  const treasury = treasuryQuery.data;
  const allAnswered = quiz.questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-base font-bold text-neutral-900">{quiz.title}</h1>
          {quiz.status !== 'active' && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
              {quiz.status === 'closed' ? t('polls.status.closed', 'Closed') : t('polls.status.disabled', 'Disabled')}
            </span>
          )}
        </div>
        {quiz.description && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{quiz.description}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>@{quiz.creatorUsername ?? 'unknown'}</span>
          <span>·</span>
          <span>{quiz.questions.length} {t('quizzes.questions', 'questions')}</span>
          <span>·</span>
          <span>{quiz.attemptCount} {quiz.attemptCount === 1 ? t('quizzes.attempt', 'attempt') : t('quizzes.attempts', 'attempts')}</span>
          {quiz.passingScorePercent != null && (
            <>
              <span>·</span>
              <span>{t('quizzes.passingScore', 'Pass at {{pct}}%', { pct: quiz.passingScorePercent })}</span>
            </>
          )}
        </div>
        {quiz.myBestAttempt && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${quiz.myBestAttempt.passed ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-600'}`}>
            {t('quizzes.bestAttempt', 'Best score: {{pct}}% ({{score}}/{{total}}) · {{status}}', {
              pct: quiz.myBestAttempt.scorePercent,
              score: quiz.myBestAttempt.score,
              total: quiz.myBestAttempt.totalPoints,
              status: quiz.myBestAttempt.passed ? t('quizzes.passed', 'Passed') : t('quizzes.notPassed', 'Not passed'),
            })}
          </div>
        )}
      </div>

      {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

      {result ? (
        <div className="space-y-3">
          <div className={`rounded-xl border p-4 text-center ${result.passed ? 'border-success-200 bg-success-50' : 'border-neutral-200 bg-white'}`}>
            <p className="text-3xl font-bold text-neutral-900">{result.scorePercent}%</p>
            <p className="mt-1 text-sm text-neutral-600">
              {t('quizzes.result.score', '{{score}}/{{total}} points', { score: result.score, total: result.totalPoints })}
            </p>
            <p className={`mt-2 text-sm font-semibold ${result.passed ? 'text-success-700' : 'text-neutral-500'}`}>
              {result.passed ? t('quizzes.passed', 'Passed') : t('quizzes.notPassed', 'Not passed')}
            </p>
            {result.rewardClaimed ? (
              <p className="mt-2 text-sm text-success-700">
                {t('polls.rewardClaimed', 'You earned {{amount}} {{currency}}!', { amount: result.rewardClaimed, currency: currency.softPlural })}
              </p>
            ) : null}
          </div>

          {quiz.questions.map((q) => {
            const r = result.perQuestionResult.find((pr) => pr.questionId === q.id);
            const mySelection = answers[q.id] ?? [];
            return (
              <div key={q.id} className={`rounded-xl border p-4 ${r?.isCorrect ? 'border-success-200 bg-white' : 'border-danger-200 bg-white'}`}>
                <p className="text-sm font-semibold text-neutral-900">
                  {r?.isCorrect ? '✓' : '✗'} {q.prompt}
                </p>
                <div className="mt-2 space-y-1">
                  {q.options.map((opt) => {
                    const wasCorrect = r?.correctOptionIds.includes(opt.id);
                    const wasMine = mySelection.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        className={`rounded-lg px-3 py-1.5 text-xs ${
                          wasCorrect ? 'bg-success-50 text-success-700 font-semibold' : wasMine ? 'bg-danger-50 text-danger-700' : 'text-neutral-500'
                        }`}
                      >
                        {wasCorrect && '✓ '}{wasMine && !wasCorrect && '✗ '}{opt.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="flex gap-3">
            {quiz.status === 'active' && !(quiz.maxAttemptsPerUser && quiz.myAttemptCount + 1 >= quiz.maxAttemptsPerUser) && (
              <button
                onClick={() => { setResult(null); setAnswers({}); }}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700"
              >
                {t('quizzes.retake', 'Retake Quiz')}
              </button>
            )}
            <Link to="/quizzes" className="flex-1 rounded-xl bg-primary-600 py-2.5 text-center text-sm font-semibold text-white">
              {t('quizzes.backToList', 'Back to Quizzes')}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {!canAttempt && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {quiz.status !== 'active'
                ? t('quizzes.unavailable', 'This quiz is not accepting attempts right now.')
                : t('quizzes.attemptsExhausted', "You've used all {{max}} of your attempts.", { max: quiz.maxAttemptsPerUser })}
            </div>
          )}

          {quiz.questions.map((q, idx) => (
            <div key={q.id} className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-sm font-semibold text-neutral-900">{idx + 1}. {q.prompt}</p>
              <div className="mt-3 space-y-1.5">
                {q.options.map((opt) => {
                  const isChecked = (answers[q.id] ?? []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canAttempt}
                      onClick={() => toggleAnswer(q, opt.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm disabled:opacity-50 ${isChecked ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 text-neutral-800'}`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${q.type === 'multiple' ? 'rounded' : 'rounded-full'} ${isChecked ? 'border-primary-600 bg-primary-600' : 'border-neutral-300'}`}>
                        {isChecked && <span className="text-[10px] text-white">✓</span>}
                      </span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            disabled={!canAttempt || !allAnswered || submitAttempt.isPending}
            onClick={() => submitAttempt.mutate()}
            className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitAttempt.isPending ? t('quizzes.submitting', 'Submitting…') : t('quizzes.submit', 'Submit Quiz')}
          </button>
        </>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void handleShare()} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600">
          {shareCopied ? t('answers.linkCopied', 'Link copied') : t('polls.share', 'Share')} ({quiz.shareCount})
        </button>
        {quiz.isOwner && (
          <button onClick={() => setFundingOpen(true)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600">
            {t('polls.treasury.cta', 'Fund Reward Pot')}
          </button>
        )}
      </div>

      {treasury && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">{t('polls.treasury.active', 'Reward Pot Active')}</p>
          <p className="mt-1 text-xs text-amber-700">
            {t('polls.treasury.remaining', '{{remaining}} {{currency}} remaining · {{claimed}}/{{max}} claimed', {
              remaining: treasury.remainingAmount,
              currency: currency.softPlural,
              claimed: treasury.claimantCount,
              max: treasury.maxClaimants,
            })}
          </p>
        </div>
      )}

      {quiz.isOwner && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('polls.owner.manage', 'Manage')}</p>
          <div className="flex flex-wrap gap-2">
            {quiz.status !== 'closed' && (
              <button onClick={() => setStatus.mutate('closed')} disabled={setStatus.isPending} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-50">
                {t('polls.owner.close', 'Close poll')}
              </button>
            )}
            {quiz.status !== 'active' && (
              <button onClick={() => setStatus.mutate('active')} disabled={setStatus.isPending} className="rounded-lg bg-success-100 px-3 py-1.5 text-xs font-semibold text-success-700 disabled:opacity-50">
                {t('polls.owner.reopen', 'Reopen poll')}
              </button>
            )}
            <button onClick={() => deleteQuiz.mutate()} disabled={deleteQuiz.isPending} className="rounded-lg bg-danger-100 px-3 py-1.5 text-xs font-semibold text-danger-700 disabled:opacity-50">
              {t('common.delete', 'Delete')}
            </button>
          </div>
        </div>
      )}

      {fundingOpen && (
        <FundTreasuryModal onClose={() => setFundingOpen(false)} saving={fundTreasury.isPending} onSave={(amount, maxClaimants) => fundTreasury.mutate({ amount, maxClaimants })} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/quizzes/$slug')({
  component: QuizDetailPage,
});

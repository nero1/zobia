/**
 * apps/android/src/routes/quizzes/new.tsx
 *
 * Create a quiz — mirrors apps/web/app/(app)/quizzes/new/page.tsx.
 * POST /api/quizzes body:{title,description?,passingScorePercent?,maxAttemptsPerUser?,
 *   questions:[{prompt,type,points?,options:[{label,isCorrect}](2-8)}](1-25)}
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_PROMPT = 500;
const MAX_OPTION = 200;
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 25;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

type QuestionType = 'single' | 'multiple' | 'true_false';

interface DraftOption {
  label: string;
  isCorrect: boolean;
}

interface DraftQuestion {
  prompt: string;
  type: QuestionType;
  points: string;
  options: DraftOption[];
}

function newQuestion(): DraftQuestion {
  return {
    prompt: '',
    type: 'single',
    points: '1',
    options: [
      { label: '', isCorrect: true },
      { label: '', isCorrect: false },
    ],
  };
}

function trueFalseOptions(): DraftOption[] {
  return [
    { label: 'True', isCorrect: true },
    { label: 'False', isCorrect: false },
  ];
}

function QuizzesNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passingScorePercent, setPassingScorePercent] = useState('');
  const [maxAttemptsPerUser, setMaxAttemptsPerUser] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion()]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateQuestion(qIdx: number, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === qIdx ? { ...q, ...patch } : q)));
  }

  function setQuestionType(qIdx: number, type: QuestionType) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        if (type === 'true_false') return { ...q, type, options: trueFalseOptions() };
        if (q.type === 'true_false') return { ...q, type, options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] };
        return { ...q, type };
      }),
    );
  }

  function updateOption(qIdx: number, oIdx: number, patch: Partial<DraftOption>) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        const options = q.options.map((o, j) => {
          if (j !== oIdx) {
            // Single-select: selecting one correct option clears the others.
            if (q.type === 'single' && patch.isCorrect) return { ...o, isCorrect: false };
            return o;
          }
          return { ...o, ...patch };
        });
        return { ...q, options };
      }),
    );
  }

  function addQuestion() {
    setQuestions((prev) => (prev.length < MAX_QUESTIONS ? [...prev, newQuestion()] : prev));
  }
  function removeQuestion(qIdx: number) {
    setQuestions((prev) => (prev.length > MIN_QUESTIONS ? prev.filter((_, i) => i !== qIdx) : prev));
  }
  function addOption(qIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qIdx && q.options.length < MAX_OPTIONS ? { ...q, options: [...q.options, { label: '', isCorrect: false }] } : q)),
    );
  }
  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qIdx && q.options.length > MIN_OPTIONS ? { ...q, options: q.options.filter((_, j) => j !== oIdx) } : q)),
    );
  }

  const canSubmit =
    title.trim().length >= 3 &&
    questions.every(
      (q) =>
        q.prompt.trim().length > 0 &&
        q.options.filter((o) => o.label.trim().length > 0).length >= MIN_OPTIONS &&
        q.options.some((o) => o.isCorrect),
    );

  const createQuiz = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string; slug: string }>('/quizzes', {
        title: title.trim(),
        description: description.trim() || undefined,
        passingScorePercent: passingScorePercent ? Number(passingScorePercent) : undefined,
        maxAttemptsPerUser: maxAttemptsPerUser ? Number(maxAttemptsPerUser) : undefined,
        questions: questions.map((q) => ({
          prompt: q.prompt.trim(),
          type: q.type,
          points: q.points ? Number(q.points) : undefined,
          options: q.options.filter((o) => o.label.trim().length > 0).map((o) => ({ label: o.label.trim(), isCorrect: o.isCorrect })),
        })),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quizzes', 'list'] });
      const slug = res.data?.slug;
      if (slug) navigate({ to: '/quizzes/$slug', params: { slug } });
      else navigate({ to: '/quizzes' });
    },
    onError: (err) => {
      if (isAxiosError<{ error?: { message?: string } }>(err)) {
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('quizzes.create.title', 'Create Quiz')}</h1>

      {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

      <div className="bg-white rounded-xl shadow-card p-4 space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
          placeholder={t('quizzes.create.titlePlaceholder', 'Quiz title')}
          maxLength={MAX_TITLE}
          className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
          placeholder={t('quizzes.create.descriptionPlaceholder', 'Description (optional)…')}
          rows={3}
          maxLength={MAX_DESCRIPTION}
          className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('quizzes.create.passingScore', 'Passing % (optional)')}</span>
            <input
              type="number"
              min="0"
              max="100"
              inputMode="numeric"
              value={passingScorePercent}
              onChange={(e) => setPassingScorePercent(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('quizzes.create.maxAttempts', 'Max attempts (optional)')}</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={maxAttemptsPerUser}
              onChange={(e) => setMaxAttemptsPerUser(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
          </label>
        </div>
      </div>

      {questions.map((q, qIdx) => (
        <div key={qIdx} className="bg-white rounded-xl shadow-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {t('quizzes.create.question', 'Question {{n}}', { n: qIdx + 1 })}
            </span>
            {questions.length > MIN_QUESTIONS && (
              <button type="button" onClick={() => removeQuestion(qIdx)} className="text-xs font-semibold text-danger-600">
                {t('common.delete', 'Delete')}
              </button>
            )}
          </div>

          <textarea
            value={q.prompt}
            onChange={(e) => updateQuestion(qIdx, { prompt: e.target.value.slice(0, MAX_PROMPT) })}
            placeholder={t('quizzes.create.promptPlaceholder', 'Ask a question…')}
            rows={2}
            maxLength={MAX_PROMPT}
            className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
          />

          <div className="flex gap-1.5">
            {(['single', 'multiple', 'true_false'] as QuestionType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setQuestionType(qIdx, type)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${q.type === type ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
              >
                {type === 'single' ? t('quizzes.create.typeSingle', 'Single') : type === 'multiple' ? t('quizzes.create.typeMultiple', 'Multiple') : t('quizzes.create.typeTrueFalse', 'True/False')}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
              {t('quizzes.create.points', 'Points')}
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={q.points}
                onChange={(e) => updateQuestion(qIdx, { points: e.target.value })}
                className="w-14 rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            {q.options.map((opt, oIdx) => (
              <div key={oIdx} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateOption(qIdx, oIdx, { isCorrect: q.type === 'single' ? true : !opt.isCorrect })}
                  aria-label={t('quizzes.create.markCorrect', 'Mark correct')}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center border ${q.type === 'single' ? 'rounded-full' : 'rounded'} ${opt.isCorrect ? 'border-success-600 bg-success-600' : 'border-neutral-300'}`}
                >
                  {opt.isCorrect && <span className="text-[11px] text-white">✓</span>}
                </button>
                {q.type === 'true_false' ? (
                  <span className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{opt.label}</span>
                ) : (
                  <input
                    type="text"
                    value={opt.label}
                    onChange={(e) => updateOption(qIdx, oIdx, { label: e.target.value.slice(0, MAX_OPTION) })}
                    placeholder={t('quizzes.create.optionPlaceholder', 'Option {{n}}', { n: oIdx + 1 })}
                    className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                  />
                )}
                {q.type !== 'true_false' && q.options.length > MIN_OPTIONS && (
                  <button type="button" onClick={() => removeOption(qIdx, oIdx)} aria-label={t('common.delete', 'Delete')} className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-400">
                    ✕
                  </button>
                )}
              </div>
            ))}
            {q.type !== 'true_false' && q.options.length < MAX_OPTIONS && (
              <button type="button" onClick={() => addOption(qIdx)} className="mt-1 rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-500">
                + {t('polls.create.addOption', 'Add option')}
              </button>
            )}
          </div>
        </div>
      ))}

      {questions.length < MAX_QUESTIONS && (
        <button type="button" onClick={addQuestion} className="w-full rounded-xl border border-dashed border-neutral-300 bg-white py-3 text-sm font-semibold text-neutral-500">
          + {t('quizzes.create.addQuestion', 'Add question')}
        </button>
      )}

      <div className="flex gap-3">
        <Link to="/quizzes" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700">
          {t('answers.ask.cancel')}
        </Link>
        <button
          type="button"
          onClick={() => createQuiz.mutate()}
          disabled={!canSubmit || createQuiz.isPending}
          className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createQuiz.isPending ? t('polls.create.posting', 'Creating…') : t('quizzes.create.submit', 'Create Quiz')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/quizzes/new')({
  component: QuizzesNewPage,
});

/**
 * apps/android/src/routes/answers/ask.tsx
 *
 * Ask a question on Answers — mirrors apps/web/app/(app)/answers/ask/page.tsx.
 * POST /api/answers/questions.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

const MAX_TITLE = 200;
const MAX_BODY = 5000;

interface ApiErrorBody {
  error?: { code?: string; message?: string; params?: { minLevel?: number; currentLevel?: number } };
}

function AskQuestionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [levelTooLow, setLevelTooLow] = useState<{ minLevel: number; currentLevel: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createQuestion = useMutation({
    mutationFn: () => apiClient.post<{ data: { id: string } }>('/answers/questions', { title: title.trim(), body: body.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['answers', 'questions'] });
      const id = res.data?.data?.id;
      if (id) navigate({ to: '/answers/$questionId', params: { questionId: id } });
      else navigate({ to: '/answers' });
    },
    onError: (err) => {
      if (isAxiosError<ApiErrorBody>(err)) {
        const code = err.response?.data?.error?.code;
        const params = err.response?.data?.error?.params;
        if (code === 'FORUM_LEVEL_TOO_LOW' && params) {
          setLevelTooLow({ minLevel: params.minLevel ?? 2, currentLevel: params.currentLevel ?? 0 });
          return;
        }
        setErrorMessage(err.response?.data?.error?.message ?? t('error.generic'));
        return;
      }
      setErrorMessage(t('error.generic'));
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('answers.ask.title')}</h1>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}
      {levelTooLow && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('answers.ask.levelTooLow', { level: levelTooLow.minLevel, current: levelTooLow.currentLevel })}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('answers.ask.titleLabel')}</h2>
        </div>
        <div className="p-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder={t('answers.ask.titlePlaceholder')}
            maxLength={MAX_TITLE}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('answers.ask.bodyLabel')}</h2>
        </div>
        <div className="p-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            placeholder={t('answers.ask.bodyPlaceholder')}
            rows={8}
            maxLength={MAX_BODY}
            className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Link to="/answers" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700">
          {t('answers.ask.cancel')}
        </Link>
        <button
          type="button"
          onClick={() => createQuestion.mutate()}
          disabled={title.trim().length < 10 || body.trim().length < 20 || createQuestion.isPending}
          className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createQuestion.isPending ? t('answers.ask.posting') : t('answers.ask.post')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/answers/ask')({
  component: AskQuestionPage,
});

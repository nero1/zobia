/**
 * apps/android/src/routes/polls/new.tsx
 *
 * Create a poll — mirrors apps/web/app/(app)/polls/new/page.tsx.
 * POST /api/polls  body:{title,description?,options:string[2-10],allowMultiple?,closesAt?}
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_OPTION = 200;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

function PollsNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateOption = (idx: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value.slice(0, MAX_OPTION) : o)));
  };
  const addOption = () => setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ''] : prev));
  const removeOption = (idx: number) => setOptions((prev) => (prev.length > MIN_OPTIONS ? prev.filter((_, i) => i !== idx) : prev));

  const trimmedOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const canSubmit = title.trim().length >= 3 && trimmedOptions.length >= MIN_OPTIONS;

  const createPoll = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string; slug: string }>('/polls', {
        title: title.trim(),
        description: description.trim() || undefined,
        options: trimmedOptions,
        allowMultiple,
        closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['polls', 'list'] });
      const slug = res.data?.slug;
      if (slug) navigate({ to: '/polls/$slug', params: { slug } });
      else navigate({ to: '/polls' });
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
      <h1 className="text-lg font-bold text-neutral-900">{t('polls.create.title', 'Create Poll')}</h1>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('polls.create.titleLabel', 'Question')}</h2>
        </div>
        <div className="p-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
            placeholder={t('polls.create.titlePlaceholder', "What's your poll about?")}
            maxLength={MAX_TITLE}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('polls.create.descriptionLabel', 'Description (optional)')}</h2>
        </div>
        <div className="p-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
            placeholder={t('polls.create.descriptionPlaceholder', 'Add more context…')}
            rows={3}
            maxLength={MAX_DESCRIPTION}
            className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('polls.create.optionsLabel', 'Options')}</h2>
        </div>
        <div className="p-4 space-y-2">
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                placeholder={t('polls.create.optionPlaceholder', 'Option {{n}}', { n: idx + 1 })}
                maxLength={MAX_OPTION}
                className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  aria-label={t('common.delete', 'Delete')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="mt-1 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-500"
            >
              + {t('polls.create.addOption', 'Add option')}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-card p-4 space-y-4">
        <label className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-700">{t('polls.create.allowMultiple', 'Allow multiple selections')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={allowMultiple}
            onClick={() => setAllowMultiple((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${allowMultiple ? 'bg-primary-600' : 'bg-neutral-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${allowMultiple ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('polls.create.closesAt', 'Closes at (optional)')}</span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <Link to="/polls" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700">
          {t('answers.ask.cancel')}
        </Link>
        <button
          type="button"
          onClick={() => createPoll.mutate()}
          disabled={!canSubmit || createPoll.isPending}
          className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createPoll.isPending ? t('polls.create.posting', 'Creating…') : t('polls.create.submit', 'Create Poll')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/polls/new')({
  component: PollsNewPage,
});

/**
 * apps/android/src/routes/wiki/new.tsx
 *
 * Create the caller's wiki — mirrors routes/blogs/new.tsx. Surfaces the
 * backend's eligibility errors (403 WIKI_CREATE_NOT_ELIGIBLE /
 * WIKI_OWNED_LIMIT_REACHED) by reading error.response.data.error.message,
 * same pattern as routes/guilds/index.tsx's create-guild error handling.
 * No CAPTCHA wiring — unlike POST /blogs, POST /wiki's schema takes no
 * captchaToken field.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { ContributePolicy } from '@/lib/wiki/api';

const POLICIES: ContributePolicy[] = ['everyone', 'friends', 'selected'];

function NewWikiPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [policy, setPolicy] = useState<ContributePolicy>('everyone');
  const [error, setError] = useState<string | null>(null);

  const policyLabel: Record<ContributePolicy, string> = {
    everyone: t('wiki.policy.everyone', 'Anyone can contribute'),
    friends: t('wiki.policy.friends', 'Friends only'),
    selected: t('wiki.policy.selected', 'Selected collaborators only'),
  };

  const createWiki = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string; slug: string }>('/wiki', {
        name: name.trim(),
        description: description.trim() || undefined,
        contributePolicy: policy,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['wiki', 'me'] });
      navigate({ to: '/wiki/$slug', params: { slug: res.data.slug } });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e?.response?.data?.error?.message ?? t('error.generic'));
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-4">{t('wiki.new.title', 'Start a Wiki')}</h1>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder={t('wiki.new.namePlaceholder', "e.g. Muna's Lore Wiki")}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={t('wiki.new.descriptionPlaceholder', 'Description (optional)')}
          className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />

        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-500">{t('wiki.new.policyLabel', 'Who can contribute?')}</p>
          <div className="flex flex-col gap-1.5">
            {POLICIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPolicy(p)}
                className={`rounded-xl border px-3 py-2 text-left text-sm ${
                  policy === p ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium' : 'border-neutral-200 bg-white text-neutral-700'
                }`}
              >
                {policyLabel[p]}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={!name.trim() || createWiki.isPending}
          onClick={() => createWiki.mutate()}
          className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createWiki.isPending ? t('wiki.new.creating', 'Creating…') : t('wiki.new.create', 'Create wiki')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/new')({
  component: NewWikiPage,
});

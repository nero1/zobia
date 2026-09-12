/**
 * apps/android/src/routes/wiki/$slug/settings.tsx
 *
 * Owner-only wiki settings: name/description/avatar/cover image URLs and
 * contribute policy. Mirrors the form-field conventions of
 * routes/blogs/$slug/manage.tsx (plain inputs + a save button, no image
 * cropper/upload flow here — Android has no wiki image-upload UI yet, same
 * gap blogs has; the fields accept a URL same as the backend's updateSchema).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchWiki, type ContributePolicy } from '@/lib/wiki/api';

const POLICIES: ContributePolicy[] = ['everyone', 'friends', 'selected'];

function WikiSettingsPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const wikiQuery = useQuery({ queryKey: ['wiki', 'detail', slug], queryFn: () => fetchWiki(slug) });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [policy, setPolicy] = useState<ContributePolicy>('everyone');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const w = wikiQuery.data?.wiki;
    if (!w) return;
    setName(w.name);
    setDescription(w.description ?? '');
    setAvatarUrl(w.avatar_url ?? '');
    setCoverImageUrl(w.cover_image_url ?? '');
    setPolicy(w.contribute_policy);
  }, [wikiQuery.data]);

  const policyLabel: Record<ContributePolicy, string> = {
    everyone: t('wiki.policy.everyone', 'Anyone can contribute'),
    friends: t('wiki.policy.friends', 'Friends only'),
    selected: t('wiki.policy.selected', 'Selected collaborators only'),
  };

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/wiki/${slug}`, {
        name: name.trim(),
        description: description.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        contributePolicy: policy,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['wiki', 'detail', slug] });
    },
  });

  if (wikiQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!wikiQuery.data?.canManage) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.settings.notAllowed', "You don't have access to this wiki's settings.")}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <h1 className="text-lg font-bold text-neutral-900">{t('wiki.settings.title', 'Wiki settings')}</h1>

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
        <input
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder={t('wiki.settings.avatarUrlPlaceholder', 'Avatar image URL (optional)')}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
        <input
          value={coverImageUrl}
          onChange={(e) => setCoverImageUrl(e.target.value)}
          placeholder={t('wiki.settings.coverUrlPlaceholder', 'Cover image URL (optional)')}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
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

        {saved && <p className="text-sm text-teal-600">{t('wiki.settings.saved', 'Settings saved.')}</p>}
        <button
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
          className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? t('wiki.settings.saving', 'Saving…') : t('wiki.settings.save', 'Save settings')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/settings')({
  component: WikiSettingsPage,
});

/**
 * apps/android/src/routes/wiki/$slug/manage.tsx
 *
 * Collaborators / moderators / invites management — owner or moderator only.
 * Also where a 'selected'-policy wiki's owner adds/removes named
 * collaborators. Route name ("manage") matches both the Blogs Android
 * convention (routes/blogs/$slug/manage.tsx) and apps/web's own planned
 * wiki_moderator_granted deep-link shape (see lib/notifications/actionRoute.ts
 * on web, which already points at `/wiki/<id>/manage`).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchWiki, fetchCollaborators, fetchInvites, searchUsers, type UserSuggestion } from '@/lib/wiki/api';
import { CollaboratorRow } from '@/components/wiki/CollaboratorRow';
import { env } from '@/lib/env';

function WikiManagePage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState('');
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [inviteUsername, setInviteUsername] = useState('');

  const wikiQuery = useQuery({ queryKey: ['wiki', 'detail', slug], queryFn: () => fetchWiki(slug) });
  const collaboratorsQuery = useQuery({ queryKey: ['wiki', 'collaborators', slug], queryFn: () => fetchCollaborators(slug) });
  const invitesQuery = useQuery({ queryKey: ['wiki', 'invites', slug], queryFn: () => fetchInvites(slug) });

  const wiki = wikiQuery.data?.wiki;
  const canManage = wikiQuery.data?.canManage ?? false;
  const isOwner = wikiQuery.data?.isOwner ?? false;
  const isSelectedPolicy = wiki?.contribute_policy === 'selected';

  const grantMod = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/wiki/${slug}/moderators`, { userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki', 'collaborators', slug] }),
    onSettled: () => setBusyId(null),
  });
  const revokeMod = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/wiki/${slug}/moderators`, { data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki', 'collaborators', slug] }),
    onSettled: () => setBusyId(null),
  });
  const addCollaborator = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/wiki/${slug}/collaborators`, { userId }),
    onSuccess: () => {
      setAddQuery('');
      setSuggestions([]);
      qc.invalidateQueries({ queryKey: ['wiki', 'collaborators', slug] });
    },
  });
  const removeCollaborator = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`/wiki/${slug}/collaborators`, { data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki', 'collaborators', slug] }),
    onSettled: () => setBusyId(null),
  });
  const createInvite = useMutation({
    mutationFn: () => apiClient.post<{ token: string; expiresAt: string }>(`/wiki/${slug}/invites`, { username: inviteUsername.trim() || undefined }),
    onSuccess: async (res) => {
      setInviteUsername('');
      qc.invalidateQueries({ queryKey: ['wiki', 'invites', slug] });
      const url = `${env.VITE_WEB_BASE_URL}/wiki/invite/${res.data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopiedToken(res.data.token);
        setTimeout(() => setCopiedToken(null), 2500);
      } catch { /* clipboard unavailable — invite still created, just not copied */ }
    },
  });

  async function runAddQuery(q: string) {
    setAddQuery(q);
    if (!q.trim()) { setSuggestions([]); return; }
    setSuggestions(await searchUsers(q));
  }

  if (wikiQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!canManage) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.manage.notAllowed', "You don't have access to manage this wiki.")}</div>;
  }

  const collaborators = collaboratorsQuery.data ?? [];
  const moderators = collaborators.filter((c) => c.is_moderator);
  const contributors = collaborators.filter((c) => !c.is_moderator);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-5">
      <h1 className="text-lg font-bold text-neutral-900">{t('wiki.manage.title', 'Manage collaborators')}</h1>

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('wiki.manage.inviteTitle', 'Invite link')}</h2>
        <div className="flex gap-2">
          <input
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
            placeholder={t('wiki.manage.inviteUsernamePlaceholder', 'Username (optional — leave blank for anyone)')}
            className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <button
            disabled={createInvite.isPending}
            onClick={() => createInvite.mutate()}
            className="flex-shrink-0 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {createInvite.isPending ? t('wiki.manage.creatingInvite', 'Creating…') : t('wiki.manage.createInvite', 'Create')}
          </button>
        </div>
        {copiedToken && <p className="mt-1.5 text-xs text-teal-600">{t('wiki.manage.linkCopied', 'Invite link copied to clipboard.')}</p>}
        {(invitesQuery.data ?? []).length > 0 && (
          <div className="mt-2 space-y-1.5">
            {invitesQuery.data!.slice(0, 5).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs">
                <span className="truncate text-neutral-600">
                  {inv.invited_username ? `@${inv.invited_username}` : t('wiki.manage.anyoneInvite', 'Anyone')}
                  {inv.used_at && ` · ${t('wiki.manage.inviteUsed', 'used')}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isSelectedPolicy && (
        <div>
          <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('wiki.manage.addCollaboratorTitle', 'Add a collaborator')}</h2>
          <input
            value={addQuery}
            onChange={(e) => void runAddQuery(e.target.value)}
            placeholder={t('wiki.manage.addCollaboratorPlaceholder', 'Search by username…')}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          {suggestions.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {suggestions.map((u) => (
                <button
                  key={u.id}
                  disabled={addCollaborator.isPending}
                  onClick={() => addCollaborator.mutate(u.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm disabled:opacity-50"
                >
                  <span>{u.display_name ?? `@${u.username}`}</span>
                  <span className="text-xs text-primary-600">{t('wiki.manage.add', 'Add')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('wiki.manage.moderatorsTitle', 'Moderators')}</h2>
        {moderators.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('wiki.manage.noModerators', 'No moderators yet.')}</p>
        ) : (
          <div className="space-y-1.5">
            {moderators.map((c) => (
              <CollaboratorRow
                key={c.id}
                collaborator={c}
                busy={busyId === c.user_id}
                onRevokeModerator={isOwner ? () => { setBusyId(c.user_id); revokeMod.mutate(c.user_id); } : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('wiki.manage.contributorsTitle', 'Contributors')}</h2>
        {contributors.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('wiki.manage.noContributors', 'No other contributors yet.')}</p>
        ) : (
          <div className="space-y-1.5">
            {contributors.map((c) => (
              <CollaboratorRow
                key={c.id}
                collaborator={c}
                busy={busyId === c.user_id}
                onGrantModerator={isOwner ? () => { setBusyId(c.user_id); grantMod.mutate(c.user_id); } : undefined}
                onRemove={isSelectedPolicy ? () => { setBusyId(c.user_id); removeCollaborator.mutate(c.user_id); } : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/manage')({
  component: WikiManagePage,
});

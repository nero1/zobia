/**
 * apps/android/src/routes/admin/moderation-roster.tsx
 *
 * Mirrors apps/web/app/(admin)/gate44/moderation/roster/page.tsx — every
 * account flagged with a staff role in one list, plus a search box to
 * grant a new role. Reuses the same GET /admin/moderation/roster and
 * POST /admin/users/[userId]/actions endpoints web uses.
 */

import { useState, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminBadge } from '@/components/admin/AdminUI';

interface RosterUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
  isModerator: boolean;
  isAdModerator: boolean;
  isSupport: boolean;
  isSeniorSupport: boolean;
  isSuspended: boolean;
  isBanned: boolean;
}

interface SearchUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
}

type RoleAction =
  | 'upgrade_moderator' | 'downgrade_moderator'
  | 'upgrade_ad_moderator' | 'downgrade_ad_moderator'
  | 'upgrade_support' | 'downgrade_support'
  | 'upgrade_senior_support' | 'downgrade_senior_support';

async function fetchRoster(): Promise<RosterUser[]> {
  const { data } = await apiClient.get<{ roster: RosterUser[] }>('/admin/moderation/roster');
  return data?.roster ?? [];
}

async function searchUsers(q: string): Promise<SearchUser[]> {
  const { data } = await apiClient.get<{ users?: SearchUser[]; data?: { users: SearchUser[] } }>(
    `/users/search?q=${encodeURIComponent(q)}&limit=8`
  );
  return data?.users ?? data?.data?.users ?? [];
}

function ModerationRosterPage() {
  const qc = useQueryClient();
  const { data: roster, status } = useQuery({ queryKey: ['admin', 'moderation-roster'], queryFn: fetchRoster });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<SearchUser[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (search.length < 2) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { searchUsers(search).then(setSuggestions).catch(() => setSuggestions([])); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const performAction = async (userId: string, action: RoleAction) => {
    setBusy(`${userId}:${action}`);
    try {
      await apiClient.post(`/admin/users/${userId}/actions`, { action });
      showToast('Updated');
      qc.invalidateQueries({ queryKey: ['admin', 'moderation-roster'] });
    } catch {
      showToast('Action failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 pb-10">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Moderation Roster</h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Every staff-flagged account in one place. Search to grant a role, or revoke one below.
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
        <h2 className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-100">Grant a role</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username…"
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
        />
        {suggestions.length > 0 && (
          <div className="mt-2 space-y-2">
            {suggestions.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 dark:border-neutral-700 p-2">
                <p className="text-sm text-neutral-900 dark:text-neutral-100">@{u.username}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => void performAction(u.id, 'upgrade_moderator')} className="rounded-lg bg-blue-100 dark:bg-blue-900/40 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">+ Mod</button>
                  <button onClick={() => void performAction(u.id, 'upgrade_ad_moderator')} className="rounded-lg bg-amber-100 dark:bg-amber-900/40 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">+ Ad Mod</button>
                  <button onClick={() => void performAction(u.id, 'upgrade_support')} className="rounded-lg bg-purple-100 dark:bg-purple-900/40 px-2 py-1 text-xs font-semibold text-purple-700 dark:text-purple-300">+ Support</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {status === 'pending' ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : !roster || roster.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          No staff-flagged accounts yet.
        </div>
      ) : (
        <div className="space-y-2">
          {roster.map((u) => (
            <div key={u.id} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">@{u.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.isModerator && <AdminBadge label="Platform Mod" color="blue" />}
                    {u.isAdModerator && <AdminBadge label="Ad Moderator" color="gold" />}
                    {u.isSupport && <AdminBadge label="Support" color="teal" />}
                    {u.isSeniorSupport && <AdminBadge label="Senior Support" color="green" />}
                    {u.isSuspended && <AdminBadge label="Suspended" color="gold" />}
                    {u.isBanned && <AdminBadge label="Banned" color="red" />}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.isModerator && (
                  <button onClick={() => void performAction(u.id, 'downgrade_moderator')} disabled={busy === `${u.id}:downgrade_moderator`} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50">Revoke Mod</button>
                )}
                {u.isAdModerator && (
                  <button onClick={() => void performAction(u.id, 'downgrade_ad_moderator')} disabled={busy === `${u.id}:downgrade_ad_moderator`} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50">Revoke Ad Mod</button>
                )}
                {u.isSupport && (
                  <button onClick={() => void performAction(u.id, 'downgrade_support')} disabled={busy === `${u.id}:downgrade_support`} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50">Revoke Support</button>
                )}
                {u.isSupport && !u.isSeniorSupport && (
                  <button onClick={() => void performAction(u.id, 'upgrade_senior_support')} disabled={busy === `${u.id}:upgrade_senior_support`} className="rounded-lg bg-teal-100 dark:bg-teal-900/40 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:text-teal-300 disabled:opacity-50">+ Senior</button>
                )}
                {u.isSeniorSupport && (
                  <button onClick={() => void performAction(u.id, 'downgrade_senior_support')} disabled={busy === `${u.id}:downgrade_senior_support`} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-50">Revoke Senior</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/moderation-roster')({
  component: ModerationRosterPage,
});

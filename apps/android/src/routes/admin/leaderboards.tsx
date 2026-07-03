/**
 * apps/android/src/routes/admin/leaderboards.tsx
 *
 * Season Leaderboard admin — mirrors apps/web/app/(admin)/admin/leaderboards/page.tsx:
 * view top 50 by season XP, search by username, override or disqualify a
 * user's season XP for competition-integrity reasons (PRD §20).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCard, AdminCardSkeleton, AdminEmptyState, AdminErrorState, AdminToast, AdminBadge, adminInputClass, fmtNumber } from '@/components/admin/AdminUI';

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
  season_xp: number;
  prestige_count: number | null;
  is_suspended: boolean;
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data } = await apiClient.get<{ entries: LeaderboardEntry[] }>('/admin/leaderboards?limit=50');
  return data?.entries ?? [];
}

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function OverrideModal({
  entry,
  onClose,
  onSave,
  saving,
}: {
  entry: LeaderboardEntry;
  onClose: () => void;
  onSave: (payload: { season_xp: number; reason: string; action: 'override' | 'disqualify' }) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [action, setAction] = useState<'override' | 'disqualify'>('override');
  const [xp, setXp] = useState(String(entry.season_xp));
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-base font-bold text-neutral-900">{t('admin.leaderboards.overrideTitle', 'Override @{{username}}', { username: entry.username })}</h3>
        <p className="mt-1 text-xs text-neutral-500">{t('admin.leaderboards.currentXp', 'Current season XP')}: {fmtNumber(entry.season_xp)}</p>

        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            {(['override', 'disqualify'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                  action === a ? (a === 'disqualify' ? 'bg-danger-600 text-white' : 'bg-gold-400 text-neutral-900') : 'border border-neutral-200 bg-white text-neutral-700'
                }`}
              >
                {a === 'override' ? t('admin.leaderboards.setXp', 'Set XP') : t('admin.leaderboards.disqualify', 'Disqualify (0 XP)')}
              </button>
            ))}
          </div>

          {action === 'override' && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('admin.leaderboards.newXp', 'New Season XP')}</span>
              <input type="number" min={0} value={xp} onChange={(e) => setXp(e.target.value)} className={adminInputClass} />
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-600">{t('admin.leaderboards.reason', 'Reason (required, logged to audit trail)')}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={t('admin.leaderboards.reasonPlaceholder', 'e.g. Confirmed bot activity, XP exploit…')}
              className={`${adminInputClass} resize-none`}
            />
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !reason.trim()}
            onClick={() => onSave({ season_xp: parseInt(xp, 10) || 0, reason: reason.trim(), action })}
            className={`flex-[2] rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60 ${action === 'disqualify' ? 'bg-danger-600' : 'bg-gold-500'}`}
          >
            {saving ? '…' : action === 'disqualify' ? t('admin.leaderboards.disqualify', 'Disqualify (0 XP)') : t('admin.leaderboards.saveOverride', 'Save Override')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminLeaderboardsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'leaderboards'], queryFn: fetchLeaderboard });

  const filtered = (data ?? []).filter(
    (e) => !search || e.username.toLowerCase().includes(search.toLowerCase()) || (e.display_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const overrideMutation = useMutation({
    mutationFn: (payload: { season_xp: number; reason: string; action: 'override' | 'disqualify' }) =>
      apiClient.patch(`/admin/leaderboards/${selected!.user_id}`, payload),
    onSuccess: () => {
      showToast(t('admin.leaderboards.saved', 'Leaderboard entry updated'));
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['admin', 'leaderboards'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">{t('admin.nav.leaderboards', 'Season Leaderboard')}</h1>
      <p className="mb-4 text-xs text-neutral-500">{t('admin.leaderboards.subtitle', 'Top 50 users by season XP. Override or disqualify for competition integrity.')}</p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.leaderboards.searchPlaceholder', 'Search by username…')}
        className={`${adminInputClass} mb-4`}
      />

      <div className="space-y-2">
        {status === 'pending' && Array.from({ length: 6 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && filtered.length === 0 && (
          <AdminEmptyState icon="🏆" title={search ? t('admin.leaderboards.noResults', 'No users match your search') : t('admin.leaderboards.empty', 'No leaderboard data yet')} />
        )}
        {status === 'success' &&
          filtered.map((entry) => (
            <AdminCard key={entry.user_id} onClick={() => setSelected(entry)}>
              <div className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-center text-base font-bold text-neutral-400">{rankLabel(entry.rank)}</span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-lg">{entry.avatar_emoji ?? '👤'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">{entry.display_name ?? entry.username}</p>
                    {entry.is_suspended && <AdminBadge label={t('admin.leaderboards.suspended', 'Suspended')} color="red" />}
                  </div>
                  <p className="text-xs text-neutral-500">@{entry.username}{entry.prestige_count ? ` · P${entry.prestige_count}` : ''}</p>
                </div>
                <p className="shrink-0 text-sm font-bold text-neutral-900">{fmtNumber(entry.season_xp)}</p>
              </div>
            </AdminCard>
          ))}
      </div>

      {selected && (
        <OverrideModal
          entry={selected}
          onClose={() => setSelected(null)}
          onSave={(payload) => overrideMutation.mutate(payload)}
          saving={overrideMutation.isPending}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/leaderboards')({
  component: AdminLeaderboardsPage,
});

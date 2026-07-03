/**
 * apps/android/src/routes/admin/users.tsx
 *
 * Admin user management — mirrors apps/web/app/(admin)/admin/users/page.tsx:
 * debounced server-side search (username/email/UUID), keyset (cursor)
 * pagination, and a detail overlay with moderation + account-security
 * actions. Card list instead of a table (native mobile pattern — web's own
 * admin tables just horizontally scroll on mobile, see PRD v2.04 changelog).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  adminInputClass,
  fmtDate,
  timeAgo,
} from '@/components/admin/AdminUI';

type Plan = 'free' | 'plus' | 'pro' | 'max';
type UserStatus = 'active' | 'suspended' | 'banned';
type SuspendDuration = '1h' | '24h' | '7d' | '30d';
type ActionType =
  | 'suspend'
  | 'ban'
  | 'restore'
  | 'upgrade_moderator'
  | 'downgrade_moderator'
  | 'reset_password'
  | 'force_2fa'
  | 'verify_account';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  avatarEmoji: string;
  plan: Plan;
  trustScore: number;
  joinedAt: string;
  lastActiveAt: string | null;
  status: UserStatus;
  isModerator: boolean;
  reportHistoryCount: number;
  paymentHistoryCount: number;
  messageCount: number;
  roomsCreated: number;
  city: string;
}

interface UsersResponse {
  users: AdminUser[];
  hasMore: boolean;
  nextCursor: string | null;
}

const DURATION_HOURS: Record<SuspendDuration, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };

const STATUS_COLOR: Record<UserStatus, 'green' | 'gold' | 'red'> = { active: 'green', suspended: 'gold', banned: 'red' };
const PLAN_COLOR: Record<Plan, 'neutral' | 'blue' | 'teal' | 'gold'> = { free: 'neutral', plus: 'blue', pro: 'teal', max: 'gold' };

async function fetchUsers(q: string, cursor: string | undefined): Promise<UsersResponse> {
  const params = new URLSearchParams({ limit: '20' });
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<UsersResponse>(`/admin/users?${params}`);
  return data;
}

function TrustBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-success-500' : score >= 40 ? 'bg-gold-500' : 'bg-danger-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-neutral-500">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail overlay
// ---------------------------------------------------------------------------

function ActionButton({ label, onClick, loading, disabled, className }: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center rounded-lg px-3 py-2.5 text-xs font-semibold disabled:opacity-50 ${className}`}
    >
      {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : label}
    </button>
  );
}

function UserDetailOverlay({
  user,
  onClose,
  onAction,
  actionPending,
}: {
  user: AdminUser;
  onClose: () => void;
  onAction: (action: ActionType, payload?: Record<string, string>) => void;
  actionPending: ActionType | null;
}) {
  const { t } = useTranslation();
  const [suspendDuration, setSuspendDuration] = useState<SuspendDuration>('24h');
  const [reason, setReason] = useState('');

  const stats: { label: string; value: string }[] = [
    { label: t('admin.users.detail.plan', 'Plan'), value: user.plan.toUpperCase() },
    { label: t('admin.users.detail.status', 'Status'), value: user.status },
    { label: t('admin.users.detail.trustScore', 'Trust Score'), value: `${user.trustScore}/100` },
    { label: t('admin.users.detail.city', 'City'), value: user.city || '—' },
    { label: t('admin.users.detail.joined', 'Joined'), value: fmtDate(user.joinedAt) },
    { label: t('admin.users.detail.lastActive', 'Last Active'), value: timeAgo(user.lastActiveAt) },
    { label: t('admin.users.detail.messages', 'Messages'), value: user.messageCount.toLocaleString() },
    { label: t('admin.users.detail.roomsCreated', 'Rooms Created'), value: String(user.roomsCreated) },
    { label: t('admin.users.detail.reports', 'Reports'), value: String(user.reportHistoryCount) },
    { label: t('admin.users.detail.payments', 'Payments'), value: String(user.paymentHistoryCount) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{t('admin.users.detail.title', 'User Detail')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-5 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-3xl">{user.avatarEmoji || '👤'}</span>
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900 truncate">@{user.username}</p>
            <p className="text-xs text-neutral-500 truncate">{user.email}</p>
            <p className="text-[10px] text-neutral-400 truncate">ID: {user.id}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-neutral-200 p-2.5">
              <p className="text-[11px] text-neutral-500">{s.label}</p>
              <p className="mt-0.5 text-sm font-medium text-neutral-900">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2.5 rounded-lg border border-neutral-200 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.users.detail.suspendOptions', 'Suspend Options')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(['1h', '24h', '7d', '30d'] as SuspendDuration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSuspendDuration(d)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${suspendDuration === d ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-700'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('admin.users.detail.reasonPlaceholder', 'Reason (required for suspend/ban)')}
            rows={2}
            className={`${adminInputClass} resize-none text-xs`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            label={t('admin.users.action.suspend', 'Suspend {{d}}', { d: suspendDuration })}
            onClick={() => onAction('suspend', { reason, duration_hours: String(DURATION_HOURS[suspendDuration]) })}
            loading={actionPending === 'suspend'}
            disabled={!reason}
            className="bg-gold-100 text-gold-800"
          />
          <ActionButton
            label={t('admin.users.action.ban', 'Ban')}
            onClick={() => onAction('ban', { reason })}
            loading={actionPending === 'ban'}
            disabled={!reason}
            className="bg-danger-100 text-danger-700"
          />
          <ActionButton
            label={t('admin.users.action.restore', 'Restore')}
            onClick={() => onAction('restore')}
            loading={actionPending === 'restore'}
            className="bg-success-100 text-success-700"
          />
          <ActionButton
            label={user.isModerator ? t('admin.users.action.revokeMod', 'Revoke Mod') : t('admin.users.action.makeMod', 'Make Mod')}
            onClick={() => onAction(user.isModerator ? 'downgrade_moderator' : 'upgrade_moderator')}
            loading={actionPending === 'upgrade_moderator' || actionPending === 'downgrade_moderator'}
            className="bg-blue-100 text-blue-700"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => Browser.open({ url: `${env.VITE_WEB_BASE_URL}/profile/${user.id}` })}
            className="flex items-center justify-center rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            {t('admin.users.detail.viewProfile', 'View Profile ↗')}
          </button>
          <button
            type="button"
            onClick={() => Browser.open({ url: `${env.VITE_WEB_BASE_URL}/admin/kyc?userId=${user.id}` })}
            className="flex items-center justify-center rounded-lg bg-teal-100 px-3 py-2 text-xs font-semibold text-teal-700"
          >
            {t('admin.users.detail.viewKyc', 'View KYC Submissions →')}
          </button>
        </div>

        <div className="space-y-2.5 rounded-lg border border-neutral-200 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.users.detail.accountSecurity', 'Account Security')}</p>
          <p className="text-[10px] text-neutral-400">
            {t('admin.users.detail.verifyEmailHint', '"Mark Email Verified" only flags the login email as confirmed — it is unrelated to identity KYC. Use "View KYC Submissions" above for identity verification.')}
          </p>
          <div className="grid grid-cols-1 gap-2">
            <ActionButton
              label={t('admin.users.action.resetPassword', 'Reset Password')}
              onClick={() => onAction('reset_password')}
              loading={actionPending === 'reset_password'}
              className="bg-amber-100 text-amber-700"
            />
            <ActionButton
              label={t('admin.users.action.force2fa', 'Force 2FA Setup')}
              onClick={() => onAction('force_2fa')}
              loading={actionPending === 'force_2fa'}
              className="bg-indigo-100 text-indigo-700"
            />
            <ActionButton
              label={t('admin.users.action.verifyEmail', 'Mark Email Verified')}
              onClick={() => onAction('verify_account')}
              loading={actionPending === 'verify_account'}
              className="bg-teal-100 text-teal-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminUsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setCursorHistory([undefined]);
    setPageIndex(0);
  }, [debouncedQuery]);

  const cursor = cursorHistory[pageIndex];
  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'users', debouncedQuery, cursor],
    queryFn: () => fetchUsers(debouncedQuery, cursor),
  });

  const goNext = () => {
    if (!data?.nextCursor) return;
    setCursorHistory((h) => [...h.slice(0, pageIndex + 1), data.nextCursor!]);
    setPageIndex((i) => i + 1);
  };
  const goPrev = () => setPageIndex((i) => Math.max(0, i - 1));

  const actionMutation = useMutation({
    mutationFn: ({ userId, action, payload }: { userId: string; action: ActionType; payload?: Record<string, string> }) =>
      apiClient.post(`/admin/users/${userId}/actions`, { action, ...payload }),
    onSuccess: () => {
      showToast(t('admin.users.actionApplied', 'Action applied successfully'));
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setSelected(null);
    },
    onError: () => showToast(t('admin.users.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.users.title', 'User Management')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <form onSubmit={(e) => { e.preventDefault(); setDebouncedQuery(query); }} className="mb-4 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder', 'Search by username, email, or ID…')}
          className={adminInputClass}
        />
        <button type="submit" className="shrink-0 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
          {t('nav.search', 'Search')}
        </button>
      </form>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}

        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

        {status === 'success' && data.users.length === 0 && (
          <AdminEmptyState
            icon="🔍"
            title={query ? t('admin.users.noResults', 'No users found') : t('admin.users.searchPrompt', 'Search to find users')}
          />
        )}

        {status === 'success' &&
          data.users.map((u) => (
            <AdminCard key={u.id} onClick={() => setSelected(u)}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">{u.avatarEmoji || '👤'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">@{u.username}</p>
                    <AdminBadge label={u.plan.toUpperCase()} color={PLAN_COLOR[u.plan]} />
                    <AdminBadge label={u.status} color={STATUS_COLOR[u.status]} />
                    {u.isModerator && <AdminBadge label={t('admin.users.mod', 'MOD')} color="blue" />}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{u.email}</p>
                  <div className="mt-1.5 flex items-center gap-3">
                    <TrustBar score={u.trustScore} />
                    <span className="text-[10px] text-neutral-400">{fmtDate(u.joinedAt)}</span>
                  </div>
                </div>
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && (data.users.length > 0 || pageIndex > 0) && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goPrev}
            disabled={pageIndex === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!data.hasMore}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {selected && (
        <UserDetailOverlay
          user={selected}
          onClose={() => setSelected(null)}
          onAction={(action, payload) => actionMutation.mutate({ userId: selected.id, action, payload })}
          actionPending={actionMutation.isPending ? (actionMutation.variables?.action ?? null) : null}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

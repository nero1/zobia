/**
 * apps/android/src/routes/admin/data-management.tsx
 *
 * Centralized Data Management — mirrors
 * apps/web/app/(admin)/gate44/data-management/page.tsx: three tabs
 * (Users/Financial/Statistical), cached quick-stat cards (30-minute Redis
 * cache, GET /admin/data-management/stats) with a "Refresh live data"
 * button, and a card-list version of the user table with Create/Delete
 * wired to the same new API endpoints as web.
 *
 * Export and Import are NOT reimplemented natively here: both are
 * multi-step flows (format/field/filter pickers, a native file picker for
 * upload, streaming CSV/TSV/XLSX/NDJSON downloads) that don't have an
 * existing file-download convention on this app to build on (no
 * @capacitor/filesystem or Share usage anywhere in apps/android today).
 * Per this app's established pattern for complex authoring flows
 * (openAuthenticatedWebLink — already used by this same file's "View KYC
 * Submissions" and game "Manage on web" links), Export/Import instead open
 * the full web Data Management page in an authenticated in-app browser tab.
 * Everything else (search/view/impersonate/suspend/ban/create/delete) is a
 * full native mirror.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';
import {
  AdminStatCard,
  AdminStatSkeleton,
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminTabs,
  AdminConfirmDialog,
  adminInputClass,
  fmtNumber,
  fmtDate,
  timeAgo,
} from '@/components/admin/AdminUI';

type Tab = 'users' | 'financial' | 'statistical';
type Plan = 'free' | 'plus' | 'pro' | 'max';
type UserStatus = 'active' | 'suspended' | 'banned';

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
  city: string;
}

interface UsersResponse {
  users: AdminUser[];
  hasMore: boolean;
  nextCursor: string | null;
}

const STATUS_COLOR: Record<UserStatus, 'green' | 'gold' | 'red'> = { active: 'green', suspended: 'gold', banned: 'red' };
const PLAN_COLOR: Record<Plan, 'neutral' | 'blue' | 'teal' | 'gold'> = { free: 'neutral', plus: 'blue', pro: 'teal', max: 'gold' };

async function fetchUsers(q: string, cursor: string | undefined): Promise<UsersResponse> {
  const params = new URLSearchParams({ limit: '20' });
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<UsersResponse>(`/admin/users?${params}`);
  return data;
}

interface StatsResponse<T> {
  tab: Tab;
  data: T;
  cachedAt: string;
  isLive: boolean;
}

async function fetchStats<T>(tab: Tab, live: boolean): Promise<StatsResponse<T>> {
  const { data } = await apiClient.get<StatsResponse<T>>(`/admin/data-management/stats?tab=${tab}${live ? '&live=1' : ''}`);
  return data;
}

// ---------------------------------------------------------------------------
// Stats header + grid
// ---------------------------------------------------------------------------

function StatsSection({ tab, cards }: { tab: Tab; cards: (data: Record<string, unknown>) => { label: string; value: string; color?: 'blue' | 'green' | 'gold' | 'red' | 'neutral' }[] }) {
  const { t } = useTranslation();
  const [live, setLive] = useState(false);
  const { data, status, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'data-management', 'stats', tab, live],
    queryFn: () => fetchStats<Record<string, unknown>>(tab, live),
  });

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {data ? (data.isLive ? `${t('admin.dataManagement.liveAsOf', 'Live as of')} ${timeAgo(data.cachedAt)}` : `${t('admin.dataManagement.cachedAgo', 'Cached')} ${timeAgo(data.cachedAt)}`) : ''}
        </span>
        <button
          type="button"
          onClick={() => { setLive(true); void refetch(); }}
          disabled={isFetching}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold text-neutral-700 disabled:opacity-50"
        >
          {isFetching ? t('admin.dataManagement.refreshing', 'Refreshing…') : t('admin.dataManagement.refreshLiveData', 'Refresh live data')}
        </button>
      </div>
      {status === 'pending' ? (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => <AdminStatSkeleton key={i} />)}
        </div>
      ) : status === 'error' ? (
        <AdminErrorState onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {cards(data.data).map((c) => (
            <AdminStatCard key={c.label} label={c.label} value={c.value} color={c.color} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create user modal
// ---------------------------------------------------------------------------

function CreateUserSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/data-management/users', {
        username,
        email: email || undefined,
        displayName: displayName || undefined,
        password: password || undefined,
      }),
    onSuccess: () => onCreated(),
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(message ?? t('admin.dataManagement.createFailed', 'Could not create user'));
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{t('admin.dataManagement.createUser', 'Create User')}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700">{error}</div>}
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('admin.dataManagement.username', 'Username *')} className={adminInputClass} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('admin.dataManagement.emailOptional', 'Email (optional)')} className={adminInputClass} />
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('admin.dataManagement.displayNameOptional', 'Display name (optional)')} className={adminInputClass} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={t('admin.dataManagement.passwordOptional', 'Password (optional)')} className={adminInputClass} />
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={username.length < 3 || createMutation.isPending}
          className="w-full rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createMutation.isPending ? t('action.saving', 'Saving…') : t('admin.dataManagement.createUser', 'Create User')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User detail overlay (search result -> view/impersonate/delete)
// ---------------------------------------------------------------------------

function UserDetailOverlay({
  user,
  onClose,
  onImpersonate,
  onDeleted,
}: {
  user: AdminUser;
  onClose: () => void;
  onImpersonate: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/admin/data-management/users/${user.id}`),
    onSuccess: () => onDeleted(),
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{t('admin.users.detail.title', 'User Detail')}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-5 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-3xl">{user.avatarEmoji || '👤'}</span>
          <div className="min-w-0">
            <p className="font-semibold text-neutral-900 truncate">@{user.username}</p>
            <p className="text-xs text-neutral-500 truncate">{user.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => Browser.open({ url: `${env.VITE_WEB_BASE_URL}/profile/${user.id}` })}
          className="w-full rounded-lg bg-neutral-100 px-3 py-2.5 text-xs font-semibold text-neutral-700"
        >
          {t('admin.users.detail.viewProfile', 'View Profile ↗')}
        </button>

        <button
          type="button"
          onClick={onImpersonate}
          className="w-full rounded-lg bg-purple-600 px-3 py-2.5 text-xs font-semibold text-white"
        >
          🎭 {t('admin.users.action.impersonate', 'Impersonate this user')}
        </button>

        <button
          type="button"
          onClick={() => void openAuthenticatedWebLink(`/gate44/users`)}
          className="w-full rounded-lg bg-blue-100 px-3 py-2.5 text-xs font-semibold text-blue-700"
        >
          {t('admin.dataManagement.moreActionsOnWeb', 'More actions (suspend/ban/mod) on web →')}
        </button>

        <div className="space-y-2 rounded-lg border border-danger-200 bg-danger-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-danger-700">{t('admin.dataManagement.dangerZone', 'Danger Zone')}</p>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending}
            className="w-full rounded-lg bg-danger-600 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {deleteMutation.isPending ? t('action.loading', 'Loading…') : t('admin.dataManagement.deleteAccount', 'Delete Account')}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <AdminConfirmDialog
          title={t('admin.dataManagement.deleteConfirmTitle', 'Delete this account?')}
          description={t('admin.dataManagement.deleteConfirmMessage', 'This will soft-delete and anonymize @{{username}}. This cannot be undone from the app.', { username: user.username })}
          confirmLabel={t('action.delete', 'Delete')}
          cancelLabel={t('action.cancel', 'Cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

function UsersTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);
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

  const impersonateMutation = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/admin/users/${userId}/impersonate`),
    onSuccess: () => { window.location.href = '/home'; },
    onError: () => showToast(t('admin.users.actionFailed', 'Action failed'), 'error'),
  });

  function refreshAfterMutation() {
    setSelected(null);
    void refetch();
    void qc.invalidateQueries({ queryKey: ['admin', 'data-management', 'stats', 'users'] });
  }

  return (
    <div>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <StatsSection
        tab="users"
        cards={(d) => [
          { label: t('admin.dataManagement.totalUsers', 'Total Users'), value: fmtNumber(Number(d.totalUsers ?? 0)) },
          { label: t('admin.dataManagement.verified', 'Verified'), value: fmtNumber(Number(d.verifiedCount ?? 0)), color: 'green' },
          { label: t('admin.dataManagement.bannedSuspended', 'Banned/Suspended'), value: `${fmtNumber(Number(d.bannedCount ?? 0))}/${fmtNumber(Number(d.suspendedCount ?? 0))}`, color: 'red' },
          { label: t('admin.dataManagement.newToday', 'New Today'), value: fmtNumber(Number(d.newToday ?? 0)), color: 'blue' },
        ]}
      />

      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setShowCreate(true)} className="flex-1 rounded-lg bg-primary-600 px-3 py-2.5 text-xs font-semibold text-white">
          + {t('admin.dataManagement.createUser', 'Create User')}
        </button>
        <button type="button" onClick={() => void openAuthenticatedWebLink('/gate44/data-management?tab=users')} className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-xs font-semibold text-neutral-700">
          {t('admin.dataManagement.exportImportOnWeb', 'Export / Import (web) →')}
        </button>
      </div>

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
          <AdminEmptyState icon="🔍" title={query ? t('admin.users.noResults', 'No users found') : t('admin.users.searchPrompt', 'Search to find users')} />
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
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{u.email}</p>
                  <span className="text-[10px] text-neutral-400">{fmtDate(u.joinedAt)}</span>
                </div>
              </div>
            </AdminCard>
          ))}
      </div>

      {status === 'success' && (data.users.length > 0 || pageIndex > 0) && (
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={goPrev} disabled={pageIndex === 0} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <button type="button" onClick={goNext} disabled={!data.hasMore} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {selected && (
        <UserDetailOverlay
          user={selected}
          onClose={() => setSelected(null)}
          onImpersonate={() => impersonateMutation.mutate(selected.id)}
          onDeleted={() => { showToast(t('admin.dataManagement.deleted', 'Account deleted')); refreshAfterMutation(); }}
        />
      )}

      {showCreate && (
        <CreateUserSheet
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); showToast(t('admin.dataManagement.userCreated', 'User created')); void refetch(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial / Statistical tabs
// ---------------------------------------------------------------------------

function FinancialTab() {
  const { t } = useTranslation();
  return (
    <div>
      <StatsSection
        tab="financial"
        cards={(d) => {
          const coinEconomy = (d.coinEconomy ?? {}) as Record<string, number>;
          const payoutSummary = (d.payoutSummary ?? {}) as { awaitingApproval?: { count: number } };
          return [
            { label: t('admin.dataManagement.coinsInCirculation', 'Coins in Circulation'), value: fmtNumber(coinEconomy.totalCoinsInCirculation ?? 0) },
            { label: t('admin.dataManagement.usersWithCoins', 'Users with Coins'), value: fmtNumber(coinEconomy.usersWithCoins ?? 0) },
            { label: t('admin.dataManagement.payoutsAwaiting', 'Payouts Awaiting'), value: fmtNumber(payoutSummary.awaitingApproval?.count ?? 0), color: 'gold' },
          ];
        }}
      />
      <div className="space-y-2">
        <button type="button" onClick={() => void openAuthenticatedWebLink('/gate44/financial')} className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700">
          {t('admin.dataManagement.openFinancial', 'Open Financial Dashboard →')}
        </button>
        <button type="button" onClick={() => void openAuthenticatedWebLink('/gate44/payouts')} className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700">
          {t('admin.dataManagement.openPayouts', 'Open Payouts Queue →')}
        </button>
      </div>
    </div>
  );
}

function StatisticalTab() {
  const { t } = useTranslation();
  return (
    <StatsSection
      tab="statistical"
      cards={(d) => [
        { label: t('admin.dataManagement.rooms', 'Rooms'), value: fmtNumber(Number(d.totalRooms ?? 0)) },
        { label: t('admin.dataManagement.roomMessages', 'Room Messages'), value: fmtNumber(Number(d.totalMessages ?? 0)) },
        { label: t('admin.dataManagement.guilds', 'Guilds'), value: fmtNumber(Number(d.totalGuilds ?? 0)) },
        { label: t('admin.dataManagement.forumThreads', 'Forum Threads'), value: fmtNumber(Number(d.totalForumThreads ?? 0)) },
        { label: t('admin.dataManagement.forumPosts', 'Forum Posts'), value: fmtNumber(Number(d.totalForumPosts ?? 0)) },
        { label: t('admin.dataManagement.polls', 'Polls'), value: fmtNumber(Number(d.totalPolls ?? 0)) },
        { label: t('admin.dataManagement.quizzes', 'Quizzes'), value: fmtNumber(Number(d.totalQuizzes ?? 0)) },
        { label: t('admin.dataManagement.tweets', 'Tweets'), value: fmtNumber(Number(d.totalTweets ?? 0)) },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DataManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">{t('admin.dataManagement.title', 'Data Management')}</h1>
      <p className="mb-4 text-xs text-neutral-500">{t('admin.dataManagement.subtitle', 'Search, export, import, and manage user accounts, plus platform-wide financial and statistical snapshots.')}</p>

      <AdminTabs
        tabs={[
          { key: 'users' as Tab, label: t('admin.dataManagement.tabs.users', 'Users') },
          { key: 'financial' as Tab, label: t('admin.dataManagement.tabs.financial', 'Financial') },
          { key: 'statistical' as Tab, label: t('admin.dataManagement.tabs.statistical', 'Statistical') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'users' && <UsersTab />}
      {tab === 'financial' && <FinancialTab />}
      {tab === 'statistical' && <StatisticalTab />}
    </div>
  );
}

export const Route = createFileRoute('/admin/data-management')({
  component: DataManagementPage,
});

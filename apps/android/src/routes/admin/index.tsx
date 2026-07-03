/**
 * apps/android/src/routes/admin/index.tsx
 *
 * Admin dashboard — mirrors apps/web/app/(admin)/admin/page.tsx:
 * live stats from GET /api/admin/overview plus quick-action links into the
 * rest of the admin section.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminStatCard, AdminStatSkeleton, AdminSectionHeader, AdminErrorState, fmtNumber, fmtCurrency } from '@/components/admin/AdminUI';

interface OverviewStats {
  active_users: { dau: number; wau: number; mau: number };
  registrations: { today: number; this_week: number };
  revenue: { today: number; this_week: number; this_month: number; currency: string };
  rooms: { active: number };
  guilds: { active: number };
  guild_wars: { active: number };
  moderation: { pending_reports: number };
  generated_at: string;
}

async function fetchOverview(): Promise<OverviewStats> {
  const { data } = await apiClient.get<OverviewStats>('/admin/overview');
  return data;
}

const QUICK_ACTIONS: { titleKey: string; titleDefault: string; descKey: string; descDefault: string; href: string }[] = [
  { titleKey: 'admin.quickActions.reviewReports', titleDefault: 'Review Reports', descKey: 'admin.quickActions.reviewReportsDesc', descDefault: 'Check pending user reports', href: '/admin/moderation' },
  { titleKey: 'admin.quickActions.manageUsers', titleDefault: 'Manage Users', descKey: 'admin.quickActions.manageUsersDesc', descDefault: 'View, ban, or verify users', href: '/admin/users' },
  { titleKey: 'admin.quickActions.announcements', titleDefault: 'Announcements', descKey: 'admin.quickActions.announcementsDesc', descDefault: 'Create or schedule announcements', href: '/admin/announcements' },
  { titleKey: 'admin.quickActions.featureFlags', titleDefault: 'Feature Flags', descKey: 'admin.quickActions.featureFlagsDesc', descDefault: 'Toggle platform features on/off', href: '/admin/feature-flags' },
  { titleKey: 'admin.quickActions.financial', titleDefault: 'Financial', descKey: 'admin.quickActions.financialDesc', descDefault: 'Payouts, balances, transactions', href: '/admin/financial' },
  { titleKey: 'admin.quickActions.flashXp', titleDefault: 'Flash XP Events', descKey: 'admin.quickActions.flashXpDesc', descDefault: 'Schedule double-XP announcements', href: '/admin/flash-xp' },
  { titleKey: 'admin.quickActions.events', titleDefault: 'Events', descKey: 'admin.quickActions.eventsDesc', descDefault: 'Seasonal and platform events', href: '/admin/events' },
  { titleKey: 'admin.quickActions.config', titleDefault: 'Config', descKey: 'admin.quickActions.configDesc', descDefault: 'CAPTCHA, age gate, provider settings', href: '/admin/config' },
  { titleKey: 'admin.quickActions.actionsLog', titleDefault: 'Actions Log', descKey: 'admin.quickActions.actionsLogDesc', descDefault: 'Automated action history', href: '/admin/actions-log' },
];

function AdminDashboardPage() {
  const { t } = useTranslation();
  const { data: stats, status, refetch } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: fetchOverview,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="px-4 py-5 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.dashboard', 'Dashboard')}</h1>
        {stats && (
          <p className="text-[11px] text-neutral-400">
            {t('admin.updated', 'Updated')} {new Date(stats.generated_at).toLocaleTimeString('en-GB')}
          </p>
        )}
      </div>

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      {status !== 'error' && (
        <>
          <section>
            <AdminSectionHeader>{t('admin.overview.activeUsers', 'Active Users')}</AdminSectionHeader>
            <div className="grid grid-cols-3 gap-2.5">
              {status === 'pending' ? (
                Array.from({ length: 3 }).map((_, i) => <AdminStatSkeleton key={i} />)
              ) : (
                <>
                  <AdminStatCard label={t('admin.overview.dau', 'DAU')} value={fmtNumber(stats?.active_users.dau ?? 0)} color="blue" />
                  <AdminStatCard label={t('admin.overview.wau', 'WAU')} value={fmtNumber(stats?.active_users.wau ?? 0)} color="blue" />
                  <AdminStatCard label={t('admin.overview.mau', 'MAU')} value={fmtNumber(stats?.active_users.mau ?? 0)} color="blue" />
                </>
              )}
            </div>
          </section>

          <section>
            <AdminSectionHeader>{t('admin.overview.revenueGrowth', 'Revenue & Growth')}</AdminSectionHeader>
            <div className="grid grid-cols-2 gap-2.5">
              {status === 'pending' ? (
                Array.from({ length: 4 }).map((_, i) => <AdminStatSkeleton key={i} />)
              ) : (
                <>
                  <AdminStatCard label={t('admin.overview.revenueToday', 'Revenue Today')} value={fmtCurrency(stats?.revenue.today ?? 0, stats?.revenue.currency)} color="gold" />
                  <AdminStatCard label={t('admin.overview.revenueWeek', 'Revenue This Week')} value={fmtCurrency(stats?.revenue.this_week ?? 0, stats?.revenue.currency)} color="gold" />
                  <AdminStatCard label={t('admin.overview.revenueMonth', 'Revenue This Month')} value={fmtCurrency(stats?.revenue.this_month ?? 0, stats?.revenue.currency)} color="gold" />
                  <AdminStatCard
                    label={t('admin.overview.newUsersToday', 'New Users Today')}
                    value={fmtNumber(stats?.registrations.today ?? 0)}
                    sub={t('admin.overview.thisWeekCount', '{{count}} this week', { count: stats?.registrations.this_week ?? 0 })}
                    color="green"
                  />
                </>
              )}
            </div>
          </section>

          <section>
            <AdminSectionHeader>{t('admin.overview.platformHealth', 'Platform Health')}</AdminSectionHeader>
            <div className="grid grid-cols-2 gap-2.5">
              {status === 'pending' ? (
                Array.from({ length: 4 }).map((_, i) => <AdminStatSkeleton key={i} />)
              ) : (
                <>
                  <AdminStatCard label={t('admin.overview.activeRooms', 'Active Rooms')} value={fmtNumber(stats?.rooms.active ?? 0)} color="green" />
                  <AdminStatCard label={t('admin.overview.activeGuilds', 'Active Guilds')} value={fmtNumber(stats?.guilds.active ?? 0)} color="green" />
                  <AdminStatCard label={t('admin.overview.activeGuildWars', 'Active Guild Wars')} value={fmtNumber(stats?.guild_wars.active ?? 0)} color="green" />
                  <AdminStatCard
                    label={t('admin.overview.pendingReports', 'Pending Reports')}
                    value={fmtNumber(stats?.moderation.pending_reports ?? 0)}
                    color={stats && stats.moderation.pending_reports > 10 ? 'red' : 'neutral'}
                  />
                </>
              )}
            </div>
          </section>

          <section>
            <AdminSectionHeader>{t('admin.overview.quickActions', 'Quick Actions')}</AdminSectionHeader>
            <div className="space-y-2">
              {QUICK_ACTIONS.map((qa) => (
                <Link
                  key={qa.href}
                  to={qa.href}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-card active:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900">{t(qa.titleKey, qa.titleDefault)}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">{t(qa.descKey, qa.descDefault)}</p>
                  </div>
                  <span className="shrink-0 text-neutral-400">→</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/')({
  component: AdminDashboardPage,
});

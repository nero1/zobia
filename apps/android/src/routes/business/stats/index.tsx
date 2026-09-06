/**
 * apps/android/src/routes/business/stats/index.tsx
 *
 * Business stats — mirrors apps/web/app/(app)/business/stats/page.tsx.
 * Depth gated by tier (starter: totals; growth: + per-page; enterprise:
 * + 90-day daily drill-down + CSV export, downloaded via the web app since
 * a file download isn't meaningful inside the Capacitor webview).
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Totals {
  page_count: number;
  total_views: number;
  total_post_views: number;
  total_ad_impressions: number;
  total_ad_clicks: number;
}

interface PageStatRow {
  id: string;
  name: string;
  view_count: number;
  post_count: number;
  ad_impressions: number;
  ad_clicks: number;
}

async function fetchStats() {
  const { data } = await apiClient.get<{ tier: string; totals: Totals; pageBreakdown: PageStatRow[] | null; canExport: boolean }>('/business/pages/stats');
  return data;
}

function BusinessStatsPage() {
  const { t } = useTranslation();
  const { data, status } = useQuery({ queryKey: ['business', 'stats'], queryFn: fetchStats, staleTime: 30_000 });

  if (status === 'pending') return <div className="p-6 text-center text-neutral-400">{t('action.loading', 'Loading…')}</div>;

  const totals = data?.totals;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Link to="/business" className="text-sm text-neutral-500">← {t('business.title', 'Business')}</Link>
      </div>
      <h1 className="text-lg font-bold text-neutral-900 mb-3">{t('business.stats.title', 'Stats')}</h1>

      {totals && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { label: t('business.stats.pages', 'Pages'), value: totals.page_count },
            { label: t('business.stats.pageViews', 'Page views'), value: totals.total_views },
            { label: t('business.stats.postViews', 'Post views'), value: totals.total_post_views },
            { label: t('business.stats.adImpressions', 'Ad impressions'), value: totals.total_ad_impressions },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-3 shadow-card">
              <p className="text-xs text-neutral-500">{s.label}</p>
              <p className="text-lg font-bold text-neutral-900">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {data?.tier === 'basic' && (
        <p className="text-xs text-neutral-500 mb-3">{t('business.stats.upgradeHint', 'Upgrade to Growth for a per-page breakdown, or Enterprise for a 90-day daily drill-down and CSV export.')}</p>
      )}

      {data?.pageBreakdown && data.pageBreakdown.length > 0 && (
        <div className="space-y-2">
          {data.pageBreakdown.map((p) => (
            <div key={p.id} className="bg-white rounded-xl p-3 shadow-card flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-900 truncate">{p.name}</p>
              <p className="text-xs text-neutral-400">👁 {p.view_count} · 📝 {p.post_count}</p>
            </div>
          ))}
        </div>
      )}

      {data?.canExport && (
        <p className="mt-4 text-xs text-neutral-400 text-center">{t('business.stats.exportOnWeb', 'CSV export is available on web/PWA under Business → Stats.')}</p>
      )}
    </div>
  );
}

export const Route = createFileRoute('/business/stats/')({
  component: BusinessStatsPage,
});

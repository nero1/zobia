"use client";

/**
 * app/(app)/business/stats/page.tsx
 *
 * Business account stats — depth gated by tier (starter: totals only;
 * growth: + per-page breakdown; enterprise: + 90-day daily drill-down and
 * CSV export). Mirrors app/(app)/blogs/dashboard/stats/page.tsx exactly.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

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
  slug: string;
  status: string;
  view_count: number;
  post_count: number;
  ad_impressions: number;
  ad_clicks: number;
}

interface DailyStatRow {
  date: string;
  page_id: string;
  page_name: string;
  views: number;
  post_views: number;
  ad_impressions: number;
  ad_clicks: number;
}

export default function BusinessStatsPage() {
  const [tier, setTier] = useState<string>("basic");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [pageBreakdown, setPageBreakdown] = useState<PageStatRow[] | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStatRow[] | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/business/pages/stats", { credentials: "include" });
      const json = await res.json().catch(() => null);
      const data = json?.data;
      setTier(data?.tier ?? "basic");
      setTotals(data?.totals ?? null);
      setPageBreakdown(data?.pageBreakdown ?? null);
      setDailyStats(data?.dailyStats ?? null);
      setCanExport(!!data?.canExport);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-8 text-neutral-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/business" className="text-sm text-neutral-500 hover:underline">← Business</Link>
          <span className="text-neutral-300">/</span>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Stats</h1>
        </div>
        {canExport && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- API route download, not an app page
          <a href="/api/business/pages/stats/export" className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            ⬇ Export CSV
          </a>
        )}
      </div>

      {totals && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Pages", value: totals.page_count },
            { label: "Page views", value: totals.total_views },
            { label: "Post views", value: totals.total_post_views },
            { label: "Ad impressions", value: totals.total_ad_impressions },
            { label: "Ad clicks", value: totals.total_ad_clicks },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-xs text-neutral-500">{s.label}</div>
              <div className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{s.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {tier === "basic" && (
        <p className="mb-4 text-sm text-neutral-500">
          Upgrade to Growth for a per-page breakdown, or Enterprise for a 90-day daily drill-down and CSV export.
        </p>
      )}

      {pageBreakdown && (
        <div className="mb-6 overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-neutral-500">
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Views</th>
                <th className="px-3 py-2">Posts</th>
                <th className="px-3 py-2">Ad Impressions</th>
                <th className="px-3 py-2">Ad Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {pageBreakdown.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[180px] truncate px-3 py-2 text-neutral-900 dark:text-neutral-100">{p.name}</td>
                  <td className="px-3 py-2 tabular-nums">{p.view_count}</td>
                  <td className="px-3 py-2 tabular-nums">{p.post_count}</td>
                  <td className="px-3 py-2 tabular-nums">{p.ad_impressions}</td>
                  <td className="px-3 py-2 tabular-nums">{p.ad_clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dailyStats && dailyStats.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-neutral-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Views</th>
                <th className="px-3 py-2">Ad Impressions</th>
                <th className="px-3 py-2">Ad Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {dailyStats.map((d, i) => (
                <tr key={`${d.page_id}-${d.date}-${i}`}>
                  <td className="px-3 py-2 tabular-nums">{d.date}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-neutral-900 dark:text-neutral-100">{d.page_name}</td>
                  <td className="px-3 py-2 tabular-nums">{d.views}</td>
                  <td className="px-3 py-2 tabular-nums">{d.ad_impressions}</td>
                  <td className="px-3 py-2 tabular-nums">{d.ad_clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

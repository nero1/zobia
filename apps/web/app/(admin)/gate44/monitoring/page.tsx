"use client";

/**
 * app/(admin)/gate44/monitoring/page.tsx
 *
 * Platform health dashboard: uptime proxy, alert volume by priority, CRON
 * job freshness, Redis reachability, and a recent-alert log feed. Backed by
 * /api/admin/monitoring/stats which is cached in Redis for 30 minutes
 * (lib/admin/statsCache.ts) — this page is deliberately not real-time, per
 * the "highly scalable, doesn't need to be up-to-the-second accurate, load
 * only what's necessary" requirement.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ALERT_PRIORITY_LEVELS } from "@/lib/alerts/types";

interface MonitoringData {
  uptime30d: { uptimePercent: number; outageMinutes: number; windowDays: number };
  uptime24h: { uptimePercent: number; outageMinutes: number; windowDays: number };
  alertVolume: { last24h: Record<number, number>; active: Record<number, number> };
  cronHealth: Array<{ key: string; lastRunAt: string; ageHours: number; stale: boolean }>;
  redisHealth: { reachable: boolean; latencyMs: number | null };
  recentLog: Array<{ id: string; type: string; title: string; priorityLevel: number; category: string; resolved: boolean; createdAt: string }>;
  cacheHitStats: { available: boolean; hits: number; misses: number; hitRatioPercent: number | null };
  slowQueries: { available: boolean; queries: Array<{ query: string; calls: number; meanExecMs: number; maxExecMs: number; totalExecMs: number }> };
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "neutral" }) {
  const toneClasses = tone === "good" ? "text-teal-600 dark:text-teal-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-50";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClasses}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MonitoringPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [data, setData] = useState<MonitoringData | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setIsAdmin(!!(json?.user ?? json)?.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const load = useCallback(async (live: boolean) => {
    if (live) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/stats${live ? "?live=1" : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load monitoring stats");
      const json = await res.json();
      setData(json.data);
      setCachedAt(json.cachedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load(false);
    else if (isAdmin === false) setLoading(false);
  }, [isAdmin, load]);

  if (isAdmin === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Monitoring</h1>
          {cachedAt && <p className="text-xs text-neutral-400">Snapshot from {timeAgo(cachedAt)} · <Link href="/gate44/alerts" className="text-teal-600 hover:underline dark:text-teal-400">View Alerts</Link></p>}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="rounded-lg bg-teal-100 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
        >
          {refreshing ? "Refreshing…" : "Refresh live data"}
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {loading || !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Uptime (30d)"
              value={`${data.uptime30d.uptimePercent}%`}
              sub={data.uptime30d.outageMinutes > 0 ? `${data.uptime30d.outageMinutes}m downtime` : "No outages"}
              tone={data.uptime30d.uptimePercent >= 99.9 ? "good" : "bad"}
            />
            <StatCard
              label="Uptime (24h)"
              value={`${data.uptime24h.uptimePercent}%`}
              sub={data.uptime24h.outageMinutes > 0 ? `${data.uptime24h.outageMinutes}m downtime` : "No outages"}
              tone={data.uptime24h.uptimePercent >= 99.9 ? "good" : "bad"}
            />
            <StatCard
              label="Redis"
              value={data.redisHealth.reachable ? "Reachable" : "Unreachable"}
              sub={data.redisHealth.latencyMs != null ? `${data.redisHealth.latencyMs}ms round-trip` : undefined}
              tone={data.redisHealth.reachable ? "good" : "bad"}
            />
            <StatCard
              label="Stale CRON jobs"
              value={String(data.cronHealth.filter((c) => c.stale).length)}
              sub={`${data.cronHealth.length} tracked`}
              tone={data.cronHealth.some((c) => c.stale) ? "bad" : "good"}
            />
            <StatCard
              label="Cache Hit Ratio"
              value={data.cacheHitStats.available ? (data.cacheHitStats.hitRatioPercent != null ? `${data.cacheHitStats.hitRatioPercent}%` : "No traffic yet") : "Unavailable"}
              sub={data.cacheHitStats.available ? `${data.cacheHitStats.hits} hits / ${data.cacheHitStats.misses} misses` : "Redis INFO stats not supported by this provider"}
              tone={!data.cacheHitStats.available ? "neutral" : data.cacheHitStats.hitRatioPercent != null && data.cacheHitStats.hitRatioPercent < 80 ? "bad" : "good"}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Alert Volume by Priority</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {([1, 2, 3, 4, 5, 6] as const).map((level) => {
                const def = ALERT_PRIORITY_LEVELS[level];
                return (
                  <div key={level} className="rounded-xl border p-3 text-center" style={{ borderColor: def.color }}>
                    <p className="text-xs font-semibold" style={{ color: def.color }}>L{level}</p>
                    <p className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">{data.alertVolume.active[level] ?? 0}</p>
                    <p className="text-[10px] text-neutral-400">active</p>
                    <p className="mt-1 text-xs text-neutral-500">{data.alertVolume.last24h[level] ?? 0} in 24h</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">CRON Job Freshness</h2>
            <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {data.cronHealth.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-neutral-500">No CRON jobs have run yet.</p>
              ) : (
                data.cronHealth.map((c) => (
                  <div key={c.key} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-neutral-900 dark:text-neutral-100">{c.key}</span>
                    <span className={`text-xs ${c.stale ? "font-semibold text-red-600 dark:text-red-400" : "text-neutral-400"}`}>
                      {c.stale ? "STALE — " : ""}{timeAgo(c.lastRunAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Recent System Log</h2>
            <p className="mb-2 text-xs text-neutral-400">Most recent alerts across all priority levels (also visible on the Alerts Dashboard).</p>
            <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {data.recentLog.map((a) => {
                const def = ALERT_PRIORITY_LEVELS[a.priorityLevel as 1 | 2 | 3 | 4 | 5 | 6] ?? ALERT_PRIORITY_LEVELS[6];
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: def.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-900 dark:text-neutral-100">{a.title}</span>
                    {a.resolved && <span className="shrink-0 text-[10px] text-neutral-400">resolved</span>}
                    <span className="shrink-0 text-xs text-neutral-400">{timeAgo(a.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Slowest Queries (by mean time)</h2>
            <p className="mb-2 text-xs text-neutral-400">
              From pg_stat_statements — normalised query text (literals replaced with $1, $2, …), safe to display.
            </p>
            {!data.slowQueries.available ? (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50">
                pg_stat_statements is not enabled on this database. See migration 0049 and docs/SETUP.md.
              </div>
            ) : data.slowQueries.queries.length === 0 ? (
              <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">No query stats recorded yet.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
                      <th className="px-3 py-2 font-medium">Query</th>
                      <th className="px-3 py-2 font-medium">Calls</th>
                      <th className="px-3 py-2 font-medium">Mean (ms)</th>
                      <th className="px-3 py-2 font-medium">Max (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slowQueries.queries.map((q, i) => (
                      <tr key={i} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/50">
                        <td className="max-w-md truncate px-3 py-2 font-mono text-neutral-700 dark:text-neutral-300" title={q.query}>{q.query}</td>
                        <td className="px-3 py-2 text-neutral-500">{q.calls}</td>
                        <td className="px-3 py-2 font-semibold text-neutral-900 dark:text-neutral-100">{q.meanExecMs}</td>
                        <td className="px-3 py-2 text-neutral-500">{q.maxExecMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/monitoring/stats?live=1
 *
 * Lightweight platform health snapshot for /gate44/monitoring:
 *  - Uptime proxy (derived from Level 1 "site" alert history — no separate
 *    uptime pinger needed, keeping this zero-cost).
 *  - Alert volume by priority level (last 24h) + currently-active counts.
 *  - CRON job freshness (from cron_state, written by every CRON handler).
 *  - Redis reachability + round-trip latency.
 *  - Recent system alert feed (doubles as a lightweight system log — the
 *    platform doesn't run a separate log aggregator).
 *
 *  - Cache hit ratio, read from Redis's own INFO stats counters (zero added
 *    overhead — Redis already tracks these on every command it processes).
 *  - Slow queries, read from pg_stat_statements (a stock Postgres extension
 *    that aggregates timing in shared memory as queries run — not a
 *    third-party APM, adds no per-query overhead). Reports "unavailable"
 *    rather than faking data if the extension isn't enabled — see
 *    migration 0049 and docs/SETUP.md.
 *
 * Cached in Redis for 30 minutes (lib/admin/statsCache.ts) — pass `live=1`
 * to force a fresh computation. Deliberately NOT up-to-the-second accurate;
 * this is a dashboard, not an APM.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAdminAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getCachedStats } from "@/lib/admin/statsCache";
import { getCacheHitStats } from "@/lib/redis/stats";
import { getSlowQueries } from "@/lib/db/slowQueries";
import { logger } from "@/lib/logger";

const querySchema = z.object({ live: z.string().optional() });

const UPTIME_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Uptime proxy — derived from Level 1 "site" alert open-duration, no pinger
// ---------------------------------------------------------------------------

interface OutageAlertRow {
  created_at: string;
  resolved_at: string | null;
}

async function computeUptime(windowDays: number, now: Date): Promise<{ uptimePercent: number; outageMinutes: number; windowDays: number }> {
  const windowStart = new Date(now.getTime() - windowDays * 24 * 3_600_000);
  const { rows } = await db.query<OutageAlertRow>(
    `SELECT created_at, resolved_at FROM system_alerts
     WHERE priority_level = 1 AND category = 'site'
       AND created_at < $2
       AND (resolved_at IS NULL OR resolved_at > $1)`,
    [windowStart.toISOString(), now.toISOString()]
  );

  let outageMs = 0;
  for (const row of rows) {
    const start = Math.max(new Date(row.created_at).getTime(), windowStart.getTime());
    const end = Math.min(row.resolved_at ? new Date(row.resolved_at).getTime() : now.getTime(), now.getTime());
    if (end > start) outageMs += end - start;
  }

  const windowMs = windowDays * 24 * 3_600_000;
  const uptimePercent = windowMs > 0 ? Math.max(0, 100 - (outageMs / windowMs) * 100) : 100;
  return { uptimePercent: Math.round(uptimePercent * 1000) / 1000, outageMinutes: Math.round(outageMs / 60_000), windowDays };
}

// ---------------------------------------------------------------------------
// Alert volume
// ---------------------------------------------------------------------------

async function computeAlertVolume(now: Date) {
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const [{ rows: last24h }, { rows: active }] = await Promise.all([
    db.query<{ priority_level: number; count: string }>(
      `SELECT priority_level, COUNT(*)::text AS count FROM system_alerts WHERE created_at >= $1 GROUP BY priority_level`,
      [dayAgo]
    ),
    db.query<{ priority_level: number; count: string }>(
      `SELECT priority_level, COUNT(*)::text AS count FROM system_alerts WHERE resolved = false GROUP BY priority_level`
    ),
  ]);
  const toMap = (rows: { priority_level: number; count: string }[]) => {
    const map: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const r of rows) map[r.priority_level] = parseInt(r.count, 10);
    return map;
  };
  return { last24h: toMap(last24h), active: toMap(active) };
}

// ---------------------------------------------------------------------------
// CRON health
// ---------------------------------------------------------------------------

interface CronStateRow {
  key: string;
  value_ts: string | null;
  updated_at: string;
}

async function computeCronHealth(now: Date) {
  const { rows } = await db.query<CronStateRow>(`SELECT key, value_ts, updated_at FROM cron_state ORDER BY key ASC LIMIT 100`);
  return rows.map((r) => {
    const lastRun = r.value_ts ?? r.updated_at;
    const ageHours = (now.getTime() - new Date(lastRun).getTime()) / 3_600_000;
    return { key: r.key, lastRunAt: lastRun, ageHours: Math.round(ageHours * 10) / 10, stale: ageHours > 26 };
  });
}

// ---------------------------------------------------------------------------
// Redis reachability
// ---------------------------------------------------------------------------

async function computeRedisHealth(): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const probeKey = "monitoring:redis:probe";
  const start = Date.now();
  try {
    await redis.set(probeKey, "1", "EX", 10);
    await redis.get(probeKey);
    return { reachable: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, "[monitoring] redis probe failed");
    return { reachable: false, latencyMs: null };
  }
}

// ---------------------------------------------------------------------------
// Recent alert feed (lightweight system log proxy)
// ---------------------------------------------------------------------------

interface RecentAlertRow {
  id: string;
  type: string;
  title: string;
  priority_level: number;
  category: string;
  resolved: boolean;
  created_at: string;
}

async function computeRecentLog() {
  const { rows } = await db.query<RecentAlertRow>(
    `SELECT id, type, title, priority_level, category, resolved, created_at
     FROM system_alerts ORDER BY created_at DESC LIMIT 20`
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    priorityLevel: r.priority_level,
    category: r.category,
    resolved: r.resolved,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Aggregate compute
// ---------------------------------------------------------------------------

async function computeMonitoringStats() {
  const now = new Date();
  const [uptime30d, uptime24h, alertVolume, cronHealth, redisHealth, recentLog, cacheHitStats, slowQueries] = await Promise.all([
    computeUptime(UPTIME_WINDOW_DAYS, now),
    computeUptime(1, now),
    computeAlertVolume(now),
    computeCronHealth(now),
    computeRedisHealth(),
    computeRecentLog(),
    getCacheHitStats(),
    getSlowQueries(10),
  ]);

  return {
    uptime30d,
    uptime24h,
    alertVolume,
    cronHealth,
    redisHealth,
    recentLog,
    cacheHitStats,
    slowQueries,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const { live } = validateSearchParams(searchParams, querySchema);
    const isLive = live === "1" || live === "true";

    const result = await getCachedStats("monitoring", computeMonitoringStats, { live: isLive });

    return NextResponse.json({ data: result.data, cachedAt: result.cachedAt, isLive: result.isLive }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

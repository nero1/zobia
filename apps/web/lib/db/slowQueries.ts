/**
 * lib/db/slowQueries.ts
 *
 * Slow-query stats for the /gate44/monitoring dashboard, read from
 * `pg_stat_statements` — a stock Postgres extension (not a third-party APM)
 * that aggregates per-normalised-query timing in shared memory as queries
 * run. Reading it later is one cheap SELECT against a system view; nothing
 * about running this query adds overhead to the app's own query path.
 *
 * Requires the extension to be enabled (see migration 0048's best-effort
 * `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`, and docs/SETUP.md —
 * most managed Postgres providers, including Supabase, ship it preloaded).
 * Gracefully reports `available: false` when it isn't installed rather than
 * throwing, so the monitoring page degrades instead of breaking.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface SlowQueryStat {
  /** Normalised query text (literals replaced with $1, $2, … by Postgres itself — safe to display). */
  query: string;
  calls: number;
  meanExecMs: number;
  maxExecMs: number;
  totalExecMs: number;
}

export interface SlowQueryReport {
  available: boolean;
  queries: SlowQueryStat[];
}

interface PgStatStatementsRow {
  query: string;
  calls: string;
  mean_exec_time: string;
  max_exec_time: string;
  total_exec_time: string;
}

const DEFAULT_LIMIT = 10;
/** Truncate displayed query text — this is a dashboard, not a query editor. */
const QUERY_TEXT_MAX_CHARS = 300;

export async function getSlowQueries(limit: number = DEFAULT_LIMIT): Promise<SlowQueryReport> {
  try {
    const { rows } = await db.query<PgStatStatementsRow>(
      `SELECT query, calls, mean_exec_time, max_exec_time, total_exec_time
       FROM pg_stat_statements
       WHERE query NOT ILIKE '%pg_stat_statements%'
       ORDER BY mean_exec_time DESC
       LIMIT $1`,
      [limit]
    );

    return {
      available: true,
      queries: rows.map((r) => ({
        query: r.query.length > QUERY_TEXT_MAX_CHARS ? `${r.query.slice(0, QUERY_TEXT_MAX_CHARS)}…` : r.query,
        calls: parseInt(r.calls, 10),
        meanExecMs: Math.round(parseFloat(r.mean_exec_time) * 100) / 100,
        maxExecMs: Math.round(parseFloat(r.max_exec_time) * 100) / 100,
        totalExecMs: Math.round(parseFloat(r.total_exec_time)),
      })),
    };
  } catch (err) {
    // Most commonly: extension not installed (42P01 relation does not exist).
    // Any other failure degrades the same way — this is a dashboard, not a
    // critical path, so it should never throw up to the caller.
    logger.warn({ err }, "[db/slowQueries] pg_stat_statements unavailable");
    return { available: false, queries: [] };
  }
}

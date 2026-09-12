export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * app/api/cron/feed-refresh/route.ts
 *
 * 10-15 minute CRON handler for the Home Dashboard feed.
 *
 * IMPORTANT — Vercel Hobby only allows daily CRON schedules (see
 * apps/web/vercel.json), so this route is deliberately NOT registered
 * there. The product owner runs it externally via cron-jobs.org (or
 * similar) hitting this URL every 10-15 minutes:
 *
 *   URL:    POST (or GET) https://<your-domain>/api/cron/feed-refresh
 *   Header: Authorization: Bearer <CRON_SECRET>
 *   Every:  10-15 minutes
 *
 * Responsibilities (idempotent — safe to call multiple times, and safe to
 * call concurrently with itself if two triggers overlap):
 *  1. Recompute the "for_you" and "trending" Home Feed candidate pools and
 *     write them to the two-tier cache (lib/feed/cache.ts), respecting the
 *     admin-configurable homeFeed.cacheTtlSeconds TTL.
 *  2. Fold recent content_engagement_signals into weighted user_interests
 *     rows (source='implicit'), then delete signals older than 30 days
 *     (simple TTL cleanup — see migration 0051 header comment).
 *  3. If homeFeed.zobianOfMonthAutoComputeEnabled and no admin override
 *     exists for the current month, compute/upsert Zobian of the Month from
 *     monthly XP gain (never overwrites an admin override — see
 *     lib/feed/zobianOfMonth.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { loadManifest } from "@/lib/manifest";
import { refreshCandidatePools } from "@/lib/feed/aggregator";
import { autoComputeZobianOfMonth } from "@/lib/feed/zobianOfMonth";

const IMPLICIT_SIGNAL_WEIGHTS: Record<string, number> = {
  view: 0.5,
  open: 0.5,
  like: 2,
  comment: 3,
  share: 4,
};

const SIGNAL_RETENTION_DAYS = 30;

/**
 * Fold content_engagement_signals rows that have an interest_tag into
 * weighted user_interests (source='implicit') rows, then prune signals
 * older than the retention window. Signals without an interest_tag (a
 * content type with no tagging) are counted toward the retention cleanup
 * but don't produce a user_interests row — see lib/feed/ranking.ts header
 * comment on the current tagging simplification.
 */
async function aggregateEngagementSignals(): Promise<{ upserted: number; pruned: number }> {
  const { rowCount: upserted } = await db.query(
    `INSERT INTO user_interests (user_id, interest_tag, source, weight)
     SELECT
       s.user_id,
       COALESCE(s.interest_tag, s.content_type) AS interest_tag,
       'implicit',
       SUM(
         CASE s.event_type
           WHEN 'like' THEN 2 WHEN 'comment' THEN 3 WHEN 'share' THEN 4
           ELSE 0.5
         END
       )
     FROM content_engagement_signals s
     WHERE s.created_at > NOW() - INTERVAL '1 day'
     GROUP BY s.user_id, COALESCE(s.interest_tag, s.content_type)
     ON CONFLICT (user_id, interest_tag, source) DO UPDATE
       SET weight = user_interests.weight + EXCLUDED.weight, updated_at = NOW()`
  );

  const { rowCount: pruned } = await db.query(
    `DELETE FROM content_engagement_signals WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [SIGNAL_RETENTION_DAYS]
  );

  return { upserted: upserted ?? 0, pruned: pruned ?? 0 };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result: {
    pools?: { forYouCount: number; trendingCount: number };
    interests?: { upserted: number; pruned: number };
    zobianOfMonth?: { computed: boolean; userId: string | null; skipped?: boolean };
    errors: string[];
  } = { errors: [] };

  try {
    result.pools = await refreshCandidatePools();
  } catch (err) {
    logger.error({ err }, "[cron:feed-refresh] Failed to refresh candidate pools");
    result.errors.push("candidate_pools");
  }

  try {
    result.interests = await aggregateEngagementSignals();
  } catch (err) {
    logger.error({ err }, "[cron:feed-refresh] Failed to aggregate engagement signals");
    result.errors.push("engagement_signals");
  }

  try {
    const manifest = await loadManifest();
    if (manifest.homeFeed.zobianOfMonthAutoComputeEnabled) {
      result.zobianOfMonth = await autoComputeZobianOfMonth();
    } else {
      result.zobianOfMonth = { computed: false, userId: null, skipped: true };
    }
  } catch (err) {
    logger.error({ err }, "[cron:feed-refresh] Failed to auto-compute Zobian of the Month");
    result.errors.push("zobian_of_month");
  }

  const durationMs = Date.now() - startedAt;
  logger.info({ ...result, durationMs }, "[cron:feed-refresh] run complete");

  return NextResponse.json({ success: result.errors.length === 0, data: { ...result, durationMs }, error: null });
}

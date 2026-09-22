/**
 * lib/referrals/visits.ts
 *
 * Referral link click/visit tracking — separate from the `referrals` table,
 * which only records completed sign-ups/qualifications. A "visit" is any
 * page load carrying a valid `?r=<code>` referral parameter, whether or not
 * the visitor ever signs up, so referrers can see their link's actual reach
 * (see PRD "Referral System — Two-Tier" and gate44/settings/referrals).
 *
 * Deduped per (referrer, visitor, day) at the database level — see
 * db/migrations/0004_referral_visits.sql — so a single stat write per
 * visitor per referrer per day is all this ever costs, regardless of how
 * many times that visitor reloads the page.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordVisitInput {
  code: string;
  path: string;
  visitorKey: string;
}

export interface VisitStats {
  /** All-time count of distinct (visitor, day) visits to this referrer's links. */
  totalVisits: number;
  /** Visits in the last 30 days, one entry per day (oldest first), zero-filled. */
  last30Days: { date: string; visits: number }[];
  /** Top 5 paths by visit count, all-time. */
  topPaths: { path: string; visits: number }[];
  /** signups (tier-1 referrals) / totalVisits, rounded to 2 decimals. Null if no visits yet. */
  conversionRate: number | null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Record one referral-link visit. Silently no-ops if the code doesn't
 * resolve to a user (invalid/stale code) or the visit was already counted
 * for this (referrer, visitor, day) — both are expected, not errors.
 */
export async function recordReferralVisit(input: RecordVisitInput): Promise<void> {
  const referrerResult = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE referral_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.code]
  );
  const referrerId = referrerResult.rows[0]?.id;
  if (!referrerId) return;

  await db.query(
    `INSERT INTO referral_visits (referrer_id, code, path, visitor_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (referrer_id, visitor_key, visited_date) DO NOTHING`,
    [referrerId, input.code, input.path.slice(0, 500), input.visitorKey.slice(0, 200)]
  );
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Basic stat available to every plan: just the all-time total. */
export async function getBasicVisitCount(referrerId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM referral_visits WHERE referrer_id = $1`,
    [referrerId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Full detail (daily breakdown, top paths, conversion rate) — gated by plan, see visitStatsTier(). */
export async function getFullVisitStats(referrerId: string, tier1SignupCount: number): Promise<VisitStats> {
  const [totalResult, dailyResult, pathsResult] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM referral_visits WHERE referrer_id = $1`,
      [referrerId]
    ),
    db.query<{ day: string; count: string }>(
      `SELECT visited_date::text AS day, COUNT(*)::text AS count
       FROM referral_visits
       WHERE referrer_id = $1 AND visited_date >= CURRENT_DATE - INTERVAL '29 days'
       GROUP BY visited_date`,
      [referrerId]
    ),
    db.query<{ path: string; count: string }>(
      `SELECT path, COUNT(*)::text AS count
       FROM referral_visits
       WHERE referrer_id = $1
       GROUP BY path
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
      [referrerId]
    ),
  ]);

  const byDay = new Map(dailyResult.rows.map((r) => [r.day, Number(r.count)]));
  const last30Days: { date: string; visits: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    last30Days.push({ date: key, visits: byDay.get(key) ?? 0 });
  }

  const totalVisits = Number(totalResult.rows[0]?.count ?? 0);

  return {
    totalVisits,
    last30Days,
    topPaths: pathsResult.rows.map((r) => ({ path: r.path, visits: Number(r.count) })),
    conversionRate: totalVisits > 0 ? Math.round((tier1SignupCount / totalVisits) * 10000) / 100 : null,
  };
}

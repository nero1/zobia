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

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
// `referralVisits` is not included in the aggregate `schema` object exported
// from lib/db/schema.ts (schema/DB mismatch — reported upstream), even
// though the table itself is defined and exported there — imported directly
// to work around that gap.
import { referralVisits } from "@/lib/db/schema";

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
  const orm = await getDb();
  const referrerRows = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.referralCode, input.code), isNull(schema.users.deletedAt)))
    .limit(1);
  const referrerId = referrerRows[0]?.id;
  if (!referrerId) return;

  await orm
    .insert(referralVisits)
    .values({
      referrerId,
      code: input.code,
      path: input.path.slice(0, 500),
      visitorKey: input.visitorKey.slice(0, 200),
    })
    .onConflictDoNothing({
      target: [referralVisits.referrerId, referralVisits.visitorKey, referralVisits.visitedDate],
    });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Basic stat available to every plan: just the all-time total. */
export async function getBasicVisitCount(referrerId: string): Promise<number> {
  const orm = await getDb();
  const rows = await orm
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(referralVisits)
    .where(eq(referralVisits.referrerId, referrerId));
  return Number(rows[0]?.count ?? 0);
}

/** Full detail (daily breakdown, top paths, conversion rate) — gated by plan, see visitStatsTier(). */
export async function getFullVisitStats(referrerId: string, tier1SignupCount: number): Promise<VisitStats> {
  const orm = await getDb();
  const [totalResult, dailyResult, pathsResult] = await Promise.all([
    orm
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(referralVisits)
      .where(eq(referralVisits.referrerId, referrerId)),
    orm
      .select({ day: sql<string>`${referralVisits.visitedDate}::text`, count: sql<string>`COUNT(*)::text` })
      .from(referralVisits)
      .where(
        and(
          eq(referralVisits.referrerId, referrerId),
          gte(referralVisits.visitedDate, sql`CURRENT_DATE - INTERVAL '29 days'`)
        )
      )
      .groupBy(referralVisits.visitedDate),
    orm
      .select({ path: referralVisits.path, count: sql<string>`COUNT(*)::text` })
      .from(referralVisits)
      .where(eq(referralVisits.referrerId, referrerId))
      .groupBy(referralVisits.path)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(5),
  ]);

  const byDay = new Map(dailyResult.map((r) => [r.day, Number(r.count)]));
  const last30Days: { date: string; visits: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    last30Days.push({ date: key, visits: byDay.get(key) ?? 0 });
  }

  const totalVisits = Number(totalResult[0]?.count ?? 0);

  return {
    totalVisits,
    last30Days,
    topPaths: pathsResult.map((r) => ({ path: r.path, visits: Number(r.count) })),
    conversionRate: totalVisits > 0 ? Math.round((tier1SignupCount / totalVisits) * 10000) / 100 : null,
  };
}

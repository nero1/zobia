/**
 * lib/creator/fund.ts
 *
 * Creator Fund — monthly pool distributed to eligible creators.
 *
 * PRD §24: Distribution is based on a weighted score comprising:
 *   40% — Engagement score (rooms hosted, messages, reactions received)
 *   25% — Growth       (new followers/members gained in the period)
 *   20% — Quest completions (sponsored + platform quests completed)
 *   15% — Consistency  (active days in the 30-day window)
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";

export interface CreatorFundDistribution {
  creatorId: string;
  rank: number;
  score: number;
  sharePercent: number;
  amountKobo: number;
}

// ---------------------------------------------------------------------------
// Score weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const W_ENGAGEMENT  = 0.40;
const W_GROWTH      = 0.25;
const W_QUESTS      = 0.20;
const W_CONSISTENCY = 0.15;

// ---------------------------------------------------------------------------
// Distribution tiers (top % of eligible creators per tier, pool share %)
// ---------------------------------------------------------------------------

const DISTRIBUTION_TIERS = [
  { topPercent:  1, poolShare: 30 },
  { topPercent:  5, poolShare: 25 },
  { topPercent: 10, poolShare: 20 },
  { topPercent: 25, poolShare: 15 },
  { topPercent: 50, poolShare: 10 },
];

// ---------------------------------------------------------------------------
// Raw metrics row from the DB
// ---------------------------------------------------------------------------

interface CreatorMetrics {
  id: string;
  gender: string | null;
  /** XP earned in the last 30 days (proxy for engagement). */
  xp_earned_30d: number;
  /** New followers gained in the last 30 days. */
  new_followers_30d: number;
  /** Sponsored + platform quests completed in the last 30 days. */
  quests_completed_30d: number;
  /** Distinct calendar days the user was active in the last 30 days. */
  active_days_30d: number;
}

// ---------------------------------------------------------------------------
// Normalisation helper
// ---------------------------------------------------------------------------

/** Min-max normalise an array of values to [0, 1].
 * When all values are equal (max === min), returns uniform weight of 1 so that
 * multiplicative boosts (e.g. IWD female-creator bonus) still take effect.
 */
function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

// ---------------------------------------------------------------------------
// calculateFundDistributions
// ---------------------------------------------------------------------------

export async function calculateFundDistributions(
  poolKobo: number,
  dbClient: TransactionClient | typeof db = db
): Promise<CreatorFundDistribution[]> {
  // Check for an active IWD / female-creator cultural event boost
  const { rows: eventRows } = await dbClient.query<{ multiplier: string }>(
    `SELECT xp_multiplier::TEXT AS multiplier
     FROM platform_events
     WHERE event_type = 'cultural'
       AND (metadata->>'female_creator_only')::boolean = true
       AND starts_at <= NOW()
       AND ends_at > NOW()
     ORDER BY xp_multiplier DESC LIMIT 1`
  );
  const femaleCreatorBoost = eventRows[0] ? parseFloat(eventRows[0].multiplier) : 1.0;

  // ZB-10: Use CTEs to compute each metric independently, then JOIN.
  // Joining multiple one-to-many tables to the same user row in a single query
  // causes a Cartesian fan-out that inflates aggregate values (e.g. SUM of xp_earned
  // grows by the number of follower rows, not the actual XP).
  //
  // BUG-027 FIX (complete): `active_days_30d` is now sourced from user_daily_logins,
  // a dedicated table populated on every login (session creation). This tracks actual
  // calendar days the user authenticated — the canonical definition of an "active day"
  // for Creator Fund consistency scoring. Decoupled from XP/message activity so
  // engagement (40%) and consistency (15%) dimensions are truly independent.
  const { rows: creators } = await dbClient.query<CreatorMetrics>(
    `WITH eng AS (
       SELECT user_id,
              COALESCE(SUM(amount), 0)::INTEGER           AS xp_earned_30d
       FROM xp_ledger
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY user_id
     ),
     act AS (
       SELECT user_id,
              COUNT(*)::INTEGER AS active_days_30d
       FROM user_daily_logins
       WHERE login_date >= (CURRENT_DATE - INTERVAL '30 days')::date
       GROUP BY user_id
     ),
     grw AS (
       SELECT following_id AS user_id,
              COUNT(DISTINCT follower_id)::INTEGER        AS new_followers_30d
       FROM follows
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY following_id
     ),
     qst_raw AS (
       SELECT creator_id AS user_id
       FROM sponsored_quest_applications
       WHERE updated_at >= NOW() - INTERVAL '30 days'
         AND status IN ('paid', 'approved')
       UNION ALL
       SELECT uqp.user_id
       FROM user_quest_progress uqp
       WHERE uqp.completed = true
         AND uqp.completed_at >= NOW() - INTERVAL '30 days'
     ),
     qst AS (
       SELECT user_id,
              COUNT(*)::INTEGER AS quests_completed_30d
       FROM qst_raw
       GROUP BY user_id
     )
     SELECT
       u.id,
       u.gender,
       COALESCE(eng.xp_earned_30d, 0)        AS xp_earned_30d,
       COALESCE(grw.new_followers_30d, 0)    AS new_followers_30d,
       COALESCE(qst.quests_completed_30d, 0) AS quests_completed_30d,
       COALESCE(act.active_days_30d, 0)      AS active_days_30d
     FROM users u
     LEFT JOIN eng ON eng.user_id = u.id
     LEFT JOIN act ON act.user_id = u.id
     LEFT JOIN grw ON grw.user_id = u.id
     LEFT JOIN qst ON qst.user_id = u.id
     WHERE u.is_creator = TRUE
       AND u.creator_tier IN ('elite', 'icon')
       AND u.deleted_at IS NULL
       AND COALESCE(eng.xp_earned_30d, 0) > 0
     ORDER BY u.id`
  );

  if (creators.length === 0) return [];

  // Extract per-dimension arrays for normalisation
  const engagementRaw  = creators.map((c) => c.xp_earned_30d);
  const growthRaw      = creators.map((c) => c.new_followers_30d);
  const questsRaw      = creators.map((c) => c.quests_completed_30d);
  const consistencyRaw = creators.map((c) => c.active_days_30d);

  const engNorm  = normalise(engagementRaw);
  const grwNorm  = normalise(growthRaw);
  const qstNorm  = normalise(questsRaw);
  const conNorm  = normalise(consistencyRaw);

  // Compute weighted composite score; apply IWD boost to female creators
  const scored = creators.map((c, i) => {
    const baseScore =
      W_ENGAGEMENT  * engNorm[i] +
      W_GROWTH      * grwNorm[i] +
      W_QUESTS      * qstNorm[i] +
      W_CONSISTENCY * conNorm[i];
    const boost = (femaleCreatorBoost > 1.0 && c.gender === "female") ? femaleCreatorBoost : 1.0;
    return { id: c.id, score: baseScore * boost };
  });

  // Sort descending by composite score
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  const distributions: CreatorFundDistribution[] = [];
  let prevCutoff = 0;
  let distributedKobo = new Decimal(0);

  for (const tier of DISTRIBUTION_TIERS) {
    const rawCutoff = Math.max(1, Math.floor((tier.topPercent / 100) * total));
    // Ensure each tier starts after the previous one so small pools don't
    // collapse multiple tiers onto the same creator(s).
    const cutoff = Math.max(rawCutoff, prevCutoff + 1);
    const inTier = scored.slice(prevCutoff, cutoff);
    if (inTier.length === 0) continue;

    const tierPool = new Decimal(poolKobo).mul(tier.poolShare).div(100);
    const perCreator = tierPool.div(inTier.length).floor();

    for (let i = 0; i < inTier.length; i++) {
      distributions.push({
        creatorId: inTier[i].id,
        rank: prevCutoff + i + 1,
        score: Math.round(inTier[i].score * 10000) / 10000,
        sharePercent: tier.poolShare / inTier.length,
        amountKobo: perCreator.toNumber(),
      });
      distributedKobo = distributedKobo.add(perCreator);
    }
    prevCutoff = cutoff;
  }

  // Redistribute any undistributed remainder (pool rounding dust) to the top creator.
  // Distributing evenly only works when remainder >= distributions.length; for smaller
  // remainders bonusPerCreator would be 0 and the dust would be silently dropped.
  // Crediting the top creator is simpler, deterministic, and keeps the pool fully paid out.
  const remainder = new Decimal(poolKobo).sub(distributedKobo).floor();
  if (remainder.gt(0) && distributions.length > 0) {
    distributions[0].amountKobo += remainder.toNumber();
  }

  return distributions;
}

// ---------------------------------------------------------------------------
// distributeCreatorFund
// ---------------------------------------------------------------------------

export async function distributeCreatorFund(poolKobo: number): Promise<number> {
  // TASK-05: calculateFundDistributions is now called INSIDE the transaction and AFTER
  // the advisory lock is acquired so only one concurrent instance can calculate + distribute.
  // TASK-06: idempotency key uses creatorId (not rank) so re-runs with changed rankings
  // cannot credit the wrong creator or miss a creator.
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  let distributed = 0;

  await db.transaction(async (tx) => {
    // Acquire transaction-level advisory lock — auto-released when the transaction commits
    // or rolls back. If another instance holds the lock, we skip this run silently.
    const { rows: lockRows } = await tx.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_xact_lock(1, hashtext('distributeCreatorFund')) AS acquired`
    );
    if (!lockRows[0]?.acquired) return;

    // Calculate distributions INSIDE the lock so scoring uses a consistent DB snapshot
    // and concurrent instances cannot both complete scoring before either acquires the lock.
    // Pass tx so all reads run inside the same transaction (BUG-TX-01 fix).
    const distributions = await calculateFundDistributions(poolKobo, tx);
    if (distributions.length === 0) return;

    // Per-creator idempotency via ON CONFLICT DO NOTHING on the unique reference_id.
    // Key is fund:{period}:creator:{creatorId} — stable per (period, creator) regardless
    // of rank changes between runs. Re-runs after a mid-loop crash skip already-credited
    // creators and credit the rest.
    for (const dist of distributions) {
      const ref = `fund:${period}:creator:${dist.creatorId}`;
      await tx.query(
        `WITH ins AS (
           INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
           VALUES ($1, 'creator_fund', $2, 0, $2, $3)
           ON CONFLICT (reference_id) DO NOTHING
           RETURNING id
         )
         UPDATE users
           SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $2,
               updated_at = NOW()
         WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)`,
        [dist.creatorId, dist.amountKobo, ref]
      );
    }
    distributed = distributions.length;
  });

  return distributed;
}

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

/** Min-max normalise an array of values to [0, 1]. */
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
  poolKobo: number
): Promise<CreatorFundDistribution[]> {
  // Check for an active IWD / female-creator cultural event boost
  const { rows: eventRows } = await db.query<{ multiplier: string }>(
    `SELECT xp_multiplier::TEXT AS multiplier
     FROM platform_events
     WHERE event_type = 'cultural'
       AND (metadata->>'female_creator_only')::boolean = true
       AND starts_at <= NOW()
       AND ends_at > NOW()
     ORDER BY xp_multiplier DESC LIMIT 1`
  );
  const femaleCreatorBoost = eventRows[0] ? parseFloat(eventRows[0].multiplier) : 1.0;

  // Fetch multi-factor metrics for all active creators in the last 30 days
  const { rows: creators } = await db.query<CreatorMetrics>(
    `SELECT
       u.id,
       u.gender,
       COALESCE(SUM(xl.amount), 0)::INTEGER               AS xp_earned_30d,
       COUNT(DISTINCT f.follower_id)::INTEGER              AS new_followers_30d,
       COUNT(DISTINCT qa.id)
         FILTER (WHERE qa.status IN ('paid', 'approved'))::INTEGER
                                                           AS quests_completed_30d,
       COUNT(DISTINCT xl2.created_at::date)::INTEGER       AS active_days_30d
     FROM users u
     LEFT JOIN xp_ledger xl
            ON xl.user_id = u.id
           AND xl.created_at >= NOW() - INTERVAL '30 days'
     LEFT JOIN follows f
            ON f.following_id = u.id
           AND f.created_at  >= NOW() - INTERVAL '30 days'
     LEFT JOIN sponsored_quest_applications qa
            ON qa.creator_id = u.id
           AND qa.updated_at >= NOW() - INTERVAL '30 days'
     LEFT JOIN xp_ledger xl2
            ON xl2.user_id = u.id
           AND xl2.created_at >= NOW() - INTERVAL '30 days'
     WHERE u.is_creator = TRUE
       AND u.creator_tier IN ('elite', 'icon', 'zobia_icon')
       AND u.deleted_at IS NULL
     GROUP BY u.id
     HAVING COALESCE(SUM(xl.amount), 0) > 0
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

  for (const tier of DISTRIBUTION_TIERS) {
    const cutoff = Math.floor((tier.topPercent / 100) * total);
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
    }
    prevCutoff = cutoff;
  }

  return distributions;
}

// ---------------------------------------------------------------------------
// distributeCreatorFund
// ---------------------------------------------------------------------------

export async function distributeCreatorFund(poolKobo: number): Promise<number> {
  const distributions = await calculateFundDistributions(poolKobo);
  if (distributions.length === 0) return 0;

  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  await db.transaction(async (tx) => {
    for (const dist of distributions) {
      await tx.query(
        `INSERT INTO creator_earnings
           (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
         VALUES ($1, 'creator_fund', $2, 0, $2, $3)`,
        [dist.creatorId, dist.amountKobo, `fund:${period}:rank${dist.rank}`]
      );
      // Credit net amount to available balance so creator can request payout
      await tx.query(
        `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
                          updated_at = NOW()
         WHERE id = $2`,
        [dist.amountKobo, dist.creatorId]
      );
    }
  });

  return distributions.length;
}

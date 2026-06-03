/**
 * lib/creator/fund.ts
 *
 * Creator Fund — monthly pool distributed to top-earning creators.
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";

export interface CreatorFundDistribution {
  creatorId: string;
  rank: number;
  sharePercent: number;
  amountKobo: number;
}

const DISTRIBUTION_TIERS = [
  { topPercent: 1,  poolShare: 30 },
  { topPercent: 5,  poolShare: 25 },
  { topPercent: 10, poolShare: 20 },
  { topPercent: 25, poolShare: 15 },
  { topPercent: 50, poolShare: 10 },
];

export async function calculateFundDistributions(
  poolKobo: number
): Promise<CreatorFundDistribution[]> {
  const { rows: creators } = await db.query<{ id: string; creator_earnings_30d: string }>(
    `SELECT u.id,
            COALESCE(SUM(ce.net_amount_kobo), 0)::text AS creator_earnings_30d
     FROM users u
     JOIN creator_earnings ce ON ce.creator_id = u.id
     WHERE u.is_creator = true
       AND u.deleted_at IS NULL
       AND ce.created_at >= NOW() - INTERVAL '30 days'
     GROUP BY u.id
     ORDER BY creator_earnings_30d DESC`
  );

  if (creators.length === 0) return [];

  const total = creators.length;
  const distributions: CreatorFundDistribution[] = [];
  let prevCutoff = 0;

  for (const tier of DISTRIBUTION_TIERS) {
    const cutoff = Math.floor((tier.topPercent / 100) * total);
    const creatorsInTier = creators.slice(prevCutoff, cutoff);
    if (creatorsInTier.length === 0) continue;

    const tierPool = new Decimal(poolKobo).mul(tier.poolShare).div(100);
    const perCreator = tierPool.div(creatorsInTier.length).floor();

    for (let i = 0; i < creatorsInTier.length; i++) {
      distributions.push({
        creatorId: creatorsInTier[i].id,
        rank: prevCutoff + i + 1,
        sharePercent: tier.poolShare / creatorsInTier.length,
        amountKobo: perCreator.toNumber(),
      });
    }
    prevCutoff = cutoff;
  }

  return distributions;
}

export async function distributeCreatorFund(poolKobo: number): Promise<number> {
  const distributions = await calculateFundDistributions(poolKobo);
  if (distributions.length === 0) return 0;

  await db.transaction(async (tx) => {
    for (const dist of distributions) {
      await tx.query(
        `INSERT INTO creator_earnings
           (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
         VALUES ($1, 'creator_fund', $2, 0, $2, $3)`,
        [dist.creatorId, dist.amountKobo, `fund:${new Date().toISOString().slice(0, 7)}`]
      );
    }
  });

  return distributions.length;
}

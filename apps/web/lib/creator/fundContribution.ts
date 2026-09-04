/**
 * lib/creator/fundContribution.ts
 *
 * Shared helper for every activity that contributes gross revenue into the
 * Creator Fund (PRD §14). Previously each call site (subscription/room-entry
 * payments in paystackWebhookHandler.ts and dodoWebhookHandler.ts, coin pack
 * purchases in both, branded-room sponsorship in
 * app/api/admin/branded-rooms/route.ts, and rewarded-ad payouts in
 * app/api/economy/rewards/ad-reward/route.ts) hard-coded the same `* 0.05`
 * literal inline with no way to adjust it without a deploy.
 *
 * The percentage per activity is now admin-configurable via the existing
 * generic x_manifest config panel (/gate44/config — see migration
 * 0009_creator_fund_config.sql for the seeded keys/defaults, which match the
 * prior hard-coded 5% exactly so nothing changes until an admin edits it).
 */

import type { TransactionClient } from "@/lib/db/interface";
import { db } from "@/lib/db";
import { getManifestValue } from "@/lib/manifest";
import { logger } from "@/lib/logger";

export type CreatorFundActivity =
  | "room_subscription"
  | "room_entry"
  | "coin_purchase"
  | "sponsor_budget"
  | "ad_reward";

/** Fallback used only if the x_manifest key is somehow missing (fresh DB pre-migration). */
const DEFAULT_SPLIT_PERCENT = 5;

function splitPercentKey(activity: CreatorFundActivity): string {
  return `creator_fund_split_${activity}_percent`;
}

/** Reads the admin-configured contribution percent for an activity (via the cached manifest — no extra Redis round-trip beyond the existing shared KV cache). */
export async function getCreatorFundSplitPercent(activity: CreatorFundActivity): Promise<number> {
  const raw = await getManifestValue(splitPercentKey(activity));
  const parsed = raw !== null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return DEFAULT_SPLIT_PERCENT;
  return parsed;
}

/**
 * Contributes `splitPercent(activity)`% of `grossAmountKobo` to the Creator
 * Fund's running balance (x_manifest.creator_fund_balance_kobo), distributed
 * to eligible creators on the 5th of each month (lib/creator/fund.ts).
 *
 * Safe to call with a zero/negative gross amount (no-ops). Callers already
 * inside a transaction should pass their `tx` client so this write commits
 * or rolls back atomically with the rest of the payment/purchase.
 */
export async function contributeToCreatorFund(
  grossAmountKobo: number,
  activity: CreatorFundActivity,
  dbClient: TransactionClient | typeof db = db
): Promise<void> {
  if (!Number.isFinite(grossAmountKobo) || grossAmountKobo <= 0) return;

  const percent = await getCreatorFundSplitPercent(activity);
  const contributionKobo = Math.floor((grossAmountKobo * percent) / 100);
  if (contributionKobo <= 0) return;

  await dbClient.query(
    `INSERT INTO x_manifest (key, value, updated_at)
     VALUES ('creator_fund_balance_kobo', $1::TEXT, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
           updated_at = NOW()`,
    [contributionKobo]
  );

  logger.info(
    { activity, grossAmountKobo, percent, contributionKobo },
    "[creator-fund] contribution recorded"
  );
}

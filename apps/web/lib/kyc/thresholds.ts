/**
 * lib/kyc/thresholds.ts
 *
 * Admin-configurable KYC tier gating for high-value selling / payouts.
 * Thresholds live in the manifest (lib/manifest/index.ts `kyc.thresholds`),
 * editable at /admin/kyc (Settings tab) — see db/migrations/0005_kyc_verification.sql
 * for the seeded defaults.
 *
 * Call `getRequiredKycTier` wherever a product is priced or revenue is about
 * to be received/paid out, and `meetsRequiredKycTier` to gate the action.
 * Wired in today at: merch product create/price-update (app/api/merch/products).
 */

import { loadManifest, type ZobiaManifest } from "@/lib/manifest";

export type KycAccountType = "individual" | "business";

/** An amount in one or both denominations — pass whichever the transaction is actually in. */
export interface ThresholdAmount {
  kobo?: number;
  usdCents?: number;
}

/**
 * Returns the minimum KYC tier required for a seller of `accountType` to
 * price a product at / receive revenue of `amount`. Returns 0 when neither
 * threshold is crossed (no extra tier required beyond whatever baseline the
 * caller already enforces, e.g. Tier 1 for all sellers).
 */
export function requiredKycTierFor(
  manifest: ZobiaManifest,
  accountType: KycAccountType,
  amount: ThresholdAmount
): 0 | 2 | 3 {
  const t = manifest.kyc.thresholds[accountType];
  const crosses = (koboThreshold: number, usdThreshold: number) =>
    (amount.kobo !== undefined && amount.kobo > koboThreshold) ||
    (amount.usdCents !== undefined && amount.usdCents > usdThreshold);

  // Tier 3 threshold is "at or above" per spec ("1 million naira and above"),
  // Tier 2 is "above" — check the higher bar first.
  if (
    (amount.kobo !== undefined && amount.kobo >= t.tier3Kobo) ||
    (amount.usdCents !== undefined && amount.usdCents >= t.tier3UsdCents)
  ) {
    return 3;
  }
  if (crosses(t.tier2Kobo, t.tier2UsdCents)) return 2;
  return 0;
}

/** Convenience wrapper that loads the manifest for you. */
export async function getRequiredKycTier(
  accountType: KycAccountType,
  amount: ThresholdAmount
): Promise<0 | 2 | 3> {
  const manifest = await loadManifest();
  return requiredKycTierFor(manifest, accountType, amount);
}

/** True when a seller's current approved `kycTier` satisfies `requiredTier`. */
export function meetsRequiredKycTier(currentTier: number, requiredTier: 0 | 2 | 3): boolean {
  return currentTier >= requiredTier;
}

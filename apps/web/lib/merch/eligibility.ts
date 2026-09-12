/**
 * lib/merch/eligibility.ts
 *
 * Who may open a Merch Store / list Market items to sell.
 *
 * Two independent qualifying paths (PRD §14 "Creator Merch Store", extended
 * for the Market page batch to also admit verified Business accounts):
 *   - An Elite+ creator (creator_tier in elite | icon | zobia_icon).
 *   - A verified, active Business account (business_accounts.verified = true
 *     AND status = 'active').
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { db as globalDb } from "@/lib/db";

export type MerchSellerAccountType = "individual" | "business";

export interface MerchSellerEligibility {
  qualified: boolean;
  /** Which path qualified the seller — used to pick the right KYC account-type threshold. */
  accountType: MerchSellerAccountType;
}

/**
 * Checks whether `userId` may open/operate a merch store, via either the
 * Elite+ creator path or the verified Business-account path.
 */
export async function getMerchSellerEligibility(
  userId: string,
  db: Pick<DatabaseAdapter, "query"> = globalDb
): Promise<MerchSellerEligibility> {
  const { rows } = await db.query<{
    is_elite_creator: boolean;
    is_verified_business: boolean;
  }>(
    `SELECT
       EXISTS(
         SELECT 1 FROM users
         WHERE id = $1 AND deleted_at IS NULL
           AND is_creator = TRUE
           AND creator_tier IN ('elite', 'icon', 'zobia_icon')
       ) AS is_elite_creator,
       EXISTS(
         SELECT 1 FROM business_accounts
         WHERE user_id = $1 AND verified = TRUE AND status = 'active'
       ) AS is_verified_business`,
    [userId]
  );

  const row = rows[0];
  if (row?.is_elite_creator) return { qualified: true, accountType: "individual" };
  if (row?.is_verified_business) return { qualified: true, accountType: "business" };
  return { qualified: false, accountType: "individual" };
}

export const MERCH_SELLER_INELIGIBLE_MESSAGE =
  "Merch stores are available to Elite, Icon, and Zobia Icon creators, and to verified Business accounts.";

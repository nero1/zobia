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

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";

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
  db?: DbOrTx
): Promise<MerchSellerEligibility> {
  const orm = db ?? (await getDb());

  const [eliteCreator] = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, userId),
        isNull(schema.users.deletedAt),
        eq(schema.users.isCreator, true),
        inArray(schema.users.creatorTier, ["elite", "icon", "zobia_icon"])
      )
    )
    .limit(1);
  if (eliteCreator) return { qualified: true, accountType: "individual" };

  const [verifiedBusiness] = await orm
    .select({ id: schema.businessAccounts.id })
    .from(schema.businessAccounts)
    .where(
      and(
        eq(schema.businessAccounts.userId, userId),
        eq(schema.businessAccounts.verified, true),
        eq(schema.businessAccounts.status, "active")
      )
    )
    .limit(1);
  if (verifiedBusiness) return { qualified: true, accountType: "business" };

  return { qualified: false, accountType: "individual" };
}

export const MERCH_SELLER_INELIGIBLE_MESSAGE =
  "Merch stores are available to Elite, Icon, and Zobia Icon creators, and to verified Business accounts.";

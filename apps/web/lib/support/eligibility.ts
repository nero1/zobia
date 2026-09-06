/**
 * lib/support/eligibility.ts
 *
 * Support Ticket System — "who can create a ticket for free" and "what does
 * it cost otherwise" checks, driven by x_manifest (via lib/manifest) and
 * reusing lib/plans/eligibility.ts's plan/prestige allow-list convention.
 */

import { db } from "@/lib/db";
import { loadManifest } from "@/lib/manifest";
import { isPlanEligible } from "@/lib/plans/eligibility";

export interface TicketEligibility {
  /** True if the user can create a ticket without paying. */
  freeAccess: boolean;
  /** Credits required to create a ticket if freeAccess is false. 0 = not payable in credits. */
  costCredits: number;
  /** Stars required to create a ticket if freeAccess is false. 0 = not payable in stars. */
  costStars: number;
  /** True if there is no way at all to pay (both costs are 0 and freeAccess is false). */
  blocked: boolean;
}

/**
 * Determines whether `userId` can open a support ticket for free (per the
 * admin-configured `support_eligible_plans` allow-list) and, if not, what a
 * one-time ticket costs. Fails closed: a lookup error resolves to
 * "blocked" (no free access, no payable cost) rather than silently granting
 * access.
 */
export async function getTicketEligibility(userId: string): Promise<TicketEligibility> {
  const manifest = await loadManifest();

  try {
    const { rows } = await db.query<{ plan: string; prestige_count: number }>(
      `SELECT plan, prestige_count FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) {
      return { freeAccess: false, costCredits: 0, costStars: 0, blocked: true };
    }

    const freeAccess = isPlanEligible(user.plan, user.prestige_count ?? 0, manifest.support.eligiblePlans);
    const costCredits = manifest.support.ticketCostCredits;
    const costStars = manifest.support.ticketCostStars;

    return {
      freeAccess,
      costCredits,
      costStars,
      blocked: !freeAccess && costCredits <= 0 && costStars <= 0,
    };
  } catch {
    return { freeAccess: false, costCredits: 0, costStars: 0, blocked: true };
  }
}

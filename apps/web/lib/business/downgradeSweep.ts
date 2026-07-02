/**
 * lib/business/downgradeSweep.ts
 *
 * Applies scheduled self-service Business Account tier downgrades once
 * their grace period elapses (PATCH /api/business/tier — see that route's
 * header comment). Called once a day from the daily-economy CRON, same
 * cadence as lib/plans/subscriptionSweep.ts.
 *
 * "After this time, extra pages get deactivated, and running adverts
 * stop" — the account keeps its current tier (and everything that comes
 * with it) until `downgrade_effective_at`; this sweep is what actually
 * moves the tier down and enforces the new tier's limits.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getBusinessPageLimit } from "@/lib/business/limits";

export interface BusinessDowngradeSweepResult {
  accountsDowngraded: number;
  pagesDeactivated: number;
  questsStopped: number;
}

interface DueDowngradeRow {
  id: string;
  user_id: string;
  business_name: string;
  tier: string;
  downgrade_to_tier: string;
}

export async function sweepBusinessDowngrades(): Promise<BusinessDowngradeSweepResult> {
  const result: BusinessDowngradeSweepResult = { accountsDowngraded: 0, pagesDeactivated: 0, questsStopped: 0 };

  const { rows: due } = await db.query<DueDowngradeRow>(
    `SELECT id, user_id, business_name, tier, downgrade_to_tier
     FROM business_accounts
     WHERE downgrade_to_tier IS NOT NULL AND downgrade_effective_at <= NOW()`
  );

  for (const account of due) {
    try {
      const newTier = account.downgrade_to_tier;
      const limit = await getBusinessPageLimit(newTier);

      // Deactivate the newest pages beyond the new tier's slot limit — keep
      // the oldest `limit` active pages (first-come, first-kept).
      const { rowCount: deactivated } = await db.query(
        `UPDATE business_pages
         SET status = 'deactivated', status_reason = 'Business account downgraded to ' || $1 || ' tier', updated_at = NOW()
         WHERE business_account_id = $2 AND deleted_at IS NULL AND status = 'active'
           AND id NOT IN (
             SELECT id FROM business_pages
             WHERE business_account_id = $2 AND deleted_at IS NULL AND status = 'active'
             ORDER BY created_at ASC
             LIMIT $3
           )`,
        [newTier, account.id, limit]
      );
      result.pagesDeactivated += deactivated ?? 0;

      // Stop all running sponsored quests — "running adverts stop".
      const { rowCount: stopped } = await db.query(
        `UPDATE sponsored_quests SET is_active = FALSE, updated_at = NOW()
         WHERE business_account_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [account.id]
      );
      result.questsStopped += stopped ?? 0;

      await db.query(
        `UPDATE business_accounts
         SET tier = $1, downgrade_to_tier = NULL, downgrade_effective_at = NULL, tier_updated_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [newTier, account.id]
      );

      await db
        .query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'business_tier_downgraded', 'Business Account Downgraded',
                   $2, $3::jsonb, false, NOW())`,
          [
            account.user_id,
            `Your business account is now on the ${newTier} tier. Pages and sponsored quests beyond this tier's limits have been deactivated — you can restore them by upgrading again.`,
            JSON.stringify({ businessAccountId: account.id, tier: newTier }),
          ]
        )
        .catch((err) => logger.error({ err, businessAccountId: account.id }, "[downgradeSweep] failed to notify owner"));

      result.accountsDowngraded++;
    } catch (err) {
      logger.error({ err, businessAccountId: account.id }, "[downgradeSweep] failed to apply downgrade");
    }
  }

  return result;
}

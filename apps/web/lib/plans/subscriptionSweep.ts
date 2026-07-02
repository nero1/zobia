/**
 * lib/plans/subscriptionSweep.ts
 *
 * Subscription expiry -> grace period -> purge, for both personal plans
 * (Plus/Pro/Max) and Business tiers (Starter/Growth/Enterprise). Called
 * once a day from the daily-economy CRON (apps/web/app/api/cron/daily-economy).
 *
 * Two passes:
 *   1. Lapse sweep — a subscription past `ends_at` still marked 'active'
 *      (i.e. it did not renew) moves to 'grace', the account is downgraded
 *      immediately (users.plan -> 'free' / business tier untouched pending
 *      grace), and any grace-gated feature NOT on the admin's preserved
 *      list for that plan is purged right away.
 *   2. Grace-expiry sweep — a 'grace' subscription past its
 *      `grace_period_ends_at` moves to 'lapsed', and any preserved (but now
 *      expired) grace-gated data is purged (save slots trimmed to the new,
 *      lower plan's limit).
 *
 * Note: `business_accounts.subscription_id` is populated once a business
 * plan is linked to a recurring `subscriptions` row (see PRD §17 / Business
 * Accounts billing). Until that linkage is wired up for a given account,
 * the business half of this sweep simply has nothing to act on for it —
 * it does not invent an expiry timer independent of the subscription record.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  PERSONAL_GRACE_PLANS,
  BUSINESS_GRACE_TIERS,
  getGracePeriodDays,
  isFeaturePreservedDuringGrace,
} from "@/lib/plans/gracePeriod";
import { reconcileSavesForUser } from "@/lib/games/saves";
import { getSaveSlotLimit } from "@/lib/plans/saveSlots";

export interface SubscriptionSweepResult {
  personalLapsedToGrace: number;
  personalGraceExpired: number;
  personalSavesPurgedImmediately: number;
  personalSavesPurgedAfterGrace: number;
  businessLapsedToGrace: number;
  businessGraceExpired: number;
}

async function purgeUnpreservedSaves(userIds: string[]): Promise<number> {
  let purged = 0;
  for (const userId of userIds) {
    try {
      const deleted = await reconcileSavesForUser(userId, 0);
      if (deleted.length > 0) purged++;
    } catch (err) {
      logger.error({ err, userId }, "[subscriptionSweep] Failed to purge unpreserved saves");
    }
  }
  return purged;
}

export async function sweepSubscriptions(): Promise<SubscriptionSweepResult> {
  const result: SubscriptionSweepResult = {
    personalLapsedToGrace: 0,
    personalGraceExpired: 0,
    personalSavesPurgedImmediately: 0,
    personalSavesPurgedAfterGrace: 0,
    businessLapsedToGrace: 0,
    businessGraceExpired: 0,
  };

  // -------------------------------------------------------------------
  // Personal: active -> grace (subscription did not renew)
  // -------------------------------------------------------------------
  for (const plan of PERSONAL_GRACE_PLANS) {
    const days = await getGracePeriodDays("personal", plan);
    const { rows } = await db.query<{ user_id: string }>(
      `UPDATE subscriptions
       SET status = 'grace', grace_period_ends_at = NOW() + ($1 || ' days')::interval, updated_at = NOW()
       WHERE plan = $2 AND status = 'active' AND ends_at < NOW()
       RETURNING user_id`,
      [String(days), plan]
    );
    if (rows.length === 0) continue;

    const userIds = rows.map((r) => r.user_id);
    result.personalLapsedToGrace += userIds.length;

    await db.query(
      `UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = ANY($1::uuid[]) AND plan = $2`,
      [userIds, plan]
    );

    const savedGamesPreserved = await isFeaturePreservedDuringGrace("personal", plan, "saved_games");
    if (!savedGamesPreserved) {
      result.personalSavesPurgedImmediately += await purgeUnpreservedSaves(userIds);
    }
  }

  // -------------------------------------------------------------------
  // Personal: grace -> lapsed (grace period elapsed — purge preserved data)
  // -------------------------------------------------------------------
  {
    const { rows } = await db.query<{ user_id: string; plan: string }>(
      `UPDATE subscriptions
       SET status = 'lapsed', updated_at = NOW()
       WHERE status = 'grace' AND grace_period_ends_at < NOW()
       RETURNING user_id, plan`
    );
    result.personalGraceExpired = rows.length;

    const freeLimit = await getSaveSlotLimit("free");
    for (const row of rows) {
      try {
        if (await isFeaturePreservedDuringGrace("personal", row.plan, "saved_games")) {
          const deleted = await reconcileSavesForUser(row.user_id, freeLimit);
          if (deleted.length > 0) result.personalSavesPurgedAfterGrace++;
        }
      } catch (err) {
        logger.error({ err, userId: row.user_id }, "[subscriptionSweep] Failed to purge post-grace saves");
      }
    }
  }

  // -------------------------------------------------------------------
  // Business: active -> grace (mirrors the personal flow above, keyed off
  // business_accounts.subscription_id once that linkage is populated).
  // -------------------------------------------------------------------
  for (const tier of BUSINESS_GRACE_TIERS) {
    const days = await getGracePeriodDays("business", tier);
    const { rowCount } = await db.query(
      `UPDATE business_accounts ba
       SET status = 'grace', grace_period_ends_at = NOW() + ($1 || ' days')::interval, updated_at = NOW()
       FROM subscriptions s
       WHERE ba.subscription_id = s.id AND ba.tier = $2 AND ba.status = 'active'
         AND s.status = 'active' AND s.ends_at < NOW()`,
      [String(days), tier]
    );
    result.businessLapsedToGrace += rowCount ?? 0;
  }

  {
    const { rowCount } = await db.query(
      `UPDATE business_accounts
       SET status = 'lapsed', updated_at = NOW()
       WHERE status = 'grace' AND grace_period_ends_at < NOW()`
    );
    result.businessGraceExpired = rowCount ?? 0;
  }

  return result;
}

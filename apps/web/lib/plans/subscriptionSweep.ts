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

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import {
  PERSONAL_GRACE_PLANS,
  BUSINESS_GRACE_TIERS,
  getGracePeriodDays,
  isFeaturePreservedDuringGrace,
} from "@/lib/plans/gracePeriod";
import { reconcileSavesForUser } from "@/lib/games/saves";
import { getSaveSlotLimit } from "@/lib/plans/saveSlots";
import { deactivateGroupsForUser } from "@/lib/plans/groupChatSweep";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

export interface SubscriptionSweepResult {
  personalLapsedToGrace: number;
  personalGraceExpired: number;
  personalSavesPurgedImmediately: number;
  personalSavesPurgedAfterGrace: number;
  businessLapsedToGrace: number;
  businessGraceExpired: number;
  groupChatsDeactivated: number;
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
    groupChatsDeactivated: 0,
  };

  const orm = await getDb();

  // -------------------------------------------------------------------
  // Personal: active -> grace (subscription did not renew)
  // -------------------------------------------------------------------
  for (const plan of PERSONAL_GRACE_PLANS) {
    const days = await getGracePeriodDays("personal", plan);
    const rows = await orm
      .update(schema.subscriptions)
      .set({
        status: "grace",
        gracePeriodEndsAt: sql`NOW() + (${String(days)} || ' days')::interval`,
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(schema.subscriptions.plan, plan), eq(schema.subscriptions.status, "active"), lt(schema.subscriptions.endsAt, sql`NOW()`)))
      .returning({ userId: schema.subscriptions.userId });
    if (rows.length === 0) continue;

    const userIds = rows.map((r) => r.userId);
    result.personalLapsedToGrace += userIds.length;

    await orm
      .update(schema.users)
      .set({ plan: "free", updatedAt: sql`NOW()` })
      .where(and(inArray(schema.users.id, userIds), eq(schema.users.plan, plan)));

    const savedGamesPreserved = await isFeaturePreservedDuringGrace("personal", plan, "saved_games");
    if (!savedGamesPreserved) {
      result.personalSavesPurgedImmediately += await purgeUnpreservedSaves(userIds);
    }
  }

  // -------------------------------------------------------------------
  // Personal: grace -> lapsed (grace period elapsed — purge preserved data)
  // -------------------------------------------------------------------
  {
    const rows = await orm
      .update(schema.subscriptions)
      .set({ status: "lapsed", updatedAt: sql`NOW()` })
      .where(and(eq(schema.subscriptions.status, "grace"), lt(schema.subscriptions.gracePeriodEndsAt, sql`NOW()`)))
      .returning({ userId: schema.subscriptions.userId, plan: schema.subscriptions.plan });
    result.personalGraceExpired = rows.length;

    const freeLimit = await getSaveSlotLimit("free");
    for (const row of rows) {
      try {
        if (await isFeaturePreservedDuringGrace("personal", row.plan, "saved_games")) {
          const deleted = await reconcileSavesForUser(row.userId, freeLimit);
          if (deleted.length > 0) result.personalSavesPurgedAfterGrace++;
        }
      } catch (err) {
        logger.error({ err, userId: row.userId }, "[subscriptionSweep] Failed to purge post-grace saves");
      }

      try {
        if (!(await isFeaturePreservedDuringGrace("personal", row.plan, "group_chats"))) {
          const deactivated = await deactivateGroupsForUser(row.userId);
          if (deactivated > 0) result.groupChatsDeactivated += deactivated;
        }
      } catch (err) {
        logger.error({ err, userId: row.userId }, "[subscriptionSweep] Failed to deactivate group chats");
      }
    }
  }

  // -------------------------------------------------------------------
  // Business: active -> grace, keyed off business_accounts.current_period_ends_at
  // (0001_consolidated_schema.sql — a business owner's checkout is a
  // one-off charge, so this is tracked directly on business_accounts rather
  // than the personal `subscriptions` table, which is unique-per-user and
  // would collide with a business owner's own personal plan row).
  // -------------------------------------------------------------------
  // NOTE: `business_accounts.current_period_ends_at` referenced below is not
  // present on `schema.businessAccounts` in lib/db/schema.ts (schema/DB
  // mismatch — reported upstream), so this uses Drizzle's `sql` tag directly
  // rather than the query builder for these two statements.
  for (const tier of BUSINESS_GRACE_TIERS) {
    const days = await getGracePeriodDays("business", tier);
    const updateResult = await orm.execute(sql`
      UPDATE business_accounts
      SET status = 'grace', grace_period_ends_at = NOW() + (${String(days)} || ' days')::interval, updated_at = NOW()
      WHERE tier = ${tier} AND status = 'active'
        AND current_period_ends_at IS NOT NULL AND current_period_ends_at < NOW()
    `);
    result.businessLapsedToGrace += updateResult.rowCount ?? 0;
  }

  {
    const graceResult = await orm.execute<{ id: string; user_id: string; tier: string }>(sql`
      UPDATE business_accounts
      SET status = 'lapsed', updated_at = NOW()
      WHERE status = 'grace' AND grace_period_ends_at < NOW()
      RETURNING id, user_id, tier
    `);
    const rows = graceResult.rows;
    result.businessGraceExpired = rows.length;

    for (const row of rows) {
      try {
        if (!(await isFeaturePreservedDuringGrace("business", row.tier, "group_chats"))) {
          const deactivated = await deactivateGroupsForUser(row.user_id);
          if (deactivated > 0) result.groupChatsDeactivated += deactivated;
        }
      } catch (err) {
        logger.error({ err, userId: row.user_id }, "[subscriptionSweep] Failed to deactivate business group chats");
      }

      // Subscription fully lapsed (grace period elapsed without renewal) —
      // pause running Sponsored Quests, same "must be explicitly restarted"
      // rule as the tier-downgrade path (lib/business/downgradeSweep.ts).
      try {
        // NOTE: `sponsored_quests.updated_at` is not present on
        // `schema.sponsoredQuests` in lib/db/schema.ts (schema/DB mismatch —
        // reported upstream), so this uses Drizzle's `sql` tag directly for
        // this one statement rather than the query builder.
        const stoppedQuestsResult = await orm.execute<{ id: string }>(sql`
          UPDATE sponsored_quests
          SET is_active = FALSE, auto_paused = TRUE,
              pause_reason = 'Business subscription lapsed', paused_at = NOW(), updated_at = NOW()
          WHERE business_account_id = ${row.id} AND is_active = TRUE AND deleted_at IS NULL
          RETURNING id
        `);
        for (const q of stoppedQuestsResult.rows) await syncSponsoredQuestTemplate(orm, q.id);
      } catch (err) {
        logger.error({ err, businessAccountId: row.id }, "[subscriptionSweep] Failed to pause sponsored quests on lapse");
      }
    }
  }

  return result;
}

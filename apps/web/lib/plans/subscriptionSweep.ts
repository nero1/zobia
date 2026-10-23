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
 * Business periods are tracked directly on business_accounts, separately
 * from the owner's unique personal subscription row.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

  // Snapshot only candidates. Recheck expiry under the same user-first locks
  // as activation; renewal must never lose its plan or saves to stale cleanup.
  const candidates = await orm.select({ userId: schema.subscriptions.userId }).from(schema.subscriptions)
    .where(sql`(${schema.subscriptions.status} IN ('active','cancelled','trialing') AND ${schema.subscriptions.endsAt} < NOW()) OR (${schema.subscriptions.status} = 'grace' AND ${schema.subscriptions.gracePeriodEndsAt} < NOW())`);
  for (const candidate of candidates) {
    const changes = await orm.transaction(async tx => {
      const [user] = await tx.select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, candidate.userId)).for("update");
      if (!user) return null;
      const [sub] = await tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, candidate.userId)).for("update");
      if (!sub || !PERSONAL_GRACE_PLANS.includes(sub.plan as typeof PERSONAL_GRACE_PLANS[number])) return null;
      const now = new Date();
      if (["active", "cancelled", "trialing"].includes(sub.status) && sub.endsAt && sub.endsAt < now) {
        const days = await getGracePeriodDays("personal", sub.plan);
        await tx.update(schema.subscriptions).set({ status: "grace", gracePeriodEndsAt: sql`NOW() + (${String(days)} || ' days')::interval`, updatedAt: sql`NOW()` }).where(eq(schema.subscriptions.id, sub.id));
        const downgraded = user.plan === sub.plan;
        if (downgraded) await tx.update(schema.users).set({ plan: "free", updatedAt: sql`NOW()` }).where(eq(schema.users.id, candidate.userId));
        let purged = 0;
        if ((downgraded || user.plan === "free") && !await isFeaturePreservedDuringGrace("personal", sub.plan, "saved_games")) {
          purged = (await reconcileSavesForUser(candidate.userId, 0, undefined, tx)).length > 0 ? 1 : 0;
        }
        return { grace: 1, lapsed: 0, immediate: purged, after: 0, groups: 0 };
      }
      if (sub.status === "grace" && sub.gracePeriodEndsAt && sub.gracePeriodEndsAt < now) {
        await tx.update(schema.subscriptions).set({ status: "lapsed", updatedAt: sql`NOW()` }).where(eq(schema.subscriptions.id, sub.id));
        let purged = 0, groups = 0;
        if (user.plan === "free") {
          if (await isFeaturePreservedDuringGrace("personal", sub.plan, "saved_games")) {
            purged = (await reconcileSavesForUser(candidate.userId, await getSaveSlotLimit("free"), undefined, tx)).length > 0 ? 1 : 0;
          }
          if (!await isFeaturePreservedDuringGrace("personal", sub.plan, "group_chats")) groups = await deactivateGroupsForUser(candidate.userId, tx);
        }
        return { grace: 0, lapsed: 1, immediate: 0, after: purged, groups };
      }
      return null;
    });
    if (changes) {
      result.personalLapsedToGrace += changes.grace;
      result.personalGraceExpired += changes.lapsed;
      result.personalSavesPurgedImmediately += changes.immediate;
      result.personalSavesPurgedAfterGrace += changes.after;
      result.groupChatsDeactivated += changes.groups;
    }
  }

  // Business expiry uses the directly tracked billing period. Keep destructive
  // cleanup in the account transaction so renewal and expiry cannot interleave.
  const businessCandidates = await orm.select({ id: schema.businessAccounts.id, userId: schema.businessAccounts.userId }).from(schema.businessAccounts)
    .where(sql`(${schema.businessAccounts.status} = 'active' AND ${schema.businessAccounts.currentPeriodEndsAt} < NOW()) OR (${schema.businessAccounts.status} = 'grace' AND ${schema.businessAccounts.gracePeriodEndsAt} < NOW())`);
  for (const candidate of businessCandidates) {
    const changes = await orm.transaction(async tx => {
      await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, candidate.userId)).for("update");
      const [account] = await tx.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, candidate.id)).for("update");
      if (!account || !BUSINESS_GRACE_TIERS.includes(account.tier as typeof BUSINESS_GRACE_TIERS[number])) return null;
      const now = new Date();
      if (account.status === "active" && account.currentPeriodEndsAt && account.currentPeriodEndsAt < now) {
        const days = await getGracePeriodDays("business", account.tier);
        await tx.update(schema.businessAccounts).set({ status: "grace", gracePeriodEndsAt: sql`NOW() + (${String(days)} || ' days')::interval`, updatedAt: sql`NOW()` }).where(eq(schema.businessAccounts.id, account.id));
        return { grace: 1, lapsed: 0, groups: 0 };
      }
      if (account.status === "grace" && account.gracePeriodEndsAt && account.gracePeriodEndsAt < now) {
        await tx.update(schema.businessAccounts).set({ status: "lapsed", updatedAt: sql`NOW()` }).where(eq(schema.businessAccounts.id, account.id));
        let groups = 0;
        if (!await isFeaturePreservedDuringGrace("business", account.tier, "group_chats")) groups = await deactivateGroupsForUser(account.userId, tx);
        const quests = await tx.update(schema.sponsoredQuests).set({ isActive: false, autoPaused: true, pauseReason: "Business subscription lapsed", pausedAt: sql`NOW()`, updatedAt: sql`NOW()` })
          .where(and(eq(schema.sponsoredQuests.businessAccountId, account.id), eq(schema.sponsoredQuests.isActive, true), isNull(schema.sponsoredQuests.deletedAt))).returning({ id: schema.sponsoredQuests.id });
        for (const quest of quests) await syncSponsoredQuestTemplate(tx, quest.id);
        return { grace: 0, lapsed: 1, groups };
      }
      return null;
    });
    if (changes) {
      result.businessLapsedToGrace += changes.grace;
      result.businessGraceExpired += changes.lapsed;
      result.groupChatsDeactivated += changes.groups;
    }
  }
  return result;
}

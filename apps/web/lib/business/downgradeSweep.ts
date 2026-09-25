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

import { and, eq, isNull, lte, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import { getBusinessPageLimit } from "@/lib/business/limits";
import { getIncludedBusinessBlogCount } from "@/lib/blogs/limits";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { insertNotification } from "@/lib/notifications/insert";

export interface BusinessDowngradeSweepResult {
  accountsDowngraded: number;
  pagesDeactivated: number;
  blogsDeactivated: number;
  questsStopped: number;
}

export async function sweepBusinessDowngrades(): Promise<BusinessDowngradeSweepResult> {
  const result: BusinessDowngradeSweepResult = { accountsDowngraded: 0, pagesDeactivated: 0, blogsDeactivated: 0, questsStopped: 0 };
  const orm = await getDb();

  const due = await orm
    .select({
      id: schema.businessAccounts.id,
      userId: schema.businessAccounts.userId,
      businessName: schema.businessAccounts.businessName,
      tier: schema.businessAccounts.tier,
      downgradeToTier: schema.businessAccounts.downgradeToTier,
    })
    .from(schema.businessAccounts)
    .where(
      and(
        sql`${schema.businessAccounts.downgradeToTier} IS NOT NULL`,
        lte(schema.businessAccounts.downgradeEffectiveAt, sql`NOW()`)
      )
    );

  for (const account of due) {
    try {
      const newTier = account.downgradeToTier as string;
      const limit = await getBusinessPageLimit(newTier);

      // Deactivate the newest pages beyond the new tier's slot limit — keep
      // the oldest `limit` active pages (first-come, first-kept).
      const keptPageIds = orm
        .select({ id: schema.businessPages.id })
        .from(schema.businessPages)
        .where(
          and(
            eq(schema.businessPages.businessAccountId, account.id),
            isNull(schema.businessPages.deletedAt),
            eq(schema.businessPages.status, "active")
          )
        )
        .orderBy(schema.businessPages.createdAt)
        .limit(limit);
      const deactivatedPages = await orm
        .update(schema.businessPages)
        .set({
          status: "deactivated",
          statusReason: `Business account downgraded to ${newTier} tier`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(schema.businessPages.businessAccountId, account.id),
            isNull(schema.businessPages.deletedAt),
            eq(schema.businessPages.status, "active"),
            notInArray(schema.businessPages.id, keptPageIds)
          )
        )
        .returning({ id: schema.businessPages.id });
      result.pagesDeactivated += deactivatedPages.length;

      // Same treatment for the business account's blogs (migration 0018):
      // keep the oldest `blogLimit` active blogs, deactivate the rest. Blogs
      // that were individually paid-unlocked (slot_source = 'purchased')
      // are deactivated the same as included ones — the grace-period
      // mechanics don't refund extra-slot purchases, matching how excess
      // business_pages above are handled without a refund either.
      const blogLimit = await getIncludedBusinessBlogCount(newTier);
      const keptBlogIds = orm
        .select({ id: schema.blogs.id })
        .from(schema.blogs)
        .where(
          and(
            eq(schema.blogs.businessAccountId, account.id),
            isNull(schema.blogs.deletedAt),
            eq(schema.blogs.status, "active")
          )
        )
        .orderBy(schema.blogs.createdAt)
        .limit(blogLimit);
      const deactivatedBlogs = await orm
        .update(schema.blogs)
        .set({
          status: "deactivated",
          statusReason: `Business account downgraded to ${newTier} tier`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(schema.blogs.businessAccountId, account.id),
            isNull(schema.blogs.deletedAt),
            eq(schema.blogs.status, "active"),
            notInArray(schema.blogs.id, keptBlogIds)
          )
        )
        .returning({ id: schema.blogs.id });
      result.blogsDeactivated += deactivatedBlogs.length;

      // Stop all running sponsored quests — "running adverts stop". Marked
      // auto_paused so the owner sees why and must explicitly restart it
      // (never auto-resumed) once they re-qualify for Growth+.
      // NOTE: `sponsored_quests.updated_at` is not present on
      // `schema.sponsoredQuests` in lib/db/schema.ts (schema/DB mismatch —
      // reported upstream), so this uses Drizzle's `sql` tag directly for
      // this one statement rather than the query builder.
      const stoppedQuestsResult = await orm.execute<{ id: string }>(sql`
        UPDATE sponsored_quests
        SET is_active = FALSE, auto_paused = TRUE,
            pause_reason = 'Business account downgraded below the Growth tier',
            paused_at = NOW(), updated_at = NOW()
        WHERE business_account_id = ${account.id} AND is_active = TRUE AND deleted_at IS NULL
        RETURNING id
      `);
      const stoppedQuests = stoppedQuestsResult.rows;
      result.questsStopped += stoppedQuests.length;
      for (const q of stoppedQuests) {
        await syncSponsoredQuestTemplate(orm, q.id);
      }

      await orm
        .update(schema.businessAccounts)
        .set({
          tier: newTier,
          downgradeToTier: null,
          downgradeEffectiveAt: null,
          tierUpdatedAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(schema.businessAccounts.id, account.id));

      await insertNotification(
        orm,
        account.userId,
        "business_tier_downgraded",
        "Business Account Downgraded",
        `Your business account is now on the ${newTier} tier. Pages and sponsored quests beyond this tier's limits have been deactivated — you can restore them by upgrading again.`,
        { businessAccountId: account.id, tier: newTier }
      ).catch((err) => logger.error({ err, businessAccountId: account.id }, "[downgradeSweep] failed to notify owner"));

      result.accountsDowngraded++;
    } catch (err) {
      logger.error({ err, businessAccountId: account.id }, "[downgradeSweep] failed to apply downgrade");
    }
  }

  return result;
}

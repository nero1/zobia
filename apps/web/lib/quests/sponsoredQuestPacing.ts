/**
 * lib/quests/sponsoredQuestPacing.ts
 *
 * Sponsored Quests billing/pacing helpers shared by the daily quest deck
 * engine (lib/quests/questEngine.ts), the admin/business/creator sponsored
 * quest APIs, and the account-lifecycle sweeps (ban, subscription lapse,
 * tier downgrade).
 *
 * Billing model (per the product decision): presented to advertisers as a
 * Facebook-Ads-style duration + budget picker, but paced under the hood as
 * impression-based CPM — each time a sponsored quest is placed into a
 * user's daily deck, that's one "impression" billed at `cpm_credits` per
 * 1,000 impressions, debited from `total_budget_credits` (mirrors the
 * ad_events/ad_campaigns idiom in lib/db/schema.ts, reusing the same
 * mental model rather than inventing a new one).
 */

import { and, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

/**
 * Reach estimate shown in the business/admin creation UX: how many daily
 * quest deck impressions a given budget is expected to buy over the chosen
 * duration, given a CPM. Deliberately simple (no historical-demand curve —
 * there is no distribution data yet) so it's honest about being an estimate.
 */
export function estimateSponsoredQuestReach(
  totalBudgetCredits: number,
  cpmCredits: number,
  durationDays: number
): { totalImpressions: number; dailyAverage: number } {
  const safeCpm = cpmCredits > 0 ? cpmCredits : 500;
  const totalImpressions = Math.floor((totalBudgetCredits / safeCpm) * 1000);
  const safeDays = Math.max(1, durationDays);
  return {
    totalImpressions,
    dailyAverage: Math.floor(totalImpressions / safeDays),
  };
}

/** Duration presets shown in the business/admin creation UX (Facebook-Ads style). */
export const SPONSORED_QUEST_DURATION_PRESETS = [
  { key: "3d", label: "3 days", days: 3 },
  { key: "1w", label: "1 week", days: 7 },
  { key: "2w", label: "2 weeks", days: 14 },
  { key: "1m", label: "1 month", days: 30 },
  { key: "2m", label: "2 months", days: 60 },
] as const;

export type SponsoredQuestDurationPresetKey = (typeof SPONSORED_QUEST_DURATION_PRESETS)[number]["key"] | "custom";

/**
 * Upserts (or removes) the shadow `quest_templates` row that lets the daily
 * quest deck engine treat an eligible Sponsored Quest exactly like a regular
 * quest — same decks/progress/completion plumbing, no parallel tracking
 * system. Call after any create/update/pause/flag/moderate/expire on a
 * sponsored_quests row.
 */
export async function syncSponsoredQuestTemplate(
  db: DbOrTx,
  questId: string
): Promise<void> {
  try {
    const [quest] = await db
      .select({
        id: schema.sponsoredQuests.id,
        title: schema.sponsoredQuests.title,
        description: schema.sponsoredQuests.description,
        targetAction: schema.sponsoredQuests.targetAction,
        targetValue: schema.sponsoredQuests.targetValue,
        rewardCoins: schema.sponsoredQuests.rewardCoins,
        isActive: schema.sponsoredQuests.isActive,
        moderationStatus: schema.sponsoredQuests.moderationStatus,
        isDailyQuestEligible: schema.sponsoredQuests.isDailyQuestEligible,
        flagStatus: schema.sponsoredQuests.flagStatus,
        startsAt: schema.sponsoredQuests.startsAt,
        endsAt: schema.sponsoredQuests.endsAt,
        totalBudgetCredits: schema.sponsoredQuests.totalBudgetCredits,
        spentCredits: schema.sponsoredQuests.spentCredits,
      })
      .from(schema.sponsoredQuests)
      .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
      .limit(1);

    // Quest deleted, or not opted into daily-deck distribution — make sure
    // no stale shadow template row lingers (it just won't be selected once
    // is_active flips false, but delete it outright on hard removal).
    if (!quest || !quest.isDailyQuestEligible) {
      await db
        .update(schema.questTemplates)
        .set({ isActive: false })
        .where(eq(schema.questTemplates.sponsoredQuestId, questId));
      return;
    }

    const now = Date.now();
    const withinWindow =
      (!quest.startsAt || new Date(quest.startsAt).getTime() <= now) &&
      (!quest.endsAt || new Date(quest.endsAt).getTime() >= now);
    const budgetRemaining = Number(quest.totalBudgetCredits) - Number(quest.spentCredits);

    const eligible =
      quest.isActive &&
      quest.moderationStatus === "approved" &&
      quest.flagStatus !== "flagged" &&
      withinWindow &&
      budgetRemaining > 0;

    // Sponsored quests reward Credits directly on completion, same as any
    // other daily quest — no XP track skew, small flat XP for consistency
    // with the deck's XP economy.
    const xpReward = 50;
    const coinReward = Math.max(0, Math.min(quest.rewardCoins ?? 0, 100_000));
    const actionType = quest.targetAction?.trim() || "sponsored_quest_action";
    const targetCount = quest.targetValue && quest.targetValue > 0 ? quest.targetValue : 1;
    // Prefix so a sponsored quest can never collide with a regular
    // template's globally-unique title.
    const title = `[Sponsored] ${quest.title}`.slice(0, 250);

    await db
      .insert(schema.questTemplates)
      .values({
        title,
        description: quest.description,
        actionType,
        targetCount,
        xpReward,
        coinReward,
        track: "main",
        planRequired: null,
        category: "sponsored",
        icon: "⭐",
        featureKey: null,
        sponsoredQuestId: questId,
        isActive: eligible,
      })
      .onConflictDoUpdate({
        target: schema.questTemplates.sponsoredQuestId,
        targetWhere: sql`sponsored_quest_id IS NOT NULL`,
        set: {
          title,
          description: quest.description,
          actionType,
          targetCount,
          coinReward,
          isActive: eligible,
        },
      });
  } catch (err) {
    logger.error({ err, questId }, "[sponsoredQuestPacing] Failed to sync shadow quest_templates row (non-fatal)");
  }
}

/**
 * Atomically records a daily-deck impression and debits the quest's budget.
 * The conditional UPDATE (spent_credits + cost <= total_budget_credits)
 * prevents a last-moment race from overspending the budget across
 * concurrent deck generations. Returns false if the quest is no longer
 * affordable (caller should not have picked it, but this is the hard
 * guarantee against a stale read).
 */
export async function recordSponsoredQuestImpression(
  db: DbOrTx,
  questId: string,
  userId: string,
  costCredits: number
): Promise<boolean> {
  try {
    const updated = await db
      .update(schema.sponsoredQuests)
      .set({
        spentCredits: sql`${schema.sponsoredQuests.spentCredits} + ${costCredits}`,
        impressionsCount: sql`${schema.sponsoredQuests.impressionsCount} + 1`,
      })
      .where(
        and(
          eq(schema.sponsoredQuests.id, questId),
          lte(
            sql`${schema.sponsoredQuests.spentCredits} + ${costCredits}`,
            schema.sponsoredQuests.totalBudgetCredits
          )
        )
      )
      .returning({ id: schema.sponsoredQuests.id });
    if (updated.length === 0) return false;

    await db
      .insert(schema.sponsoredQuestEvents)
      .values({ questId, userId, eventType: "impression", costCredits: String(costCredits) })
      .onConflictDoNothing();
    return true;
  } catch (err) {
    logger.error({ err, questId, userId }, "[sponsoredQuestPacing] Failed to record impression (non-fatal)");
    return false;
  }
}

/** Today's already-spent Credits for a quest, for daily_budget_credits pacing. */
export async function getSponsoredQuestSpendToday(db: DbOrTx, questId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`SUM(${schema.sponsoredQuestEvents.costCredits})` })
    .from(schema.sponsoredQuestEvents)
    .where(
      and(
        eq(schema.sponsoredQuestEvents.questId, questId),
        eq(schema.sponsoredQuestEvents.eventType, "impression"),
        gte(schema.sponsoredQuestEvents.createdAt, sql`CURRENT_DATE`)
      )
    );
  return Number(row?.total ?? 0);
}

interface EligibleSponsoredTemplateRow {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: string | null;
  track: string;
  sponsored_quest_id: string;
  cpm_credits: string;
  daily_budget_credits: string | null;
}

/**
 * Candidate sponsored-quest templates for today's deck: budget-eligible,
 * approved, active, within their date range. Caller (questEngine) still
 * applies the daily_budget_credits pacing check per-candidate since that
 * needs a per-quest SUM query — kept out of this SELECT to avoid an N+1
 * subquery for quests that don't set a daily cap.
 */
export async function getEligibleSponsoredQuestTemplates(
  db: DbOrTx
): Promise<EligibleSponsoredTemplateRow[]> {
  const rows = await db
    .select({
      id: schema.questTemplates.id,
      title: schema.questTemplates.title,
      description: schema.questTemplates.description,
      actionType: schema.questTemplates.actionType,
      targetCount: schema.questTemplates.targetCount,
      xpReward: schema.questTemplates.xpReward,
      coinReward: schema.questTemplates.coinReward,
      category: schema.questTemplates.category,
      icon: schema.questTemplates.icon,
      planRequired: schema.questTemplates.planRequired,
      track: schema.questTemplates.track,
      sponsoredQuestId: schema.sponsoredQuests.id,
      cpmCredits: schema.sponsoredQuests.cpmCredits,
      dailyBudgetCredits: schema.sponsoredQuests.dailyBudgetCredits,
    })
    .from(schema.questTemplates)
    .innerJoin(schema.sponsoredQuests, eq(schema.sponsoredQuests.id, schema.questTemplates.sponsoredQuestId))
    .where(
      and(
        eq(schema.questTemplates.isActive, true),
        eq(schema.sponsoredQuests.isActive, true),
        eq(schema.sponsoredQuests.moderationStatus, "approved"),
        ne(schema.sponsoredQuests.flagStatus, "flagged"),
        eq(schema.sponsoredQuests.isDailyQuestEligible, true),
        sql`(${schema.sponsoredQuests.startsAt} IS NULL OR ${schema.sponsoredQuests.startsAt} <= NOW())`,
        sql`(${schema.sponsoredQuests.endsAt} IS NULL OR ${schema.sponsoredQuests.endsAt} >= NOW())`,
        lt(schema.sponsoredQuests.spentCredits, schema.sponsoredQuests.totalBudgetCredits)
      )
    );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    action_type: r.actionType,
    target_count: r.targetCount,
    xp_reward: r.xpReward,
    coin_reward: r.coinReward,
    category: r.category,
    icon: r.icon,
    plan_required: r.planRequired,
    track: r.track ?? "main",
    sponsored_quest_id: r.sponsoredQuestId,
    cpm_credits: r.cpmCredits,
    daily_budget_credits: r.dailyBudgetCredits,
  }));
}

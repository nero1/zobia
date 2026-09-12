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

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
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
  db: DatabaseAdapter | TransactionClient,
  questId: string
): Promise<void> {
  try {
    const { rows } = await db.query<{
      id: string;
      title: string;
      description: string;
      target_action: string | null;
      target_value: number | null;
      reward_coins: number | null;
      is_active: boolean;
      moderation_status: string;
      is_daily_quest_eligible: boolean;
      flag_status: string;
      starts_at: string | null;
      ends_at: string | null;
      total_budget_credits: string;
      spent_credits: string;
    }>(
      `SELECT id, title, description, target_action, target_value, reward_coins,
              is_active, moderation_status, is_daily_quest_eligible, flag_status,
              starts_at, ends_at, total_budget_credits, spent_credits
       FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL`,
      [questId]
    );
    const quest = rows[0];

    // Quest deleted, or not opted into daily-deck distribution — make sure
    // no stale shadow template row lingers (it just won't be selected once
    // is_active flips false, but delete it outright on hard removal).
    if (!quest || !quest.is_daily_quest_eligible) {
      await db.query(`UPDATE quest_templates SET is_active = FALSE WHERE sponsored_quest_id = $1`, [questId]);
      return;
    }

    const now = Date.now();
    const withinWindow =
      (!quest.starts_at || new Date(quest.starts_at).getTime() <= now) &&
      (!quest.ends_at || new Date(quest.ends_at).getTime() >= now);
    const budgetRemaining = Number(quest.total_budget_credits) - Number(quest.spent_credits);

    const eligible =
      quest.is_active &&
      quest.moderation_status === "approved" &&
      quest.flag_status !== "flagged" &&
      withinWindow &&
      budgetRemaining > 0;

    // Sponsored quests reward Credits directly on completion, same as any
    // other daily quest — no XP track skew, small flat XP for consistency
    // with the deck's XP economy.
    const xpReward = 50;
    const coinReward = Math.max(0, Math.min(quest.reward_coins ?? 0, 100_000));
    const actionType = quest.target_action?.trim() || "sponsored_quest_action";
    const targetCount = quest.target_value && quest.target_value > 0 ? quest.target_value : 1;

    await db.query(
      `INSERT INTO quest_templates
         (title, description, action_type, target_count, xp_reward, coin_reward,
          track, plan_required, category, icon, feature_key, sponsored_quest_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 'main', NULL, 'sponsored', '⭐', NULL, $7, $8)
       ON CONFLICT (sponsored_quest_id) WHERE sponsored_quest_id IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         action_type = EXCLUDED.action_type,
         target_count = EXCLUDED.target_count,
         coin_reward = EXCLUDED.coin_reward,
         is_active = EXCLUDED.is_active`,
      [
        // Prefix so a sponsored quest can never collide with a regular
        // template's globally-unique title.
        `[Sponsored] ${quest.title}`.slice(0, 250),
        quest.description,
        actionType,
        targetCount,
        xpReward,
        coinReward,
        questId,
        eligible,
      ]
    );
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
  db: DatabaseAdapter | TransactionClient,
  questId: string,
  userId: string,
  costCredits: number
): Promise<boolean> {
  try {
    const { rowCount } = await db.query(
      `UPDATE sponsored_quests
       SET spent_credits = spent_credits + $1, impressions_count = impressions_count + 1
       WHERE id = $2 AND spent_credits + $1 <= total_budget_credits`,
      [costCredits, questId]
    );
    if (!rowCount) return false;

    await db.query(
      `INSERT INTO sponsored_quest_events (quest_id, user_id, event_type, cost_credits)
       VALUES ($1, $2, 'impression', $3)
       ON CONFLICT DO NOTHING`,
      [questId, userId, costCredits]
    );
    return true;
  } catch (err) {
    logger.error({ err, questId, userId }, "[sponsoredQuestPacing] Failed to record impression (non-fatal)");
    return false;
  }
}

/** Today's already-spent Credits for a quest, for daily_budget_credits pacing. */
export async function getSponsoredQuestSpendToday(db: DatabaseAdapter, questId: string): Promise<number> {
  const { rows } = await db.query<{ total: string | null }>(
    `SELECT SUM(cost_credits) AS total FROM sponsored_quest_events
     WHERE quest_id = $1 AND event_type = 'impression' AND created_at >= CURRENT_DATE`,
    [questId]
  );
  return Number(rows[0]?.total ?? 0);
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
  db: DatabaseAdapter
): Promise<EligibleSponsoredTemplateRow[]> {
  const { rows } = await db.query<EligibleSponsoredTemplateRow>(
    `SELECT qt.id, qt.title, qt.description, qt.action_type, qt.target_count,
            qt.xp_reward, qt.coin_reward, qt.category, qt.icon, qt.plan_required, qt.track,
            sq.id AS sponsored_quest_id, sq.cpm_credits, sq.daily_budget_credits
     FROM quest_templates qt
     JOIN sponsored_quests sq ON sq.id = qt.sponsored_quest_id
     WHERE qt.is_active = TRUE
       AND sq.is_active = TRUE
       AND sq.moderation_status = 'approved'
       AND sq.flag_status != 'flagged'
       AND sq.is_daily_quest_eligible = TRUE
       AND (sq.starts_at IS NULL OR sq.starts_at <= NOW())
       AND (sq.ends_at IS NULL OR sq.ends_at >= NOW())
       AND sq.spent_credits < sq.total_budget_credits`
  );
  return rows;
}

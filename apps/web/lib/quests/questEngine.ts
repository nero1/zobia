/**
 * lib/quests/questEngine.ts
 *
 * Daily quest deck engine.
 *
 * Each user gets a deck of 3–6 quests per day based on their plan:
 *  - free : 3 quests
 *  - plus : 4 quests
 *  - pro  : 5 quests
 *  - max  : 6 quests
 *
 * Completing the entire deck awards a 500 XP bonus.
 * Quests reset at midnight UTC (stored as quest_date = YYYY-MM-DD in UTC).
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import type { Plan } from "@zobia/types";
import { ACTION_TRACKS } from "@/lib/xp/engine";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";

// Maps a ProgressionTrack name to the corresponding users table column
const TRACK_COLUMN: Record<string, string> = {
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  explorer: "xp_explorer",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** XP bonus for completing every quest in today's deck. */
const DECK_COMPLETION_BONUS_XP = 500;

/** Number of quests per plan tier. */
const DECK_SIZE_BY_PLAN: Record<Plan, number> = {
  free: 3,
  plus: 4,
  pro: 5,
  max: 6,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: Plan | null;
}

export interface QuestDeckItem extends QuestTemplate {
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// generateDailyDeck
// ---------------------------------------------------------------------------

/**
 * Generates (or returns cached) the daily quest deck for a user.
 *
 * Quest selection is deterministic per (user_id, date): uses the user ID
 * as a seed so different users may get different quests while remaining
 * consistent for the same user throughout the day.
 *
 * @param userId - UUID of the user requesting the deck.
 * @param plan   - The user's subscription plan.
 * @param db     - Active database adapter.
 * @returns Ordered array of quest deck items with current progress.
 */
export async function generateDailyDeck(
  userId: string,
  plan: Plan,
  db: DatabaseAdapter
): Promise<QuestDeckItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const deckSize = DECK_SIZE_BY_PLAN[plan] ?? 3;

  // Fetch eligible quest templates for this plan
  const { rows: templates } = await db.query<QuestTemplate>(
    `SELECT id, title, description, action_type, target_count,
            xp_reward, coin_reward, category, icon, plan_required
     FROM quest_templates
     WHERE is_active = TRUE
       AND (valid_date IS NULL OR valid_date = $1)
       AND (plan_required IS NULL OR plan_required = 'free'
            OR (plan_required = 'plus' AND $2 IN ('plus','pro','max'))
            OR (plan_required = 'pro' AND $2 IN ('pro','max'))
            OR (plan_required = 'max' AND $2 = 'max'))
     ORDER BY HASHTEXT(CONCAT($3, id::text)) -- deterministic shuffle per user
     LIMIT $4`,
    [today, plan, userId, deckSize]
  );

  if (templates.length === 0) return [];

  const questIds = templates.map((t) => t.id);

  // Persist the deck assignment so checkDeckCompletion can scope its query correctly.
  // Uses ON CONFLICT DO NOTHING for idempotency on repeated calls within the same day.
  if (questIds.length > 0) {
    const values = questIds
      .map((_, i) => `($1, $${i + 2}, $${questIds.length + 2})`)
      .join(", ");
    await db.query(
      `INSERT INTO user_quest_decks (user_id, quest_id, assigned_date)
       VALUES ${values}
       ON CONFLICT (user_id, quest_id, assigned_date) DO NOTHING`,
      [userId, ...questIds, today]
    );
  }

  const { rows: progresses } = await db.query<{
    quest_id: string;
    progress_count: number;
    completed: boolean;
    completed_at: string | null;
  }>(
    `SELECT quest_id, progress_count, completed, completed_at
     FROM user_quest_progress
     WHERE user_id = $1
       AND quest_date = $2
       AND quest_id = ANY($3::uuid[])`,
    [userId, today, questIds]
  );

  const progressMap = new Map(progresses.map((p) => [p.quest_id, p]));

  return templates.map((template) => {
    const p = progressMap.get(template.id);
    return {
      ...template,
      progress_count: p?.progress_count ?? 0,
      completed: p?.completed ?? false,
      completed_at: p?.completed_at ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// updateQuestProgress
// ---------------------------------------------------------------------------

/**
 * Increments a user's progress on a specific quest.
 * Marks the quest complete if the target is reached.
 * Awards XP + coins on first completion (idempotent).
 *
 * @param userId    - UUID of the user.
 * @param questId   - UUID of the quest template.
 * @param increment - How much to add to the progress counter (default 1).
 * @param db        - Active database adapter.
 * @returns The updated progress state and any rewards awarded.
 */
export async function updateQuestProgress(
  userId: string,
  questId: string,
  increment: number = 1,
  db: DatabaseAdapter
): Promise<{
  progress_count: number;
  completed: boolean;
  newly_completed: boolean;
  xp_awarded: number;
  coins_awarded: number;
}> {
  const today = new Date().toISOString().slice(0, 10);

  return db.transaction(async (client) => {
    const questResult = await client.query<QuestTemplate>(
      `SELECT id, target_count, xp_reward, coin_reward, action_type,
              category, icon, plan_required
       FROM quest_templates
       WHERE id = $1 AND is_active = TRUE
         AND (valid_date IS NULL OR valid_date = $2)
       LIMIT 1`,
      [questId, today]
    );
    const quest = questResult.rows[0];
    if (!quest) throw new Error(`[questEngine] Quest not found: ${questId}`);

    const progressResult = await client.query<{
      progress_count: number;
      completed: boolean;
    }>(
      `SELECT progress_count, completed
       FROM user_quest_progress
       WHERE user_id = $1 AND quest_id = $2 AND quest_date = $3
       FOR UPDATE`,
      [userId, questId, today]
    );

    const current = progressResult.rows[0];
    if (current?.completed) {
      return {
        progress_count: current.progress_count,
        completed: true,
        newly_completed: false,
        xp_awarded: 0,
        coins_awarded: 0,
      };
    }

    const prevCount = current?.progress_count ?? 0;
    const newCount = Math.min(prevCount + increment, quest.target_count);
    const nowCompleted = newCount >= quest.target_count;

    if (current) {
      await client.query(
        `UPDATE user_quest_progress
         SET progress_count = $1, completed = $2,
             completed_at = $3, updated_at = NOW()
         WHERE user_id = $4 AND quest_id = $5 AND quest_date = $6`,
        [newCount, nowCompleted, nowCompleted ? new Date().toISOString() : null, userId, questId, today]
      );
    } else {
      await client.query(
        `INSERT INTO user_quest_progress
           (user_id, quest_id, quest_date, progress_count, completed, completed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [userId, questId, today, newCount, nowCompleted, nowCompleted ? new Date().toISOString() : null]
      );
    }

    let xpAwarded = 0;
    let coinsAwarded = 0;

    if (nowCompleted) {
      xpAwarded = quest.xp_reward;
      coinsAwarded = quest.coin_reward;

      // BUG-15: use safeAwardXP for DLQ fallback and stable referenceId for idempotency
      const parallelTrack =
        ACTION_TRACKS[quest.action_type as keyof typeof ACTION_TRACKS] ?? null;
      const xpTrack = (parallelTrack as import("@/lib/xp/safeAwardXP").XPTrack) ?? "main";
      const questCompletionRef = `quest:${questId}:${userId}:${today}`;
      await safeAwardXP(userId, xpAwarded, xpTrack, "quest_complete", questCompletionRef, client);

      // Use creditCoins() for proper SELECT FOR UPDATE locking and ledger consistency (BUG-10)
      if (coinsAwarded > 0) {
        await creditCoins(userId, coinsAwarded, "quest_reward", questId, "Daily quest reward", {}, client);
      }
    }

    return {
      progress_count: newCount,
      completed: nowCompleted,
      newly_completed: nowCompleted,
      xp_awarded: xpAwarded,
      coins_awarded: coinsAwarded,
    };
  });
}

// ---------------------------------------------------------------------------
// checkDeckCompletion
// ---------------------------------------------------------------------------

/**
 * Checks whether a user has completed their entire daily quest deck.
 * If all quests are complete and the bonus hasn't been awarded yet,
 * awards the 500 XP deck completion bonus.
 *
 * @param userId - UUID of the user.
 * @param date   - ISO date string (YYYY-MM-DD) to check. Defaults to today UTC.
 * @param db     - Active database adapter.
 * @returns Whether the deck was completed and whether the bonus was newly awarded.
 */
export async function checkDeckCompletion(
  userId: string,
  date: string,
  db: DatabaseAdapter
): Promise<{ deckComplete: boolean; bonusAwarded: boolean; bonusXP: number }> {
  return db.transaction(async (client) => {
    // Lock user row to serialize concurrent calls
    await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);

    // Check quest completion for the user's assigned deck only.
    // Without the deck filter, progress on quests from other decks would
    // incorrectly count toward completion of today's assigned deck (BUG-008).
    const result = await client.query<{
      total: string;
      completed_count: string;
      bonus_already_awarded: boolean;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE uqp.completed = TRUE) AS completed_count,
         EXISTS (
           SELECT 1 FROM xp_ledger
           WHERE user_id = $1 AND source = 'complete_quest_deck'
             AND metadata->>'date' = $2
         ) AS bonus_already_awarded
       FROM user_quest_progress uqp
       WHERE uqp.user_id = $1
         AND uqp.quest_date = $2
         AND uqp.quest_id IN (
           SELECT quest_id FROM user_quest_decks
           WHERE user_id = $1 AND assigned_date = $2::date
         )`,
      [userId, date]
    );

    const row = result.rows[0];
    if (!row) return { deckComplete: false, bonusAwarded: false, bonusXP: 0 };

    const total = parseInt(row.total);
    const completed = parseInt(row.completed_count);
    const deckComplete = total > 0 && completed >= total;

    if (!deckComplete || row.bonus_already_awarded) {
      return { deckComplete, bonusAwarded: false, bonusXP: 0 };
    }

    // Award bonus within the locked transaction
    await client.query(
      `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2`,
      [DECK_COMPLETION_BONUS_XP, userId]
    );
    await client.query(
      `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, metadata, created_at)
       VALUES ($1, $2, 'main', 'complete_quest_deck', $2, $3::jsonb, NOW())`,
      [userId, DECK_COMPLETION_BONUS_XP, JSON.stringify({ date })]
    );

    return { deckComplete: true, bonusAwarded: true, bonusXP: DECK_COMPLETION_BONUS_XP };
  });
}

// ---------------------------------------------------------------------------
// resetDailyQuests
// ---------------------------------------------------------------------------

/**
 * CRON: Resets all daily quest progress records for the new day.
 *
 * Only marks old records as "expired" — does not delete them so audit
 * history is preserved. New progress inserts happen on the new date automatically.
 *
 * @param db - Active database adapter.
 * @returns Number of quest progress rows that were cleared.
 */
export async function resetDailyQuests(
  db: DatabaseAdapter
): Promise<{ clearedRows: number }> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const result = await db.query<{ count: string }>(
    `WITH deleted AS (
       UPDATE user_quest_progress
       SET expired_at = NOW()
       WHERE quest_date <= $1 AND expired_at IS NULL
       RETURNING 1
     )
     SELECT COUNT(*) AS count FROM deleted`,
    [yesterday]
  );

  return { clearedRows: parseInt(result.rows[0]?.count ?? "0") };
}

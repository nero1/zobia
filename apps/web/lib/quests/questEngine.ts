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
import { publishRealtimeEvent } from "@/lib/realtime";
import { logger } from "@/lib/logger";

// Maps a ProgressionTrack name to the corresponding users table column
const TRACK_COLUMN: Record<string, string> = {
  main: "xp_total",
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
  gaming: "xp_gaming",
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
     ORDER BY MD5(CONCAT($3::text, $1::text, id::text)) -- deterministic stable shuffle per user per day
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

  // Collect XP award details inside the transaction and issue safeAwardXP
  // only AFTER the transaction commits. This prevents phantom DLQ entries:
  // if the transaction rolls back, there is no XP to award and no DLQ entry
  // should be written.
  let pendingXP: { amount: number; track: import("@/lib/xp/safeAwardXP").XPTrack; ref: string } | null = null;

  const result = await db.transaction(async (client) => {
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

    const deckCheck = await client.query(
      `SELECT 1 FROM user_quest_decks WHERE user_id = $1 AND quest_id = $2 AND assigned_date = $3 LIMIT 1`,
      [userId, questId, today]
    );
    if (!deckCheck.rows[0]) throw new Error(`[questEngine] Quest ${questId} not in user's deck`);

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

      const parallelTrack =
        ACTION_TRACKS[quest.action_type as keyof typeof ACTION_TRACKS] ?? null;
      if (parallelTrack === null && !(quest.action_type in ACTION_TRACKS)) {
        logger.warn({ questId, actionType: quest.action_type }, "[questEngine] unknown action_type — no track mapping found, awarding main XP");
      }
      const xpTrack = (parallelTrack as import("@/lib/xp/safeAwardXP").XPTrack) ?? "main";
      const questCompletionRef = `quest:${questId}:${userId}:${today}`;

      // Defer XP award to post-commit; record intent here
      pendingXP = { amount: xpAwarded, track: xpTrack, ref: questCompletionRef };

      // Use creditCoins() for proper SELECT FOR UPDATE locking and ledger consistency (BUG-10)
      // SYS-CL-01: per-user, per-day reference (mirrors questCompletionRef above) — a bare
      // questId would collide across every user completing the same quest template.
      if (coinsAwarded > 0) {
        await creditCoins(userId, coinsAwarded, "quest_reward", questCompletionRef, "Daily quest reward", {}, client);
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

  // Issue XP award after the transaction commits so a rollback doesn't leave
  // a phantom DLQ entry for XP that was never actually lost.
  // Type assertion needed because TS narrows `let` vars assigned inside async callbacks to their
  // initial type (null) after the await; the runtime value is correct.
  const capturedXP = pendingXP as { amount: number; track: import("@/lib/xp/safeAwardXP").XPTrack; ref: string } | null;
  if (capturedXP) {
    await safeAwardXP(userId, capturedXP.amount, capturedXP.track, "quest_complete", capturedXP.ref);
  }

  return result;
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
  // Track whether we should issue XP after the transaction commits.
  let shouldAwardBonus = false;
  const deckRef = `deck_completion:${userId}:${date}`;

  const result = await db.transaction(async (client) => {
    // Lock user row to serialize concurrent calls
    await client.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [userId]);

    // Check quest completion for the user's assigned deck only.
    // Without the deck filter, progress on quests from other decks would
    // incorrectly count toward completion of today's assigned deck (BUG-008).
    const queryResult = await client.query<{
      total: string;
      completed_count: string;
      bonus_already_awarded: boolean;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE uqp.completed = TRUE) AS completed_count,
         EXISTS (
           SELECT 1 FROM xp_ledger
           WHERE user_id = $1 AND source = 'deck_completion'
             AND reference_id = $3
         ) AS bonus_already_awarded
       FROM user_quest_progress uqp
       WHERE uqp.user_id = $1
         AND uqp.quest_date = $2
         AND uqp.quest_id IN (
           SELECT quest_id FROM user_quest_decks
           WHERE user_id = $1 AND assigned_date = $2::date
         )`,
      [userId, date, deckRef]
    );

    const row = queryResult.rows[0];
    if (!row) return { deckComplete: false, bonusAwarded: false, bonusXP: 0 };

    const total = parseInt(row.total);
    const completed = parseInt(row.completed_count);
    const deckComplete = total > 0 && completed >= total;

    if (!deckComplete || row.bonus_already_awarded) {
      return { deckComplete, bonusAwarded: false, bonusXP: 0 };
    }

    // Mark that bonus should be awarded post-commit (avoids phantom DLQ if tx rolls back)
    shouldAwardBonus = true;

    return { deckComplete: true, bonusAwarded: true, bonusXP: DECK_COMPLETION_BONUS_XP };
  });

  // Issue XP award after the transaction commits so a rollback doesn't leave
  // a phantom DLQ entry for XP that was never actually lost.
  if (shouldAwardBonus) {
    await safeAwardXP(userId, DECK_COMPLETION_BONUS_XP, 'main', 'deck_completion', deckRef);
  }

  return result;
}

// ---------------------------------------------------------------------------
// triggerActivityQuestProgress
// ---------------------------------------------------------------------------

/**
 * Find all quests in a user's current-day deck that match `actionType`,
 * increment each by 1, award rewards on completion, and fire realtime
 * `reward_earned` events.  Errors are swallowed — call fire-and-forget.
 *
 * @param userId     - UUID of the user performing the action
 * @param actionType - quest_templates.action_type to match (e.g. 'join_new_room')
 * @param dbAdapter  - Active database adapter
 */
export async function triggerActivityQuestProgress(
  userId: string,
  actionType: string,
  dbAdapter: DatabaseAdapter
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows: matchingQuests } = await dbAdapter.query<{ id: string }>(
      `SELECT qt.id
       FROM quest_templates qt
       JOIN user_quest_decks uqd
         ON uqd.quest_id    = qt.id
        AND uqd.user_id     = $1
        AND uqd.assigned_date = $2::date
       WHERE qt.action_type = $3
         AND qt.is_active   = TRUE
         AND (qt.valid_date IS NULL OR qt.valid_date = $2)`,
      [userId, today, actionType]
    );

    if (matchingQuests.length === 0) return;

    let anyNewlyCompleted = false;

    for (const quest of matchingQuests) {
      try {
        const result = await updateQuestProgress(userId, quest.id, 1, dbAdapter);
        if (result.newly_completed) {
          anyNewlyCompleted = true;
          publishRealtimeEvent(`user:${userId}`, "reward_earned", {
            type: "quest_complete",
            xpAmount: result.xp_awarded,
            coinAmount: result.coins_awarded,
          }).catch(() => {});
        }
      } catch (err) {
        logger.error({ userId, questId: quest.id, err }, "[questEngine] updateQuestProgress failed (non-fatal)");
      }
    }

    if (anyNewlyCompleted) {
      try {
        const deckResult = await checkDeckCompletion(userId, today, dbAdapter);
        if (deckResult.bonusAwarded) {
          publishRealtimeEvent(`user:${userId}`, "reward_earned", {
            type: "deck_complete",
            xpAmount: deckResult.bonusXP,
            coinAmount: 0,
          }).catch(() => {});
        }
      } catch (err) {
        logger.error({ userId, err }, "[questEngine] checkDeckCompletion failed (non-fatal)");
      }
    }
  } catch (err) {
    logger.error({ userId, actionType, err }, "[questEngine] triggerActivityQuestProgress failed");
  }
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
  const todayUTC = new Date().toISOString().slice(0, 10);

  const result = await db.query<{ count: string }>(
    `WITH deleted AS (
       UPDATE user_quest_progress
       SET expired_at = NOW()
       WHERE quest_date < $1::date AND expired_at IS NULL
       RETURNING 1
     )
     SELECT COUNT(*) AS count FROM deleted`,
    [todayUTC]
  );

  // DATA-01: purge old expired rows to prevent unbounded table growth
  await db.query(
    `DELETE FROM user_quest_progress
     WHERE expired_at IS NOT NULL
       AND quest_date < $1::date - INTERVAL '7 days'`,
    [todayUTC]
  ).catch((err) => {
    logger.error({ err }, "[questEngine] Failed to purge old user_quest_progress rows");
  });

  await db.query(
    `DELETE FROM user_quest_decks WHERE assigned_date < CURRENT_DATE - INTERVAL '30 days'`
  );

  return { clearedRows: parseInt(result.rows[0]?.count ?? "0") };
}

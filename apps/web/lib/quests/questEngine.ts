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

import { randomBytes } from "crypto";
import type { DatabaseAdapter } from "@/lib/db/interface";
import type { Plan } from "@zobia/types";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { publishRealtimeEvent } from "@/lib/realtime";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { db as globalDb } from "@/lib/db";

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
  /** Parallel progression track this quest's XP reward feeds (PRD §7), e.g. 'social', 'explorer'. */
  track: string;
}

export interface QuestDeckItem extends QuestTemplate {
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// CSPRNG helpers
// ---------------------------------------------------------------------------

/**
 * Returns a cryptographically random integer in [0, max) using rejection
 * sampling to avoid modulo bias.
 */
function cryptoRandInt(max: number): number {
  if (max <= 1) return 0;
  const bytesNeeded = 4;
  const limit = 0x100000000 - (0x100000000 % max);
  let val: number;
  do {
    val = randomBytes(bytesNeeded).readUInt32BE(0);
  } while (val >= limit);
  return val % max;
}

// ---------------------------------------------------------------------------
// generateDailyDeck
// ---------------------------------------------------------------------------

/**
 * Generates (or returns cached) the daily quest deck for a user.
 *
 * Quest selection uses a cryptographically random Fisher-Yates shuffle
 * (crypto.randomBytes) — not a seeded deterministic source, so each call
 * may return a different ordering even for the same user and date.
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

  // BUG-006 FIX: acquire a per-user+date distributed lock before inserting the
  // deck. Without this, two concurrent requests arriving at the same time (e.g.
  // two tabs opening simultaneously) could each insert a disjoint subset of
  // quests, producing a deck larger than deckSize — because ON CONFLICT DO
  // NOTHING operates per-row, not per-user+date.
  const lockKey = `quest_deck_lock:${userId}:${today}`;
  const lockValue = randomBytes(16).toString("hex");
  const LOCK_TTL_SECONDS = 10;

  const acquired = await redis.set(lockKey, lockValue, "EX", LOCK_TTL_SECONDS, "NX");

  if (acquired !== "OK") {
    // Another instance is generating the deck — wait briefly then fall through
    // to the re-query below (the other instance will have persisted the rows).
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    // BUG-009 FIX: check whether a deck already exists for this user+date
    // before generating a new shuffle. If it does, skip the INSERT entirely
    // and go straight to the stable DB re-query below.
    const { rows: existingDeck } = await db.query<{ quest_id: string }>(
      `SELECT quest_id FROM user_quest_decks WHERE user_id = $1 AND assigned_date = $2::date LIMIT 1`,
      [userId, today]
    );

    if (existingDeck.length === 0) {
      // Fetch ALL eligible quest templates for this plan without a DB-level shuffle.
      // Selection is done in application code via a CSPRNG-based Fisher-Yates shuffle
      // so no key material is passed to the DB and the shuffle is cryptographically
      // unpredictable.
      const { rows: allTemplates } = await db.query<QuestTemplate>(
        `SELECT id, title, description, action_type, target_count,
                xp_reward, coin_reward, category, icon, plan_required, track
         FROM quest_templates
         WHERE is_active = TRUE
           AND (valid_date IS NULL OR valid_date = $1)
           AND (plan_required IS NULL OR plan_required = 'free'
                OR (plan_required = 'plus' AND $2 IN ('plus','pro','max'))
                OR (plan_required = 'pro' AND $2 IN ('pro','max'))
                OR (plan_required = 'max' AND $2 = 'max'))`,
        [today, plan]
      );

      // Fisher-Yates shuffle using crypto.randomBytes — O(n) in-place, unbiased
      const templates = [...allTemplates];
      for (let i = templates.length - 1; i > 0; i--) {
        const j = cryptoRandInt(i + 1);
        [templates[i], templates[j]] = [templates[j], templates[i]];
      }
      const selectedTemplates = templates.slice(0, deckSize);

      if (selectedTemplates.length > 0) {
        const questIds = selectedTemplates.map((t) => t.id);
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
    }
  } finally {
    // Release the lock only if we still own it (avoid releasing a lock taken
    // by another instance after our TTL expired).
    const currentVal = await redis.get(lockKey);
    if (currentVal === lockValue) {
      await redis.del(lockKey);
    }
  }

  // BUG-009 FIX: always re-query user_quest_decks + quest_templates after the
  // INSERT so the returned array reflects what is actually in the DB in a
  // stable, deterministic order (id ASC). Returning the in-memory shuffled
  // array produced different orderings on repeated calls within the same day.
  const { rows: assignedRows } = await db.query<QuestTemplate & {
    quest_id: string;
    progress_count: number;
    completed: boolean;
    completed_at: string | null;
  }>(
    `SELECT
       qt.id, qt.title, qt.description, qt.action_type, qt.target_count,
       qt.xp_reward, qt.coin_reward, qt.category, qt.icon, qt.plan_required, qt.track,
       COALESCE(uqp.progress_count, 0) AS progress_count,
       COALESCE(uqp.completed, FALSE) AS completed,
       uqp.completed_at
     FROM user_quest_decks uqd
     JOIN quest_templates qt ON qt.id = uqd.quest_id
     LEFT JOIN user_quest_progress uqp
       ON uqp.user_id = $1
      AND uqp.quest_id = qt.id
      AND uqp.quest_date = $2
     WHERE uqd.user_id = $1
       AND uqd.assigned_date = $2::date
     ORDER BY uqd.id ASC`,
    [userId, today]
  );

  return assignedRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    action_type: row.action_type,
    target_count: row.target_count,
    xp_reward: row.xp_reward,
    coin_reward: row.coin_reward,
    category: row.category,
    icon: row.icon,
    plan_required: row.plan_required,
    track: row.track,
    progress_count: row.progress_count,
    completed: row.completed,
    completed_at: row.completed_at ?? null,
  }));
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
  // BUG-022 FIX: reject non-positive increments before touching the DB.
  // A zero or negative increment would decrement progress or be a no-op,
  // neither of which is a valid quest progress update. Callers that pass
  // a negative increment (e.g. due to a sign-flip bug) would silently corrupt
  // quest progress without this guard.
  if (typeof increment !== "number" || !Number.isFinite(increment) || increment <= 0) {
    throw new Error(`[questEngine] updateQuestProgress: increment must be a positive number, got ${increment}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Collect XP award details inside the transaction and issue safeAwardXP
  // only AFTER the transaction commits. This prevents phantom DLQ entries:
  // if the transaction rolls back, there is no XP to award and no DLQ entry
  // should be written.
  let pendingXP: { amount: number; track: import("@/lib/xp/safeAwardXP").XPTrack; ref: string } | null = null;
  // PRD §7 (Elder System): Elder earns 10% of a Mentee's quest XP as a Mentorship Bonus.
  let pendingElderBonus: { elderId: string; amount: number; ref: string; menteeId: string } | null = null;

  const result = await db.transaction(async (client) => {
    const questResult = await client.query<QuestTemplate>(
      `SELECT id, target_count, xp_reward, coin_reward, action_type,
              category, icon, plan_required, track
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

      // Quest XP is routed by quest_templates.track (e.g. 'social', 'explorer',
      // 'generosity') — NOT by ACTION_TRACKS, which is keyed by XPAction values
      // from lib/xp/engine.ts and uses a different naming namespace than
      // quest_templates.action_type (e.g. 'send_text_message' vs 'messages').
      // Looking action_type up in ACTION_TRACKS never matched, so every quest
      // completion silently fell back to the main track regardless of category.
      const xpTrack = (TRACK_COLUMN[quest.track] ? quest.track : "main") as import("@/lib/xp/safeAwardXP").XPTrack;
      if (!TRACK_COLUMN[quest.track]) {
        logger.warn({ questId, track: quest.track }, "[questEngine] unknown quest track — awarding main XP");
      }
      const questCompletionRef = `quest:${questId}:${userId}:${today}`;

      // Defer XP award to post-commit; record intent here
      pendingXP = { amount: xpAwarded, track: xpTrack, ref: questCompletionRef };

      // Use creditCoins() for proper SELECT FOR UPDATE locking and ledger consistency (BUG-10)
      // SYS-CL-01: per-user, per-day reference (mirrors questCompletionRef above) — a bare
      // questId would collide across every user completing the same quest template.
      if (coinsAwarded > 0) {
        await creditCoins(userId, coinsAwarded, "quest_reward", questCompletionRef, "Daily quest reward", {}, client);
      }

      // PRD §7: Elder mentorship bonus — 10% of quest XP to the user's active Elder mentor.
      const elderResult = await client.query<{ elder_id: string }>(
        `SELECT elder_id FROM elder_mentorships
         WHERE mentee_id = $1 AND COALESCE(status, 'active') = 'active'
         LIMIT 1`,
        [userId]
      );
      const elderBonus = Math.floor(xpAwarded * 0.1);
      if (elderResult.rows[0] && elderBonus > 0) {
        pendingElderBonus = {
          elderId: elderResult.rows[0].elder_id,
          amount: elderBonus,
          ref: `mentorship_bonus:${questCompletionRef}`,
          menteeId: userId,
        };
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

  const capturedElderBonus = pendingElderBonus as { elderId: string; amount: number; ref: string; menteeId: string } | null;
  if (capturedElderBonus) {
    await safeAwardXP(capturedElderBonus.elderId, capturedElderBonus.amount, "main", "mentorship_bonus", capturedElderBonus.ref);
    try {
      const { insertNotification } = await import("@/lib/notifications/insert");
      await insertNotification(
        globalDb,
        capturedElderBonus.elderId,
        "mentorship_bonus",
        "Mentorship bonus earned!",
        `Your mentee earned ${capturedElderBonus.amount} XP for you by completing a quest.`,
        { menteeId: capturedElderBonus.menteeId, bonusXP: capturedElderBonus.amount }
      );
    } catch (err) {
      logger.error({ err, elderId: capturedElderBonus.elderId }, "[questEngine] Failed to notify elder of mentorship bonus (non-fatal)");
    }
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
         (SELECT COUNT(*) FROM user_quest_decks
          WHERE user_id = $1 AND assigned_date = $2::date) AS total,
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
 * @param actionType - quest_templates.action_type to match (e.g. 'room_join')
 * @param dbAdapter  - Active database adapter
 * @param increment  - How much to increment matching quests by (default 1).
 *                     Used by meta-quests like 'xp_meta' where the increment
 *                     equals the XP amount earned rather than a flat unit.
 */
export async function triggerActivityQuestProgress(
  userId: string,
  actionType: string,
  dbAdapter: DatabaseAdapter,
  increment: number = 1
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
        const result = await updateQuestProgress(userId, quest.id, increment, dbAdapter);
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
  ).catch((err) => {
    logger.warn({ err }, "[questEngine] Failed to prune old user_quest_decks rows");
  });

  return { clearedRows: parseInt(result.rows[0]?.count ?? "0") };
}

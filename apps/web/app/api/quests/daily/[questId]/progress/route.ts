/**
 * app/api/quests/daily/[questId]/progress/route.ts
 *
 * Quest progress update endpoint.
 *
 * POST /api/quests/daily/[questId]/progress
 *   - Increments the user's progress counter for the given quest
 *   - Marks the quest complete if the target count is reached
 *   - Awards XP and coins when quest is first completed
 *   - Idempotent: repeated calls after completion are no-ops
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestTemplate {
  id: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  is_active: boolean;
}

interface QuestProgressRow {
  quest_id: string;
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const progressSchema = z.object({
  /** How much to increment the counter by (default 1). */
  increment: z.number().int().positive().max(100).default(1),
});

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

interface QuestParams {
  questId: string;
}

// ---------------------------------------------------------------------------
// POST /api/quests/daily/[questId]/progress
// ---------------------------------------------------------------------------

/**
 * Update progress on a daily quest.
 *
 * Increments the user's progress counter by `increment` (default 1).
 * If the target is reached and the quest has not been completed before,
 * awards XP and coins and marks the quest complete.
 *
 * @returns JSON { progress_count, completed, xp_awarded?, coins_awarded? }
 */
export const POST = withAuth<QuestParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { questId } = params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

    const body = await validateBody(req, progressSchema);
    const today = new Date().toISOString().slice(0, 10);

    const outcome = await db.transaction(async (client) => {
      // 1. Verify the quest exists and is active today
      const questResult = await client.query<QuestTemplate>(
        `SELECT id, target_count, xp_reward, coin_reward, is_active
         FROM quest_templates
         WHERE id = $1
           AND is_active = true
           AND (valid_date IS NULL OR valid_date = $2)
         LIMIT 1`,
        [questId, today]
      );

      const quest = questResult.rows[0];
      if (!quest) throw notFound("Quest not found or not active today");

      // 2. Get or create progress row (locked for update)
      const progressResult = await client.query<QuestProgressRow>(
        `SELECT quest_id, progress_count, completed, completed_at
         FROM user_quest_progress
         WHERE user_id = $1 AND quest_id = $2 AND quest_date = $3
         FOR UPDATE`,
        [auth.user.sub, questId, today]
      );

      let currentProgress = progressResult.rows[0];
      const alreadyCompleted = currentProgress?.completed ?? false;

      // 3. If already completed – return current state (idempotent)
      if (alreadyCompleted) {
        return {
          progress_count: currentProgress!.progress_count,
          completed: true,
          completed_at: currentProgress!.completed_at,
          xp_awarded: 0,
          coins_awarded: 0,
          newly_completed: false,
        };
      }

      // 4. Calculate new progress count
      const currentCount = currentProgress?.progress_count ?? 0;
      const newCount = Math.min(currentCount + body.increment, quest.target_count);
      const nowCompleted = newCount >= quest.target_count;

      if (currentProgress) {
        // Update existing row
        await client.query(
          `UPDATE user_quest_progress
           SET progress_count = $1,
               completed      = $2,
               completed_at   = $3,
               updated_at     = NOW()
           WHERE user_id = $4 AND quest_id = $5 AND quest_date = $6`,
          [
            newCount,
            nowCompleted,
            nowCompleted ? new Date().toISOString() : null,
            auth.user.sub,
            questId,
            today,
          ]
        );
      } else {
        // Insert new progress row
        await client.query(
          `INSERT INTO user_quest_progress
             (user_id, quest_id, quest_date, progress_count, completed, completed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            auth.user.sub,
            questId,
            today,
            newCount,
            nowCompleted,
            nowCompleted ? new Date().toISOString() : null,
          ]
        );
      }

      // 5. Award XP + coins on first completion
      let xpAwarded = 0;
      let coinsAwarded = 0;

      if (nowCompleted) {
        xpAwarded = quest.xp_reward;
        coinsAwarded = quest.coin_reward;

        // Write to xp_ledger
        await client.query(
          `INSERT INTO xp_ledger (user_id, action, xp_amount, multiplier, xp_net, metadata, created_at)
           VALUES ($1, 'quest_complete', $2, 1.0, $2, $3, NOW())`,
          [
            auth.user.sub,
            xpAwarded,
            JSON.stringify({ quest_id: questId, date: today }),
          ]
        );

        // Update user xp_total + coin_balance
        await client.query(
          `UPDATE users
           SET xp_total     = COALESCE(xp_total, 0) + $1,
               coin_balance = COALESCE(coin_balance, 0) + $2,
               updated_at   = NOW()
           WHERE id = $3`,
          [xpAwarded, coinsAwarded, auth.user.sub]
        );

        // Write to coin_ledger
        await client.query(
          `INSERT INTO coin_ledger (user_id, amount, type, reference, created_at)
           VALUES ($1, $2, 'quest_reward', $3, NOW())`,
          [auth.user.sub, coinsAwarded, questId]
        );
      }

      return {
        progress_count: newCount,
        completed: nowCompleted,
        completed_at: nowCompleted ? new Date().toISOString() : null,
        xp_awarded: xpAwarded,
        coins_awarded: coinsAwarded,
        newly_completed: nowCompleted,
      };
    });

    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

export const dynamic = 'force-dynamic';

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
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { publishRealtimeEvent } from "@/lib/realtime";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DECK_BONUS_XP = 500;

function questDeckSizeForPlan(plan: string | null | undefined): number {
  switch (plan) {
    case "max":  return 6;
    case "pro":  return 5;
    case "plus": return 4;
    default:     return 3;
  }
}

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
        // Check for an active quest_accelerator booster (PRD §3: +50% XP on quest completions for 7 days)
        const { rows: acceleratorRows } = await client.query<{ id: string }>(
          `SELECT id FROM user_xp_boosters
           WHERE user_id = $1
             AND booster_type = 'quest_accelerator'
             AND expires_at > NOW()
             AND is_active = TRUE
           LIMIT 1`,
          [auth.user.sub]
        );
        const questAcceleratorActive = acceleratorRows.length > 0;

        // Base XP from quest; apply +50% if accelerator is active (integer arithmetic)
        const baseXP = quest.xp_reward;
        xpAwarded = questAcceleratorActive
          ? Math.floor(baseXP * 150 / 100)  // +50% using integer basis-point math
          : baseXP;
        const multiplierUsed = questAcceleratorActive ? 1.5 : 1.0;

        coinsAwarded = quest.coin_reward;

        // Stable per-user, per-day idempotency key (bare questId would block
        // re-completion of the same repeating quest on subsequent days).
        const questRef = `quest:${questId}:${auth.user.sub}:${today}`;

        // Write to xp_ledger (ON CONFLICT guards against concurrent retries)
        await client.query(
          `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount, created_at)
           VALUES ($1, $2, 'main', 'quest_complete', $3, $4, $5, NOW())
           ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
          [
            auth.user.sub,
            xpAwarded,
            questRef,
            multiplierUsed,
            baseXP,
          ]
        );

        // Read coin balance BEFORE the UPDATE so balance_before in the ledger
        // reflects the pre-award balance (SYS-CL-02: previously read after UPDATE).
        let coinBalanceBefore = 0;
        if (coinsAwarded > 0) {
          const { rows: preBalRows } = await client.query<{ coin_balance: string }>(
            `SELECT coin_balance FROM users WHERE id = $1`,
            [auth.user.sub]
          );
          coinBalanceBefore = parseInt(preBalRows[0]?.coin_balance ?? "0", 10);
        }

        // Update user xp_total + coin_balance
        await client.query(
          `UPDATE users
           SET xp_total     = COALESCE(xp_total, 0) + $1,
               coin_balance = COALESCE(coin_balance, 0) + $2,
               updated_at   = NOW()
           WHERE id = $3`,
          [xpAwarded, coinsAwarded, auth.user.sub]
        );

        // Write to coin_ledger with the pre-award balance captured above
        if (coinsAwarded > 0) {
          await client.query(
            `INSERT INTO coin_ledger
               (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
             VALUES ($1, $2, $3, $4, 'quest_reward', $5, 'Quest completion reward', NOW())
             ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
            [auth.user.sub, coinsAwarded, coinBalanceBefore, coinBalanceBefore + coinsAwarded, questRef]
          );
        }

        // Elder mentorship bonus — award 10% of quest XP to the active elder (PRD §7)
        const elderBonus = Math.floor(xpAwarded * 0.1);
        if (elderBonus > 0) {
          const { rows: elderRows } = await client.query<{ elder_id: string }>(
            `SELECT elder_id FROM elder_mentorships
             WHERE mentee_id = $1 AND COALESCE(status, 'active') = 'active'
             LIMIT 1`,
            [auth.user.sub]
          );
          if (elderRows[0]) {
            const elderId = elderRows[0].elder_id;
            await client.query(
              `UPDATE users SET xp_total = COALESCE(xp_total, 0) + $1, updated_at = NOW() WHERE id = $2`,
              [elderBonus, elderId]
            );
            await client.query(
              `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
               VALUES ($1, $2, 'main', 'mentorship_bonus', $3, $2, NOW())
               ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
              [elderId, elderBonus, questRef]
            );
            // Notify elder of mentorship bonus (fire-and-forget)
            client.query(
              `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
               VALUES ($1, 'mentorship_bonus', $2, false, NOW())`,
              [
                elderId,
                JSON.stringify({ menteeId: auth.user.sub, bonusXP: elderBonus }),
              ]
            ).catch(() => {});
          }
        }
      }

      // Check if all daily quests are now complete → award deck bonus
      let deckBonusXP = 0;
      let deckCompleted = false;

      if (nowCompleted) {
        const { rows: planRows } = await client.query<{ plan: string | null }>(
          `SELECT plan FROM users WHERE id = $1 LIMIT 1`,
          [auth.user.sub]
        );
        const deckLimit = questDeckSizeForPlan(planRows[0]?.plan ?? null);

        const { rows: deckTemplates } = await client.query<{ id: string }>(
          `SELECT id FROM quest_templates
           WHERE is_active = true AND (valid_date IS NULL OR valid_date = $1)
           ORDER BY category, id LIMIT $2`,
          [today, deckLimit]
        );

        if (deckTemplates.length > 0) {
          const deckIds = deckTemplates.map((q) => q.id);
          const { rows: completedRows } = await client.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM user_quest_progress
             WHERE user_id = $1 AND quest_date = $2 AND quest_id = ANY($3::uuid[]) AND completed = true`,
            [auth.user.sub, today, deckIds]
          );
          const allDone = parseInt(completedRows[0]?.count ?? "0", 10) >= deckTemplates.length;

          if (allDone) {
            // Idempotency: use a deterministic reference_id and ON CONFLICT DO NOTHING
            // to atomically prevent duplicate deck bonus awards (eliminates TOCTOU race
            // between a prior SELECT-then-INSERT approach).
            const deckBonusRef = `deck_bonus:${auth.user.sub}:${today}`;
            const { rows: bonusInsertRows } = await client.query<{ id: string }>(
              `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
               VALUES ($1, $2, 'main', 'deck_bonus', $3, $2, NOW())
               ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
               RETURNING id`,
              [auth.user.sub, DECK_BONUS_XP, deckBonusRef]
            );

            if (bonusInsertRows[0]) {
              deckBonusXP = DECK_BONUS_XP;
              deckCompleted = true;
              await client.query(
                `UPDATE users SET xp_total = COALESCE(xp_total, 0) + $1, updated_at = NOW() WHERE id = $2`,
                [deckBonusXP, auth.user.sub]
              );
            }
          }
        }
      }

      return {
        progress_count: newCount,
        completed: nowCompleted,
        completed_at: nowCompleted ? new Date().toISOString() : null,
        xp_awarded: xpAwarded,
        coins_awarded: coinsAwarded,
        newly_completed: nowCompleted,
        deck_completed: deckCompleted,
        deck_bonus_xp: deckBonusXP,
      };
    });

    // Fire-and-forget post-completion side effects
    if (outcome.newly_completed) {
      recordWarContribution(auth.user.sub, 'complete_quest', db).catch((err) =>
        logger.error({ err: err }, '[quests:POST] war contribution failed');
      );

      // Notify client to show floating reward notifications
      if (outcome.xp_awarded > 0 || outcome.coins_awarded > 0) {
        publishRealtimeEvent(`user:${auth.user.sub}`, "reward_earned", {
          type: "quest_complete",
          xpAmount: outcome.xp_awarded,
          coinAmount: outcome.coins_awarded,
        }).catch(() => {});
      }
    }

    if (outcome.deck_completed) {
      publishRealtimeEvent(`user:${auth.user.sub}`, "reward_earned", {
        type: "deck_complete",
        xpAmount: outcome.deck_bonus_xp,
        coinAmount: 0,
      }).catch(() => {});
    }

    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

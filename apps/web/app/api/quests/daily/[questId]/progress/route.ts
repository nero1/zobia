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
 *
 * Delegates to lib/quests/questEngine.ts (updateQuestProgress /
 * checkDeckCompletion) — the same engine used by server-side action routes
 * (message send, room join, gifting, etc via triggerActivityQuestProgress) —
 * so there is a single source of truth for quest completion, deck-bonus
 * awarding, and Elder mentorship bonus logic instead of two divergent
 * implementations.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { publishRealtimeEvent } from "@/lib/realtime";
import { updateQuestProgress, checkDeckCompletion } from "@/lib/quests/questEngine";
import { logger } from "@/lib/logger";

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
 * awards XP and coins and marks the quest complete. The quest must be part
 * of the user's assigned deck for today (see GET /api/quests/daily) —
 * otherwise the update is rejected.
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

    let outcome;
    try {
      outcome = await updateQuestProgress(auth.user.sub, questId, body.increment, db);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not in user's deck") || message.includes("Quest not found")) {
        throw notFound("Quest not found or not in today's deck");
      }
      throw err;
    }

    let deckCompleted = false;
    let deckBonusXP = 0;

    if (outcome.newly_completed) {
      recordWarContribution(auth.user.sub, 'complete_quest', db).catch((err) => {
        logger.error({ err }, '[quests:progress] war contribution failed');
      });

      if (outcome.xp_awarded > 0 || outcome.coins_awarded > 0) {
        publishRealtimeEvent(`user:${auth.user.sub}`, "reward_earned", {
          type: "quest_complete",
          xpAmount: outcome.xp_awarded,
          coinAmount: outcome.coins_awarded,
        }).catch(() => {});
      }

      const deckResult = await checkDeckCompletion(auth.user.sub, today, db);
      if (deckResult.bonusAwarded) {
        deckCompleted = true;
        deckBonusXP = deckResult.bonusXP;
        publishRealtimeEvent(`user:${auth.user.sub}`, "reward_earned", {
          type: "deck_complete",
          xpAmount: deckBonusXP,
          coinAmount: 0,
        }).catch(() => {});
      }
    }

    return NextResponse.json(
      {
        progress_count: outcome.progress_count,
        completed: outcome.completed,
        xp_awarded: outcome.xp_awarded,
        coins_awarded: outcome.coins_awarded,
        newly_completed: outcome.newly_completed,
        deck_completed: deckCompleted,
        deck_bonus_xp: deckBonusXP,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

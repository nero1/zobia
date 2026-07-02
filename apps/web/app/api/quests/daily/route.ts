export const dynamic = 'force-dynamic';

/**
 * app/api/quests/daily/route.ts
 *
 * Daily quest deck endpoints.
 *
 * GET  /api/quests/daily
 *   Returns today's quest deck for the authenticated user.
 *   Each quest includes the user's current progress.
 *
 * POST /api/quests/daily/[questId]/progress
 *   Updates quest progress (increments counter, marks complete if target reached).
 *   Note: the progress POST lives in ./[questId]/progress/route.ts – this file
 *   handles only the GET for the deck list.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { generateDailyDeck } from "@/lib/quests/questEngine";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// GET /api/quests/daily
// ---------------------------------------------------------------------------

/**
 * Return today's quest deck for the authenticated user.
 *
 * Delegates to lib/quests/questEngine.generateDailyDeck so the deck is
 * actually persisted to `user_quest_decks`. Without this, action routes that
 * call triggerActivityQuestProgress() would never find the quest in the
 * user's deck and progress would silently never advance (BUG: quests always
 * showed 0/x because the deck the client saw here and the deck membership
 * check in updateQuestProgress() referenced two different, disconnected
 * quest lists).
 *
 * @returns JSON { date: string, quests: QuestDeckItem[] }
 */
export const GET = withAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { rows: planRows } = await db.query<{ plan: Plan | null }>(
      `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const plan: Plan = planRows[0]?.plan ?? "free";

    const quests = await generateDailyDeck(auth.user.sub, plan, db);
    const today = new Date().toISOString().slice(0, 10);

    const completedCount = quests.filter((q) => q.completed).length;
    return NextResponse.json(
      {
        date: today,
        quests,
        total: quests.length,
        completed: completedCount,
        bonus_unlocked: quests.length > 0 && completedCount === quests.length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

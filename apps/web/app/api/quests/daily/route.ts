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
}

interface QuestProgress {
  quest_id: string;
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

interface QuestDeckItem extends QuestTemplate {
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the quest deck size for a given user plan per PRD §7.
 * Free=3, Plus=4, Pro=5, Max=6
 */
function questDeckSizeForPlan(plan: string | null | undefined): number {
  switch (plan) {
    case "max":  return 6;
    case "pro":  return 5;
    case "plus": return 4;
    default:     return 3; // free tier
  }
}

/**
 * Get or create today's quest deck assignment for the user.
 * Deck size is gated by subscription plan per PRD §3/§7.
 *
 * @param userId - Authenticated user's UUID
 * @returns Array of quests with progress
 */
async function getDailyQuestDeck(userId: string): Promise<QuestDeckItem[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Resolve user's current subscription plan for deck-size gating
  const { rows: planRows } = await db.query<{ plan: string | null }>(
    `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const deckLimit = questDeckSizeForPlan(planRows[0]?.plan);

  // Fetch today's active quest templates, limited by plan tier
  const { rows: templates } = await db.query<QuestTemplate>(
    `SELECT id, title, description, action_type, target_count,
            xp_reward, coin_reward, category, icon
     FROM quest_templates
     WHERE is_active = true
       AND (valid_date IS NULL OR valid_date = $1)
     ORDER BY category, id
     LIMIT $2`,
    [today, deckLimit]
  );

  if (templates.length === 0) return [];

  const questIds = templates.map((t) => t.id);

  // Fetch this user's progress for today's quests
  const { rows: progresses } = await db.query<QuestProgress>(
    `SELECT quest_id, progress_count, completed, completed_at
     FROM user_quest_progress
     WHERE user_id = $1
       AND quest_date = $2
       AND quest_id = ANY($3::uuid[])`,
    [userId, today, questIds]
  );

  const progressMap = new Map<string, QuestProgress>(
    progresses.map((p) => [p.quest_id, p])
  );

  return templates.map((template) => {
    const progress = progressMap.get(template.id);
    return {
      ...template,
      progress_count: progress?.progress_count ?? 0,
      completed: progress?.completed ?? false,
      completed_at: progress?.completed_at ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /api/quests/daily
// ---------------------------------------------------------------------------

/**
 * Return today's quest deck for the authenticated user.
 *
 * @returns JSON { date: string, quests: QuestDeckItem[] }
 */
export const GET = withAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const quests = await getDailyQuestDeck(auth.user.sub);
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

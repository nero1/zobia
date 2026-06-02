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
 * Get or create today's quest deck assignment for the user.
 * The deck is assigned daily and is the same set for all users on a given day
 * (simplifies caching and fairness).
 *
 * @param userId - Authenticated user's UUID
 * @returns Array of quests with progress
 */
async function getDailyQuestDeck(userId: string): Promise<QuestDeckItem[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch today's active quest templates
  const { rows: templates } = await db.query<QuestTemplate>(
    `SELECT id, title, description, action_type, target_count,
            xp_reward, coin_reward, category, icon
     FROM quest_templates
     WHERE is_active = true
       AND (valid_date IS NULL OR valid_date = $1)
     ORDER BY category, id
     LIMIT 10`,
    [today]
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
export const GET = withAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const quests = await getDailyQuestDeck(auth.user.sub);
    const today = new Date().toISOString().slice(0, 10);

    return NextResponse.json(
      {
        date: today,
        quests,
        total: quests.length,
        completed: quests.filter((q) => q.completed).length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

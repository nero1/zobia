export const dynamic = 'force-dynamic';

/**
 * app/api/quests/new-member/route.ts
 *
 * New Member Quest endpoints.
 *
 * The New Member Quest is a 6-step guided mission awarded to every user on
 * onboarding completion. It guides users through core social features and
 * pays out 1,000 Coins + 2,000 XP when all 6 steps are done.
 *
 * Steps:
 *  1. send_message    — Send a message
 *  2. join_room       — Join a Room
 *  3. gift_someone    — Gift someone
 *  4. add_friend      — Add a friend
 *  5. friend_request  — Send 3 friend requests
 *  6. daily_login     — Complete a daily login
 *
 * GET  /api/quests/new-member
 *   Returns the user's New Member Quest progress.
 *   { step: 1-6, steps: [{id, label, completed}], allComplete: boolean }
 *
 * POST /api/quests/new-member/complete
 *   Called when all 6 steps are done.
 *   Awards 1,000 Coins + 2,000 XP atomically.
 *   Marks quest as complete (idempotent — returns 409 if already claimed).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, conflict, badRequest } from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEW_MEMBER_QUEST_COIN_REWARD = 1000;
const NEW_MEMBER_QUEST_XP_REWARD = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestStep {
  id: string;
  label: string;
  completed: boolean;
}

interface QuestProgress {
  steps: QuestStep[];
}

interface UserQuestRow {
  id: string;
  user_id: string;
  quest_type: string;
  progress: QuestProgress | string;
  completed: boolean;
  completed_at: string | null;
  reward_claimed: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the progress JSON from the database row.
 * Handles both already-parsed objects and raw JSON strings.
 */
function parseProgress(raw: QuestProgress | string): QuestProgress {
  if (typeof raw === "string") {
    return JSON.parse(raw) as QuestProgress;
  }
  return raw;
}

/**
 * Compute the current step number (1-based) and whether all steps are done.
 */
function computeQuestState(steps: QuestStep[]): {
  currentStep: number;
  allComplete: boolean;
} {
  const firstIncomplete = steps.findIndex((s) => !s.completed);
  const allComplete = firstIncomplete === -1;
  const currentStep = allComplete ? steps.length : firstIncomplete + 1;
  return { currentStep, allComplete };
}

// ---------------------------------------------------------------------------
// GET /api/quests/new-member
// ---------------------------------------------------------------------------

/**
 * Return the authenticated user's New Member Quest progress.
 *
 * If no quest record exists (e.g. user signed up before this feature was
 * deployed), a default progress object is returned without writing to DB.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<UserQuestRow>(
      `SELECT id, user_id, quest_type, progress, completed, completed_at,
              COALESCE(reward_claimed, completed) AS reward_claimed,
              created_at, updated_at
       FROM new_member_quests
       WHERE user_id = $1 AND quest_type = 'new_member'
       LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      // Quest record not found — return empty progress (user predates the feature)
      const defaultSteps: QuestStep[] = [
        { id: "send_message",   label: "Send a message",          completed: false },
        { id: "join_room",      label: "Join a Room",             completed: false },
        { id: "gift_someone",   label: "Gift someone",            completed: false },
        { id: "add_friend",     label: "Add a friend",            completed: false },
        { id: "friend_request", label: "Send 3 friend requests",  completed: false },
        { id: "daily_login",    label: "Complete a daily login",  completed: false },
      ];
      return NextResponse.json({
        success: true,
        data: {
          step: 1,
          steps: defaultSteps,
          allComplete: false,
          rewardClaimed: false,
        },
        error: null,
      });
    }

    const progress = parseProgress(rows[0].progress);
    const { currentStep, allComplete } = computeQuestState(progress.steps);

    return NextResponse.json({
      success: true,
      data: {
        step: currentStep,
        steps: progress.steps,
        allComplete,
        rewardClaimed: rows[0].reward_claimed ?? rows[0].completed,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/quests/new-member/complete
// ---------------------------------------------------------------------------

/**
 * Claim the New Member Quest reward.
 *
 * Verifies all 6 steps are complete, then atomically:
 *  - Credits 1,000 Coins
 *  - Awards 2,000 XP (via xp_ledger insert + users.xp_total update)
 *  - Marks the quest as complete and reward_claimed
 *
 * Idempotent — returns 409 if the reward has already been claimed.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    const result = await db.transaction(async (client) => {
      // 1. Lock the quest row
      const { rows } = await client.query<UserQuestRow>(
        `SELECT id, progress, completed, COALESCE(reward_claimed, completed) AS reward_claimed
         FROM new_member_quests
         WHERE user_id = $1 AND quest_type = 'new_member'
         FOR UPDATE`,
        [userId]
      );

      if (!rows[0]) {
        throw badRequest("New Member Quest not found for this user", "QUEST_NOT_FOUND");
      }

      const quest = rows[0];

      // 2. Idempotency — already claimed
      if (quest.reward_claimed) {
        throw conflict("New Member Quest reward has already been claimed", "REWARD_ALREADY_CLAIMED");
      }

      // 3. Verify all steps are complete
      const progress = parseProgress(quest.progress);
      const { allComplete } = computeQuestState(progress.steps);
      if (!allComplete) {
        throw badRequest("Not all quest steps are complete yet", "QUEST_INCOMPLETE");
      }

      // 4. Award XP — insert into xp_ledger and update users.xp_total
      await client.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, description, created_at)
         VALUES ($1, $2, 'main', 'new_member_quest', 'New Member Quest completion reward', NOW())`,
        [userId, NEW_MEMBER_QUEST_XP_REWARD]
      );

      await client.query(
        `UPDATE users
         SET xp_total = COALESCE(xp_total, 0) + $1, updated_at = NOW()
         WHERE id = $2`,
        [NEW_MEMBER_QUEST_XP_REWARD, userId]
      );

      // 5. Credit coins atomically (creditCoins handles SELECT FOR UPDATE internally)
      await creditCoins(
        userId,
        NEW_MEMBER_QUEST_COIN_REWARD,
        "quest_reward",
        `new_member_quest:${quest.id}`,
        "New Member Quest completion reward",
        { questId: quest.id, questType: "new_member" },
        client
      );

      // 6. Mark quest as complete and reward claimed
      await client.query(
        `UPDATE new_member_quests
         SET completed = TRUE, reward_claimed = TRUE, completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [quest.id]
      );

      return {
        coinsGranted: NEW_MEMBER_QUEST_COIN_REWARD,
        xpGranted: NEW_MEMBER_QUEST_XP_REWARD,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

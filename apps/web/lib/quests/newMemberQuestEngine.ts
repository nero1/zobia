/**
 * lib/quests/newMemberQuestEngine.ts
 *
 * Shared helper for advancing New Member Quest steps (PRD §4).
 *
 * The New Member Quest is a guided 6-step mission created for every user on
 * onboarding completion (see app/api/onboarding/complete/route.ts). Steps are
 * stored as a JSON array on `new_member_quests.progress.steps`. This helper
 * centralises the step-completion write so every action route (message send,
 * room join, gifting, friend accept, daily login) advances the quest the same
 * way, instead of re-implementing the JSONB update inline.
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { logger } from "@/lib/logger";

/** IDs of the boolean (non-counting) New Member Quest steps. */
export type NewMemberQuestStepId =
  | "send_message"
  | "join_room"
  | "gift_someone"
  | "add_friend"
  | "daily_login";

/**
 * Marks a boolean New Member Quest step complete for a user.
 *
 * No-op (does not throw) if:
 *  - the user has no new_member_quests row (predates the feature)
 *  - the quest is already fully completed
 *  - the step id doesn't exist in the user's step list
 *  - the step is already marked complete
 *
 * Safe to call fire-and-forget from any action route — errors are logged and
 * swallowed since quest progress must never block or fail the underlying
 * user action (sending a message, joining a room, etc).
 *
 * @param db     - Database adapter or an active transaction client
 * @param userId - UUID of the user performing the action
 * @param stepId - Which step to mark complete
 */
export async function advanceNewMemberQuestStep(
  db: DatabaseAdapter | TransactionClient,
  userId: string,
  stepId: NewMemberQuestStepId
): Promise<void> {
  try {
    await db.query(
      `UPDATE new_member_quests
       SET progress = jsonb_set(
             progress,
             '{steps}',
             (
               SELECT jsonb_agg(
                 CASE WHEN s->>'id' = $2 AND COALESCE((s->>'completed')::boolean, false) = false
                      THEN jsonb_set(s, '{completed}', 'true'::jsonb)
                      ELSE s END
               )
               FROM jsonb_array_elements(progress->'steps') s
             )
           ),
           updated_at = NOW()
       WHERE user_id = $1 AND quest_type = 'new_member' AND NOT completed`,
      [userId, stepId]
    );
  } catch (err) {
    logger.warn({ err, userId, stepId }, "[newMemberQuestEngine] Failed to advance step (non-fatal)");
  }
}

/**
 * The friend_request step is counter-based (target 3), unlike the other
 * boolean steps. Increments its `count` field and marks it complete once the
 * target is reached. Kept separate from advanceNewMemberQuestStep because its
 * JSONB shape differs (count + target rather than a plain boolean).
 *
 * @param db     - Database adapter or an active transaction client
 * @param userId - UUID of the user sending a friend request
 * @param target - Number of requests required to complete the step (default 3)
 */
export async function advanceNewMemberQuestFriendRequestStep(
  db: DatabaseAdapter | TransactionClient,
  userId: string,
  target: number = 3
): Promise<void> {
  try {
    await db.query(
      `UPDATE new_member_quests
       SET progress = jsonb_set(
         progress,
         '{steps}',
         (
           SELECT jsonb_agg(
             CASE WHEN s->>'id' = 'friend_request'
                  THEN jsonb_set(
                    jsonb_set(s, '{count}', to_jsonb(COALESCE((s->>'count')::int, 0) + 1)),
                    '{completed}',
                    to_jsonb(COALESCE((s->>'count')::int, 0) + 1 >= $2)
                  )
                  ELSE s END
           )
           FROM jsonb_array_elements(progress->'steps') s
         )
       ),
       updated_at = NOW()
       WHERE user_id = $1 AND quest_type = 'new_member' AND NOT completed`,
      [userId, target]
    );
  } catch (err) {
    logger.warn({ err, userId }, "[newMemberQuestEngine] Failed to advance friend_request step (non-fatal)");
  }
}

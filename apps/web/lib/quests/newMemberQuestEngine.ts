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

import { sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

/** IDs of the boolean (non-counting) New Member Quest steps. */
export type NewMemberQuestStepId =
  | "send_message"
  | "join_room"
  | "gift_someone"
  | "add_friend"
  | "daily_login";

/** Number of friend requests required to complete the friend_request step. */
export const FRIEND_REQUEST_TARGET = 3;

export interface NewMemberQuestStep {
  id: string;
  label: string;
  completed: boolean;
  count?: number;
  target?: number;
}

/**
 * Canonical step list. Single source of truth for onboarding, the GET
 * endpoint's fallback and the lazy-create path below. Clients localise the
 * label by id (home.newMemberQuest.steps.<id>) and fall back to this label.
 */
export const NEW_MEMBER_QUEST_STEPS: readonly NewMemberQuestStep[] = [
  { id: "send_message",   label: "Send a message",         completed: false },
  { id: "join_room",      label: "Join a Room",            completed: false },
  { id: "gift_someone",   label: "Gift someone",           completed: false },
  { id: "add_friend",     label: "Add a friend",           completed: false },
  { id: "friend_request", label: "Send 3 friend requests", completed: false, count: 0, target: FRIEND_REQUEST_TARGET },
  { id: "daily_login",    label: "Complete a daily login", completed: false },
];

/** Fresh progress object for a new quest row. */
export function buildNewMemberQuestProgress(): { steps: NewMemberQuestStep[] } {
  return { steps: NEW_MEMBER_QUEST_STEPS.map((s) => ({ ...s })) };
}

/**
 * Creates the user's New Member Quest row when it is missing (users who
 * onboarded before the feature, or whose onboarding insert failed) and
 * backfills each step from the activity they have already done, so progress
 * is never lost because the row did not exist yet. Idempotent: does nothing
 * when the row exists.
 *
 * @returns true when a row was created
 */
export async function ensureNewMemberQuest(db: DbOrTx, userId: string): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO new_member_quests (user_id, quest_type, progress)
    SELECT u.id, 'new_member', jsonb_build_object('steps', jsonb_build_array(
      jsonb_build_object('id', 'send_message', 'label', 'Send a message', 'completed',
        (EXISTS (SELECT 1 FROM room_messages rm WHERE rm.sender_id = u.id)
         OR EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id))),
      jsonb_build_object('id', 'join_room', 'label', 'Join a Room', 'completed',
        EXISTS (SELECT 1 FROM room_members r WHERE r.user_id = u.id)),
      jsonb_build_object('id', 'gift_someone', 'label', 'Gift someone', 'completed',
        EXISTS (SELECT 1 FROM gifts g WHERE g.sender_id = u.id)),
      jsonb_build_object('id', 'add_friend', 'label', 'Add a friend', 'completed',
        EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
                AND (f.requester_id = u.id OR f.addressee_id = u.id))),
      jsonb_build_object('id', 'friend_request', 'label', 'Send 3 friend requests',
        'completed', (SELECT COUNT(*) FROM friendships f WHERE f.requester_id = u.id) >= ${FRIEND_REQUEST_TARGET}::int,
        'count', LEAST((SELECT COUNT(*) FROM friendships f WHERE f.requester_id = u.id), ${FRIEND_REQUEST_TARGET}::int),
        'target', ${FRIEND_REQUEST_TARGET}::int),
      jsonb_build_object('id', 'daily_login', 'label', 'Complete a daily login', 'completed',
        EXISTS (SELECT 1 FROM user_daily_logins l WHERE l.user_id = u.id))
    ))
    FROM users u
    WHERE u.id = ${userId}
    ON CONFLICT (user_id, quest_type) DO NOTHING
  `);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Marks a boolean New Member Quest step complete for a user.
 *
 * Creates (and backfills) the quest row first when the user has none, so the
 * action is never silently dropped. No-op when the quest is already fully
 * completed, the step id does not exist, or the step is already complete.
 *
 * Callers MUST `await` this: on serverless a fire-and-forget promise can be
 * frozen when the response is sent, which silently lost progress. It never
 * throws, since quest progress must not fail the underlying user action.
 *
 * @param db     - Drizzle db instance or an active transaction handle
 * @param userId - UUID of the user performing the action
 * @param stepId - Which step to mark complete
 */
export async function advanceNewMemberQuestStep(
  db: DbOrTx,
  userId: string,
  stepId: NewMemberQuestStepId
): Promise<void> {
  const run = () => db.execute(sql`
    UPDATE ${schema.newMemberQuests}
    SET progress = jsonb_set(
          progress,
          '{steps}',
          (
            SELECT jsonb_agg(
              CASE WHEN s->>'id' = ${stepId} AND COALESCE((s->>'completed')::boolean, false) = false
                   THEN jsonb_set(s, '{completed}', 'true'::jsonb)
                   ELSE s END
              ORDER BY ord
            )
            FROM jsonb_array_elements(progress->'steps') WITH ORDINALITY AS t(s, ord)
          )
        ),
        updated_at = NOW()
    WHERE user_id = ${userId} AND quest_type = 'new_member' AND NOT completed
      AND jsonb_typeof(progress->'steps') = 'array'
  `);
  try {
    const res = await run();
    if ((res.rowCount ?? 0) === 0 && (await ensureNewMemberQuest(db, userId))) {
      await run();
    }
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
 * @param db     - Drizzle db instance or an active transaction handle
 * @param userId - UUID of the user sending a friend request
 * @param target - Number of requests required to complete the step
 */
export async function advanceNewMemberQuestFriendRequestStep(
  db: DbOrTx,
  userId: string,
  target: number = FRIEND_REQUEST_TARGET
): Promise<void> {
  const run = () => db.execute(sql`
    UPDATE ${schema.newMemberQuests}
    SET progress = jsonb_set(
      progress,
      '{steps}',
      (
        SELECT jsonb_agg(
          CASE WHEN s->>'id' = 'friend_request'
               THEN jsonb_set(
                 jsonb_set(s, '{count}', to_jsonb(LEAST(COALESCE((s->>'count')::int, 0) + 1, ${target}::int))),
                 '{completed}',
                 to_jsonb(COALESCE((s->>'count')::int, 0) + 1 >= ${target}::int)
               )
               ELSE s END
          ORDER BY ord
        )
        FROM jsonb_array_elements(progress->'steps') WITH ORDINALITY AS t(s, ord)
      )
    ),
    updated_at = NOW()
    WHERE user_id = ${userId} AND quest_type = 'new_member' AND NOT completed
      AND jsonb_typeof(progress->'steps') = 'array'
  `);
  try {
    // A freshly created row is backfilled from the friendships table, which
    // already contains the request that triggered this call, so only run the
    // increment when the row pre-existed.
    const res = await run();
    if ((res.rowCount ?? 0) === 0) await ensureNewMemberQuest(db, userId);
  } catch (err) {
    logger.warn({ err, userId }, "[newMemberQuestEngine] Failed to advance friend_request step (non-fatal)");
  }
}

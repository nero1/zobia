/**
 * lib/messaging/conversationScore.ts
 *
 * Conversation score tracker for DM pairs.
 *
 * The conversation score reflects how engaged two users are with each other.
 * It increases on every message sent and on every reaction received.
 * At certain thresholds the pair earns a "Connection" badge.
 *
 * Score data is stored in the `conversation_scores` database table and cached
 * in Redis for fast reads. Scores are keyed on an ordered pair of user IDs so
 * (A, B) and (B, A) resolve to the same record.
 */

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events that contribute to the conversation score. */
export type ConversationScoreEvent =
  | "message_sent"   // +2 points
  | "reaction_sent"  // +1 point
  | "reaction_recv"; // +1 point (awarded to the message sender)

/** Snapshot of a conversation score between two users. */
export interface ConversationScore {
  userId1: string;
  userId2: string;
  score: number;
  streakDays: number;
  /** Whether the pair has unlocked the Connection badge. */
  hasConnectionBadge: boolean;
  updatedAt: string;
  /** Sticker pack names newly unlocked by this update (only present after updateConversationScore). */
  newStickerUnlocks?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Score thresholds that unlock exclusive DM sticker reaction packs (PRD §5). */
export const STICKER_UNLOCK_THRESHOLDS = [
  { threshold: 100, packName: "Exclusive Reactions Pack 1" },
  { threshold: 250, packName: "Exclusive Reactions Pack 2" },
] as const;

/** Points awarded per event type. */
const EVENT_POINTS: Record<ConversationScoreEvent, number> = {
  message_sent: 2,
  reaction_sent: 1,
  reaction_recv: 1,
};

/** Redis cache TTL for conversation scores (5 minutes). */
const CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise two user IDs into a stable ordered pair so (A, B) and (B, A)
 * always resolve to the same key.
 */
function orderedPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2
    ? [userId1, userId2]
    : [userId2, userId1];
}

function cacheKey(u1: string, u2: string): string {
  const [a, b] = orderedPair(u1, u2);
  return `conv_score:${a}:${b}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connection Badge
// ---------------------------------------------------------------------------

/** Streak threshold (in days) required to unlock the Connection Badge. */
const CONNECTION_BADGE_STREAK_DAYS = 7;

/**
 * Checks whether the given streak day count meets the Connection Badge threshold.
 *
 * Returns true when streakDays >= 7, indicating the badge should be (or has been)
 * unlocked for this conversation pair.  Callers are responsible for persisting
 * the badge state; this function is purely a threshold check.
 *
 * @param _conversationId - The conversation identifier (reserved for future per-conversation logic)
 * @param streak          - The current streak in days for the conversation pair
 */
export function checkConnectionBadgeUnlock(
  _conversationId: string,
  streak: number
): boolean {
  return streak >= CONNECTION_BADGE_STREAK_DAYS;
}

// ---------------------------------------------------------------------------
// Score updates
// ---------------------------------------------------------------------------

/**
 * Update the conversation score for a user pair when a scoring event occurs.
 *
 * Upserts the `conversation_scores` row atomically and invalidates the Redis
 * cache so the next read fetches the fresh value.
 *
 * @param userId1 - One participant's UUID
 * @param userId2 - The other participant's UUID
 * @param event   - The scoring event that occurred
 * @returns Updated conversation score record
 */
export async function updateConversationScore(
  userId1: string,
  userId2: string,
  event: ConversationScoreEvent
): Promise<ConversationScore> {
  const [u1, u2] = orderedPair(userId1, userId2);
  const points = EVENT_POINTS[event];

  interface ScoreRow {
    user_id_1: string;
    user_id_2: string;
    score: number;
    streak_days: number;
    has_connection_badge: boolean;
    updated_at: string;
  }

  const { rows } = await db.query<ScoreRow>(
    `INSERT INTO conversation_scores
       (user_id_1, user_id_2, score, streak_days, has_connection_badge, updated_at)
     VALUES ($1, $2, $3, 1, $4, NOW())
     ON CONFLICT (user_id_1, user_id_2)
     DO UPDATE SET
       score = conversation_scores.score + EXCLUDED.score,
       streak_days = CASE
         WHEN conversation_scores.updated_at::date = NOW()::date THEN
           conversation_scores.streak_days
         WHEN conversation_scores.updated_at::date = (NOW() - INTERVAL '1 day')::date THEN
           conversation_scores.streak_days + 1
         ELSE 1
       END,
       has_connection_badge = CASE
         WHEN conversation_scores.has_connection_badge THEN TRUE
         WHEN CASE
               WHEN conversation_scores.updated_at::date = NOW()::date THEN
                 conversation_scores.streak_days
               WHEN conversation_scores.updated_at::date = (NOW() - INTERVAL '1 day')::date THEN
                 conversation_scores.streak_days + 1
               ELSE 1
             END >= $5 THEN TRUE
         ELSE FALSE
       END,
       badge_unlocked_at = CASE
         WHEN conversation_scores.has_connection_badge THEN conversation_scores.badge_unlocked_at
         WHEN CASE
               WHEN conversation_scores.updated_at::date = NOW()::date THEN
                 conversation_scores.streak_days
               WHEN conversation_scores.updated_at::date = (NOW() - INTERVAL '1 day')::date THEN
                 conversation_scores.streak_days + 1
               ELSE 1
             END >= $5 THEN NOW()
         ELSE NULL
       END,
       updated_at = NOW()
     RETURNING user_id_1, user_id_2, score, streak_days, has_connection_badge, updated_at`,
    [u1, u2, points, false, CONNECTION_BADGE_STREAK_DAYS]
  );

  const row = rows[0];
  if (!row) {
    throw new Error("[conversationScore] Upsert returned no rows");
  }

  const result: ConversationScore = {
    userId1: row.user_id_1,
    userId2: row.user_id_2,
    score: row.score,
    streakDays: row.streak_days,
    hasConnectionBadge: row.has_connection_badge,
    updatedAt: row.updated_at,
  };

  // Check for newly crossed sticker unlock thresholds
  const previousScore = result.score - points;
  const newStickerUnlocks: string[] = [];
  for (const su of STICKER_UNLOCK_THRESHOLDS) {
    if (previousScore < su.threshold && result.score >= su.threshold) {
      newStickerUnlocks.push(su.packName);
      // Persist the unlock and grant the sticker pack to both users (best-effort)
      try {
        await db.query(
          `INSERT INTO dm_score_sticker_unlocks
             (user_id_1, user_id_2, pack_name, unlocked_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT DO NOTHING`,
          [u1, u2, su.packName]
        );
        // Grant the sticker pack to both users in the pair
        await db.query(
          `INSERT INTO user_sticker_packs (user_id, pack_name, granted_at)
           VALUES ($1, $2, NOW()), ($3, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [u1, su.packName, u2]
        );
      } catch {
        // Non-fatal
      }
    }
  }
  if (newStickerUnlocks.length > 0) {
    result.newStickerUnlocks = newStickerUnlocks;
  }

  // Invalidate cache so next read is fresh
  try {
    await redis.del(cacheKey(u1, u2));
  } catch {
    // Non-fatal — cache invalidation is best-effort
  }

  return result;
}

/**
 * Retrieve the current conversation score for a user pair.
 *
 * Returns a zero-score record if no conversation has taken place yet.
 * Caches the result in Redis for {@link CACHE_TTL_SECONDS} seconds.
 *
 * @param userId1 - One participant's UUID
 * @param userId2 - The other participant's UUID
 * @returns Current conversation score record
 */
export async function getConversationScore(
  userId1: string,
  userId2: string
): Promise<ConversationScore> {
  const [u1, u2] = orderedPair(userId1, userId2);
  const key = cacheKey(u1, u2);

  // 1. Try Redis cache
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as ConversationScore;
    }
  } catch {
    // Cache miss — fall through to DB
  }

  // 2. Read from database
  interface ScoreRow {
    user_id_1: string;
    user_id_2: string;
    score: number;
    streak_days: number;
    has_connection_badge: boolean;
    updated_at: string;
  }

  const { rows } = await db.query<ScoreRow>(
    `SELECT user_id_1, user_id_2, score, streak_days, has_connection_badge, updated_at
     FROM conversation_scores
     WHERE user_id_1 = $1 AND user_id_2 = $2
     LIMIT 1`,
    [u1, u2]
  );

  const result: ConversationScore = rows[0]
    ? {
        userId1: rows[0].user_id_1,
        userId2: rows[0].user_id_2,
        score: rows[0].score,
        streakDays: rows[0].streak_days,
        hasConnectionBadge: rows[0].has_connection_badge,
        updatedAt: rows[0].updated_at,
      }
    : {
        userId1: u1,
        userId2: u2,
        score: 0,
        streakDays: 0,
        hasConnectionBadge: false,
        updatedAt: new Date().toISOString(),
      };

  // 3. Write to cache (best-effort)
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // Ignore cache write errors
  }

  return result;
}

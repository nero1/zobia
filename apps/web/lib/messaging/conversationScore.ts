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

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

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

  const orm = await getDb();
  const streakCase = sql`CASE
         WHEN ${schema.conversationScores.updatedAt}::date = NOW()::date THEN
           ${schema.conversationScores.streakDays}
         WHEN ${schema.conversationScores.updatedAt}::date = (NOW() - INTERVAL '1 day')::date THEN
           ${schema.conversationScores.streakDays} + 1
         ELSE 1
       END`;

  const rows = await orm
    .insert(schema.conversationScores)
    .values({ userId1: u1, userId2: u2, score: points, streakDays: 1, hasConnectionBadge: false })
    .onConflictDoUpdate({
      target: [schema.conversationScores.userId1, schema.conversationScores.userId2],
      set: {
        score: sql`${schema.conversationScores.score} + ${points}`,
        streakDays: streakCase,
        hasConnectionBadge: sql`CASE
         WHEN ${schema.conversationScores.hasConnectionBadge} THEN TRUE
         WHEN ${streakCase} >= ${CONNECTION_BADGE_STREAK_DAYS} THEN TRUE
         ELSE FALSE
       END`,
        badgeUnlockedAt: sql`CASE
         WHEN ${schema.conversationScores.hasConnectionBadge} THEN ${schema.conversationScores.badgeUnlockedAt}
         WHEN ${streakCase} >= ${CONNECTION_BADGE_STREAK_DAYS} THEN NOW()
         ELSE NULL
       END`,
        updatedAt: new Date(),
      },
    })
    .returning({
      userId1: schema.conversationScores.userId1,
      userId2: schema.conversationScores.userId2,
      score: schema.conversationScores.score,
      streakDays: schema.conversationScores.streakDays,
      hasConnectionBadge: schema.conversationScores.hasConnectionBadge,
      updatedAt: schema.conversationScores.updatedAt,
    });

  const row = rows[0];
  if (!row) {
    throw new Error("[conversationScore] Upsert returned no rows");
  }

  const result: ConversationScore = {
    userId1: row.userId1,
    userId2: row.userId2,
    score: row.score,
    streakDays: row.streakDays,
    hasConnectionBadge: row.hasConnectionBadge,
    updatedAt: row.updatedAt!.toISOString(),
  };

  // Check for newly crossed sticker unlock thresholds
  const previousScore = result.score - points;
  const newStickerUnlocks: string[] = [];
  for (const su of STICKER_UNLOCK_THRESHOLDS) {
    if (previousScore < su.threshold && result.score >= su.threshold) {
      // BUG-SK-01 fix: query the pack FIRST. Only consume the unlock threshold
      // (insert into dm_score_sticker_unlocks) if the pack exists in the DB.
      // If the pack is missing, log the misconfiguration and skip so the threshold
      // can fire again once the pack is seeded.
      try {
        const [pack] = await orm
          .select({ id: schema.stickerPacks.id })
          .from(schema.stickerPacks)
          .where(eq(schema.stickerPacks.name, su.packName))
          .limit(1);
        if (!pack) {
          logger.error(
            { packName: su.packName, u1, u2 },
            "[conversationScore] Sticker pack not found in DB — unlock threshold not consumed; will retry once pack is seeded"
          );
        } else {
          await orm
            .insert(schema.dmScoreStickerUnlocks)
            .values({ userId1: u1, userId2: u2, packName: su.packName })
            .onConflictDoNothing();
          await orm
            .insert(schema.userStickerPacks)
            .values([
              { userId: u1, packId: pack.id },
              { userId: u2, packId: pack.id },
            ])
            .onConflictDoNothing();
          newStickerUnlocks.push(su.packName);
        }
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
  const orm = await getDb();
  const [row] = await orm
    .select({
      userId1: schema.conversationScores.userId1,
      userId2: schema.conversationScores.userId2,
      score: schema.conversationScores.score,
      streakDays: schema.conversationScores.streakDays,
      hasConnectionBadge: schema.conversationScores.hasConnectionBadge,
      updatedAt: schema.conversationScores.updatedAt,
    })
    .from(schema.conversationScores)
    .where(and(eq(schema.conversationScores.userId1, u1), eq(schema.conversationScores.userId2, u2)))
    .limit(1);

  const result: ConversationScore = row
    ? {
        userId1: row.userId1,
        userId2: row.userId2,
        score: row.score,
        streakDays: row.streakDays,
        hasConnectionBadge: row.hasConnectionBadge,
        updatedAt: row.updatedAt!.toISOString(),
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

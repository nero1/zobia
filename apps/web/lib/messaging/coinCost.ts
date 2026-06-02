/**
 * lib/messaging/coinCost.ts
 *
 * DM coin cost calculator and daily limit checker.
 *
 * Coin costs (per PRD):
 *  - Free:  2 Coins to REPLY  — cannot initiate DMs
 *  - Plus:  1 Coin to REPLY   — cannot initiate DMs
 *  - Pro:   Free to reply, 1 Coin to initiate; 25 sent/day, 100 replies/day
 *  - Max:   Free all;          250 DMs/day, unlimited replies
 *
 * All costs are integers (no floating point). Zero means the action is free.
 * Coin arithmetic must always be done in whole numbers in the application layer;
 * the database stores integers in "coins" (not kobo) for DM purposes.
 */

import { redis } from "@/lib/redis";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Daily send/reply limits for a plan. */
export interface DailyDMLimits {
  /** Max DMs the user can initiate per day. null = no limit. */
  sentLimit: number | null;
  /** Max replies the user can send per day. null = no limit. */
  replyLimit: number | null;
}

/** Result of a daily limit check. */
export interface DailyLimitCheckResult {
  sentCount: number;
  replyCount: number;
  sentLimitReached: boolean;
  replyLimitReached: boolean;
}

// ---------------------------------------------------------------------------
// Coin cost table
// ---------------------------------------------------------------------------

/** Coin cost to INITIATE a new DM conversation (first message to a new recipient). */
const INITIATE_COST: Record<Plan, number> = {
  free: 0,  // not applicable — Free cannot initiate
  plus: 0,  // not applicable — Plus cannot initiate
  pro: 1,
  max: 0,
};

/** Coin cost to REPLY in an existing DM conversation. */
const REPLY_COST: Record<Plan, number> = {
  free: 2,
  plus: 1,
  pro: 0,
  max: 0,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the coin cost for a DM action.
 *
 * Returns the integer number of coins to deduct before the message is created.
 * Returns 0 when the action is free for the given plan.
 *
 * @param senderPlan  - The sender's subscription plan
 * @param isInitiating - True when starting a brand-new conversation
 * @returns Integer coin cost (≥ 0)
 */
export function getDMCost(senderPlan: Plan, isInitiating: boolean): number {
  if (isInitiating) {
    return INITIATE_COST[senderPlan] ?? 0;
  }
  return REPLY_COST[senderPlan] ?? 0;
}

/**
 * Check whether a plan is permitted to initiate DM conversations.
 *
 * Free and Plus users cannot send the first message; they may only reply
 * once the other party has messaged them first.
 *
 * @param plan - The user's subscription plan
 * @returns True if the plan can initiate DMs
 */
export function canInitiateDM(plan: Plan): boolean {
  return plan === "pro" || plan === "max";
}

/**
 * Return the daily sent/reply limits for a given plan.
 *
 * @param plan - The user's subscription plan
 * @returns Object with sentLimit and replyLimit (null means unlimited)
 */
export function getDailyDMLimits(plan: Plan): DailyDMLimits {
  switch (plan) {
    case "free":
      return { sentLimit: 0, replyLimit: null }; // cannot initiate; replies governed by coin cost
    case "plus":
      return { sentLimit: 0, replyLimit: null }; // cannot initiate
    case "pro":
      return { sentLimit: 25, replyLimit: 100 };
    case "max":
      return { sentLimit: 250, replyLimit: null };
  }
}

// ---------------------------------------------------------------------------
// Redis-backed daily counter
// ---------------------------------------------------------------------------

/** Redis key prefix for daily DM counters. */
const DM_COUNT_PREFIX = "dm:daily";

/** Returns the UTC date string "YYYY-MM-DD" for a given Date. */
function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Build the Redis key for a user's DM counter on a specific date. */
function buildCountKey(
  userId: string,
  type: "sent" | "reply",
  date: Date
): string {
  return `${DM_COUNT_PREFIX}:${type}:${userId}:${utcDateKey(date)}`;
}

/**
 * Increment the daily DM counter for a user and return the updated value.
 *
 * The counter automatically expires at midnight + 1 hour (90 000 s) to
 * clean up without race conditions at the day boundary.
 *
 * @param userId  - Authenticated user's UUID
 * @param type    - "sent" (initiated) or "reply"
 * @param date    - Reference date (pass new Date() in production)
 * @returns New counter value after increment
 */
export async function incrementDailyCount(
  userId: string,
  type: "sent" | "reply",
  date: Date = new Date()
): Promise<number> {
  const key = buildCountKey(userId, type, date);
  const newVal = await redis.incr(key);
  if (newVal === 1) {
    // First write today — set TTL to 25 hours so Redis cleans up automatically
    await redis.expire(key, 90_000);
  }
  return newVal;
}

/**
 * Check whether today's daily DM limits have been reached for a user.
 *
 * This is a READ-ONLY check — it does not modify counters.
 * Call {@link incrementDailyCount} after a successful send.
 *
 * @param userId - Authenticated user's UUID
 * @param plan   - The user's subscription plan
 * @param date   - Reference date (defaults to now)
 * @returns Object with current counts and boolean flags per limit type
 */
export async function checkDailyLimitReached(
  userId: string,
  plan: Plan,
  date: Date = new Date()
): Promise<DailyLimitCheckResult> {
  const limits = getDailyDMLimits(plan);

  const [rawSent, rawReply] = await Promise.all([
    redis.get(buildCountKey(userId, "sent", date)),
    redis.get(buildCountKey(userId, "reply", date)),
  ]);

  const sentCount = rawSent ? parseInt(rawSent, 10) : 0;
  const replyCount = rawReply ? parseInt(rawReply, 10) : 0;

  return {
    sentCount,
    replyCount,
    sentLimitReached:
      limits.sentLimit !== null && sentCount >= limits.sentLimit,
    replyLimitReached:
      limits.replyLimit !== null && replyCount >= limits.replyLimit,
  };
}

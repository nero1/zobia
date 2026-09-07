/**
 * lib/presence/generic.ts
 *
 * Generic Redis-backed live-presence primitive, extracted from the original
 * lib/presence/room.ts so Group Chats can reuse the exact same
 * admit/count/leave mechanics (and Lua script) under their own key prefix,
 * instead of re-deriving a second implementation. lib/presence/room.ts now
 * delegates to this module; its exported function signatures are unchanged
 * so no room call site needed to change.
 */

import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/** A presence entry is stale once it has not been refreshed for this long. */
export const PRESENCE_TTL_MS = 70_000; // ~1.5× a 45s client heartbeat
/** Redis key TTL — a little beyond the entry TTL so empty entities expire cleanly. */
const KEY_TTL_SECONDS = 120;

/**
 * Atomically prune stale entries, admit the user if allowed, and return the
 * resulting live count. Admission rule (soft cap): a user is admitted if
 * they are already present (re-heartbeat), OR they are privileged, OR the
 * live count is below `cap`. Otherwise the entity is full and they are not
 * added.
 *
 * @param key        - Fully-qualified Redis key for this entity's presence set.
 * @param logScope   - Log prefix for failures (e.g. "presence:room", "presence:group").
 */
export async function admitPresence(
  key: string,
  userId: string,
  cap: number,
  privileged: boolean,
  logScope: string,
): Promise<{ admitted: boolean; count: number }> {
  const now = Date.now();
  const cutoff = now - PRESENCE_TTL_MS;

  // KEYS[1] = sorted set; ARGV = now, cutoff, userId, ttlSeconds, cap, privileged
  const script = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
    local already = redis.call('ZSCORE', KEYS[1], ARGV[3])
    local count = redis.call('ZCARD', KEYS[1])
    local admitted = 0
    if already or ARGV[6] == '1' or count < tonumber(ARGV[5]) then
      redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
      redis.call('EXPIRE', KEYS[1], ARGV[4])
      admitted = 1
      if not already then count = count + 1 end
    end
    return {admitted, count}
  `;

  try {
    const res = (await redis.eval(
      script,
      1,
      key,
      now,
      cutoff,
      userId,
      KEY_TTL_SECONDS,
      cap,
      privileged ? "1" : "0",
    )) as [number, number];
    return { admitted: res[0] === 1, count: res[1] ?? 0 };
  } catch (err) {
    // Fail open: if Redis is unavailable, never lock users out.
    logger.error({ err: err }, `[${logScope}] admit failed (failing open)`);
    return { admitted: true, count: 0 };
  }
}

/**
 * Read the current live presence count, pruning stale entries first.
 * Read-only with respect to membership (does not add the caller).
 */
export async function getPresenceCount(key: string, logScope: string): Promise<number> {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const script = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    return redis.call('ZCARD', KEYS[1])
  `;
  try {
    const count = (await redis.eval(script, 1, key, cutoff)) as number;
    return typeof count === "number" ? count : 0;
  } catch (err) {
    logger.error({ err: err }, `[${logScope}] count failed`);
    return 0;
  }
}

/** Remove a user from an entity's live presence (explicit leave / navigate away). */
export async function leavePresence(key: string, userId: string, logScope: string): Promise<void> {
  try {
    await redis.zrem(key, userId);
  } catch (err) {
    logger.error({ err: err }, `[${logScope}] leave failed`);
  }
}

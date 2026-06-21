/**
 * lib/redis/helpers.ts
 *
 * Atomic Redis helpers using Lua scripts evaluated server-side.
 * Lua scripts execute atomically — no race windows between commands.
 */

import type { RedisClient } from "./index";

/**
 * PUSH-01 / AI-02: Atomically increment a counter and set its TTL on first creation.
 *
 * Equivalent to the unsafe two-step pattern:
 *   const count = await redis.incr(key);
 *   if (count === 1) await redis.expire(key, ttlSeconds); // ← race window here
 *
 * The Lua script eliminates the race: EXPIRE is set inside the same atomic operation.
 *
 * @param redis      - Active Redis client
 * @param key        - Counter key
 * @param ttlSeconds - TTL to apply when the key is first created (count === 1)
 * @returns New counter value after increment
 */
export async function atomicIncrWithTtl(
  redis: RedisClient,
  key: string,
  ttlSeconds: number
): Promise<number> {
  const result = await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
     return count`,
    1,
    key,
    String(ttlSeconds)
  );
  return result as number;
}

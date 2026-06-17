/**
 * lib/presence/room.ts
 *
 * Room-scoped live presence backed by Redis (zero realtime-provider cost).
 *
 * Each room has a Redis sorted set `room:presence:<roomId>` whose members are
 * userIds and whose scores are the last-heartbeat timestamp (ms). Clients send
 * a heartbeat every ~45s while actively viewing a room; an entry older than
 * PRESENCE_TTL_MS is considered gone (tab/app closed, network lost, idle), so
 * a slot frees up automatically with NO explicit "Leave" action.
 *
 * This is what soft participant caps are enforced against — "who is here right
 * now", not DB membership (which persists). Admission is atomic via a Lua
 * script so concurrent joiners can never both slip past a full room.
 */

import { redis } from "@/lib/redis";

/** A presence entry is stale once it has not been refreshed for this long. */
export const PRESENCE_TTL_MS = 70_000; // ~1.5× a 45s client heartbeat
/** Redis key TTL — a little beyond the entry TTL so empty rooms expire cleanly. */
const KEY_TTL_SECONDS = 120;

function roomPresenceKey(roomId: string): string {
  return `room:presence:${roomId}`;
}

/**
 * Atomically prune stale entries, admit the user if allowed, and return the
 * resulting live count.
 *
 * Admission rule (soft cap): a user is admitted if they are already present
 * (re-heartbeat), OR they are privileged (creator/mod/etc.), OR the live count
 * is below `cap`. Otherwise the room is full and they are not added.
 *
 * @returns `{ admitted, count }` — count reflects the set after any add.
 */
export async function admitRoomPresence(
  roomId: string,
  userId: string,
  cap: number,
  privileged: boolean,
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
      roomPresenceKey(roomId),
      now,
      cutoff,
      userId,
      KEY_TTL_SECONDS,
      cap,
      privileged ? "1" : "0",
    )) as [number, number];
    return { admitted: res[0] === 1, count: res[1] ?? 0 };
  } catch (err) {
    // Fail open: if Redis is unavailable, never lock users out of rooms.
    console.error("[presence:room] admit failed (failing open)", err);
    return { admitted: true, count: 0 };
  }
}

/**
 * Read the current live presence count for a room, pruning stale entries first.
 * Read-only with respect to membership (does not add the caller).
 */
export async function getRoomPresenceCount(roomId: string): Promise<number> {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const script = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
    return redis.call('ZCARD', KEYS[1])
  `;
  try {
    const count = (await redis.eval(script, 1, roomPresenceKey(roomId), cutoff)) as number;
    return typeof count === "number" ? count : 0;
  } catch (err) {
    console.error("[presence:room] count failed", err);
    return 0;
  }
}

/** Remove a user from a room's live presence (explicit leave / navigate away). */
export async function leaveRoomPresence(roomId: string, userId: string): Promise<void> {
  try {
    await redis.zrem(roomPresenceKey(roomId), userId);
  } catch (err) {
    console.error("[presence:room] leave failed", err);
  }
}

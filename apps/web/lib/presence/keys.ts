import { redis } from "@/lib/redis";

/** Builds the Redis key that signals a user is currently online. */
export function presenceRedisKey(userId: string): string {
  return `presence:online:${userId}`;
}

/**
 * Whether a user is currently online (has an active presence key).
 *
 * Used to skip push notifications for users who are actively in the app — they
 * already receive the message over realtime/poll, so a push would be redundant
 * noise (and an avoidable cost). Fails open to `false` (i.e. "send the push")
 * if Redis is unavailable, so we never silently drop notifications.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    const exists = await redis.exists(presenceRedisKey(userId));
    return exists > 0;
  } catch {
    return false;
  }
}

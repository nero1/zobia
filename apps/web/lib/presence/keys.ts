/** Builds the Redis key that signals a user is currently online. */
export function presenceRedisKey(userId: string): string {
  return `presence:online:${userId}`;
}

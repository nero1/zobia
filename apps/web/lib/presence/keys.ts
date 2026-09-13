/**
 * lib/presence/keys.ts
 *
 * Global "is this user currently online?" checks.
 *
 * ---------------------------------------------------------------------------
 * REDIS-COST-01 — this is now derived from Postgres, not Redis
 * ---------------------------------------------------------------------------
 * Sitewide presence used to be a `presence:online:<uid>` Redis key with a
 * 5-minute TTL, written on every heartbeat and read on every presence lookup
 * and every chat-push fan-out. That was pure duplication: the exact same
 * heartbeat already writes `users.last_active_at`, which is indexed
 * (`idx_users_last_active`) and carries strictly more information (it also
 * answers "recently active", which the Redis key could not).
 *
 * Deriving presence from `last_active_at` removes, per heartbeat, one Redis
 * write; per presence lookup, one Redis read; and per group-message push, one
 * Redis command PER RECIPIENT — replaced by a single indexed SQL predicate.
 *
 * It also fixes a latent correctness bug. The previous bulk check in
 * lib/notifications/chatPush.ts destructured pipeline results as ioredis
 * `[error, value]` tuples. On the Upstash provider `exec()` resolves to bare
 * values, so that destructure produced `undefined` for the count, every
 * recipient was treated as online, and group/DM pushes were silently dropped.
 * There is no pipeline here any more for that to go wrong in.
 *
 * NOTE: this is the SITEWIDE presence signal only. Live per-room and
 * per-group-chat presence (lib/presence/generic.ts) is a genuinely different
 * problem — a bounded, short-TTL membership set with capacity admission — and
 * legitimately stays in Redis.
 */

import { db } from "@/lib/db";

/**
 * How recently a user must have been seen to count as "online".
 * Matches the TTL the Redis presence key used to carry, so the observable
 * behaviour of every caller is unchanged.
 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Whether a user is currently online (seen within ONLINE_WINDOW_MS).
 *
 * Used to skip push notifications for users who are actively in the app — they
 * already receive the message over realtime/poll, so a push would be redundant
 * noise (and an avoidable cost). Fails open to `false` (i.e. "send the push")
 * if the lookup fails, so we never silently drop notifications.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const online = await getOnlineUserIds([userId]);
  return online.has(userId);
}

/**
 * Bulk variant: which of these users are currently online?
 *
 * One indexed query regardless of how many ids are passed — this is what the
 * group-message push fan-out uses, where the old implementation issued one
 * Redis command per recipient.
 *
 * Fails open to an EMPTY set (nobody online) so a database blip results in
 * pushes being sent rather than swallowed.
 *
 * @param userIds - Candidate user ids. An empty array short-circuits.
 */
export async function getOnlineUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users
       WHERE id = ANY($1)
         AND deleted_at IS NULL
         AND last_active_at IS NOT NULL
         AND last_active_at > NOW() - ($2 || ' milliseconds')::interval`,
      [userIds, String(ONLINE_WINDOW_MS)]
    );
    return new Set(rows.map((r) => r.id));
  } catch {
    // Fail open — treat everyone as offline so notifications still go out.
    return new Set();
  }
}

/**
 * lib/messaging/canonicalDmPair.ts
 *
 * BUG-020 FIX: canonical pair ordering for dm_conversations.
 *
 * The dm_conversations table enforces user_id_1 < user_id_2 via a CHECK
 * constraint (migration 0030) so there is exactly one row per pair. Before
 * this fix, some call sites used `(user_id_1=$A AND user_id_2=$B) OR
 * (user_id_1=$B AND user_id_2=$A)` which cannot use the (user_id_1,
 * user_id_2) unique index efficiently.
 *
 * Usage:
 *   const [uid1, uid2] = canonicalDmPair(senderId, recipientId);
 *   db.query(`... WHERE user_id_1 = $1 AND user_id_2 = $2`, [uid1, uid2]);
 */

/**
 * Returns the two user UUIDs in canonical (ascending) order so that
 * every lookup hits the unique index on (user_id_1, user_id_2) correctly.
 *
 * @param a - First user UUID
 * @param b - Second user UUID
 * @returns Tuple [smaller, larger] by string comparison (UUID lexicographic order)
 */
export function canonicalDmPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

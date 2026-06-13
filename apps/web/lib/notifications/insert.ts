/**
 * lib/notifications/insert.ts
 *
 * Shared helper for inserting rows into the `notifications` table.
 *
 * ZB-26: Centralises the INSERT so every caller sets the same required
 * columns — type, payload, is_read, and created_at — preventing silent
 * omissions that result in NULL or default-mismatched values.
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";

export type NotificationType =
  | "guild_discovery"
  | "guild_low_contribution"
  | "ad_revenue_enrolled"
  | "dm_sticker_unlock"
  | "season_reward"
  | "war_result"
  | "gift_received"
  | "referral_qualified"
  | "welcome"
  | string;

/**
 * Insert a single notification row.
 *
 * @param db      - Database adapter or transaction client
 * @param userId  - Recipient user UUID
 * @param type    - Notification type key (matches NotificationType)
 * @param payload - Arbitrary JSON payload surfaced to the client
 */
export async function insertNotification(
  db: DatabaseAdapter | TransactionClient,
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
     VALUES ($1, $2, $3, false, NOW())`,
    [userId, type, JSON.stringify(payload)]
  );
}

/**
 * Insert notifications for multiple users in one batch.
 * Each user gets an identical payload — clone and customise before calling
 * if per-user data differs.
 *
 * Uses a single bulk INSERT (chunked at 500 rows) instead of per-user queries
 * to reduce round-trips and improve throughput.
 */
export async function insertNotificationBatch(
  db: DatabaseAdapter | TransactionClient,
  userIds: string[],
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;
  const payloadJson = JSON.stringify(payload);

  // Chunk at 500 rows to avoid parameter count limits
  const CHUNK_SIZE = 500;
  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    const values = chunk
      .map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}, false, NOW())`)
      .join(", ");
    const params: string[] = [];
    for (const userId of chunk) {
      params.push(userId, type, payloadJson);
    }
    await db.query(
      `INSERT INTO notifications (user_id, type, payload, is_read, created_at) VALUES ${values}`,
      params
    );
  }
}

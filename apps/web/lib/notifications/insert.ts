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
 */
export async function insertNotificationBatch(
  db: DatabaseAdapter | TransactionClient,
  userIds: string[],
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;
  const payloadJson = JSON.stringify(payload);
  for (const userId of userIds) {
    await db.query(
      `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
       VALUES ($1, $2, $3, false, NOW())`,
      [userId, type, payloadJson]
    );
  }
}

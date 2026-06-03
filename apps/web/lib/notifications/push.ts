/**
 * lib/notifications/push.ts
 *
 * Expo Push Notification sender.
 * Sends push notifications via the Expo Push API.
 * Reads push tokens from user_push_tokens table.
 * Fire-and-forget for non-critical notifications.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^ExponentPushToken\[.+\]$/;
const EXPO_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushTokenRow {
  token: string;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default";
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoTicket[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the Authorization header for Expo requests.
 * Uses Bearer token if EXPO_ACCESS_TOKEN is set; otherwise no auth header.
 */
function buildExpoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const expoToken = process.env.EXPO_ACCESS_TOKEN;
  if (expoToken) {
    headers["Authorization"] = `Bearer ${expoToken}`;
  }
  return headers;
}

/**
 * Validate that a push token matches the Expo push token format.
 *
 * @param token - The token string to validate
 * @returns true if valid Expo push token format
 */
function isValidExpoToken(token: string): boolean {
  return EXPO_TOKEN_PATTERN.test(token);
}

/**
 * Send a batch of Expo push messages. Handles up to 100 per request.
 * Errors are logged but never thrown.
 *
 * @param messages - Array of Expo push message objects (max 100)
 */
async function sendExpoBatch(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: buildExpoHeaders(),
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      console.error(
        `[push] Expo API returned ${response.status}: ${text}`
      );
      return;
    }

    const result = (await response.json()) as ExpoPushResponse;

    // Log any per-message errors
    for (const ticket of result.data ?? []) {
      if (ticket.status === "error") {
        console.error(
          `[push] Expo ticket error: ${ticket.message ?? "unknown"} (${ticket.details?.error ?? "no code"})`
        );
      }
    }
  } catch (err) {
    console.error("[push] Failed to send Expo push batch:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a single user.
 *
 * Looks up the user's push token from user_push_tokens and sends the
 * notification via the Expo Push API. Fire-and-forget: errors are
 * logged but never thrown.
 *
 * @param userId - Target user UUID
 * @param title  - Notification title
 * @param body   - Notification body text
 * @param data   - Optional extra data payload
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const { rows } = await db.query<PushTokenRow>(
      `SELECT token FROM user_push_tokens WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    const token = rows[0]?.token;
    if (!token) return; // No push token registered — silently skip

    if (!isValidExpoToken(token)) {
      console.warn(`[push] Invalid Expo push token format for user ${userId}: ${token}`);
      return;
    }

    const message: ExpoMessage = {
      to: token,
      title,
      body,
      sound: "default",
      ...(data ? { data } : {}),
    };

    await sendExpoBatch([message]);
  } catch (err) {
    console.error(`[push] sendPushNotification failed for user ${userId}:`, err);
  }
}

/**
 * Send push notifications to multiple users in a single batched request.
 *
 * Looks up push tokens for all provided users, filters out invalid/missing
 * tokens, and sends up to 100 messages per Expo API request.
 * Errors are logged but never thrown.
 *
 * @param notifications - Array of notification payloads (userId, title, body, optional data)
 */
export async function sendPushNotificationBatch(
  notifications: Array<{
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }>
): Promise<void> {
  if (notifications.length === 0) return;

  try {
    const userIds = [...new Set(notifications.map((n) => n.userId))];

    // Fetch all tokens in one query
    const { rows } = await db.query<{ user_id: string; token: string }>(
      `SELECT user_id, token FROM user_push_tokens WHERE user_id = ANY($1)`,
      [userIds]
    );

    // Build a userId → token map (one token per user)
    const tokenMap = new Map<string, string>();
    for (const row of rows) {
      if (isValidExpoToken(row.token)) {
        tokenMap.set(row.user_id, row.token);
      }
    }

    // Build Expo messages for users that have valid tokens
    const messages: ExpoMessage[] = [];
    for (const notification of notifications) {
      const token = tokenMap.get(notification.userId);
      if (!token) continue;

      messages.push({
        to: token,
        title: notification.title,
        body: notification.body,
        sound: "default",
        ...(notification.data ? { data: notification.data } : {}),
      });
    }

    // Send in batches of EXPO_BATCH_SIZE (100)
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      await sendExpoBatch(batch);
    }
  } catch (err) {
    console.error("[push] sendPushNotificationBatch failed:", err);
  }
}

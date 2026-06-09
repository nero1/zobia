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

/**
 * Notification priority levels.
 *
 * - `high`   — time-sensitive alerts (e.g. direct messages, guild wars).
 *              Uses default sound, Expo priority "high".
 * - `normal` — standard social notifications (likes, comments, follows).
 *              Uses default sound, Expo priority "normal".
 * - `low`    — informational nudges (weekly recaps, non-critical reminders).
 *              Silent (no sound), Expo priority "normal", badge-only display.
 * - `silent` — background data updates or invisible analytics pings.
 *              No sound, Expo priority "normal", no visual interruption.
 */
export type NotificationPriority = "high" | "normal" | "low" | "silent";

/**
 * Options for sending a single push notification.
 */
export interface PushNotificationOptions {
  /** Deep-link action route or URL to open on tap. */
  action?: string;
  /** Arbitrary extra data passed through to the app's notification handler. */
  data?: Record<string, unknown>;
  /**
   * Notification priority — controls sound and Expo delivery priority.
   * Defaults to `"normal"`.
   */
  priority?: NotificationPriority;
  /**
   * App icon badge count to display after delivering the notification.
   * Pass 0 to clear the badge. Omit to leave badge unchanged.
   */
  badge?: number;
}

interface PushTokenRow {
  token: string;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** `"default"` plays the system default sound; `null` is silent. */
  sound: "default" | null;
  /** Expo delivery priority tier. */
  priority: "high" | "normal";
  badge?: number;
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
 * Resolve the Expo `sound` and `priority` fields from our internal
 * `NotificationPriority` enum.
 *
 * | Our priority | Expo sound    | Expo priority |
 * |--------------|---------------|---------------|
 * | high         | "default"     | "high"        |
 * | normal       | "default"     | "normal"      |
 * | low          | null (silent) | "normal"      |
 * | silent       | null (silent) | "normal"      |
 *
 * @param priority - Internal priority level (defaults to "normal")
 * @returns Expo-compatible sound and priority fields
 */
function resolveExpoPriority(priority: NotificationPriority = "normal"): {
  sound: "default" | null;
  priority: "high" | "normal";
} {
  if (priority === "high") {
    return { sound: "default", priority: "high" };
  }
  if (priority === "normal") {
    return { sound: "default", priority: "normal" };
  }
  // low and silent: no sound, normal delivery priority (badge-only display)
  return { sound: null, priority: "normal" };
}

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
 * Returns a list of tokens that Expo flagged as DeviceNotRegistered
 * so callers can clean them from the DB.
 *
 * @param messages        - Array of { message, token } pairs (max 100)
 * @returns Set of stale tokens that should be removed from user_push_tokens
 */
async function sendExpoBatch(
  messages: Array<{ msg: ExpoMessage; token: string }>
): Promise<Set<string>> {
  const staleTokens = new Set<string>();
  if (messages.length === 0) return staleTokens;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: buildExpoHeaders(),
      body: JSON.stringify(messages.map((m) => m.msg)),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      console.error(
        `[push] Expo API returned ${response.status}: ${text}`
      );
      return staleTokens;
    }

    const result = (await response.json()) as ExpoPushResponse;

    // Inspect per-message tickets; collect DeviceNotRegistered tokens for cleanup
    for (let i = 0; i < (result.data ?? []).length; i++) {
      const ticket = result.data[i];
      if (ticket.status === "error") {
        const errCode = ticket.details?.error ?? "";
        if (errCode === "DeviceNotRegistered") {
          // Mark this token for removal — app uninstalled or token expired
          staleTokens.add(messages[i].token);
        } else {
          console.error(
            `[push] Expo ticket error: ${ticket.message ?? "unknown"} (${errCode})`
          );
        }
      }
    }
  } catch (err) {
    console.error("[push] Failed to send Expo push batch:", err);
  }

  return staleTokens;
}

/**
 * Remove stale push tokens from the database.
 * Called after sendExpoBatch returns DeviceNotRegistered tokens.
 *
 * @param tokens - Set of Expo push token strings to delete
 */
async function purgeStaleTokens(tokens: Set<string>): Promise<void> {
  if (tokens.size === 0) return;
  const list = [...tokens];
  try {
    await db.query(
      `DELETE FROM user_push_tokens WHERE token = ANY($1)`,
      [list]
    );
    console.info(`[push] Purged ${list.length} stale push token(s).`);
  } catch (err) {
    console.error("[push] Failed to purge stale tokens:", err);
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
 * @param userId  - Target user UUID
 * @param title   - Notification title
 * @param body    - Notification body text
 * @param options - Optional delivery options (priority, data, badge, action)
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  options?: PushNotificationOptions
): Promise<void> {
  try {
    // Fetch ALL registered tokens for the user — supports multi-device
    const { rows } = await db.query<PushTokenRow>(
      `SELECT token FROM user_push_tokens WHERE user_id = $1`,
      [userId]
    );

    if (rows.length === 0) return; // No push tokens registered — silently skip

    const { sound, priority } = resolveExpoPriority(options?.priority);

    const messageData: Record<string, unknown> = { ...(options?.data ?? {}) };
    if (options?.action) {
      messageData.action = options.action;
    }

    const messages = rows
      .filter((r) => isValidExpoToken(r.token))
      .map((r) => ({
        token: r.token,
        msg: {
          to: r.token,
          title,
          body,
          sound,
          priority,
          ...(Object.keys(messageData).length > 0 ? { data: messageData } : {}),
          ...(options?.badge !== undefined ? { badge: options.badge } : {}),
        } as ExpoMessage,
      }));

    if (messages.length === 0) return;

    const stale = await sendExpoBatch(messages);
    await purgeStaleTokens(stale);
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
 * Each notification entry can specify its own priority and badge. When
 * priority is `low` or `silent`, the notification is delivered without
 * sound (badge-only display on device).
 *
 * @param notifications - Array of notification payloads per user
 */
export async function sendPushNotificationBatch(
  notifications: Array<{
    userId: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    priority?: NotificationPriority;
    badge?: number;
  }>
): Promise<void> {
  if (notifications.length === 0) return;

  try {
    const userIds = [...new Set(notifications.map((n) => n.userId))];

    // Fetch ALL tokens for all users in one query — supports multi-device
    const { rows } = await db.query<{ user_id: string; token: string }>(
      `SELECT user_id, token FROM user_push_tokens WHERE user_id = ANY($1)`,
      [userIds]
    );

    // Build a userId → token[] map (accumulate all tokens per user)
    const tokenMap = new Map<string, string[]>();
    for (const row of rows) {
      if (!isValidExpoToken(row.token)) continue;
      const existing = tokenMap.get(row.user_id) ?? [];
      existing.push(row.token);
      tokenMap.set(row.user_id, existing);
    }

    // Build one Expo message per (notification × device token) pair
    const messages: Array<{ msg: ExpoMessage; token: string }> = [];
    for (const notification of notifications) {
      const tokens = tokenMap.get(notification.userId) ?? [];
      for (const token of tokens) {
        const { sound, priority } = resolveExpoPriority(notification.priority);
        messages.push({
          token,
          msg: {
            to: token,
            title: notification.title,
            body: notification.body,
            sound,
            priority,
            ...(notification.data ? { data: notification.data } : {}),
            ...(notification.badge !== undefined ? { badge: notification.badge } : {}),
          },
        });
      }
    }

    // Send in batches of EXPO_BATCH_SIZE (100), collect and purge stale tokens
    const allStale = new Set<string>();
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const stale = await sendExpoBatch(batch);
      stale.forEach((t) => allStale.add(t));
    }
    await purgeStaleTokens(allStale);
  } catch (err) {
    console.error("[push] sendPushNotificationBatch failed:", err);
  }
}

/**
 * lib/notifications/push.ts
 *
 * Expo Push Notification sender — two-stage delivery with receipt polling.
 *
 * Stage 1: POST to /v2/push/send → receive push ticket IDs.
 *          Tickets are persisted in push_tickets for deferred receipt polling.
 * Stage 2: (PUSH-RECEIPT-01) poll /v2/push/getReceipts with ticket IDs
 *          (at least 15 minutes after stage 1) to confirm delivery or detect
 *          permanent failures (DeviceNotRegistered, MessageTooBig, etc.).
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_TOKEN_PATTERN = /^ExponentPushToken\[.+\]$/;
const EXPO_BATCH_SIZE = 100;
/** Minimum age for a pending ticket before we poll its receipt (Expo SLA). */
const RECEIPT_POLL_DELAY_MS = 15 * 60 * 1000; // 15 minutes

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

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface ExpoReceiptsResponse {
  data: Record<string, ExpoReceipt>;
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
 *
 * After a successful send, persists ticket IDs in push_tickets for stage 2
 * receipt polling. Returns the set of tokens that Expo flagged as
 * DeviceNotRegistered at stage 1 so callers can clean them from the DB.
 *
 * @param messages - Array of { msg, token, userId } tuples (max 100)
 * @returns Set of stale tokens that should be removed from user_push_tokens
 */
async function sendExpoBatch(
  messages: Array<{ msg: ExpoMessage; token: string; userId: string }>
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
      console.error(`[push] Expo API returned ${response.status}: ${text}`);
      // BUG-12: write system_alert so ops can detect silent notification loss
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('push_notification_batch_failed', 'warning', $1, $2::jsonb, NOW())`,
        [
          `Expo push batch failed with HTTP ${response.status}`,
          JSON.stringify({ status: response.status, recipientCount: messages.length }),
        ]
      ).catch(() => {});
      return staleTokens;
    }

    const result = (await response.json()) as ExpoPushResponse;

    // Collect ticket IDs to persist for stage 2 receipt polling
    const ticketsToSave: Array<{ userId: string; ticketId: string; token: string }> = [];

    for (let i = 0; i < (result.data ?? []).length; i++) {
      const ticket = result.data[i];
      if (ticket.status === "ok" && ticket.id) {
        // Stage 1 ok — save ticket ID and token for receipt polling
        ticketsToSave.push({ userId: messages[i].userId, ticketId: ticket.id, token: messages[i].token });
      } else if (ticket.status === "error") {
        const errCode = ticket.details?.error ?? "";
        if (errCode === "DeviceNotRegistered") {
          staleTokens.add(messages[i].token);
        } else {
          console.error(
            `[push] Expo ticket error: ${ticket.message ?? "unknown"} (${errCode})`
          );
        }
      }
    }

    // Persist tickets for stage 2 polling (best-effort, don't fail the send)
    if (ticketsToSave.length > 0) {
      const values = ticketsToSave
        .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`)
        .join(", ");
      const params = ticketsToSave.flatMap((t) => [t.userId, t.ticketId, t.token]);
      await db
        .query(
          `INSERT INTO push_tickets (user_id, ticket_id, token) VALUES ${values}
           ON CONFLICT (ticket_id) DO NOTHING`,
          params
        )
        .catch((err) =>
          console.error("[push] Failed to persist push tickets:", err)
        );
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
// Stage 2: Receipt polling (PUSH-RECEIPT-01)
// ---------------------------------------------------------------------------

/**
 * Poll Expo's /v2/push/getReceipts for all pending push tickets older than
 * RECEIPT_POLL_DELAY_MS (15 minutes).
 *
 * Designed to be called from the daily CRON job. Processes tickets in
 * batches of 100. On receipt error:
 * - DeviceNotRegistered → purge token, mark ticket resolved
 * - Other errors → mark ticket as error with the error code
 * - ok → mark ticket resolved
 *
 * @returns Count of tickets resolved in this run
 */
export async function pollPushReceipts(): Promise<number> {
  // Session-level advisory lock prevents concurrent CRON runs from double-processing
  // the same tickets. pg_try_advisory_lock returns immediately (non-blocking); if
  // another CRON instance is already running we simply skip this run.
  const { rows: lockRows } = await db.query<{ acquired: boolean }>(
    `SELECT pg_try_advisory_lock(1, hashtext('pollPushReceipts')) AS acquired`
  );
  if (!lockRows[0]?.acquired) {
    return 0;
  }

  let totalResolved = 0;

  try {
    // Fetch pending tickets old enough for Expo to have a receipt
    const { rows: pendingTickets } = await db.query<{
      id: string;
      user_id: string;
      ticket_id: string;
      token: string | null;
    }>(
      `SELECT id, user_id, ticket_id, token
       FROM push_tickets
       WHERE status = 'pending'
         AND created_at < NOW() - INTERVAL '15 minutes'
       ORDER BY created_at ASC
       LIMIT 1000`
    );

    if (pendingTickets.length === 0) return 0;

    // Poll in batches of 100 (Expo limit)
    for (let i = 0; i < pendingTickets.length; i += EXPO_BATCH_SIZE) {
      const batch = pendingTickets.slice(i, i + EXPO_BATCH_SIZE);
      const ticketIds = batch.map((r) => r.ticket_id);

      try {
        const response = await fetch(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers: buildExpoHeaders(),
          body: JSON.stringify({ ids: ticketIds }),
        });

        if (!response.ok) {
          console.error(
            `[push/receipts] Expo receipts API returned ${response.status}`
          );
          continue;
        }

        const result = (await response.json()) as ExpoReceiptsResponse;

        const staleTokens = new Set<string>();

        for (const ticket of batch) {
          const receipt = result.data?.[ticket.ticket_id];
          if (!receipt) continue;

          if (receipt.status === "ok") {
            // Mark checked_at and status in one update per ticket so a mid-batch
            // failure never strands a ticket with checked_at set but status still pending.
            await db.query(
              `UPDATE push_tickets
               SET status = 'ok', checked_at = NOW(), resolved_at = NOW()
               WHERE id = $1`,
              [ticket.id]
            );
            totalResolved++;
          } else if (receipt.status === "error") {
            const errCode = receipt.details?.error ?? "unknown";

            if (errCode === "DeviceNotRegistered") {
              // Purge only the specific token tied to this ticket, not all user tokens.
              if (ticket.token) {
                staleTokens.add(ticket.token);
              } else {
                // Legacy ticket without stored token — fall back to looking up by
                // the specific ticket_id correlation (cannot be done safely, skip).
                console.warn(`[push/receipts] Ticket ${ticket.ticket_id} has no stored token; cannot purge specific device.`);
              }

              await db.query(
                `UPDATE push_tickets
                 SET status = 'device_not_registered',
                     error_code = $2,
                     checked_at = NOW(),
                     resolved_at = NOW()
                 WHERE id = $1`,
                [ticket.id, errCode]
              );
            } else {
              await db.query(
                `UPDATE push_tickets
                 SET status = 'error',
                     error_code = $2,
                     checked_at = NOW(),
                     resolved_at = NOW()
                 WHERE id = $1`,
                [ticket.id, errCode]
              );
              console.error(
                `[push/receipts] Delivery error for ticket ${ticket.ticket_id}: ${receipt.message ?? "unknown"} (${errCode})`
              );
            }
            totalResolved++;
          }
        }

        if (staleTokens.size > 0) {
          await purgeStaleTokens(staleTokens);
        }
      } catch (batchErr) {
        console.error("[push/receipts] Failed to process receipt batch:", batchErr);
      }
    }
  } catch (err) {
    console.error("[push/receipts] pollPushReceipts failed:", err);
  } finally {
    await db.query(`SELECT pg_advisory_unlock(1, hashtext('pollPushReceipts'))`).catch(() => {});
  }

  return totalResolved;
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
 * Stage 1 ticket IDs are persisted to push_tickets for deferred receipt
 * polling (stage 2).
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
    // Fetch active tokens for the user (excluding stale/abandoned devices)
    const { rows } = await db.query<PushTokenRow>(
      `SELECT token FROM user_push_tokens
       WHERE user_id = $1
         AND (last_seen_at IS NULL OR last_seen_at > NOW() - INTERVAL '90 days')`,
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
        userId,
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
 * Stage 1 ticket IDs are persisted to push_tickets for deferred receipt
 * polling (stage 2).
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
    // Deduplicate notifications by userId so each user receives at most one push
    // per batch call, regardless of how many events triggered it (BUG-N-01).
    const seen = new Set<string>();
    const dedupedNotifications = notifications.filter((n) => {
      if (seen.has(n.userId)) return false;
      seen.add(n.userId);
      return true;
    });
    const userIds = dedupedNotifications.map((n) => n.userId);

    // Fetch active tokens for all users — excludes stale/abandoned devices
    const { rows } = await db.query<{ user_id: string; token: string }>(
      `SELECT user_id, token FROM user_push_tokens
       WHERE user_id = ANY($1)
         AND (last_seen_at IS NULL OR last_seen_at > NOW() - INTERVAL '90 days')`,
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
    const messages: Array<{ msg: ExpoMessage; token: string; userId: string }> = [];
    for (const notification of dedupedNotifications) {
      const tokens = tokenMap.get(notification.userId) ?? [];
      for (const token of tokens) {
        const { sound, priority } = resolveExpoPriority(notification.priority);
        messages.push({
          token,
          userId: notification.userId,
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

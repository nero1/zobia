/**
 * lib/notifications/push.ts
 *
 * Push notification sender — routes to two providers by token format:
 *   - Expo Push API (two-stage delivery with receipt polling) — historically
 *     used by the now-discontinued Expo app.
 *   - Firebase Cloud Messaging (lib/notifications/fcm.ts) — the Capacitor
 *     Android app's @capacitor/push-notifications plugin registers FCM
 *     tokens, not Expo tokens.
 *
 * Expo stage 1: POST to /v2/push/send → receive push ticket IDs.
 *          Tickets are persisted in push_tickets for deferred receipt polling.
 * Expo stage 2: (PUSH-RECEIPT-01) poll /v2/push/getReceipts with ticket IDs
 *          (at least 15 minutes after stage 1) to confirm delivery or detect
 *          permanent failures (DeviceNotRegistered, MessageTooBig, etc.).
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { atomicIncrWithTtl } from "@/lib/redis/helpers";
import { logger } from "@/lib/logger";
import { sendFcmBatch, type FcmMessage } from "@/lib/notifications/fcm";
import { sendWebPushBatch, type WebPushMessage } from "@/lib/notifications/webPush";
import { raiseAlert } from "@/lib/alerts/dispatch";

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
  device_id: string | null;
  last_seen_at: string | null;
  platform: string | null;
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
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(unreadable)");
      logger.error({ status: response.status, recipientCount: messages.length }, `[push] Expo API returned ${response.status}: ${text}`);
      // BUG-12: write system_alert so ops can detect silent notification loss
      const orm = await getDb();
      await raiseAlert(orm, {
        type: "push_notification_batch_failed",
        category: "infra",
        priorityLevel: 4,
        title: "Expo push batch failed",
        message: `Expo push batch failed with HTTP ${response.status}`,
        metadata: { status: response.status, recipientCount: messages.length },
        dedupeKey: "push_notification_batch_failed",
      }).catch(() => {});
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
          logger.error({ errCode, message: ticket.message }, `[push] Expo ticket error: ${ticket.message ?? "unknown"} (${errCode})`);
        }
      }
    }

    // Persist tickets for stage 2 polling (best-effort, don't fail the send)
    if (ticketsToSave.length > 0) {
      const orm = await getDb();
      await orm
        .insert(schema.pushTickets)
        .values(ticketsToSave.map((t) => ({ userId: t.userId, ticketId: t.ticketId, token: t.token })))
        .onConflictDoNothing({ target: schema.pushTickets.ticketId })
        .catch((err: unknown) => logger.error({ err }, "[push] Failed to persist push tickets"));
    }
  } catch (err) {
    logger.error({ err }, "[push] Failed to send Expo push batch");
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
    const orm = await getDb();
    await orm.delete(schema.userPushTokens).where(inArray(schema.userPushTokens.token, list));
    logger.info({ count: list.length }, "[push] Purged stale push tokens");
  } catch (err) {
    logger.error({ err }, "[push] Failed to purge stale tokens");
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
  // BUG-L09: The previous session-level advisory lock (pg_try_advisory_lock) is
  // tied to a DB connection, not a transaction. In connection-pooled environments
  // (PgBouncer, Neon) the pool can re-use the connection while the lock is held,
  // or the lock can outlast the function if it's killed before the finally block.
  // Replaced with a Redis SET NX EX mutex which is safe regardless of connection
  // pooling and has a hard TTL to prevent permanent lock-out on crash.
  const LOCK_KEY = "cron:lock:pollPushReceipts";
  const LOCK_TTL = 5 * 60; // 5 minutes max — longer than any expected run

  const acquired = await redis.set(LOCK_KEY, "1", "EX", LOCK_TTL, "NX").catch(() => null);
  if (acquired === null) {
    // Another CRON instance is running — skip this invocation
    return 0;
  }

  let totalResolved = 0;
  const orm = await getDb();

  try {
    // Fetch pending tickets old enough for Expo to have a receipt
    const pendingTickets = await orm
      .select({
        id: schema.pushTickets.id,
        userId: schema.pushTickets.userId,
        ticketId: schema.pushTickets.ticketId,
        token: schema.pushTickets.token,
      })
      .from(schema.pushTickets)
      .where(and(eq(schema.pushTickets.status, "pending"), sql`${schema.pushTickets.createdAt} < NOW() - INTERVAL '15 minutes'`))
      .orderBy(schema.pushTickets.createdAt)
      .limit(1000);

    if (pendingTickets.length === 0) {
      // Still run cleanup even when no tickets are pending (BUG-PUSH-01)
      await orm
        .delete(schema.pushTickets)
        .where(and(sql`${schema.pushTickets.resolvedAt} IS NOT NULL`, sql`${schema.pushTickets.resolvedAt} < NOW() - INTERVAL '30 days'`))
        .catch((err: unknown) => logger.error({ err }, "[push] Failed to purge resolved push_tickets"));
      return 0;
    }

    // Poll in batches of 100 (Expo limit)
    for (let i = 0; i < pendingTickets.length; i += EXPO_BATCH_SIZE) {
      const batch = pendingTickets.slice(i, i + EXPO_BATCH_SIZE);
      const ticketIds = batch.map((r) => r.ticketId);

      try {
        const response = await fetch(EXPO_RECEIPTS_URL, {
          method: "POST",
          headers: buildExpoHeaders(),
          body: JSON.stringify({ ids: ticketIds }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          logger.error({ status: response.status }, "[push/receipts] Expo receipts API returned non-200");
          continue;
        }

        const result = (await response.json()) as ExpoReceiptsResponse;

        // Collect IDs by outcome for batch DB updates (TASK-18)
        const okIds: string[] = [];
        const deviceNotRegisteredIds: string[] = [];
        const errorDetails: Array<{ id: string; errCode: string }> = [];
        const staleTokens = new Set<string>();

        for (const ticket of batch) {
          const receipt = result.data?.[ticket.ticketId];
          if (!receipt) continue;

          if (receipt.status === "ok") {
            okIds.push(ticket.id);
            totalResolved++;
          } else if (receipt.status === "error") {
            const errCode = receipt.details?.error ?? "unknown";

            if (errCode === "DeviceNotRegistered") {
              deviceNotRegisteredIds.push(ticket.id);
              if (ticket.token) {
                staleTokens.add(ticket.token);
              } else {
                logger.warn({ ticketId: ticket.ticketId }, "[push/receipts] Ticket has no stored token; cannot purge specific device");
              }
            } else {
              errorDetails.push({ id: ticket.id, errCode });
              logger.error({ ticketId: ticket.ticketId, errCode, message: receipt.message }, "[push/receipts] Delivery error for ticket");
            }
            totalResolved++;
          }
        }

        // Batch updates — one query per outcome group instead of one per ticket
        if (okIds.length > 0) {
          await orm
            .update(schema.pushTickets)
            .set({ status: "ok", checkedAt: new Date(), resolvedAt: new Date() })
            .where(inArray(schema.pushTickets.id, okIds));
        }
        if (deviceNotRegisteredIds.length > 0) {
          await orm
            .update(schema.pushTickets)
            .set({ status: "device_not_registered", errorCode: "DeviceNotRegistered", checkedAt: new Date(), resolvedAt: new Date() })
            .where(inArray(schema.pushTickets.id, deviceNotRegisteredIds));
        }
        if (errorDetails.length > 0) {
          // PUSH-02: store per-ticket error_code so ops can triage non-DeviceNotRegistered failures
          await orm.execute(sql`
            UPDATE push_tickets SET status = 'error', error_code = v.err_code,
                 checked_at = NOW(), resolved_at = NOW()
             FROM (SELECT unnest(${errorDetails.map((e) => e.id)}::uuid[]) AS id, unnest(${errorDetails.map((e) => e.errCode)}::text[]) AS err_code) v
             WHERE push_tickets.id = v.id
          `);
        }

        if (staleTokens.size > 0) {
          await purgeStaleTokens(staleTokens);
        }
      } catch (batchErr) {
        logger.error({ err: batchErr }, "[push/receipts] Failed to process receipt batch");
      }
    }
  } catch (err) {
    logger.error({ err }, "[push/receipts] pollPushReceipts failed");
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }

  // BUG-010 FIX: purge resolved push_tickets older than 30 days so the table
  // doesn't grow unbounded. Tickets are small rows but accumulate at the rate
  // of every notification sent; without a purge the table becomes a hot GC target.
  await orm
    .delete(schema.pushTickets)
    .where(and(sql`${schema.pushTickets.resolvedAt} IS NOT NULL`, sql`${schema.pushTickets.resolvedAt} < NOW() - INTERVAL '30 days'`))
    .catch((err: unknown) => logger.error({ err }, "[push] Failed to purge resolved push_tickets"));

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
/** Max push notifications per user per 60-second window before throttling. */
const MAX_PUSH_PER_USER_PER_MINUTE = 10;

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  options?: PushNotificationOptions
): Promise<void> {
  try {
    // TASK-14: per-user rate limit to prevent notification floods from pipeline bugs
    const rateKey = `user:push:rate:${userId}`;
    const count = await atomicIncrWithTtl(redis, rateKey, 60);
    if (count > MAX_PUSH_PER_USER_PER_MINUTE) {
      logger.warn({ userId, count }, "[push] Per-user push rate limit exceeded — skipping");
      return;
    }

    // Fetch active tokens for the user. ORDER BY last_seen_at DESC so that when
    // we deduplicate by device_id we keep the most recently seen token per device.
    const orm = await getDb();
    const rows = await orm
      .select({
        token: schema.userPushTokens.token,
        device_id: schema.userPushTokens.deviceId,
        last_seen_at: schema.userPushTokens.lastSeenAt,
        platform: schema.userPushTokens.platform,
      })
      .from(schema.userPushTokens)
      .where(
        and(
          eq(schema.userPushTokens.userId, userId),
          or(isNull(schema.userPushTokens.lastSeenAt), sql`${schema.userPushTokens.lastSeenAt} > NOW() - INTERVAL '90 days'`)
        )
      )
      .orderBy(sql`${schema.userPushTokens.lastSeenAt} DESC NULLS LAST`);

    if (rows.length === 0) return; // No push tokens registered — silently skip

    // Deduplicate by device_id: a user may have installed the app on the same
    // device twice (e.g. uninstall/reinstall) resulting in multiple tokens for
    // the same physical device. Keep only the most-recently-active one per
    // device to avoid duplicate deliveries.
    // BUG-PUSH-DEDUP-01: also deduplicate null-device_id rows by token value so a
    // user with N legacy rows without device_id doesn't receive N notifications.
    const seenDeviceIds = new Set<string>();
    const seenTokens = new Set<string>();
    const dedupedRows: PushTokenRow[] = rows.filter((r) => {
      if (!r.device_id) {
        if (seenTokens.has(r.token)) return false;
        seenTokens.add(r.token);
        return true;
      }
      if (seenDeviceIds.has(r.device_id)) return false;
      seenDeviceIds.add(r.device_id);
      return true;
    }) as unknown as PushTokenRow[];

    const { sound, priority } = resolveExpoPriority(options?.priority);

    const messageData: Record<string, unknown> = { ...(options?.data ?? {}) };
    if (options?.action) {
      messageData.action = options.action;
    }

    // ZSB-17: PWA (Web Push) rows are tagged `platform = 'web'` and store a
    // JSON-stringified PushSubscription in `token`, not an Expo/FCM token —
    // route those to Web Push before the Expo/FCM format-sniffing below.
    const webPushRows = dedupedRows.filter((r) => r.platform === "web");
    const remainingRows = dedupedRows.filter((r) => r.platform !== "web");
    const expoRows = remainingRows.filter((r) => isValidExpoToken(r.token));
    const fcmRows = remainingRows.filter((r) => !isValidExpoToken(r.token));

    const messages = expoRows.map((r) => ({
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

    const stale = new Set<string>();
    if (messages.length > 0) {
      (await sendExpoBatch(messages)).forEach((t) => stale.add(t));
    }
    // Android (Capacitor app) tokens are FCM registration tokens, not Expo
    // tokens — routed to Firebase Cloud Messaging instead (see lib/notifications/fcm.ts).
    if (fcmRows.length > 0) {
      const fcmSound: FcmMessage["sound"] = sound === "default" ? "default" : undefined;
      const fcmMessages = fcmRows.map((r) => ({
        token: r.token,
        title,
        body,
        data: Object.keys(messageData).length > 0 ? messageData : undefined,
        sound: fcmSound,
        priority,
        badge: options?.badge,
      }));
      (await sendFcmBatch(fcmMessages)).forEach((t) => stale.add(t));
    }
    // Installed-PWA (Web Push) tokens.
    if (webPushRows.length > 0) {
      const webPushMessages: WebPushMessage[] = webPushRows.map((r) => ({
        subscriptionJson: r.token,
        title,
        body,
        data: Object.keys(messageData).length > 0 ? messageData : undefined,
        badge: options?.badge,
      }));
      (await sendWebPushBatch(webPushMessages)).forEach((t) => stale.add(t));
    }

    await purgeStaleTokens(stale);
  } catch (err) {
    logger.error({ err, userId }, "[push] sendPushNotification failed");
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
    // BUG-025 FIX: apply the same per-user rate limit as sendPushNotification.
    // Without this check, callers using the batch path could send an unlimited
    // number of push notifications to the same user within 60 seconds, bypassing
    // the MAX_PUSH_PER_USER_PER_MINUTE guard that single-send enforces.
    const filteredNotifications = (await Promise.all(
      notifications.map(async (n) => {
        const rateKey = `user:push:rate:${n.userId}`;
        const count = await atomicIncrWithTtl(redis, rateKey, 60).catch(() => 0);
        if (count > MAX_PUSH_PER_USER_PER_MINUTE) {
          logger.warn({ userId: n.userId, count }, "[push] Per-user push rate limit exceeded in batch — skipping");
          return null;
        }
        return n;
      })
    )).filter((n): n is NonNullable<typeof n> => n !== null);

    if (filteredNotifications.length === 0) return;

    // Deduplicate notifications by userId so each user receives at most one push
    // per batch call, regardless of how many events triggered it (BUG-N-01).
    const seen = new Set<string>();
    const dedupedNotifications = filteredNotifications.filter((n) => {
      if (seen.has(n.userId)) return false;
      seen.add(n.userId);
      return true;
    });
    const userIds = dedupedNotifications.map((n) => n.userId);

    // Fetch active tokens for all users — excludes stale/abandoned devices.
    // ORDER BY last_seen_at DESC so deduplication by device_id keeps the most recent token.
    const orm = await getDb();
    const rows = await orm
      .select({
        user_id: schema.userPushTokens.userId,
        token: schema.userPushTokens.token,
        device_id: schema.userPushTokens.deviceId,
        platform: schema.userPushTokens.platform,
      })
      .from(schema.userPushTokens)
      .where(
        and(
          inArray(schema.userPushTokens.userId, userIds),
          or(isNull(schema.userPushTokens.lastSeenAt), sql`${schema.userPushTokens.lastSeenAt} > NOW() - INTERVAL '90 days'`)
        )
      )
      .orderBy(sql`${schema.userPushTokens.lastSeenAt} DESC NULLS LAST`);

    // Build a userId → token[] map with device_id deduplication (mirrors sendPushNotification).
    // A user who reinstalled without unregistering gets multiple tokens for the same physical
    // device; keep only the most-recently-seen token per device_id to avoid duplicate deliveries.
    // BUG-PUSH-DEDUP-01: also deduplicate null-device_id rows by token value per user.
    const tokenMap = new Map<string, Array<{ token: string; platform: string | null }>>();
    const seenDevicesByUser = new Map<string, Set<string>>();
    const seenTokensByUser = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.device_id) {
        const seenDevices = seenDevicesByUser.get(row.user_id) ?? new Set<string>();
        if (seenDevices.has(row.device_id)) continue;
        seenDevices.add(row.device_id);
        seenDevicesByUser.set(row.user_id, seenDevices);
      } else {
        const seenTokens = seenTokensByUser.get(row.user_id) ?? new Set<string>();
        if (seenTokens.has(row.token)) continue;
        seenTokens.add(row.token);
        seenTokensByUser.set(row.user_id, seenTokens);
      }
      const existing = tokenMap.get(row.user_id) ?? [];
      existing.push({ token: row.token, platform: row.platform });
      tokenMap.set(row.user_id, existing);
    }

    // Build one message per (notification × device token) pair, routed to
    // Expo, FCM (Capacitor Android), or Web Push (installed PWA) by
    // platform tag / token format.
    const expoMessages: Array<{ msg: ExpoMessage; token: string; userId: string }> = [];
    const fcmMessages: FcmMessage[] = [];
    const webPushMessages: WebPushMessage[] = [];
    for (const notification of dedupedNotifications) {
      const tokens = tokenMap.get(notification.userId) ?? [];
      const { sound, priority } = resolveExpoPriority(notification.priority);
      for (const { token, platform } of tokens) {
        if (platform === "web") {
          webPushMessages.push({
            subscriptionJson: token,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            badge: notification.badge,
          });
        } else if (isValidExpoToken(token)) {
          expoMessages.push({
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
        } else {
          fcmMessages.push({
            token,
            title: notification.title,
            body: notification.body,
            data: notification.data,
            sound: sound === "default" ? "default" : undefined,
            priority,
            badge: notification.badge,
          });
        }
      }
    }

    // Send in batches of EXPO_BATCH_SIZE (100), collect and purge stale tokens
    const allStale = new Set<string>();
    for (let i = 0; i < expoMessages.length; i += EXPO_BATCH_SIZE) {
      const batch = expoMessages.slice(i, i + EXPO_BATCH_SIZE);
      const stale = await sendExpoBatch(batch);
      stale.forEach((t) => allStale.add(t));
    }
    if (fcmMessages.length > 0) {
      (await sendFcmBatch(fcmMessages)).forEach((t) => allStale.add(t));
    }
    if (webPushMessages.length > 0) {
      (await sendWebPushBatch(webPushMessages)).forEach((t) => allStale.add(t));
    }
    await purgeStaleTokens(allStale);
  } catch (err) {
    logger.error({ err }, "[push] sendPushNotificationBatch failed");
  }
}

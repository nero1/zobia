/**
 * lib/notifications/webPush.ts
 *
 * Web Push (VAPID) sender — background push delivery for installed-PWA
 * users, closing the ZSB-17 parity gap: the Capacitor Android app registers
 * for FCM push (lib/notifications/fcm.ts) and gets background/killed-app
 * notifications; installed-PWA users previously got none at all, regardless
 * of what the backend sent, because app/sw.ts had no `push` event handler
 * and there was no subscription-registration flow.
 *
 * A Web Push subscription (endpoint + p256dh/auth keys) is stored as a
 * JSON-stringified string in the same `user_push_tokens.token` column Expo/
 * FCM tokens use, tagged with `platform = 'web'` — see
 * app/api/users/push-token/route.ts.
 */

import webpush from "web-push";
import { logger } from "@/lib/logger";

export interface WebPushMessage {
  /** JSON-stringified PushSubscription, as stored in user_push_tokens.token. */
  subscriptionJson: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
}

export type WebPushSendResult = "ok" | "unregistered" | "error";

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@zobia.org";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/**
 * Send a single Web Push message.
 *
 * Mirrors sendFcmMessage's "trusted no-op in development when unconfigured"
 * behaviour, and its unregistered/error/ok result shape so
 * lib/notifications/push.ts can fan out to all three providers uniformly.
 */
export async function sendWebPushMessage(msg: WebPushMessage): Promise<WebPushSendResult> {
  if (!ensureVapidConfigured()) {
    if (process.env.NODE_ENV === "production") {
      logger.warn("[webpush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured — skipping PWA push send");
      return "error";
    }
    logger.warn("[webpush] VAPID not configured — trusting send in dev mode (no actual push delivered)");
    return "ok";
  }

  let subscription: webpush.PushSubscription;
  try {
    subscription = JSON.parse(msg.subscriptionJson) as webpush.PushSubscription;
  } catch {
    // Malformed stored subscription — treat as unregistered so it gets purged.
    return "unregistered";
  }

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: msg.title,
        body: msg.body,
        data: msg.data ?? {},
        badge: msg.badge,
      })
    );
    return "ok";
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    // 404/410 = subscription expired or the browser unsubscribed — same
    // handling as Expo's DeviceNotRegistered / FCM's 404 so the caller purges it.
    if (statusCode === 404 || statusCode === 410) return "unregistered";
    logger.error({ err }, "[webpush] sendWebPushMessage failed");
    return "error";
  }
}

/**
 * Send a batch of Web Push messages with bounded concurrency.
 * Returns the subset of subscription JSON strings that came back
 * unregistered so the caller can purge them.
 */
export async function sendWebPushBatch(messages: WebPushMessage[]): Promise<Set<string>> {
  const stale = new Set<string>();
  const CONCURRENCY = 10;

  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const chunk = messages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((m) => sendWebPushMessage(m)));
    results.forEach((result, idx) => {
      if (result === "unregistered") stale.add(chunk[idx].subscriptionJson);
    });
  }

  return stale;
}

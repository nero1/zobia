/**
 * lib/notifications/fcm.ts
 *
 * Firebase Cloud Messaging (HTTP v1) sender — push delivery for the
 * Capacitor Android app (@capacitor/push-notifications registers an FCM
 * token, not an Expo token; see apps/android/src/lib/push/index.ts).
 * Used alongside the Expo sender in lib/notifications/push.ts, which routes
 * each registered token to the matching provider by token format.
 *
 * Requires FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON (Firebase service
 * account key with the "Firebase Cloud Messaging API" enabled — see
 * docs/SETUP.md "Push Notifications (Capacitor Android / FCM)"). Falls back
 * to a "trusted" no-op in development when unset, matching the Google Play
 * Billing verification helpers (lib/payments/googlePlayVerify.ts).
 */

import { logger } from "@/lib/logger";
import { getGoogleServiceAccountAccessToken, type GoogleServiceAccountJson } from "@/lib/google/serviceAccountAuth";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function loadServiceAccount(): GoogleServiceAccountJson | null {
  const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!saJson) return null;
  return JSON.parse(saJson) as GoogleServiceAccountJson;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Android notification sound — "default" or omitted for silent (low/silent priority). */
  sound?: "default";
  /** FCM/Android delivery priority — "high" wakes the device, "normal" is batched. */
  priority?: "high" | "normal";
  badge?: number;
}

export type FcmSendResult = "ok" | "unregistered" | "error";

/**
 * Send a single FCM message via the HTTP v1 API.
 *
 * Unlike the legacy FCM API, v1 has no true batch endpoint — one HTTP
 * request per message. Callers should fan these out with bounded
 * concurrency (see sendFcmBatch).
 */
export async function sendFcmMessage(msg: FcmMessage): Promise<FcmSendResult> {
  const projectId = process.env.FCM_PROJECT_ID;
  const sa = loadServiceAccount();

  if (!projectId || !sa) {
    if (process.env.NODE_ENV === "production") {
      logger.warn("[fcm] FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON not configured — skipping Android push send");
      return "error";
    }
    logger.warn("[fcm] FCM not configured — trusting send in dev mode (no actual push delivered)");
    return "ok";
  }

  try {
    const accessToken = await getGoogleServiceAccountAccessToken(sa, FCM_SCOPE);

    // FCM data payload values must all be strings.
    const stringData: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.data ?? {})) {
      stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let resp: Response;
    try {
      resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        signal: controller.signal,
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: msg.token,
            notification: { title: msg.title, body: msg.body },
            data: Object.keys(stringData).length > 0 ? stringData : undefined,
            android: {
              priority: msg.priority === "high" ? "high" : "normal",
              notification: {
                // Must match the channel apps/android/src/lib/push/index.ts
                // creates client-side via PushNotifications.createChannel() —
                // required on Android O+ or a background/killed-app
                // notification silently fails to display.
                channel_id: "default",
                sound: msg.sound === "default" ? "default" : undefined,
                notification_count: msg.badge,
              },
            },
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.ok) return "ok";

    // UNREGISTERED (404) / NOT_FOUND / INVALID_ARGUMENT with a bad-token
    // reason means the token is dead — same handling as Expo's
    // DeviceNotRegistered so the caller purges it from user_push_tokens.
    if (resp.status === 404) return "unregistered";

    const text = await resp.text().catch(() => "(unreadable)");
    logger.error({ status: resp.status }, `[fcm] Send failed: ${text}`);
    return "error";
  } catch (err) {
    logger.error({ err }, "[fcm] sendFcmMessage failed");
    return "error";
  }
}

/**
 * Send a batch of FCM messages with bounded concurrency (FCM v1 has no
 * native batch endpoint). Returns the subset of tokens that came back
 * UNREGISTERED so the caller can purge them.
 */
export async function sendFcmBatch(messages: FcmMessage[]): Promise<Set<string>> {
  const stale = new Set<string>();
  const CONCURRENCY = 10;

  for (let i = 0; i < messages.length; i += CONCURRENCY) {
    const chunk = messages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((m) => sendFcmMessage(m)));
    results.forEach((result, idx) => {
      if (result === "unregistered") stale.add(chunk[idx].token);
    });
  }

  return stale;
}

/**
 * lib/push/webPush.ts
 *
 * Client-side Web Push (VAPID) subscription flow for the installed PWA —
 * mirrors apps/android/src/lib/push/index.ts's permission-check pattern
 * (check current permission, request only if "prompt", register with the
 * platform, never block the rest of the app on failure).
 *
 * Companion to app/sw.ts's `push`/`notificationclick` handlers (receiving
 * side) and lib/notifications/webPush.ts (server sender).
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** True if this browser/context can support a Web Push subscription at all. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Subscribe this browser to Web Push and register the subscription with the
 * server. Safe to call repeatedly — re-subscribing with an already-active
 * subscription is a cheap no-op per the Push API spec.
 *
 * Requests Notification permission if not already decided. Returns `false`
 * (without throwing) on any failure — push is an enhancement, never a
 * blocker — mirroring the Capacitor app's non-fatal push init.
 */
export async function subscribeToWebPush(): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.warn("[webpush] NEXT_PUBLIC_VAPID_PUBLIC_KEY not configured — skipping subscribe");
    return false;
  }

  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return false;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's lib.dom PushSubscriptionOptionsInit types applicationServerKey
        // as BufferSource<ArrayBuffer>, but Uint8Array's `buffer` is typed
        // ArrayBufferLike (could be a SharedArrayBuffer) — a real Uint8Array
        // from `new Uint8Array(n)` always backs onto a plain ArrayBuffer, so
        // this cast is safe.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      }));

    await fetch("/api/users/push-token", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: JSON.stringify(subscription.toJSON()),
        platform: "web",
      }),
    });

    return true;
  } catch (err) {
    console.error("[webpush] subscribeToWebPush failed:", err);
    return false;
  }
}

/** Unsubscribe this browser from Web Push and remove the server-side registration (logout). */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const token = JSON.stringify(subscription.toJSON());
    await subscription.unsubscribe().catch(() => {});
    await fetch("/api/users/push-token", {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  } catch (err) {
    console.error("[webpush] unsubscribeFromWebPush failed:", err);
  }
}

/** Current, already-decided permission state — does not prompt. */
export function getWebPushPermission(): NotificationPermission | "unsupported" {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission;
}

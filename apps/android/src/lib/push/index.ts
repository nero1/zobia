/**
 * apps/android/src/lib/push/index.ts
 *
 * Push notification registration + handling for the Capacitor Android app.
 * Uses @capacitor/push-notifications (Firebase Cloud Messaging on Android)
 * — a different token type from the discontinued Expo app's Expo push
 * tokens, so the server (lib/notifications/fcm.ts, lib/notifications/push.ts)
 * routes each registered token to the right provider by format. Same
 * POST /api/users/push-token endpoint and { token, platform, deviceId } body
 * shape as apps/expo/app/_layout.tsx's registerForPushNotifications().
 *
 * Adapted for TanStack Router (no navigation ref needed — the router
 * instance is created once at module scope in main.tsx) and
 * @capacitor/preferences (device ID persistence) instead of SecureStore.
 */

import { PushNotifications, type ActionPerformed, type PushNotificationSchema, type Token } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import type { AnyRouter } from '@tanstack/react-router';
import { apiClient } from '@/lib/api/client';

const DEVICE_ID_KEY = 'zobia_device_id';
const DEFAULT_CHANNEL_ID = 'default';

/**
 * Allowlist of in-app routes a push notification's `data.action` may
 * navigate to — mirrors apps/expo/app/_layout.tsx's VALID_PUSH_ROUTES,
 * scoped to routes that actually exist in this app's routeTree.gen.ts
 * (narrower than Expo's list since not every web/PWA page has an Android
 * screen yet). Prevents a compromised/crafted push payload from routing
 * into an arbitrary path.
 */
const VALID_PUSH_ROUTES: RegExp[] = [
  /^\/rooms\/[a-f0-9-]+$/i,
  /^\/messages\/[a-f0-9-]+$/i,
  /^\/profile\/[^/]+$/i,
  /^\/games\/[a-z0-9-]+$/i,
  /^\/answers\/[a-f0-9-]+$/i,
  /^\/blogs\/[^/]+\/[^/]+$/i,
  /^\/business$/i,
  /^\/business\/ads$/i,
  /^\/notifications$/i,
  /^\/wallet$/i,
];

function isAllowedRoute(path: string): boolean {
  return VALID_PUSH_ROUTES.some((re) => re.test(path));
}

/** Returns a stable per-installation UUID, generating one on first call. */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: DEVICE_ID_KEY });
    if (value) return value;
    const id = crypto.randomUUID();
    await Preferences.set({ key: DEVICE_ID_KEY, value: id });
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

async function registerToken(token: string): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    await apiClient.post('/users/push-token', { token, platform: 'android', deviceId });
  } catch (err) {
    console.error('[push] Failed to register push token:', err);
  }
}

function extractAction(notification: PushNotificationSchema): string | undefined {
  const data = notification.data as Record<string, unknown> | undefined;
  const action = data?.action ?? notification.link ?? notification.click_action;
  return typeof action === 'string' ? action : undefined;
}

let initialized = false;

/**
 * Register for push notifications and wire up listeners. Call once, after
 * the user's identity is established (matches Expo's convention — the push
 * token is tied to a specific user via the auth'd apiClient request).
 *
 * Non-fatal on any failure: notifications are an enhancement, never a
 * blocker for using the app.
 */
export async function initPushNotifications(router: AnyRouter): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    await PushNotifications.createChannel({
      id: DEFAULT_CHANNEL_ID,
      name: 'General',
      description: 'Messages, room activity, and other Zobia notifications',
      importance: 4,
      visibility: 1,
      vibration: true,
    });

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') return;

    await PushNotifications.addListener('registration', (token: Token) => {
      void registerToken(token.value);
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] Registration error:', err.error);
    });

    // Foreground notifications don't show a system banner on Android (unlike
    // iOS) — the notification center list (GET /api/notifications, polled by
    // apps/android/src/routes/notifications.tsx) is the in-app source of
    // truth, so no extra handling is needed here beyond logging.
    await PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.debug('[push] Foreground notification:', notification.title);
    });

    // Tapping a notification (app backgrounded or killed) — navigate to the
    // deep-linked screen if the payload carries an allowlisted action.
    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const route = extractAction(action.notification);
      if (!route) return;
      if (!isAllowedRoute(route)) {
        console.warn('[push] Blocked notification action not in allowlist:', route);
        return;
      }
      router.navigate({ to: route as never });
    });

    await PushNotifications.register();
  } catch (err) {
    console.error('[push] initPushNotifications failed:', err);
  }
}

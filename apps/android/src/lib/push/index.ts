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
import { App } from '@capacitor/app';
import type { AnyRouter } from '@tanstack/react-router';
import { apiClient } from '@/lib/api/client';
import { isAllowedRoute, ACTION_ALIASES } from '@/lib/notifications/routing';

const DEVICE_ID_KEY = 'zobia_device_id';
const DEFAULT_CHANNEL_ID = 'default';

// ZSB-16 fix: the allowlist (VALID_PUSH_ROUTES) and ACTION_ALIASES used to
// live only here — moved to lib/notifications/routing.ts so the in-app
// notifications list (routes/notifications.tsx) can reuse the exact same
// allowlist for tap-to-navigate instead of a second, divergent one.
// Re-exported for backwards compatibility with lib/push/__tests__/index.test.ts.
export { isAllowedRoute };

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

// Last token this device registered with the server — cached so logout can
// unregister it (ZSB-05) without needing another native `PushNotifications`
// round-trip just to find out what it was.
let lastRegisteredToken: string | null = null;

async function registerToken(token: string): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    await apiClient.post('/users/push-token', { token, platform: 'android', deviceId });
    lastRegisteredToken = token;
  } catch (err) {
    console.error('[push] Failed to register push token:', err);
  }
}

function extractAction(notification: PushNotificationSchema): string | undefined {
  const data = notification.data as Record<string, unknown> | undefined;
  const action = data?.action ?? notification.link ?? notification.click_action;
  return typeof action === 'string' ? action : undefined;
}

// BUG-CAP-08 fix: `initialized` now only latches once registration has
// actually been requested (permission granted + listeners wired), not the
// moment the function is first called. Previously it was set at the very
// top of initPushNotifications(), so a user who denied permission and later
// granted it from Android system Settings — without force-closing the app —
// could never get push registered again for the rest of that app session,
// since every subsequent call was a silent no-op against the stale flag.
let initialized = false;
let foregroundRetryAttached = false;

/**
 * Best-effort server-side unregister of the last token this device
 * registered, then reset the module's init latch so the *next* login (which
 * may be a different account on the same device) re-runs
 * `PushNotifications.register()` instead of silently no-op'ing against the
 * stale `initialized` flag (ZSB-05). Call from `clearAuth()` on logout.
 *
 * Swallows all errors — push cleanup must never block sign-out.
 */
export async function unregisterPushOnLogout(): Promise<void> {
  const token = lastRegisteredToken;
  lastRegisteredToken = null;
  initialized = false;
  if (!token) return;
  try {
    await apiClient.delete('/users/push-token', { data: { token } });
  } catch (err) {
    console.error('[push] Failed to unregister push token on logout:', err);
  }
}

/**
 * Register for push notifications and wire up listeners. Safe to call
 * multiple times — it only does real work once permission is granted, and
 * re-checks are cheap no-ops otherwise (see `attemptInit` below).
 *
 * Non-fatal on any failure: notifications are an enhancement, never a
 * blocker for using the app.
 */
export async function initPushNotifications(router: AnyRouter): Promise<void> {
  await attemptInit(router);

  // Re-check on every foreground resume while permission hasn't been granted
  // yet, so a grant made from system Settings (a very common flow that does
  // not force-close the app) is picked up without requiring a cold restart.
  // Registered once per process — @capacitor/app already backs the same
  // 'appStateChange' event consumed by lib/api/client.ts's focusManager.
  if (!foregroundRetryAttached) {
    foregroundRetryAttached = true;
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !initialized) void attemptInit(router);
    }).catch((err) => console.error('[push] appStateChange listener failed:', err));
  }
}

// ZSB-05 follow-up fix: `initialized` is intentionally reset by
// `unregisterPushOnLogout()` so the *next* login re-runs `register()` for
// whichever account is now signed in. But `PushNotifications.addListener()`
// stacks handlers rather than replacing them — re-running the four
// `addListener()` calls below on every login/logout cycle within the same
// app process would accumulate duplicate listeners (each subsequent push
// event firing `registerToken()`/navigation once per accumulated listener).
// `listenersAttached` is a separate, never-reset latch so the listeners are
// wired exactly once per process, while `initialized`/`register()` can still
// re-run per login.
let listenersAttached = false;

async function attemptInit(router: AnyRouter): Promise<void> {
  if (initialized) return;

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

    // Permission is granted from here on — latch now so a concurrent/later
    // call (or the foreground-retry listener above) doesn't double-register.
    initialized = true;

    if (!listenersAttached) {
      listenersAttached = true;

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
      // deep-linked screen if the payload carries an allowlisted action. The
      // `router` singleton is created once at module scope in main.tsx, so
      // capturing it here forever (rather than per attemptInit() call) is safe.
      await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
        const rawAction = extractAction(action.notification);
        if (!rawAction) return;
        const route = ACTION_ALIASES[rawAction] ?? rawAction;
        if (!isAllowedRoute(route)) {
          console.warn('[push] Blocked notification action not in allowlist:', route);
          return;
        }
        router.navigate({ to: route as never });
      });
    }

    await PushNotifications.register();
  } catch (err) {
    console.error('[push] initPushNotifications failed:', err);
  }
}

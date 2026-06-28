// MUST be first: installs the global `crypto` polyfill (Hermes ships none) before
// any module that derives an encryption key at startup runs. Without this the
// MMKV store init throws and the app hangs on a white screen after the splash.
import '@/lib/polyfills';

// React MUST be imported before NativeWind (global.css) and expo-router.
// In Hermes/CommonJS, import statements compile to require() calls in source
// order. NativeWind's Metro transform and expo-router both access React
// internals (e.g. useMemo) during their own module evaluation. If React's
// require() hasn't run yet when they execute, the module cache returns null
// for 'react' and the startup crash is:
//   TypeError: Cannot read property 'useMemo' of null
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Dimensions, Linking, Platform, View } from 'react-native';

import '../global.css';

export { ErrorBoundary } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

import { AuthProvider } from '@/lib/auth/context';
import { RootErrorBoundary } from '@/components/RootErrorBoundary';
import { DebugOverlay } from '@/components/DebugOverlay';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { FloatingNotificationProvider } from '@/components/providers/FloatingNotificationProvider';
import { queryClient, apiClient } from '@/lib/api/client';
import { AnnouncementModal } from '@/components/announcements/AnnouncementModal';
import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal';
import { useAuth } from '@/lib/auth/hooks';
import { initOfflineDB } from '@/lib/offline/sqlite';
import { syncPendingMessages, resetSendingMessages } from '@/lib/offline/syncQueue';
import { initStore } from '@/lib/offline/store';
import { applyStoredLanguagePref } from '@/lib/i18n';
import { initializeAds } from '@/lib/ads/admob';
import { initGooglePlayBilling, endBillingConnection } from '@/lib/payments/googlePlay';
import { useReferralCaptureFromLink } from '@/lib/deeplinks/referral';

// BUG-CRIT-02: Prevent the native splash from auto-hiding so we can control
// it ourselves — hide only after auth state is resolved and MMKV is ready.
// Guard the module-scope call: a synchronous throw here (native module not
// ready) would abort bundle evaluation and strand the app on a white screen
// before React mounts. preventAutoHideAsync returns a promise, so also swallow
// any rejection.
try {
  void SplashScreen.preventAutoHideAsync().catch(() => {});
} catch {
  /* splash module not ready — the native splash will auto-hide on its own */
}

// BUG-WHITESCREEN (no chip, no alert) ROOT CAUSE FIX
// ---------------------------------------------------------------------------
// SafeAreaProvider (react-native-safe-area-context 4.10.x) renders NOTHING —
// literally `{insets != null ? children : null}` — until the NATIVE side
// delivers the first inset measurement via its async `onInsetsChange` callback.
// On some Android configurations (notably edge-to-edge enforcement when
// targeting SDK 35, which this app does via expo-build-properties) that callback
// can be delayed indefinitely or never fire, so the provider stays on `null`
// and the app is stuck on a blank white screen forever.
//
// Because SafeAreaProvider is the OUTERMOST wrapper, this also swallows the
// <DebugOverlay /> chip and the RootErrorBoundary — both are its children — so
// the failure is completely invisible: white screen, no chip, no red box, and
// no native alert (nothing actually throws; the tree just never renders).
//
// Passing `initialMetrics` makes `insets` non-null on the very FIRST render, so
// children always render immediately; the real insets still update later when
// `onInsetsChange` fires. `initialWindowMetrics` is read synchronously from the
// native module at startup, but can itself be null, so we fall back to a
// zero-inset, full-window frame derived from Dimensions. This GUARANTEES the
// tree renders on frame one regardless of native-callback timing.
const FALLBACK_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: {
    x: 0,
    y: 0,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
} satisfies NonNullable<typeof initialWindowMetrics>;
const SAFE_AREA_INITIAL_METRICS = initialWindowMetrics ?? FALLBACK_METRICS;

// ---------------------------------------------------------------------------
// Push notification configuration
// Notifications delivered while the app is in the foreground show as banners.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Offline sync debounce — prevents concurrent sync runs on flapping connections
// ---------------------------------------------------------------------------

// BUG-26 FIX: The global.fetch monkey-patch that was here has been removed.
// Use apiFetch (lib/api/apiFetch.ts) for own-API calls that need auth headers.
// The apiClient instance (lib/api/client.ts) already handles JWT injection.

let _syncTimeout: ReturnType<typeof setTimeout> | null = null;
let _isSyncing = false;

function debouncedSync() {
  if (_syncTimeout) clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
      await syncPendingMessages();
    } catch (err) {
      console.warn('[offline] Sync failed', err);
    } finally {
      _isSyncing = false;
    }
  }, 2000);
}

// BUG-DATA-04 FIX: /i flag so routes with uppercase hex characters (e.g. UUIDs
// from some backends) are not silently blocked by the lowercase-only pattern.
/** Allowlist of valid in-app routes that a push notification may navigate to. */
const VALID_PUSH_ROUTES: RegExp[] = [
  /^\/rooms\/[a-f0-9-]+$/i,
  /^\/messages\/[0-9a-f-]{36}$/i,
  /^\/messages\/group\/[a-f0-9-]+$/i,
  /^\/profile\/[0-9a-f-]{36}$/i,
  /^\/events\/[a-f0-9-]+$/i,
  /^\/quests$/i,
  /^\/leaderboards$/i,
  /^\/seasons$/i,
  /^\/guilds\/[a-f0-9-]+$/i,
  /^\/guilds\/[a-f0-9-]+\/chat$/i,
  /^\/notifications$/i,
];

// Guard the module-scope native call so a throw can't abort bundle evaluation
// (which would blank the app before React mounts).
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (err) {
  console.warn('[push] setNotificationHandler failed', err);
}

// ---------------------------------------------------------------------------
// Push token registration
// ---------------------------------------------------------------------------


const DEVICE_ID_KEY = 'zobia_device_id';

/** Returns a stable per-installation UUID, generating one on first call. */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return Crypto.randomUUID();
  }
}

/**
 * Request notification permission and register the device's Expo push token
 * with the backend so the server can reach this device.
 * No-ops silently on simulators/emulators.
 */
async function registerForPushNotifications(): Promise<void> {
  // Expo push notifications only work on physical devices
  if (!Device.isDevice) return;

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1A73E8',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    // BUG-M15 FIX: show an actionable alert so the user can open Settings
    // directly instead of getting a UX dead-end with no path to enable notifs.
    Alert.alert(
      'Notifications disabled',
      "You won't receive notifications. Enable them in Settings to stay in the loop.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]
    );
    return;
  }

  // BUG-015 FIX: pass projectId so getExpoPushTokenAsync() works correctly
  // with the EAS build infrastructure. Without projectId, this call is
  // deprecated since Expo SDK 47 and will fail in production EAS builds.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  // L-8 FIX: warn early so developers notice missing EAS config in staging builds.
  if (!projectId) {
    console.warn('[push] EAS projectId not found in expoConfig.extra.eas — push tokens may fail in production builds');
  }
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  const token = tokenData.data;

  if (!token) return;

  const deviceId = await getOrCreateDeviceId();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  // Register token with backend — retry up to 3 times with exponential backoff
  const MAX_PUSH_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_PUSH_RETRIES; attempt++) {
    try {
      await apiClient.post('/users/push-token', { token, platform, deviceId });
      return;
    } catch (err) {
      if (attempt < MAX_PUSH_RETRIES - 1) {
        const base = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, base * (0.5 + 0.5 * Math.random())));
      } else {
        console.warn('[push] Token registration failed after retries:', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Inner layout (has access to auth context and theme)
// ---------------------------------------------------------------------------

function RootLayoutNav() {
  const { isDark } = useTheme();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  // Keep a stable ref to the latest router instance so the notification listener
  // does not need to be re-registered every time router changes identity (BUG-NAV-01).
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; });
  const [storeReady, setStoreReady] = useState(false);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => { isLoadingRef.current = isLoading; });
  // M-10 FIX: ref so the notification listener can guard against routing before
  // the user session is restored (not just before auth loading finishes).
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  // C-4 FIX: hold a cold-start notification action until the nav tree is ready.
  const pendingNotifAction = useRef<string | null>(null);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  // Capture any ?r=<code> referral from the launch URL or links received while
  // running, so the referral attaches at onboarding regardless of which page
  // the link pointed to (profile, room, course, game).
  // BUG-004 FIX: gate behind storeReady — captureReferralFromUrl writes to
  // MMKV via setItem() which throws if initStore() hasn't completed yet.
  useReferralCaptureFromLink(storeReady);

  // BUG-CRIT-03: Await initStore() so we know when MMKV is ready before any
  // component that uses `storage` (e.g. RewardedAdButton, AnnouncementModal)
  // tries to read from it. setStoreReady(true) only fires in the finally block
  // so a crash in initStore still unblocks the app (degraded, no persistence).
  useEffect(() => {
    let active = true;

    // BUG-WHITESCREEN FIX: a watchdog so a hung bootstrap step (e.g. a native
    // module that never resolves) can never trap the app on a blank screen.
    // After this deadline we render regardless; the app degrades gracefully
    // rather than hanging on white forever.
    const watchdog = setTimeout(() => {
      if (active) {
        console.warn('[bootstrap] storeReady watchdog fired — rendering anyway');
        setStoreReady(true);
      }
    }, 8000);

    // Critical render path: only the MMKV store gates the first render. Init it
    // first and flip storeReady the moment it settles (success OR failure) so a
    // storage problem degrades gracefully instead of hanging on a white screen.
    (async () => {
      try {
        await initStore();
        // L-2: apply user's saved language pref from the encrypted store now
        // that initStore() has completed and getStorage() is safe to call.
        applyStoredLanguagePref();
      } catch (err) {
        console.warn('[offline] MMKV store init failed', err);
      } finally {
        if (active) {
          clearTimeout(watchdog);
          setStoreReady(true);
        }
      }

      // C-4 FIX: capture the cold-start notification action now but do NOT
      // navigate immediately — the nav tree hasn't rendered yet. The effect
      // below (keyed on isLoading + storeReady + user) will fire the navigation
      // once auth is resolved and the tree is mounted. Guarded so a failure here
      // never bubbles up and blocks the storeReady flip above.
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          const data = lastResponse.notification.request.content.data as Record<string, unknown>;
          const action = data?.action as string | undefined;
          if (action && VALID_PUSH_ROUTES.some((re) => re.test(action))) {
            pendingNotifAction.current = action;
          }
        }
      } catch (err) {
        console.warn('[push] getLastNotificationResponseAsync failed', err);
      }
    })();

    // Non-critical, fully in the background: the offline SQLite message queue.
    // It must NEVER gate the first render — its key derivation uses crypto.subtle
    // which can be slow or unavailable on some devices, and the UI does not
    // depend on it being ready.
    (async () => {
      try {
        await initOfflineDB();
        await resetSendingMessages();
      } catch (err) {
        console.warn('[offline] SQLite offline-queue init failed', err);
      }
    })();

    // Ads and billing do not depend on MMKV — start them in parallel.
    // Guard the floating promise so an ads-init rejection can never surface as
    // an unhandled rejection during startup.
    initializeAds().catch((err) => console.warn('[ads] init failed', err));
    if (Platform.OS === 'android') {
      initGooglePlayBilling().catch((err) =>
        console.warn('[billing] Google Play Billing init failed', err)
      );
    }
    return () => {
      active = false;
      clearTimeout(watchdog);
    };
  }, []);

  // BUG-CRIT-02: Hide splash screen once auth state resolves and store is ready.
  // BUG-UX-11 FIX: wrap in try-catch so a hideAsync failure (e.g. already
  // hidden, or native module not ready) never throws and leaves the app stuck.
  useEffect(() => {
    if (!isLoading && storeReady) {
      SplashScreen.hideAsync().catch((err) => {
        console.warn('[splash] hideAsync failed', err);
      });
    }
  }, [isLoading, storeReady]);

  // C-4 FIX: fire any cold-start notification navigation once the nav tree is
  // mounted and the user session is confirmed (auth done + user present).
  // BUG-UX-12 FIX: use routerRef.current (stable ref) instead of router
  // directly to avoid re-running this effect on every render where the
  // expo-router object reference changes.
  useEffect(() => {
    if (isLoading || !storeReady || !user) return;
    const action = pendingNotifAction.current;
    if (!action) return;
    pendingNotifAction.current = null;
    try {
      routerRef.current.push(action as Parameters<typeof router.push>[0]);
    } catch (err) {
      console.warn('[push] Cold-start notification navigation failed:', action, err);
    }
  }, [isLoading, storeReady, user]); // router excluded: routerRef.current always holds latest (BUG-UX-12)

  // BUG-CRIT-01: Auth gate — redirect unauthenticated users to the login screen.
  // BUG-UX-12 FIX: use routerRef.current to avoid re-running on every router
  // reference change.
  useEffect(() => {
    if (!isLoading && storeReady && !user) {
      routerRef.current.replace('/auth/login');
    }
  }, [isLoading, storeReady, user]); // router excluded: routerRef.current always holds latest (BUG-UX-12)

  // Request notification permission early (before login) so Android installs
  // show the POST_NOTIFICATIONS dialog on first launch rather than silently
  // leaving notifications disabled. The push token is registered later
  // (after login) by registerForPushNotifications() below.
  useEffect(() => {
    if (!storeReady || !Device.isDevice) return;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#1A73E8',
          });
        }
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'undetermined') {
          await Notifications.requestPermissionsAsync();
        }
      } catch (err) {
        console.warn('[push] Pre-login permission request failed', err);
      }
    })();
  }, [storeReady]);

  // Register push token once the user's identity is established.
  // Scoped to user?.id so token refresh (which mutates other user fields)
  // does not re-trigger an unnecessary re-registration.
  useEffect(() => {
    if (!user?.id) return;
    registerForPushNotifications();
  }, [user?.id]);

  // Manage Google Play Billing connection with app lifecycle.
  // Reconnect when app returns to foreground (covers cold start + resume);
  // disconnect only on true background (not on 'inactive' which is a transient
  // state during phone calls, Control Center, etc. on Android).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        initGooglePlayBilling().catch(() => {});
      } else if (status === 'background') {
        endBillingConnection().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // Listen for internet reconnection and sync pending messages.
  // Debounced 2 s to prevent concurrent sync runs during flapping connections.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        debouncedSync();
      }
    });
    return () => {
      unsub();
      if (_syncTimeout) clearTimeout(_syncTimeout);
    };
  }, []);

  // Listen for notifications received while the app is foregrounded
  useEffect(() => {
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        // Foreground notification received — the handler above shows a banner.
        // Additional in-app handling (e.g. badge count updates) can go here.
        console.debug('[push] Foreground notification:', notification.request.content.title);
      }
    );

    // Handle taps on notifications (app in background or killed)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        // M-10 FIX: guard on both loading state and user presence so taps on
        // notifications can never route to protected screens when logged out.
        if (isLoadingRef.current || !userRef.current) return;

        const data = response.notification.request.content.data as Record<string, unknown>;
        const action = data?.action as string | undefined;

        // Route to the deep link action if one was attached to the notification.
        // Validate against an allowlist before navigating to prevent arbitrary
        // route injection from a crafted or compromised notification payload.
        if (action) {
          if (VALID_PUSH_ROUTES.some((re) => re.test(action))) {
            try {
              // Use routerRef so this callback always has the latest router
              // without causing the effect to re-run on router changes (BUG-NAV-01).
              routerRef.current.push(action as Parameters<typeof router.push>[0]);
            } catch (err) {
              console.warn('[push] Failed to navigate to notification action:', action, err);
            }
          } else {
            if (__DEV__) console.warn('[push] Blocked invalid notification action (not in allowlist):', action);
          }
        }
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []); // Empty deps: register once; routerRef/isLoadingRef always hold latest values

  // Don't render the nav tree until auth state is resolved and store is ready.
  // Return a visible placeholder instead of null so the user never stares at a
  // blank white screen if the native splash auto-hid early (e.g. because the
  // Android API 36 edge-to-edge enforcement caused a window resize that
  // dismisses the splash before preventAutoHideAsync took effect).
  if (isLoading || !storeReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Only show the announcement modal after the user is authenticated */}
      {user !== null && <AnnouncementModal />}
      {/* Session-expired notice — surfaces when a screen (e.g. an open chat
          room) outlives the session and the next request/action 401s. */}
      <SessionExpiredModal />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        {/* Full-screen card (not modal) so the login screen always takes the full
            viewport and router.replace() navigates reliably on Android. A modal
            presentation was causing the session-expired redirect to appear as a
            bottom-sheet while the RN Modal overlay was still visible on top,
            giving the impression that "nothing happened" after tapping Sign In. */}
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="auth/two-factor" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

/**
 * Root layout for the Zobia Social Expo app.
 *
 * Wraps the entire app with:
 * - GestureHandlerRootView (required by react-native-gesture-handler)
 * - SafeAreaProvider
 * - QueryClientProvider (React Query)
 * - ThemeProvider (light/dark)
 * - AuthProvider (JWT via SecureStore)
 * - i18n initialisation (side-effect import above)
 * - Push notification permission request + token registration
 * - Notification tap handler (deep-link routing)
 */
export default function RootLayout() {
  return (
    // SafeAreaProvider is the outermost wrapper so both the main app tree and
    // the sibling DebugOverlay can consume useSafeAreaInsets(). Placing it here
    // (outside the error boundary) means even if a provider crashes, the overlay
    // still has correct inset values for positioning.
    //
    // `initialMetrics` is REQUIRED here: without it the provider renders null
    // until the native async inset callback fires, which can hang forever on
    // Android edge-to-edge (SDK 35) and strand the whole tree — including the
    // DebugOverlay chip — on a blank white screen. See SAFE_AREA_INITIAL_METRICS.
    <SafeAreaProvider initialMetrics={SAFE_AREA_INITIAL_METRICS}>
      <RootErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <AuthProvider>
                <FloatingNotificationProvider>
                  <RootLayoutNav />
                </FloatingNotificationProvider>
              </AuthProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </GestureHandlerRootView>
      </RootErrorBoundary>
      {/* Rendered OUTSIDE the error boundary so it can still surface captured
          errors even when a provider render throws and the boundary swaps in
          its fallback. Shares the SafeAreaProvider above for correct insets.
          No-ops in production. */}
      <DebugOverlay />
    </SafeAreaProvider>
  );
}

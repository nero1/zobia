import '../global.css';

export { ErrorBoundary } from 'expo-router';

import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

import { AuthProvider } from '@/lib/auth/context';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { FloatingNotificationProvider } from '@/components/providers/FloatingNotificationProvider';
import { queryClient, apiClient } from '@/lib/api/client';
import { AnnouncementModal } from '@/components/announcements/AnnouncementModal';
import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal';
import { useAuth } from '@/lib/auth/hooks';
import { initOfflineDB } from '@/lib/offline/sqlite';
import { syncPendingMessages } from '@/lib/offline/syncQueue';
import { initStore } from '@/lib/offline/store';
import { initializeAds } from '@/lib/ads/admob';
import { initGooglePlayBilling, endBillingConnection } from '@/lib/payments/googlePlay';
import { useReferralCaptureFromLink } from '@/lib/deeplinks/referral';
import '@/lib/i18n';

// BUG-CRIT-02: Prevent the native splash from auto-hiding so we can control
// it ourselves — hide only after auth state is resolved and MMKV is ready.
SplashScreen.preventAutoHideAsync();

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

/** Allowlist of valid in-app routes that a push notification may navigate to. */
const VALID_PUSH_ROUTES: RegExp[] = [
  /^\/rooms\/[a-f0-9-]+$/,
  /^\/messages\/[0-9a-f-]{36}$/,
  /^\/messages\/group\/[a-f0-9-]+$/,
  /^\/profile\/[0-9a-f-]{36}$/,
  /^\/events\/[a-f0-9-]+$/,
  /^\/quests$/,
  /^\/leaderboards$/,
  /^\/seasons$/,
  /^\/guilds\/[a-f0-9-]+$/,
  /^\/guilds\/[a-f0-9-]+\/chat$/,
  /^\/notifications$/,
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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
    // User declined — fail silently, do not prompt again until next cold start
    return;
  }

  // BUG-015 FIX: pass projectId so getExpoPushTokenAsync() works correctly
  // with the EAS build infrastructure. Without projectId, this call is
  // deprecated since Expo SDK 47 and will fail in production EAS builds.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
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
        Alert.alert('Push Notifications', "Couldn't set up push notifications. You can retry in Settings.");
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
  const [storeReady, setStoreReady] = useState(false);
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
    (async () => {
      await initOfflineDB().catch((err) =>
        console.warn('[offline] SQLite init failed', err)
      );
      try {
        await initStore();
      } catch (err) {
        console.warn('[offline] MMKV store init failed', err);
      } finally {
        if (active) setStoreReady(true);
      }
    })();
    // Ads and billing do not depend on MMKV — start them in parallel.
    initializeAds();
    if (Platform.OS === 'android') {
      initGooglePlayBilling().catch((err) =>
        console.warn('[billing] Google Play Billing init failed', err)
      );
    }
    return () => { active = false; };
  }, []);

  // BUG-CRIT-02: Hide splash screen once auth state resolves and store is ready.
  useEffect(() => {
    if (!isLoading && storeReady) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, storeReady]);

  // BUG-CRIT-01: Auth gate — redirect unauthenticated users to the login screen.
  useEffect(() => {
    if (!isLoading && storeReady && !user) {
      router.replace('/auth/login');
    }
  }, [isLoading, storeReady, user, router]);

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
        const data = response.notification.request.content.data as Record<string, unknown>;
        const action = data?.action as string | undefined;

        // Route to the deep link action if one was attached to the notification.
        // Validate against an allowlist before navigating to prevent arbitrary
        // route injection from a crafted or compromised notification payload.
        if (action) {
          if (VALID_PUSH_ROUTES.some((re) => re.test(action))) {
            try {
              router.push(action as Parameters<typeof router.push>[0]);
            } catch (err) {
              console.warn('[push] Failed to navigate to notification action:', action, err);
            }
          } else {
            console.warn('[push] Blocked invalid notification action (not in allowlist):', action);
          }
        }
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);

  // Don't render the nav tree until auth state is resolved and store is ready.
  if (isLoading || !storeReady) return null;

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
        <Stack.Screen name="auth/login" options={{ presentation: 'modal', headerShown: false }} />
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <FloatingNotificationProvider>
                <RootLayoutNav />
              </FloatingNotificationProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

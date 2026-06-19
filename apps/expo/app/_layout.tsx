import '../global.css';

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
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
import { useReferralCaptureFromLink } from '@/lib/deeplinks/referral';
import '@/lib/i18n';

// ---------------------------------------------------------------------------
// Push notification configuration
// Notifications delivered while the app is in the foreground show as banners.
// ---------------------------------------------------------------------------

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

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  if (!token) return;

  // Register token with backend (fire-and-forget)
  apiClient
    .post('/users/push-token', { token })
    .catch((err) => console.warn('[push] Token registration failed:', err));
}

// ---------------------------------------------------------------------------
// Inner layout (has access to auth context and theme)
// ---------------------------------------------------------------------------

function RootLayoutNav() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  // Capture any ?r=<code> referral from the launch URL or links received while
  // running, so the referral attaches at onboarding regardless of which page
  // the link pointed to (profile, room, course, game).
  useReferralCaptureFromLink();

  // Initialise offline database and encrypted MMKV store
  useEffect(() => {
    initOfflineDB().catch((err) =>
      console.warn('[offline] SQLite init failed', err)
    );
    initStore().catch((err) =>
      console.warn('[offline] MMKV store init failed', err)
    );
  }, []);

  // Register push token once the user is authenticated
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications();
  }, [user]);

  // Listen for internet reconnection and sync pending messages
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        syncPendingMessages().catch((err) =>
          console.warn('[offline] Sync failed', err)
        );
      }
    });
    return unsub;
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

        // Route to the deep link action if one was attached to the notification
        if (action) {
          try {
            router.push(action as Parameters<typeof router.push>[0]);
          } catch (err) {
            console.warn('[push] Failed to navigate to notification action:', action, err);
          }
        }
      }
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [router]);

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

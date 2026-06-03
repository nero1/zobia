import '../global.css';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from '@/lib/auth/context';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { queryClient } from '@/lib/api/client';
import { AnnouncementModal } from '@/components/announcements/AnnouncementModal';
import { useAuth } from '@/lib/auth/hooks';
import '@/lib/i18n';

/**
 * Inner layout rendered inside ThemeProvider so it can consume the theme.
 */
function RootLayoutNav() {
  const { isDark } = useTheme();
  const { user } = useAuth();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Only show the announcement modal after the user is authenticated */}
      {user !== null && <AnnouncementModal />}
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
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <RootLayoutNav />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

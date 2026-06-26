import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AdminSwipeDrawer, useAdminDrawer } from '@/components/admin/AdminSwipeDrawer';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { useAuth } from '@/lib/auth/hooks';

// ---------------------------------------------------------------------------
// Header hamburger — consumes AdminDrawerContext
// ---------------------------------------------------------------------------

function AdminHeaderLeft() {
  const { openDrawer } = useAdminDrawer();
  const { isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={openDrawer}
      style={styles.hamburger}
      accessibilityLabel="Open admin menu"
      hitSlop={8}
    >
      <Ionicons
        name="menu-outline"
        size={24}
        color={isDark ? colors.neutral[200] : colors.neutral[700]}
      />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Inner Stack — rendered inside AdminSwipeDrawer so it can access the context
// ---------------------------------------------------------------------------

function AdminStack() {
  const { isDark } = useTheme();
  const headerBg = isDark ? colors.neutral[900] : '#ffffff';
  const headerText = isDark ? colors.neutral[50] : colors.neutral[900];

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: headerBg },
        headerTintColor: headerText,
        headerShadowVisible: false,
        headerLeft: () => <AdminHeaderLeft />,
        contentStyle: { backgroundColor: isDark ? colors.neutral[950] : colors.neutral[100] },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />
      <Stack.Screen name="users" options={{ title: 'Users' }} />
      <Stack.Screen name="moderation" options={{ title: 'Moderation' }} />
      <Stack.Screen name="community-notes" options={{ title: 'Community Notes' }} />
      <Stack.Screen name="financial" options={{ title: 'Financial' }} />
      <Stack.Screen name="payouts" options={{ title: 'Payouts' }} />
      <Stack.Screen name="refunds" options={{ title: 'Refunds' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="messages" options={{ title: 'Messages' }} />
      <Stack.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Stack.Screen name="config" options={{ title: 'Config' }} />
      <Stack.Screen name="ai-settings" options={{ title: 'AI Settings' }} />
      <Stack.Screen name="feature-flags" options={{ title: 'Feature Flags' }} />
      <Stack.Screen name="branded-rooms" options={{ title: 'Branded Rooms' }} />
      <Stack.Screen name="leaderboards" options={{ title: 'Leaderboards' }} />
      <Stack.Screen name="leaderboard-banners" options={{ title: 'Leaderboard Banners' }} />
      <Stack.Screen name="events" options={{ title: 'Events' }} />
      <Stack.Screen name="flash-xp" options={{ title: 'Flash XP' }} />
      <Stack.Screen name="gift-drop" options={{ title: 'Gift Drop' }} />
      <Stack.Screen name="seasons" options={{ title: 'Seasons' }} />
      <Stack.Screen name="sponsored-quests" options={{ title: 'Sponsored Quests' }} />
      <Stack.Screen name="actions-log" options={{ title: 'Actions Log' }} />
      <Stack.Screen name="automated-actions" options={{ title: 'Auto Actions' }} />
      <Stack.Screen name="creator-spotlight" options={{ title: 'Creator Spotlight' }} />
      <Stack.Screen name="email-settings" options={{ title: 'Email Settings' }} />
      <Stack.Screen name="footer-scripts" options={{ title: 'Footer Scripts' }} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Admin layout root — wraps everything in AdminSwipeDrawer
// ---------------------------------------------------------------------------

export default function AdminLayout() {
  const { user } = useAuth();

  // BUG-032 FIX: redirect non-admins before rendering any admin screen so they
  // see a clear "not found" rather than a series of 403 errors with empty UIs.
  if (!user?.isAdmin) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <AdminSwipeDrawer>
      <AdminStack />
    </AdminSwipeDrawer>
  );
}

const styles = StyleSheet.create({
  hamburger: {
    marginLeft: 4,
    padding: 4,
  },
});

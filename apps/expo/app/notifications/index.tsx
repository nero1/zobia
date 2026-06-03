/**
 * app/notifications/index.tsx
 *
 * Notifications screen.
 *
 * Features:
 *  - FlatList of notifications from /api/notifications
 *  - Icon per type (Ionicons)
 *  - Read/unread visual indicator
 *  - "Mark all read" button
 *  - Pull-to-refresh
 */

import React, { useState, useCallback } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationType =
  | 'xp'
  | 'gift'
  | 'guild'
  | 'dm'
  | 'mention'
  | 'season'
  | 'system'
  | 'streak'
  | 'friend'
  | 'announcement';

interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchNotifications(): Promise<AppNotification[]> {
  const { data } = await apiClient.get('/api/notifications');
  return data.notifications ?? [];
}

async function markAllRead(): Promise<void> {
  await apiClient.post('/api/notifications/read-all');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TYPE_ICON: Record<NotificationType, IoniconName> = {
  xp: 'star-outline',
  gift: 'gift-outline',
  guild: 'shield-outline',
  dm: 'chatbubble-outline',
  mention: 'at-outline',
  season: 'trophy-outline',
  system: 'information-circle-outline',
  streak: 'flame-outline',
  friend: 'person-add-outline',
  announcement: 'megaphone-outline',
};

const TYPE_COLOR: Record<NotificationType, string> = {
  xp: colors.brand.gold,
  gift: colors.brand.green,
  guild: colors.brand.blue,
  dm: colors.brand.blue,
  mention: colors.brand.blue,
  season: colors.brand.gold,
  system: colors.neutral[500],
  streak: '#F97316',
  friend: colors.brand.green,
  announcement: colors.semantic.info,
};

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

function NotifRow({ notif }: { notif: AppNotification }) {
  const { colors: themeColors } = useTheme();
  const iconName = TYPE_ICON[notif.type] ?? 'notifications-outline';
  const iconColor = TYPE_COLOR[notif.type] ?? colors.brand.blue;

  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: themeColors.border },
        !notif.isRead && styles.rowUnread,
      ]}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${iconColor}18` }]}>
        <Ionicons name={iconName} size={20} color={iconColor} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: themeColors.text }]} numberOfLines={1}>
            {notif.title}
          </Text>
          {!notif.isRead && <View style={styles.unreadDot} />}
        </View>
        <Text style={[styles.body, { color: themeColors.textMuted }]} numberOfLines={2}>
          {notif.body}
        </Text>
        <Text style={[styles.time, { color: themeColors.textMuted }]}>
          {formatTime(notif.createdAt)}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function NotificationsScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: notifications = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
  });

  const markAllMutation = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load notifications.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <FlatList
      data={notifications}
      keyExtractor={(n) => n.id}
      renderItem={({ item }) => <NotifRow notif={item} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
      ListHeaderComponent={() => (
        <View style={[styles.header, { borderBottomColor: themeColors.border }]}>
          <Text style={[styles.headerTitle, { color: themeColors.text }]}>Notifications</Text>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={styles.markAllBtn}
              onPress={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications as read"
            >
              <Text style={styles.markAllText}>
                {markAllMutation.isPending ? 'Marking…' : 'Mark all read'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={() => (
        <View style={styles.emptyState}>
          <Ionicons name="notifications-off-outline" size={48} color={themeColors.textMuted} />
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            No notifications yet.
          </Text>
        </View>
      )}
      contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: `${colors.brand.blue}18`,
    minHeight: 44,
    justifyContent: 'center',
  },
  markAllText: { fontSize: 13, fontWeight: '700', color: colors.brand.blue },

  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    alignItems: 'flex-start',
    minHeight: 60,
  },
  rowUnread: {
    backgroundColor: `${colors.brand.blue}08`,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.blue,
    flexShrink: 0,
  },
  body: { fontSize: 13, lineHeight: 18 },
  time: { fontSize: 11, marginTop: 2 },

  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyText: { fontSize: 15, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 10 },
  skeletonRow: { height: 72, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

/**
 * app/notifications/index.tsx
 *
 * Notifications screen.
 *
 * Features:
 *  - FlatList of notifications from /notifications
 *  - Icon per type (Ionicons)
 *  - Read/unread visual indicator
 *  - "Mark all read" button
 *  - Pull-to-refresh
 */

import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  payload?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Notification formatter (payload → title + body)
// ---------------------------------------------------------------------------

function formatNotification(n: AppNotification & { payload?: Record<string, unknown> | null }): AppNotification {
  if (n.title) return n;
  const p = n.payload ?? {};
  const str = (k: string, fb = '') => String(p[k] ?? fb);
  const num = (k: string, fb = 0) => Number(p[k] ?? fb);
  let title = 'Notification';
  let body = '';
  switch (n.type) {
    case 'guild_low_contribution':
      title = '📉 Low Contribution Alert';
      body = `Your score (${num('contributionScore')}) is below your guild average (${num('guildAverage')}). Step it up!`;
      break;
    case 'guild_war': title = '⚔️ Guild War Update'; body = str('message', 'Your guild has a war update.'); break;
    case 'guild_war_final_hour': title = '⚔️ Final Hour!'; body = str('message', "Your guild's war is entering the final hour! Give it everything you've got."); break;
    case 'prestige_complete': title = `🔥 Prestige ${num('prestigeCount')} Achieved!`; body = str('title', 'You have been reborn.'); break;
    case 'mystery_xp_drop': title = '✨ Mystery XP Drop!'; body = `You earned ${num('xpAmount').toLocaleString()} bonus XP.`; break;
    case 'flash_xp_announced': title = '⚡ Flash XP Coming Soon'; body = str('message', `${str('name', 'Double XP')} is happening soon — stay active!`); break;
    case 'flash_xp_live': title = `⚡ ${str('name', 'Flash XP')} is LIVE!`; body = str('message', `${num('multiplier', 2)}× XP is active now. Go earn!`); break;
    case 'leaderboard_ripple': title = '📊 Leaderboard Change'; body = str('message', 'Your rank has changed.'); break;
    case 'platform_council_invite': title = '🏛️ Council Invitation'; body = 'You\'ve been invited to the Platform Council!'; break;
    case 'reengagement': title = '👋 Welcome back!'; body = str('message', 'Things happened while you were away.'); break;
    case 'streak_risk': title = '⚠️ Streak at Risk'; body = `${num('streakDays')}-day streak — log in today to keep it!`; break;
    case 'rank_up': title = `🏅 Rank Up! ${str('newRank', '')}`; body = str('message', ''); break;
    default:
      title = str('subject', str('title', n.type.replace(/_/g, ' ')));
      body = str('body', str('message', ''));
  }
  return { ...n, title, body };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchNotifications(cursor?: string): Promise<{ notifications: AppNotification[]; nextCursor: string | null }> {
  const params: Record<string, string | number> = { limit: 30 };
  if (cursor) params.cursor = cursor;
  const { data } = await apiClient.get('/notifications', { params });
  const raw: AppNotification[] = data.notifications ?? [];
  return { notifications: raw.map(formatNotification), nextCursor: data.nextCursor ?? null };
}

async function markAllRead(): Promise<void> {
  await apiClient.post('/notifications/read-all');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TYPE_ICON: Partial<Record<string, IoniconName>> & { default: IoniconName } = {
  xp: 'star-outline',
  gift: 'gift-outline',
  guild: 'shield-outline',
  guild_war: 'shield-outline',
  guild_war_final_hour: 'shield-outline',
  guild_low_contribution: 'trending-down-outline',
  dm: 'chatbubble-outline',
  mention: 'at-outline',
  season: 'trophy-outline',
  system: 'information-circle-outline',
  streak: 'flame-outline',
  streak_risk: 'warning-outline',
  friend: 'person-add-outline',
  announcement: 'megaphone-outline',
  prestige_complete: 'flame-outline',
  mystery_xp_drop: 'sparkles-outline',
  flash_xp_announced: 'flash-outline',
  flash_xp_live: 'flash-outline',
  leaderboard_ripple: 'podium-outline',
  platform_council_invite: 'business-outline',
  reengagement: 'hand-left-outline',
  default: 'notifications-outline',
} as const;

const TYPE_COLOR: Partial<Record<string, string>> = {
  xp: colors.brand.gold,
  gift: colors.brand.green,
  guild: colors.brand.blue,
  guild_low_contribution: '#EF4444',
  dm: colors.brand.blue,
  mention: colors.brand.blue,
  season: colors.brand.gold,
  system: colors.neutral[500],
  streak: '#F97316',
  streak_risk: '#EF4444',
  friend: colors.brand.green,
  announcement: colors.semantic.info,
  prestige_complete: '#F97316',
  mystery_xp_drop: colors.brand.gold,
  flash_xp_announced: '#F59E0B',
  flash_xp_live: '#F59E0B',
  leaderboard_ripple: colors.brand.blue,
  platform_council_invite: colors.brand.blue,
  reengagement: colors.brand.green,
};

function formatTime(iso: string): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Notification routing + read helper
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeId(id: unknown): string | null {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return id;
}

function getNotificationRoute(notif: AppNotification): string | null {
  const p = notif.payload ?? {};
  switch (notif.type) {
    case 'dm':
    case 'new_message': {
      const id = safeId(p.conversationId);
      return id ? `/messages/${id}` : null;
    }
    case 'guild_war':
    case 'guild_war_final_hour':
    case 'guild_low_contribution': {
      const id = safeId(p.guildId);
      return id ? `/guilds/${id}` : null;
    }
    case 'gift':
    case 'gift_received':
      return '/(tabs)/wallet';
    case 'friend':
    case 'friend_request': {
      const id = safeId(p.senderId);
      return id ? `/profile/${id}` : null;
    }
    case 'mention':
    case 'room': {
      const id = safeId(p.roomId);
      return id ? `/rooms/${id}` : null;
    }
    case 'rank_up':
    case 'prestige_complete':
      return '/(tabs)/profile';
    case 'streak_risk':
    case 'reengagement':
      return '/(tabs)';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Notification row
// ---------------------------------------------------------------------------

function NotifRow({ notif, onPress }: { notif: AppNotification; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const iconName: IoniconName = TYPE_ICON[notif.type] ?? TYPE_ICON.default;
  const iconColor = TYPE_COLOR[notif.type] ?? colors.brand.blue;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: themeColors.border },
        !notif.isRead && styles.rowUnread,
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
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
    </Pressable>
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: notifPages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => fetchNotifications(pageParam as string | undefined),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });

  const notifications = notifPages?.pages.flatMap((p) => p.notifications) ?? [];

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const prev = queryClient.getQueryData<typeof notifPages>(['notifications']);
      queryClient.setQueryData<typeof notifPages>(['notifications'], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((n) =>
              n.id === id ? { ...n, isRead: true } : n
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notifications'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
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

  const unreadCount = notifications.filter((n: AppNotification) => !n.isRead).length;

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            {t('notifications.loadError', 'Could not load notifications.')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <FlatList
      data={notifications}
      keyExtractor={(n) => n.id}
      accessibilityLabel="Notification list"
      renderItem={({ item }) => (
        <NotifRow
          notif={item}
          onPress={() => {
            markReadMutation.mutate(item.id);
            const route = getNotificationRoute(item);
            if (route) router.push(route as Parameters<typeof router.push>[0]);
          }}
        />
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }}
      onEndReachedThreshold={0.3}
      ListFooterComponent={isFetchingNextPage ? <ActivityIndicator color={colors.brand.blue} style={{ padding: 16 }} /> : null}
      ListHeaderComponent={() => (
        <View style={[styles.header, { borderBottomColor: themeColors.border }]}>
          <Text style={[styles.headerTitle, { color: themeColors.text }]}>{t('notifications.title')}</Text>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={styles.markAllBtn}
              onPress={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.markAllRead')}
            >
              <Text style={styles.markAllText}>
                {markAllMutation.isPending ? t('notifications.markingAll') : t('notifications.markAllRead')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={() => (
        <View style={styles.emptyState}>
          <Ionicons name="notifications-off-outline" size={48} color={themeColors.textMuted} />
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            {t('notifications.empty')}
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
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

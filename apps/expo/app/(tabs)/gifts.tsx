/**
 * Gifts screen
 *
 * Dedicated page for viewing sent/received gift history and launching the
 * gift-send flow to a chosen friend.
 *
 * Route: accessible from the SwipeDrawer at /(tabs)/gifts
 * (hidden from the bottom tab bar)
 *
 * @module app/(tabs)/gifts
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GiftUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface GiftRecord {
  id: string;
  createdAt: string;
  coinValue: number;
  status: string;
  direction: 'sent' | 'received';
  sender: GiftUser;
  recipient: GiftUser;
  giftItem: { name: string; emoji: string; tier: number };
}

interface GiftPage {
  gifts: GiftRecord[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Tier badge colour helper
// ---------------------------------------------------------------------------

const TIER_BG: Record<number, string> = {
  1: colors.neutral[200],
  2: '#D1FAE5',
  3: '#FEF3C7',
  4: '#DBEAFE',
  5: '#FEF9C3',
};

const TIER_TEXT: Record<number, string> = {
  1: colors.neutral[600],
  2: '#065F46',
  3: '#92400E',
  4: '#1D4ED8',
  5: '#78350F',
};

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Gift row
// ---------------------------------------------------------------------------

function GiftRow({ gift, isDark }: { gift: GiftRecord; isDark: boolean }) {
  const { t } = useTranslation();
  const isSent = gift.direction === 'sent';
  const other = isSent ? gift.recipient : gift.sender;
  const tierBg = TIER_BG[gift.giftItem.tier] ?? colors.neutral[200];
  const tierText = TIER_TEXT[gift.giftItem.tier] ?? colors.neutral[600];

  return (
    <View style={[styles.row, { borderBottomColor: isDark ? colors.neutral[800] : colors.neutral[200] }]}>
      <View style={styles.emojiWrap}>
        <Text style={styles.giftEmoji}>{gift.giftItem.emoji}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[styles.giftName, { color: isDark ? colors.neutral[50] : colors.neutral[900] }]}
          numberOfLines={1}
        >
          {gift.giftItem.name}
        </Text>
        <Text style={[styles.rowSub, { color: colors.neutral[500] }]} numberOfLines={1}>
          {isSent ? t('gifts.row.to') : t('gifts.row.from')} @{other.username ?? 'unknown'} · {relativeTime(gift.createdAt)}
        </Text>
      </View>
      <View style={[styles.tierBadge, { backgroundColor: tierBg }]}>
        <Text style={[styles.tierText, { color: tierText }]}>T{gift.giftItem.tier}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  tab,
  onSend,
  isDark,
}: {
  tab: 'received' | 'sent';
  onSend: () => void;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyEmoji}>🎁</Text>
      <Text style={[styles.emptyTitle, { color: isDark ? colors.neutral[50] : colors.neutral[900] }]}>
        {tab === 'received' ? t('gifts.empty.received') : t('gifts.empty.sent')}
      </Text>
      <Text style={[styles.emptySub, { color: colors.neutral[500] }]}>
        {tab === 'received' ? t('gifts.empty.receivedHint') : t('gifts.empty.sentHint')}
      </Text>
      {tab === 'sent' && (
        <Pressable onPress={onSend} style={styles.sendBtn}>
          <Text style={styles.sendBtnText}>{t('gifts.sendBtn')}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function GiftsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const [tab, setTab] = useState<'received' | 'sent'>('received');

  const tabBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[800] : colors.neutral[200];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];

  // BUG-UX-14 FIX: use cursor-based pagination via useInfiniteQuery instead of
  // a fixed limit=40, so users can load arbitrarily long gift histories.
  const PAGE_SIZE = 20;
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isRefetching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<GiftPage>({
    queryKey: ['gifts', tab],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      const url = `/economy/gifts?type=${tab}&limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const { data: res } = await apiClient.get<GiftPage>(url);
      return { gifts: res.gifts ?? [], nextCursor: res.nextCursor ?? null };
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const gifts = useMemo(
    () => data?.pages.flatMap((p) => p.gifts) ?? [],
    [data],
  );

  const handleSend = useCallback(() => {
    // Navigate to gift-send with no pre-filled recipient so user can pick
    router.push('/economy/gift-send' as Parameters<typeof router.push>[0]);
  }, [router]);

  return (
    <Screen scrollable={false} edges={['left', 'right']}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 8, borderBottomColor: borderColor, backgroundColor: tabBg }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.brand.blue} />
        </Pressable>
        <Text style={[styles.title, { color: textPrimary }]}>🎁 {t('gifts.title')}</Text>
        <Pressable onPress={handleSend} style={styles.sendHeaderBtn} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={24} color={colors.brand.blue} />
        </Pressable>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], borderBottomColor: borderColor }]}>
        {(['received', 'sent'] as const).map((tabKey) => (
          <Pressable
            key={tabKey}
            onPress={() => setTab(tabKey)}
            style={[
              styles.tabBtn,
              tab === tabKey && { backgroundColor: isDark ? colors.neutral[900] : colors.neutral[0] },
            ]}
          >
            <Text style={[styles.tabLabel, { color: tab === tabKey ? colors.brand.blue : colors.neutral[500] }]}>
              {tabKey === 'received' ? t('gifts.tabs.received') : t('gifts.tabs.sent')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.brand.blue} />
        </View>
      ) : isError ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptySub, { color: colors.neutral[500] }]}>{t('gifts.loadError')}</Text>
          <Pressable onPress={() => refetch()} style={styles.sendBtn}>
            <Text style={styles.sendBtnText}>{t('gifts.retry')}</Text>
          </Pressable>
        </View>
      ) : gifts.length === 0 ? (
        <EmptyState tab={tab} onSend={handleSend} isDark={isDark} />
      ) : (
        <FlatList
          data={gifts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <GiftRow gift={item} isDark={isDark} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand.blue} />
            ) : null
          }
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  sendHeaderBtn: {
    padding: 4,
  },
  tabBar: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emojiWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftEmoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  giftName: {
    fontSize: 14,
    fontWeight: '600',
  },
  rowSub: {
    fontSize: 12,
  },
  tierBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tierText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  sendBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  sendBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '600',
  },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

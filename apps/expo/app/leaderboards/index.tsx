/**
 * app/leaderboards/index.tsx
 *
 * Leaderboard screen.
 *
 * Features:
 *  - Tabs: Global, City, Guild, Season
 *  - Track pills: Main, Social, Creator, Competitor, Generosity, Knowledge, Explorer
 *  - FlatList of ranked users
 *  - Current user's rank pinned at bottom if not in visible range
 *  - Skeleton loader + offline graceful state
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardTab = 'global' | 'city' | 'guild' | 'season';
type LeaderboardTrack = 'main' | 'social' | 'creator' | 'competitor' | 'generosity' | 'knowledge' | 'explorer' | 'gaming';

interface SponsoredBanner {
  id: string;
  sponsorName: string;
  message: string;
  ctaUrl: string | null;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

interface LeaderboardEntry {
  rank: number;
  previousRank: number | null;
  userId: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  city: string | null;
  score: number;
  isCurrentUser: boolean;
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  currentUserEntry: LeaderboardEntry | null;
  currentUserInView: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TABS: { key: LeaderboardTab; label: string }[] = [
  { key: 'global', label: 'Global' },
  { key: 'city', label: 'City' },
  { key: 'guild', label: 'Guild' },
  { key: 'season', label: 'Season' },
];

const TRACKS: { key: LeaderboardTrack; label: string; emoji: string }[] = [
  { key: 'main', label: 'Main', emoji: '⭐' },
  { key: 'social', label: 'Social', emoji: '💬' },
  { key: 'creator', label: 'Creator', emoji: '🎨' },
  { key: 'competitor', label: 'Competitor', emoji: '⚔️' },
  { key: 'generosity', label: 'Generosity', emoji: '🎁' },
  { key: 'knowledge', label: 'Knowledge', emoji: '📚' },
  { key: 'explorer', label: 'Explorer', emoji: '🧭' },
  { key: 'gaming', label: 'Gaming', emoji: '🎮' },
];

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchLeaderboard(
  tab: LeaderboardTab,
  track: LeaderboardTrack,
): Promise<LeaderboardResponse> {
  const { data } = await apiClient.get('/leaderboards', { params: { tab, track } });
  return data;
}

async function fetchLeaderboardBanner(): Promise<SponsoredBanner | null> {
  try {
    const { data } = await apiClient.get('/leaderboards/banner');
    return data?.data?.banner ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sponsored banner row
// ---------------------------------------------------------------------------

function SponsoredBannerRow({ banner }: { banner: SponsoredBanner }) {
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.bannerRow, { backgroundColor: themeColors.surface }]}>
      <Text style={[styles.bannerSponsoredLabel, { color: themeColors.textMuted }]}>
        {t('leaderboards.sponsored', 'Sponsored')}
      </Text>
      <Text style={[styles.bannerSponsorName, { color: themeColors.text }]}>
        {banner.sponsorName}
      </Text>
      <Text style={[styles.bannerMessage, { color: themeColors.textMuted }]}>
        {banner.message}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <View key={i} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Entry row
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rank change ripple animation
// ---------------------------------------------------------------------------

function RankChangeRipple({
  changed,
  direction,
  children,
}: {
  changed: boolean;
  direction: 'up' | 'down' | null;
  children: React.ReactNode;
}) {
  const bgAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!changed || direction === null) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bgAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: false,
        }),
        Animated.timing(bgAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: false,
        }),
      ]),
      { iterations: 3 },
    );

    loop.start(() => {
      bgAnim.setValue(0);
    });

    return () => loop.stop();
  }, [changed, direction]);

  const targetColor =
    direction === 'up'
      ? 'rgba(16, 185, 129, 0.15)'
      : 'rgba(239, 68, 68, 0.10)';

  const backgroundColor = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', targetColor],
  });

  return (
    <Animated.View style={changed ? { backgroundColor } : undefined}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Rank delta indicator
// ---------------------------------------------------------------------------

function RankDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null || previous === current) return null;
  const delta = previous - current; // positive = moved up
  const up = delta > 0;
  return (
    <Text style={[styles.rankDelta, { color: up ? '#22c55e' : '#ef4444' }]}>
      {up ? `▲${delta}` : `▼${Math.abs(delta)}`}
    </Text>
  );
}

function EntryRow({ entry }: { entry: LeaderboardEntry }) {
  const { colors: themeColors } = useTheme();
  const medal = RANK_MEDALS[entry.rank];

  const rankChanged =
    entry.previousRank !== null && entry.previousRank !== entry.rank;
  const rankDirection: 'up' | 'down' | null = rankChanged
    ? entry.previousRank! > entry.rank
      ? 'up'
      : 'down'
    : null;

  return (
    <RankChangeRipple changed={rankChanged} direction={rankDirection}>
      <View
        style={[
          styles.entryRow,
          { borderBottomColor: themeColors.border },
          entry.isCurrentUser && styles.entryRowHighlight,
        ]}
      >
        <View style={styles.rankCol}>
          {medal ? (
            <Text style={styles.medal}>{medal}</Text>
          ) : (
            <Text style={[styles.rankNum, { color: themeColors.textMuted }]}>
              {entry.rank}
            </Text>
          )}
          <RankDelta current={entry.rank} previous={entry.previousRank} />
        </View>

        <View style={styles.avatar}>
          <Text style={styles.avatarEmoji}>{entry.avatarEmoji}</Text>
        </View>

        <View style={styles.nameCol}>
          <Text style={[styles.displayName, { color: themeColors.text }]} numberOfLines={1}>
            {entry.displayName}
            {entry.isCurrentUser && (
              <Text style={styles.youLabel}> (You)</Text>
            )}
          </Text>
          <Text style={[styles.username, { color: themeColors.textMuted }]} numberOfLines={1}>
            @{entry.username}
            {entry.city ? ` · ${entry.city}` : ''}
          </Text>
        </View>

        <Text style={[styles.score, { color: themeColors.text }]}>
          {entry.score.toLocaleString()}
        </Text>
      </View>
    </RankChangeRipple>
  );
}

// ---------------------------------------------------------------------------
// Pinned current user row
// ---------------------------------------------------------------------------

function PinnedUserRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <View
      style={[
        styles.pinnedRow,
        {
          backgroundColor: `${colors.brand.blue}18`,
          borderTopColor: colors.brand.blue,
        },
      ]}
    >
      <Text style={[styles.pinnedLabel, { color: colors.brand.blue }]}>Your rank</Text>
      <EntryRow entry={entry} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * LeaderboardScreen — ranked users across tabs and XP tracks.
 */
export default function LeaderboardScreen() {
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('global');
  const [activeTrack, setActiveTrack] = useState<LeaderboardTrack>('main');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaderboard', activeTab, activeTrack],
    queryFn: () => fetchLeaderboard(activeTab, activeTrack),
    placeholderData: (prev) => prev,
  });

  const { data: banner } = useQuery({
    queryKey: ['leaderboard-banner'],
    queryFn: fetchLeaderboardBanner,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return (
    <Screen disableBottomInset>
      <View style={[styles.tabBar, { borderBottomColor: themeColors.border }]}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[
              styles.tab,
              activeTab === tab.key && {
                borderBottomColor: colors.brand.blue,
                borderBottomWidth: 2,
              },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === tab.key ? colors.brand.blue : themeColors.textMuted },
              ]}
            >
              {t(`leaderboards.scope.${tab.key}`, tab.label)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Track pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.trackScroll, { borderBottomColor: themeColors.border }]}
        contentContainerStyle={styles.trackContent}
      >
        {TRACKS.map((track) => (
          <Pressable
            key={track.key}
            onPress={() => setActiveTrack(track.key)}
            style={[
              styles.trackPill,
              activeTrack === track.key && {
                backgroundColor: colors.brand.blue,
                borderColor: colors.brand.blue,
              },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: activeTrack === track.key }}
          >
            <Text style={styles.trackEmoji}>{track.emoji}</Text>
            <Text
              style={[
                styles.trackLabel,
                { color: activeTrack === track.key ? colors.neutral[0] : themeColors.textMuted },
              ]}
            >
              {t(`leaderboards.track.${track.key}`, track.label)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <LeaderboardSkeleton />
      ) : isError ? (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            {t('leaderboards.loadError', 'Could not load leaderboard. Check your connection.')}
          </Text>
        </View>
      ) : (
        <View style={styles.flex}>
          <FlatList
            data={data?.entries ?? []}
            keyExtractor={(e) => e.userId}
            renderItem={({ item }) => <EntryRow entry={item} />}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              banner?.isActive ? <SponsoredBannerRow banner={banner} /> : null
            }
            ListEmptyComponent={() => (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                  {t('leaderboards.empty')}
                </Text>
              </View>
            )}
          />

          {/* Pinned current user if not in visible range */}
          {data?.currentUserEntry && !data.currentUserInView && (
            <PinnedUserRow entry={data.currentUserEntry} />
          )}
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
  },
  tabText: { fontSize: 14, fontWeight: '600' },

  trackScroll: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    maxHeight: 56,
  },
  trackContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  trackPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
    minHeight: 36,
  },
  trackEmoji: { fontSize: 13 },
  trackLabel: { fontSize: 12, fontWeight: '600' },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 56,
  },
  entryRowHighlight: {
    backgroundColor: `${colors.brand.blue}08`,
  },

  rankCol: { width: 36, alignItems: 'center' },
  medal: { fontSize: 20 },
  rankNum: { fontSize: 14, fontWeight: '700' },
  rankDelta: { fontSize: 9, fontWeight: '700', marginTop: 1 },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 22 },

  nameCol: { flex: 1 },
  displayName: { fontSize: 14, fontWeight: '600' },
  youLabel: { fontWeight: '400', color: colors.brand.blue, fontSize: 12 },
  username: { fontSize: 12, marginTop: 1 },

  score: { fontSize: 14, fontWeight: '700' },

  pinnedRow: {
    borderTopWidth: 2,
    paddingTop: 4,
  },
  pinnedLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 6,
  },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14 },

  skeletonContainer: { padding: 16, gap: 10 },
  skeletonRow: { height: 60, borderRadius: 10, backgroundColor: colors.neutral[200] },

  bannerRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
  },
  bannerSponsoredLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  bannerSponsorName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  bannerMessage: {
    fontSize: 12,
  },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

/**
 * app/seasons/index.tsx
 *
 * Season screen.
 *
 * Features:
 *  - Season theme header with name and days remaining
 *  - Season Pass progress bar (free tier)
 *  - "Upgrade to Paid Pass" card (shows exclusive rewards)
 *  - Season leaderboard preview (top 10)
 *  - Season History shelf (past seasons as timeline cards)
 */

import React from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeasonPassTier {
  tier: 'free' | 'paid';
  currentLevel: number;
  maxLevel: number;
  xpToNextLevel: number;
  xpInCurrentLevel: number;
  rewards: string[];
}

interface LeaderboardPreviewEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarEmoji: string;
  score: number;
}

interface PastSeason {
  id: string;
  name: string;
  themeEmoji: string;
  startedAt: string;
  endedAt: string;
  finalRank: number | null;
}

interface SeasonData {
  currentSeason: {
    id: string;
    name: string;
    themeEmoji: string;
    daysRemaining: number;
    endsAt: string;
  };
  passProgress: SeasonPassTier;
  hasPaidPass: boolean;
  paidPassExclusiveRewards: string[];
  leaderboardPreview: LeaderboardPreviewEntry[];
  pastSeasons: PastSeason[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchSeasonData(): Promise<SeasonData> {
  const { data } = await apiClient.get('/seasons/current');
  return data;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SeasonSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonHeader} />
      <View style={styles.skeletonBar} />
      <View style={styles.skeletonCard} />
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  progress: number; // 0–1
  color?: string;
}

function ProgressBar({ progress, color = colors.brand.blue }: ProgressBarProps) {
  return (
    <View style={styles.progressOuter}>
      <View style={[styles.progressInner, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard preview row
// ---------------------------------------------------------------------------

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function LeaderRow({ entry }: { entry: LeaderboardPreviewEntry }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.leaderRow, { borderBottomColor: themeColors.border }]}>
      <Text style={styles.leaderRank}>
        {MEDALS[entry.rank] ?? `#${entry.rank}`}
      </Text>
      <View style={styles.leaderAvatar}>
        <Text style={styles.leaderAvatarEmoji}>{entry.avatarEmoji}</Text>
      </View>
      <Text style={[styles.leaderName, { color: themeColors.text }]} numberOfLines={1}>
        {entry.displayName}
      </Text>
      <Text style={[styles.leaderScore, { color: themeColors.text }]}>
        {entry.score.toLocaleString()}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Past season card
// ---------------------------------------------------------------------------

function PastSeasonCard({ season }: { season: PastSeason }) {
  const { colors: themeColors } = useTheme();
  const startYear = new Date(season.startedAt).getFullYear();
  return (
    <View style={[styles.pastCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      <Text style={styles.pastEmoji}>{season.themeEmoji}</Text>
      <Text style={[styles.pastName, { color: themeColors.text }]} numberOfLines={1}>
        {season.name}
      </Text>
      <Text style={[styles.pastYear, { color: themeColors.textMuted }]}>{startYear}</Text>
      {season.finalRank !== null && (
        <Text style={[styles.pastRank, { color: colors.brand.gold }]}>
          Rank #{season.finalRank}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * SeasonScreen — season pass progress, leaderboard preview, and history.
 */
export default function SeasonScreen() {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['season-current'],
    queryFn: fetchSeasonData,
  });

  if (isLoading) return <Screen scrollable><SeasonSkeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load season data. Check your connection.
          </Text>
        </View>
      </Screen>
    );
  }

  const { currentSeason, passProgress, hasPaidPass, paidPassExclusiveRewards, leaderboardPreview, pastSeasons } = data;

  const levelProgress = passProgress.xpInCurrentLevel /
    (passProgress.xpInCurrentLevel + passProgress.xpToNextLevel);

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Season header */}
      <View style={[styles.seasonHeader, { backgroundColor: themeColors.surface }]}>
        <Text style={styles.seasonEmoji}>{currentSeason.themeEmoji}</Text>
        <Text style={[styles.seasonName, { color: themeColors.text }]}>{currentSeason.name}</Text>
        <View style={styles.daysRemainingBadge}>
          <Text style={styles.daysRemainingText}>
            {currentSeason.daysRemaining} days left
          </Text>
        </View>
      </View>

      {/* Season Pass progress */}
      <View style={[styles.section, { backgroundColor: themeColors.surface }]}>
        <View style={styles.passHeader}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
            Season Pass
          </Text>
          <View style={[styles.tierBadge, { backgroundColor: hasPaidPass ? colors.brand.gold : colors.neutral[300] }]}>
            <Text style={styles.tierBadgeText}>{hasPaidPass ? 'Paid' : 'Free'}</Text>
          </View>
        </View>
        <View style={styles.levelRow}>
          <Text style={[styles.levelText, { color: themeColors.textMuted }]}>
            Level {passProgress.currentLevel}
          </Text>
          <Text style={[styles.levelText, { color: themeColors.textMuted }]}>
            {passProgress.xpInCurrentLevel.toLocaleString()} / {(passProgress.xpInCurrentLevel + passProgress.xpToNextLevel).toLocaleString()} XP
          </Text>
        </View>
        <ProgressBar progress={levelProgress} />
        <Text style={[styles.nextLevelHint, { color: themeColors.textMuted }]}>
          {passProgress.xpToNextLevel.toLocaleString()} XP to level {passProgress.currentLevel + 1}
        </Text>
      </View>

      {/* Upgrade card (free users) */}
      {!hasPaidPass && (
        <View style={[styles.upgradeCard, { borderColor: colors.brand.gold }]}>
          <Text style={styles.upgradeTitle}>👑 Upgrade to Paid Pass</Text>
          <Text style={[styles.upgradeSubtitle, { color: themeColors.textMuted }]}>
            Exclusive rewards this season:
          </Text>
          {paidPassExclusiveRewards.map((reward: string, idx: number) => (
            <Text key={idx} style={[styles.rewardItem, { color: themeColors.text }]}>
              ✓ {reward}
            </Text>
          ))}
          <Button label="Upgrade Season Pass" onPress={() => router.push('/economy/store')} style={styles.upgradeBtn} />
        </View>
      )}

      {/* Season leaderboard preview */}
      <View style={styles.leaderboardSection}>
        <View style={styles.leaderboardHeader}>
          <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
            Season Leaderboard
          </Text>
          <Pressable onPress={() => router.push('/leaderboards')} style={styles.seeAllBtn}>
            <Text style={styles.seeAllText}>See all →</Text>
          </Pressable>
        </View>
        {leaderboardPreview.length === 0 ? (
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            No entries yet.
          </Text>
        ) : (
          leaderboardPreview.slice(0, 10).map((entry: LeaderboardPreviewEntry) => (
            <LeaderRow key={entry.userId} entry={entry} />
          ))
        )}
      </View>

      {/* Season history */}
      {pastSeasons.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: themeColors.text, paddingHorizontal: 16 }]}>
            Season History
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyScroll}
          >
            {pastSeasons.map((s: PastSeason) => (
              <PastSeasonCard key={s.id} season={s} />
            ))}
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { gap: 12 },

  seasonHeader: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 8,
  },
  seasonEmoji: { fontSize: 56 },
  seasonName: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  daysRemainingBadge: {
    backgroundColor: colors.brand.blue,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  daysRemainingText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '700',
  },

  section: {
    borderRadius: 14,
    marginHorizontal: 16,
    padding: 16,
    gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' },

  passHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tierBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  tierBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  levelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  levelText: { fontSize: 12 },

  progressOuter: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  progressInner: {
    height: 10,
    borderRadius: 5,
  },
  nextLevelHint: { fontSize: 12, textAlign: 'center' },

  upgradeCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 2,
    padding: 16,
    gap: 8,
    backgroundColor: `${colors.brand.gold}0C`,
  },
  upgradeTitle: { fontSize: 17, fontWeight: '800', color: colors.brand.goldDark },
  upgradeSubtitle: { fontSize: 13 },
  rewardItem: { fontSize: 14, lineHeight: 22 },
  upgradeBtn: { marginTop: 4 },

  leaderboardSection: { marginHorizontal: 16 },
  leaderboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  seeAllBtn: { paddingVertical: 8, paddingLeft: 8, minHeight: 44, justifyContent: 'center' },
  seeAllText: { fontSize: 13, color: colors.brand.blue, fontWeight: '600' },

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 48,
  },
  leaderRank: { width: 32, fontSize: 16, textAlign: 'center' },
  leaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderAvatarEmoji: { fontSize: 20 },
  leaderName: { flex: 1, fontSize: 14, fontWeight: '600' },
  leaderScore: { fontSize: 13, fontWeight: '700' },

  emptyText: { fontSize: 14, paddingVertical: 12 },

  historyScroll: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  pastCard: {
    width: 110,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  pastEmoji: { fontSize: 28 },
  pastName: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  pastYear: { fontSize: 11 },
  pastRank: { fontSize: 12, fontWeight: '700' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonHeader: { height: 140, borderRadius: 14, backgroundColor: colors.neutral[200] },
  skeletonBar: { height: 80, borderRadius: 10, backgroundColor: colors.neutral[200] },
  skeletonCard: { height: 160, borderRadius: 14, backgroundColor: colors.neutral[200] },
  skeletonRow: { height: 48, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

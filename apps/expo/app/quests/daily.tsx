/**
 * Zobia Social — Daily Quests Screen.
 *
 * Full-screen dedicated view for daily quests with progress bars,
 * XP/coin rewards, completion status and a set bonus section.
 *
 * Route: /quests/daily
 */

import React from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quest {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  coinReward?: number;
  progress: number;
  target: number;
  completed: boolean;
}

interface DailyQuestsResponse {
  quests: Quest[];
  setBonusXp?: number;
  resetAt?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchDailyQuests(): Promise<DailyQuestsResponse> {
  const { data } = await apiClient.get<Record<string, unknown>>('/quests/daily');
  // Map API snake_case fields to the expected Quest interface
  const rawQuests = (data.quests ?? []) as Record<string, unknown>[];
  const quests: Quest[] = rawQuests.map((q) => ({
    id: String(q.id ?? ''),
    name: String(q.title ?? q.name ?? ''),
    description: String(q.description ?? ''),
    xpReward: Number(q.xp_reward ?? q.xpReward ?? 0),
    coinReward: Number(q.coin_reward ?? q.coinReward ?? 0),
    progress: Number(q.progress_count ?? q.progress ?? 0),
    target: Number(q.target_count ?? q.target ?? 1),
    completed: Boolean(q.completed ?? false),
  }));
  return {
    quests,
    setBonusXp: Number(data.bonus_xp ?? data.setBonusXp ?? 500),
    resetAt: String(data.reset_at ?? data.resetAt ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface QuestCardProps {
  quest: Quest;
  isDark: boolean;
}

function QuestCard({ quest, isDark }: QuestCardProps) {
  const progressPct = quest.target === 0 ? 1 : Math.min(quest.progress / quest.target, 1);
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const cardBorder = quest.completed
    ? colors.brand.green
    : isDark ? colors.neutral[700] : colors.neutral[200];
  const completedBg = quest.completed
    ? (isDark ? colors.brand.green + '18' : colors.brand.green + '0A')
    : cardBg;

  return (
    <View
      style={[
        styles.questCard,
        { backgroundColor: completedBg, borderColor: cardBorder },
      ]}
    >
      {/* Title row */}
      <View style={styles.questTitleRow}>
        <Text style={[styles.questName, { color: textColor }]} numberOfLines={1}>
          {quest.name}
        </Text>
        {quest.completed && (
          <View style={[styles.completedBadge, { backgroundColor: colors.brand.green + '20' }]}>
            <Text style={[styles.completedBadgeText, { color: colors.brand.green }]}>✓ Done</Text>
          </View>
        )}
      </View>

      {/* Description */}
      {quest.description ? (
        <Text style={[styles.questDesc, { color: subtitleColor }]} numberOfLines={2}>
          {quest.description}
        </Text>
      ) : null}

      {/* Progress bar */}
      <View style={styles.progressRow}>
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                flex: progressPct,
                backgroundColor: quest.completed ? colors.brand.green : colors.brand.blue,
              },
            ]}
          />
          <View style={[styles.progressEmpty, { flex: 1 - progressPct }]} />
        </View>
        <Text style={[styles.progressLabel, { color: subtitleColor }]}>
          {quest.progress}/{quest.target}
        </Text>
      </View>

      {/* Reward badges */}
      <View style={styles.rewardRow}>
        <View style={[styles.rewardBadge, { backgroundColor: colors.brand.gold + '20' }]}>
          <Text style={[styles.rewardText, { color: colors.brand.gold }]}>
            +{quest.xpReward} XP
          </Text>
        </View>
        {quest.coinReward && quest.coinReward > 0 ? (
          <View style={[styles.rewardBadge, { backgroundColor: colors.brand.blue + '15' }]}>
            <Text style={[styles.rewardText, { color: colors.brand.blue }]}>
              🪙 {quest.coinReward}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const bg = isDark ? colors.neutral[700] : colors.neutral[200];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];
  return (
    <View style={[styles.questCard, { backgroundColor: cardBg, borderColor }]}>
      <View style={[styles.skeletonLine, { width: '55%', backgroundColor: bg }]} />
      <View style={[styles.skeletonLine, { width: '80%', backgroundColor: bg, height: 10 }]} />
      <View style={[styles.skeletonLine, { width: '100%', height: 6, backgroundColor: bg, borderRadius: 3 }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * DailyQuestsScreen — dedicated full-screen view of today's quests.
 */
export default function DailyQuestsScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['quests', 'daily'],
    queryFn: fetchDailyQuests,
    staleTime: 60_000,
  });

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  const quests = data?.quests ?? [];
  const setBonusXp = data?.setBonusXp ?? 500;
  const allCompleted = quests.length > 0 && quests.every((q: Quest) => q.completed);
  const completedCount = quests.filter((q: Quest) => q.completed).length;

  const renderHeader = () => (
    <View>
      {/* Back + Title */}
      <View style={styles.pageHeader}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backText, { color: colors.brand.blue }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.pageTitle, { color: textColor }]}>Daily Quests</Text>
        <Text style={[styles.pageSubtitle, { color: subtitleColor }]}>
          Resets at midnight
        </Text>
      </View>

      {/* Set Bonus Banner */}
      <View
        style={[
          styles.setBonusBanner,
          {
            backgroundColor: allCompleted
              ? colors.brand.green + '20'
              : isDark ? colors.neutral[800] : colors.neutral[100],
            borderColor: allCompleted ? colors.brand.green : isDark ? colors.neutral[700] : colors.neutral[200],
          },
        ]}
      >
        <Text style={[styles.setBonusTitle, { color: textColor }]}>
          {allCompleted ? '🎉 Quest Set Complete!' : `Complete All Quests — Bonus Reward`}
        </Text>
        <View style={[styles.setBonusXpBadge, { backgroundColor: colors.brand.gold + '20' }]}>
          <Text style={[styles.setBonusXpText, { color: colors.brand.gold }]}>
            +{setBonusXp} XP
          </Text>
        </View>
        {!isLoading && quests.length > 0 && (
          <Text style={[styles.setBonusProgress, { color: subtitleColor }]}>
            {completedCount}/{quests.length} completed
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <Screen scrollable={false} disableBottomInset>
      <FlatList<Quest | number>
        data={isLoading ? [0, 1, 2] : isError ? [] : quests}
        keyExtractor={(item, idx) =>
          isLoading ? String(idx) : (item as Quest).id
        }
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['quests', 'daily'] })}
            tintColor={colors.brand.blue}
          />
        }
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) =>
          isLoading ? (
            <SkeletonCard isDark={isDark} />
          ) : (
            <QuestCard quest={item as Quest} isDark={isDark} />
          )
        }
        ListEmptyComponent={
          isError ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: colors.semantic.error }]}>
                Could not load quests.
              </Text>
              <Button
                label="Retry"
                size="sm"
                variant="secondary"
                onPress={() => void refetch()}
                accessibilityLabel="Retry loading daily quests"
              />
            </View>
          ) : !isLoading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎯</Text>
              <Text style={[styles.emptyText, { color: subtitleColor }]}>
                No quests available today. Check back tomorrow!
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 40,
  },
  pageHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 4,
  },
  backBtn: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },

  setBonusBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    alignItems: 'flex-start',
  },
  setBonusTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  setBonusXpBadge: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  setBonusXpText: {
    fontSize: 15,
    fontWeight: '800',
  },
  setBonusProgress: {
    fontSize: 12,
    marginTop: 2,
  },

  questCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  questTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  questName: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  completedBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  questDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 3,
  },
  progressEmpty: {
    backgroundColor: 'transparent',
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'right',
  },
  rewardRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  rewardBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rewardText: {
    fontSize: 12,
    fontWeight: '700',
  },

  skeletonLine: {
    height: 14,
    borderRadius: 7,
    marginBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
  },
});

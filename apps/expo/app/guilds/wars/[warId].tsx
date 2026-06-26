/**
 * app/guilds/wars/[warId].tsx
 *
 * Live guild war screen.
 *
 * Features:
 *  - Both guilds with points and crest emojis
 *  - Live score updates (poll every 10 seconds)
 *  - Countdown timer to end / "Final Hour" indicator
 *  - Member contribution leaderboard
 *  - "Contribute" button linking back to activity
 */

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuildSide {
  guildId: string;
  name: string;
  crestEmoji: string;
  score: number;
}

interface Contributor {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  contributionPoints: number;
  guildId: string;
}

type WarStatus = 'active' | 'final_hour' | 'ended';

interface War {
  id: string;
  guild1: GuildSide;
  guild2: GuildSide;
  endsAt: string;
  status: WarStatus;
  contributors: Contributor[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchWar(warId: string): Promise<War> {
  const { data } = await apiClient.get(`/guilds/wars/${warId}`);
  return data.war;
}

// ---------------------------------------------------------------------------
// Countdown hook
// ---------------------------------------------------------------------------

function useCountdown(endsAt: string) {
  const [display, setDisplay] = useState('');
  const [isFinalHour, setIsFinalHour] = useState(false);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) {
        setDisplay('Ended');
        setIsFinalHour(false);
        clearInterval(id);
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
      setIsFinalHour(diff <= 3_600_000);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  return { display, isFinalHour };
}

// ---------------------------------------------------------------------------
// Score comparison bar
// ---------------------------------------------------------------------------

interface ScoreBarProps {
  guild1Score: number;
  guild2Score: number;
}

function ScoreBar({ guild1Score, guild2Score }: ScoreBarProps) {
  const total = guild1Score + guild2Score;
  const ratio = total === 0 ? 0.5 : guild1Score / total;

  return (
    <View style={styles.scoreBarOuter}>
      <View style={[styles.scoreBarLeft, { flex: ratio }]} />
      <View style={[styles.scoreBarRight, { flex: 1 - ratio }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function WarSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonScoreboard} />
      <View style={styles.skeletonTimer} />
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * LiveWarScreen — real-time guild war tracker with score, timer, and contributors.
 */
export default function LiveWarScreen() {
  const { warId } = useLocalSearchParams<{ warId: string }>();
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const { data: war, isLoading, isError } = useQuery({
    queryKey: ['war', warId],
    queryFn: () => fetchWar(warId!),
    enabled: !!warId,
    refetchInterval: war?.status === 'ended' ? false : 10_000,
  });

  const { display: countdown, isFinalHour } = useCountdown(war?.endsAt ?? new Date(Date.now() + 3_600_000).toISOString());

  const renderContributor = ({ item, index }: { item: Contributor; index: number }) => {
    const isGuild1 = item.guildId === war?.guild1.guildId;
    return (
      <View style={[styles.contributorRow, { borderBottomColor: themeColors.border }]}>
        <Text style={[styles.contributorRank, { color: themeColors.textMuted }]}>
          #{index + 1}
        </Text>
        <View
          style={[
            styles.contributorAvatar,
            { borderColor: isGuild1 ? colors.brand.blue : colors.semantic.error },
          ]}
        >
          <Text style={styles.contributorAvatarEmoji}>{item.avatarEmoji}</Text>
        </View>
        <Text style={[styles.contributorName, { color: themeColors.text }]} numberOfLines={1}>
          {item.displayName}
        </Text>
        <Text style={[styles.contributorPoints, { color: themeColors.text }]}>
          {item.contributionPoints.toLocaleString()} pts
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <Screen>
        <WarSkeleton />
      </Screen>
    );
  }

  if (isError || !war) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load war data. Check your connection.
          </Text>
        </View>
      </Screen>
    );
  }

  const isTied = war.guild1.score === war.guild2.score;
  const guild1Winning = !isTied && war.guild1.score > war.guild2.score;

  return (
    <Screen disableBottomInset>
      <FlatList
        data={war.contributors}
        keyExtractor={(c) => c.userId}
        renderItem={renderContributor}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View>
            {/* Final hour banner */}
            {isFinalHour && war.status === 'active' && (
              <View style={styles.finalHourBanner}>
                <Text style={styles.finalHourText}>🔥 FINAL HOUR — Push hard!</Text>
              </View>
            )}

            {/* Scoreboard */}
            <View style={[styles.scoreboard, { backgroundColor: themeColors.surface }]}>
              {/* Guild 1 */}
              <View style={styles.guildSide}>
                <Text style={styles.guildCrest}>{war.guild1.crestEmoji}</Text>
                <Text style={[styles.guildName, { color: themeColors.text }]} numberOfLines={1}>
                  {war.guild1.name}
                </Text>
                <Text
                  style={[
                    styles.guildScore,
                    { color: isTied ? themeColors.text : (guild1Winning ? colors.semantic.success : themeColors.text) },
                  ]}
                >
                  {war.guild1.score.toLocaleString()}
                </Text>
              </View>

              {/* VS */}
              <View style={styles.vsColumn}>
                <Text style={[styles.vsText, { color: themeColors.textMuted }]}>VS</Text>
              </View>

              {/* Guild 2 */}
              <View style={[styles.guildSide, styles.guildSideRight]}>
                <Text style={styles.guildCrest}>{war.guild2.crestEmoji}</Text>
                <Text style={[styles.guildName, { color: themeColors.text }]} numberOfLines={1}>
                  {war.guild2.name}
                </Text>
                <Text
                  style={[
                    styles.guildScore,
                    { color: isTied ? themeColors.text : (!guild1Winning ? colors.semantic.success : themeColors.text) },
                  ]}
                >
                  {war.guild2.score.toLocaleString()}
                </Text>
              </View>
            </View>

            {/* Score bar */}
            <ScoreBar guild1Score={war.guild1.score} guild2Score={war.guild2.score} />

            {/* Timer */}
            <View style={[styles.timerRow, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.timerLabel, { color: themeColors.textMuted }]}>
                {war.status === 'ended' ? 'War ended' : 'Ends in'}
              </Text>
              <Text
                style={[
                  styles.timerValue,
                  { color: isFinalHour ? colors.semantic.error : themeColors.text },
                ]}
              >
                {countdown}
              </Text>
            </View>

            {/* Contribute button */}
            {war.status !== 'ended' && (
              <View style={styles.contributeSection}>
                <Button
                  label="Contribute to the War"
                  onPress={() => router.push('/(tabs)/rooms')}
                />
                <Text style={[styles.contributeHint, { color: themeColors.textMuted }]}>
                  Earn points by being active in rooms and chats
                </Text>
              </View>
            )}

            <Text style={[styles.contributorsHeading, { color: themeColors.text }]}>
              Top Contributors
            </Text>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyContrib}>
            <Text style={[styles.emptyContribText, { color: themeColors.textMuted }]}>
              No contributions yet. Be the first to fight for your guild!
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  finalHourBanner: {
    backgroundColor: colors.semantic.error,
    paddingVertical: 10,
    alignItems: 'center',
  },
  finalHourText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  scoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  guildSide: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  guildSideRight: { alignItems: 'center' },
  guildCrest: { fontSize: 44 },
  guildName: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  guildScore: { fontSize: 28, fontWeight: '900' },

  vsColumn: { width: 40, alignItems: 'center' },
  vsText: { fontSize: 16, fontWeight: '800' },

  scoreBarOuter: {
    flexDirection: 'row',
    height: 8,
    marginHorizontal: 0,
  },
  scoreBarLeft: {
    backgroundColor: colors.brand.blue,
  },
  scoreBarRight: {
    backgroundColor: colors.semantic.error,
  },

  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  timerLabel: { fontSize: 13, fontWeight: '500' },
  timerValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },

  contributeSection: {
    padding: 16,
    gap: 8,
  },
  contributeHint: { fontSize: 12, textAlign: 'center' },

  contributorsHeading: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  contributorRank: { width: 28, fontSize: 13, fontWeight: '600' },
  contributorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  contributorAvatarEmoji: { fontSize: 20 },
  contributorName: { flex: 1, fontSize: 14, fontWeight: '500' },
  contributorPoints: { fontSize: 13, fontWeight: '700' },

  emptyContrib: { padding: 32, alignItems: 'center' },
  emptyContribText: { fontSize: 14, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonScoreboard: { height: 120, borderRadius: 14, backgroundColor: colors.neutral[200] },
  skeletonTimer: { height: 44, borderRadius: 10, backgroundColor: colors.neutral[200] },
  skeletonRow: { height: 56, borderRadius: 10, backgroundColor: colors.neutral[200] },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

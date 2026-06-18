/**
 * app/nemesis/index.tsx
 *
 * Nemesis screen.
 *
 * Features:
 *  - Side-by-side: user avatar vs nemesis avatar
 *  - XP comparison bar
 *  - "You're X XP ahead/behind" text
 *  - Recent activity list of both users
 *  - Challenge button (opens 7-day sprint)
 *  - Dismiss button
 */

import React from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AxiosError } from 'axios';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityItem {
  id: string;
  userId: string;
  description: string;
  xpEarned: number;
  createdAt: string;
}

interface NemesisData {
  me: {
    userId: string;
    displayName: string;
    avatarEmoji: string;
    xp: number;
    competitorLevel: number;
  };
  nemesis: {
    userId: string;
    displayName: string;
    avatarEmoji: string;
    xp: number;
  };
  recentActivity: ActivityItem[];
  sprintActive: boolean;
  sprintEndsAt: string | null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchNemesis(): Promise<NemesisData> {
  const { data } = await apiClient.get('/nemesis');
  return data;
}

async function challengeNemesis(): Promise<void> {
  await apiClient.post('/nemesis/challenge');
}

async function dismissNemesis(): Promise<void> {
  await apiClient.post('/nemesis/dismiss');
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NemesisSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonVs} />
      <View style={styles.skeletonBar} />
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// XP bar
// ---------------------------------------------------------------------------

interface XPBarProps {
  myXP: number;
  nemesisXP: number;
}

function XPBar({ myXP, nemesisXP }: XPBarProps) {
  const total = myXP + nemesisXP;
  const myRatio = total === 0 ? 0.5 : myXP / total;

  return (
    <View style={styles.xpBarOuter}>
      <View style={[styles.xpBarMe, { flex: myRatio }]} />
      <View style={[styles.xpBarNemesis, { flex: 1 - myRatio }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Activity row
// ---------------------------------------------------------------------------

function ActivityRow({ item, myUserId }: { item: ActivityItem; myUserId: string }) {
  const { colors: themeColors } = useTheme();
  const isMe = item.userId === myUserId;
  return (
    <View style={[styles.activityRow, { borderBottomColor: themeColors.border }]}>
      <View
        style={[
          styles.activityDot,
          { backgroundColor: isMe ? colors.brand.blue : colors.semantic.error },
        ]}
      />
      <Text style={[styles.activityDesc, { color: themeColors.text }]} numberOfLines={2}>
        {item.description}
      </Text>
      <Text style={[styles.activityXP, { color: isMe ? colors.brand.blue : colors.semantic.error }]}>
        +{item.xpEarned} XP
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * NemesisScreen — XP rivalry tracker with challenge and dismiss actions.
 */
export default function NemesisScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nemesis'],
    queryFn: fetchNemesis,
  });

  const challengeMutation = useMutation({
    mutationFn: challengeNemesis,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nemesis'] });
      Alert.alert('Challenge Sent!', '7-day XP sprint has started. Beat your nemesis!');
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string; params?: Record<string, unknown> } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? (err as Error).message;
      const params = axiosErr.response?.data?.error?.params ?? {};
      if (code === 'LEVEL_GATE') {
        Alert.alert('Level Required', translateApiError(t, code, message, params));
      } else if (code === 'CHALLENGE_ALREADY_ACTIVE') {
        Alert.alert('Already Challenged', 'You already have a pending 7-day sprint with your nemesis.');
      } else {
        Alert.alert('Challenge Failed', message);
      }
    },
  });

  const dismissMutation = useMutation({
    mutationFn: dismissNemesis,
    onSuccess: () => {
      router.back();
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const message = axiosErr.response?.data?.error?.message ?? (err as Error).message;
      Alert.alert('Dismiss Failed', message);
    },
  });

  if (isLoading) return <Screen><NemesisSkeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            No nemesis found. Keep earning XP and one will appear!
          </Text>
        </View>
      </Screen>
    );
  }

  const xpDiff = Math.abs(data.me.xp - data.nemesis.xp);
  const iAhead = data.me.xp >= data.nemesis.xp;

  return (
    <Screen>
      <FlatList
        data={data.recentActivity}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <ActivityRow item={item} myUserId={data.me.userId} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View>
            {/* VS panel */}
            <View style={[styles.vsPanel, { backgroundColor: themeColors.surface }]}>
              {/* Me */}
              <View style={styles.playerSide}>
                <View style={[styles.avatarCircle, { borderColor: colors.brand.blue }]}>
                  <Text style={styles.avatarEmoji}>{data.me.avatarEmoji}</Text>
                </View>
                <Text style={[styles.playerName, { color: themeColors.text }]} numberOfLines={1}>
                  {data.me.displayName}
                </Text>
                <Text style={[styles.playerXP, { color: colors.brand.blue }]}>
                  {data.me.xp.toLocaleString()} XP
                </Text>
              </View>

              <View style={styles.vsCenter}>
                <Text style={[styles.vsText, { color: themeColors.textMuted }]}>VS</Text>
              </View>

              {/* Nemesis */}
              <View style={[styles.playerSide, styles.playerSideRight]}>
                <View style={[styles.avatarCircle, { borderColor: colors.semantic.error }]}>
                  <Text style={styles.avatarEmoji}>{data.nemesis.avatarEmoji}</Text>
                </View>
                <Text style={[styles.playerName, { color: themeColors.text }]} numberOfLines={1}>
                  {data.nemesis.displayName}
                </Text>
                <Text style={[styles.playerXP, { color: colors.semantic.error }]}>
                  {data.nemesis.xp.toLocaleString()} XP
                </Text>
              </View>
            </View>

            {/* XP bar */}
            <XPBar myXP={data.me.xp} nemesisXP={data.nemesis.xp} />

            {/* Delta text */}
            <View style={styles.deltaRow}>
              <Text
                style={[
                  styles.deltaText,
                  { color: iAhead ? colors.semantic.success : colors.semantic.error },
                ]}
              >
                {iAhead
                  ? `You're ${xpDiff.toLocaleString()} XP ahead`
                  : `They're ${xpDiff.toLocaleString()} XP ahead`}
              </Text>
            </View>

            {/* Sprint indicator */}
            {data.sprintActive && (
              <View style={styles.sprintBanner}>
                <Text style={styles.sprintBannerText}>⚡ 7-Day Sprint Active!</Text>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {!data.sprintActive && (
                <Button
                  label={
                    data.me.competitorLevel < 40
                      ? `Challenge — Level ${data.me.competitorLevel}/40 Required`
                      : 'Challenge — 7-Day Sprint'
                  }
                  onPress={() => {
                    if (data.me.competitorLevel < 40) {
                      Alert.alert(
                        'Level Required',
                        `You need Competitor Track Level 40 to challenge. You're at Level ${data.me.competitorLevel}.`
                      );
                      return;
                    }
                    challengeMutation.mutate();
                  }}
                  loading={challengeMutation.isPending}
                />
              )}
              <Button
                label="Dismiss Nemesis"
                variant="ghost"
                onPress={() =>
                  Alert.alert('Dismiss Nemesis?', 'A new nemesis will be assigned automatically.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Dismiss', style: 'destructive', onPress: () => dismissMutation.mutate() },
                  ])
                }
                loading={dismissMutation.isPending}
              />
            </View>

            <Text style={[styles.activityHeading, { color: themeColors.text }]}>
              Recent Activity
            </Text>
            {/* Legend */}
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.activityDot, { backgroundColor: colors.brand.blue }]} />
                <Text style={[styles.legendText, { color: themeColors.textMuted }]}>
                  {data.me.displayName}
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.activityDot, { backgroundColor: colors.semantic.error }]} />
                <Text style={[styles.legendText, { color: themeColors.textMuted }]}>
                  {data.nemesis.displayName}
                </Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              No recent activity to show.
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
  vsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  playerSide: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  playerSideRight: { alignItems: 'center' },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  avatarEmoji: { fontSize: 40 },
  playerName: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  playerXP: { fontSize: 16, fontWeight: '900' },

  vsCenter: { width: 40, alignItems: 'center' },
  vsText: { fontSize: 18, fontWeight: '800' },

  xpBarOuter: {
    flexDirection: 'row',
    height: 10,
  },
  xpBarMe: { backgroundColor: colors.brand.blue },
  xpBarNemesis: { backgroundColor: colors.semantic.error },

  deltaRow: { paddingVertical: 12, alignItems: 'center' },
  deltaText: { fontSize: 16, fontWeight: '700' },

  sprintBanner: {
    backgroundColor: colors.semantic.warning,
    paddingVertical: 8,
    alignItems: 'center',
    marginBottom: 4,
  },
  sprintBannerText: { color: colors.neutral[0], fontSize: 14, fontWeight: '700' },

  actions: { padding: 16, gap: 10 },

  activityHeading: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },

  legend: { flexDirection: 'row', paddingHorizontal: 16, gap: 16, paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12 },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 44,
  },
  activityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  activityDesc: { flex: 1, fontSize: 14 },
  activityXP: { fontSize: 13, fontWeight: '700' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonVs: { height: 140, borderRadius: 14, backgroundColor: colors.neutral[200] },
  skeletonBar: { height: 10, borderRadius: 5, backgroundColor: colors.neutral[200] },
  skeletonRow: { height: 52, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

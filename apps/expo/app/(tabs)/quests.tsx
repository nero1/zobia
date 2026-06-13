/**
 * app/(tabs)/quests.tsx
 *
 * Quests tab — shows daily quests and new member quest progress.
 * Navigates to detailed quest screens for more actions.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/lib/theme/colors';
import { useAuth } from '@/lib/auth/hooks';
import { apiClient } from '@/lib/api/client';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '@/lib/hooks/useCurrency';

interface DailyQuest {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  progress: number;
  goal: number;
  completed: boolean;
}

interface MemberQuestStep {
  id: string;
  label: string;
  completed: boolean;
}

interface MemberQuestData {
  steps: MemberQuestStep[];
  allComplete: boolean;
  rewardClaimed: boolean;
}

export default function QuestsTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const router = useRouter();
  const { token } = useAuth();
  const currency = useCurrency();
  const { t } = useTranslation();

  const [dailyQuests, setDailyQuests] = useState<DailyQuest[]>([]);
  const [memberQuest, setMemberQuest] = useState<MemberQuestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const bg = isDark ? colors.neutral[950] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const border = isDark ? colors.neutral[800] : colors.neutral[200];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];
  const textSecondary = isDark ? colors.neutral[400] : colors.neutral[500];

  const load = useCallback(async () => {
    try {
      const [dailyRes, memberRes] = await Promise.all([
        apiClient.get('/quests/daily'),
        apiClient.get('/quests/new-member'),
      ]);
      setDailyQuests(dailyRes.data?.quests ?? dailyRes.quests ?? []);
      const md = memberRes.data ?? memberRes;
      if (md && !md.allComplete && !md.rewardClaimed) {
        setMemberQuest(md);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  const completedCount = dailyQuests.filter((q) => q.completed).length;
  const totalCount = dailyQuests.length;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color={colors.brand.blue} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: bg }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[styles.heading, { color: textPrimary }]}>{t('nav.quests')}</Text>

      {/* New Member Quest */}
      {memberQuest && (
        <Pressable
          onPress={() => router.push('/quests/new-member' as never)}
          style={[styles.card, { backgroundColor: cardBg, borderColor: '#8b5cf6' }]}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardIcon}>🎯</Text>
            <Text style={[styles.cardTitle, { color: textPrimary }]}>{t('newMemberQuest.title')}</Text>
            <Text style={[styles.badge, { backgroundColor: '#ede9fe', color: '#7c3aed' }]}>
              {memberQuest.steps.filter((s) => s.completed).length}/{memberQuest.steps.length}
            </Text>
          </View>
          <Text style={[styles.cardSubtext, { color: textSecondary }]}>
            {t('home.memberQuest.reward', { coins: '1,000', xp: '2,000' })}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.round((memberQuest.steps.filter((s) => s.completed).length / Math.max(1, memberQuest.steps.length)) * 100)}%` as unknown as number,
                  backgroundColor: '#8b5cf6',
                },
              ]}
            />
          </View>
        </Pressable>
      )}

      {/* Daily Quests */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardIcon}>📋</Text>
          <Text style={[styles.cardTitle, { color: textPrimary }]}>{t('quests.title')}</Text>
          <Text style={[styles.badge, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: textSecondary }]}>
            {completedCount}/{totalCount}
          </Text>
        </View>

        {dailyQuests.length === 0 ? (
          <Text style={[styles.emptyText, { color: textSecondary }]}>{t('quests.noQuestsToday')}</Text>
        ) : (
          dailyQuests.map((quest) => {
            const pct = quest.goal > 0 ? Math.min(100, Math.round((quest.progress / quest.goal) * 100)) : 0;
            return (
              <View
                key={quest.id}
                style={[styles.questRow, { borderTopColor: border }]}
              >
                <View style={[styles.checkbox, {
                  borderColor: quest.completed ? '#14b8a6' : border,
                  backgroundColor: quest.completed ? '#14b8a6' : 'transparent',
                }]}>
                  {quest.completed && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={styles.questContent}>
                  <Text style={[styles.questTitle, {
                    color: quest.completed ? textSecondary : textPrimary,
                    textDecorationLine: quest.completed ? 'line-through' : 'none',
                  }]}>
                    {quest.title}
                  </Text>
                  {quest.description ? (
                    <Text style={[styles.questDesc, { color: textSecondary }]}>{quest.description}</Text>
                  ) : null}
                  {!quest.completed && quest.goal > 1 && (
                    <View style={styles.miniProgress}>
                      <View style={[styles.miniProgressFill, { width: `${pct}%` as unknown as number }]} />
                    </View>
                  )}
                </View>
                <View style={[styles.xpBadge, { backgroundColor: isDark ? '#78350f' : '#fef3c7' }]}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: isDark ? '#fcd34d' : '#92400e' }}>
                    +{quest.xpReward} XP
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Pressable
        onPress={() => router.push('/quests/daily' as never)}
        style={[styles.link, { borderColor: border }]}
      >
        <Text style={{ color: colors.brand.blue, fontSize: 14, fontWeight: '600' }}>
          {t('quests.viewAll')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 100 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardIcon: { fontSize: 18 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  badge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  cardSubtext: { fontSize: 13, marginBottom: 8 },
  progressBar: { height: 6, borderRadius: 99, backgroundColor: '#e5e7eb', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 99 },
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  questRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  questContent: { flex: 1, gap: 3 },
  questTitle: { fontSize: 14, fontWeight: '600' },
  questDesc: { fontSize: 12 },
  miniProgress: { height: 4, borderRadius: 99, backgroundColor: '#e5e7eb', overflow: 'hidden', marginTop: 4 },
  miniProgressFill: { height: '100%', borderRadius: 99, backgroundColor: '#3b82f6' },
  xpBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  link: { borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', marginTop: 4 },
});

/**
 * app/quests/new-member.tsx
 *
 * New Member Quest screen.
 *
 * Shows the 5-step guided onboarding mission to new users:
 *  1. Send a message
 *  2. Join a Room
 *  3. Gift someone
 *  4. Add a friend
 *  5. Complete a daily login
 *
 * Payout on completion: 1,000 Coins + 2,000 XP
 *
 * PRD §4 — "First Contact (guided)": A 5-step guided mission designed to be
 * completable within the first session.
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestStep {
  id: string;
  label: string;
  completed: boolean;
  /** Deep-link route to perform this action */
  route?: string;
}

interface QuestProgress {
  step: number;
  steps: QuestStep[];
  allComplete: boolean;
  rewardClaimed: boolean;
}

// ---------------------------------------------------------------------------
// Step action routes (navigate user to the relevant feature)
// ---------------------------------------------------------------------------

const STEP_ROUTES: Record<string, string> = {
  send_message: '/messages/new',
  join_room:    '/rooms',
  gift_someone: '/economy/gift-send',
  add_friend:   '/messages/new',
  daily_login:  '/home',
};

const STEP_ICONS: Record<string, string> = {
  send_message: '💬',
  join_room:    '🏠',
  gift_someone: '🎁',
  add_friend:   '🤝',
  daily_login:  '📅',
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchQuestProgress(): Promise<QuestProgress> {
  const { data } = await apiClient.get('/quests/new-member');
  return data.data ?? data;
}

async function claimReward(): Promise<{ coinsGranted: number; xpGranted: number }> {
  const { data } = await apiClient.post('/quests/new-member');
  return data.data ?? data;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: QuestStep;
  isCurrent: boolean;
  onPress: () => void;
}

function StepRow({ step, isCurrent, onPress }: StepRowProps) {
  const { colors: themeColors } = useTheme();

  const icon = STEP_ICONS[step.id] ?? '⭐';
  const bg = step.completed
    ? `${colors.semantic.success}18`
    : isCurrent
    ? `${colors.brand.blue}12`
    : themeColors.surface;

  const borderColor = step.completed
    ? colors.semantic.success
    : isCurrent
    ? colors.brand.blue
    : themeColors.border;

  return (
    <TouchableOpacity
      style={[styles.stepRow, { backgroundColor: bg, borderColor }]}
      onPress={onPress}
      disabled={step.completed}
      accessibilityRole="button"
      accessibilityLabel={`${step.label}${step.completed ? ', completed' : isCurrent ? ', current step' : ''}`}
      activeOpacity={0.7}
    >
      <View style={styles.stepIconContainer}>
        {step.completed ? (
          <Text style={styles.checkIcon}>✓</Text>
        ) : (
          <Text style={styles.stepIcon}>{icon}</Text>
        )}
      </View>

      <View style={styles.stepTextContainer}>
        <Text
          style={[
            styles.stepLabel,
            { color: step.completed ? colors.semantic.success : themeColors.text },
          ]}
          numberOfLines={1}
        >
          {step.label}
        </Text>
        {isCurrent && !step.completed && (
          <Text style={[styles.stepCta, { color: colors.brand.blue }]}>
            Tap to do this now →
          </Text>
        )}
      </View>

      {step.completed && (
        <View style={[styles.completedBadge, { backgroundColor: colors.semantic.success }]}>
          <Text style={styles.completedBadgeText}>Done</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  return (
    <View style={styles.progressOuter}>
      <View style={[styles.progressInner, { width: `${pct}%` }]} />
    </View>
  );
}

function RewardClaimedBanner({ coins, xp }: { coins: number; xp: number }) {
  const currency = useCurrency();
  return (
    <View style={[styles.rewardBanner, { backgroundColor: `${colors.semantic.success}15` }]}>
      <Text style={styles.rewardBannerEmoji}>🎉</Text>
      <Text style={[styles.rewardBannerTitle, { color: colors.semantic.success }]}>
        Reward claimed!
      </Text>
      <Text style={styles.rewardBannerBody}>
        +{coins.toLocaleString()} {currency.softPlural} · +{xp.toLocaleString()} XP
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function NewMemberQuestScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const { t } = useTranslation();
  const [justClaimed, setJustClaimed] = React.useState<{
    coins: number;
    xp: number;
  } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['new-member-quest'],
    queryFn: fetchQuestProgress,
    refetchInterval: 10_000, // poll every 10 s so step completions reflect quickly
  });

  const claimMutation = useMutation({
    mutationFn: claimReward,
    onSuccess: (result) => {
      setJustClaimed({ coins: result.coinsGranted, xp: result.xpGranted });
      queryClient.invalidateQueries({ queryKey: ['new-member-quest'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (err: Error) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message ?? 'Could not claim reward. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.brand.blue} size="large" />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.centerState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load quest. Check your connection.
          </Text>
          <TouchableOpacity
            onPress={() => queryClient.invalidateQueries({ queryKey: ['new-member-quest'] })}
            style={styles.retryBtn}
          >
            <Text style={[styles.retryBtnText, { color: colors.brand.blue }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const completedCount = data.steps.filter((s: QuestStep) => s.completed).length;
  const totalCount = data.steps.length;

  const handleStepPress = (step: QuestStep) => {
    if (step.completed) return;
    const route = STEP_ROUTES[step.id];
    if (route) {
      router.push(route as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <Screen scrollable>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: themeColors.surface }]}>
        <Text style={styles.headerEmoji}>⭐</Text>
        <Text style={[styles.headerTitle, { color: themeColors.text }]}>
          New Member Quest
        </Text>
        <Text style={[styles.headerSubtitle, { color: themeColors.textMuted }]}>
          Complete 5 steps and earn your welcome rewards
        </Text>

        {/* Progress */}
        <View style={styles.progressSection}>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressLabel, { color: themeColors.textMuted }]}>
              Progress
            </Text>
            <Text style={[styles.progressCount, { color: themeColors.text }]}>
              {completedCount} / {totalCount}
            </Text>
          </View>
          <ProgressBar completed={completedCount} total={totalCount} />
        </View>
      </View>

      {/* Reward already claimed */}
      {data.rewardClaimed && justClaimed && (
        <RewardClaimedBanner coins={justClaimed.coins} xp={justClaimed.xp} />
      )}

      {/* Reward preview */}
      <View style={[styles.rewardPreview, { borderColor: themeColors.border }]}>
        <View style={styles.rewardItem}>
          <Text style={styles.rewardEmoji}>🪙</Text>
          <Text style={[styles.rewardAmount, { color: themeColors.text }]}>1,000</Text>
          <Text style={[styles.rewardLabel, { color: themeColors.textMuted }]}>{currency.softPlural}</Text>
        </View>
        <View style={[styles.rewardDivider, { backgroundColor: themeColors.border }]} />
        <View style={styles.rewardItem}>
          <Text style={styles.rewardEmoji}>⚡</Text>
          <Text style={[styles.rewardAmount, { color: themeColors.text }]}>2,000</Text>
          <Text style={[styles.rewardLabel, { color: themeColors.textMuted }]}>XP</Text>
        </View>
      </View>

      {/* Steps */}
      <View style={styles.stepsSection}>
        <Text style={[styles.stepsSectionTitle, { color: themeColors.textMuted }]}>
          STEPS TO COMPLETE
        </Text>
        {data.steps.map((step: QuestStep, index: number) => (
          <StepRow
            key={step.id}
            step={step}
            isCurrent={!step.completed && index + 1 === data.step}
            onPress={() => handleStepPress(step)}
          />
        ))}
      </View>

      {/* Claim button */}
      {data.allComplete && !data.rewardClaimed && (
        <View style={styles.claimSection}>
          <Button
            label={claimMutation.isPending ? 'Claiming…' : 'Claim Your Reward!'}
            onPress={() => claimMutation.mutate()}
            disabled={claimMutation.isPending}
            variant="primary"
          />
        </View>
      )}

      {/* Already claimed */}
      {data.rewardClaimed && !justClaimed && (
        <View style={styles.claimedSection}>
          <Text style={[styles.claimedText, { color: colors.semantic.success }]}>
            ✓ Reward already claimed. Welcome to Zobia!
          </Text>
          <TouchableOpacity
            style={styles.goHomeBtn}
            onPress={() => router.push('/home' as Parameters<typeof router.push>[0])}
            accessibilityRole="button"
            accessibilityLabel="Go to home"
          >
            <Text style={[styles.goHomeBtnText, { color: colors.brand.blue }]}>
              Explore Zobia →
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.bottomPad} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 6,
  },
  headerEmoji:    { fontSize: 48 },
  headerTitle:    { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  headerSubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 2 },

  progressSection: { width: '100%', marginTop: 16, gap: 6 },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  progressCount: { fontSize: 12, fontWeight: '700' },
  progressOuter: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  progressInner: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.blue,
  },

  rewardPreview: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  rewardItem: { flex: 1, alignItems: 'center', gap: 4 },
  rewardEmoji: { fontSize: 28 },
  rewardAmount: { fontSize: 20, fontWeight: '800' },
  rewardLabel: { fontSize: 12 },
  rewardDivider: { width: 1, marginHorizontal: 8 },

  rewardBanner: {
    margin: 16,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  rewardBannerEmoji: { fontSize: 32 },
  rewardBannerTitle: { fontSize: 18, fontWeight: '800' },
  rewardBannerBody:  { fontSize: 14, color: colors.neutral[600] },

  stepsSection: { padding: 16, gap: 10 },
  stepsSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
    minHeight: 56,
  },
  stepIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIcon:  { fontSize: 20 },
  checkIcon: { fontSize: 18, color: colors.semantic.success, fontWeight: '800' },
  stepTextContainer: { flex: 1, gap: 2 },
  stepLabel: { fontSize: 15, fontWeight: '600' },
  stepCta:   { fontSize: 12, fontWeight: '500' },
  completedBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  completedBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  claimSection:  { margin: 16 },
  claimedSection: { padding: 16, alignItems: 'center', gap: 12 },
  claimedText:   { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  goHomeBtn:     {},
  goHomeBtnText: { fontSize: 15, fontWeight: '600' },

  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText:   { fontSize: 15, textAlign: 'center', marginBottom: 12 },
  retryBtn:    { padding: 8 },
  retryBtnText: { fontSize: 15, fontWeight: '600' },

  bottomPad: { height: 40 },
});

/**
 * Zobia Social — Creator Dashboard Screen.
 *
 * Displays revenue summaries, member stats, top gifters,
 * payout history, and a "Request Payout" action.
 *
 * Route: /creator/dashboard
 */

import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { translateApiError } from '@/lib/i18n/apiErrors';
import { koboToNairaStr } from '@/lib/utils/currency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevenueBreakdown {
  subscriptions: number;
  gifts: number;
  broadcasts: number;
  quests: number;
  classrooms: number;
}

interface MemberStats {
  total: number;
  activeThisWeek: number;
  churnRate: number;
}

interface TopGifter {
  userId: string;
  username: string;
  avatarEmoji: string;
  totalGiftedCoins: number;
}

interface Payout {
  id: string;
  amount: number;
  createdAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface CreatorDashboardData {
  revenue: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    allTime: number;
  };
  breakdown: RevenueBreakdown;
  memberStats: MemberStats;
  topGifters: TopGifter[];
  recentPayouts: Payout[];
  minPayoutThreshold: number;
  pendingBalance: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCreatorDashboard(): Promise<CreatorDashboardData> {
  const { data } = await apiClient.get<CreatorDashboardData>('/creator/dashboard');
  return data;
}

async function requestPayout(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/creator/payout/request');
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// BUG-032 FIX: use koboToNairaStr (Decimal.js) not raw JS division to avoid
// floating-point rounding errors in financial display.
function formatKobo(kobo: number): string {
  return koboToNairaStr(kobo);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function payoutStatusColor(status: Payout['status']): string {
  switch (status) {
    case 'completed': return colors.semantic.success;
    case 'failed': return colors.semantic.error;
    case 'processing': return colors.brand.blue;
    default: return colors.semantic.warning;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatRowProps {
  label: string;
  value: string;
  accent?: string;
  isDark: boolean;
}

function StatRow({ label, value, accent, isDark }: StatRowProps) {
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: mutedColor }]}>{label}</Text>
      <Text style={[styles.statValue, { color: accent ?? textColor }]}>{value}</Text>
    </View>
  );
}

function SkeletonBlock({ height = 80, isDark }: { height?: number; isDark: boolean }) {
  return (
    <View
      style={[
        styles.skeletonBlock,
        { height, backgroundColor: isDark ? colors.neutral[800] : colors.neutral[200] },
      ]}
    />
  );
}

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  isDark: boolean;
}

function SectionCard({ title, children, isDark }: SectionCardProps) {
  const bg = isDark ? colors.neutral[800] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  return (
    <View style={[styles.sectionCard, { backgroundColor: bg, borderColor }]}>
      <Text style={[styles.sectionTitle, { color: textColor }]}>{title}</Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * CreatorDashboardScreen — revenue overview, member stats, top gifters,
 * payout history and request payout action.
 */
export default function CreatorDashboardScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  // BUG-033 FIX: track PIN attempts to lock out after 5 failures.
  const [pinAttempts, setPinAttempts] = useState(0);
  const PIN_MAX_ATTEMPTS = 5;

  const { data: pinStatus } = useQuery<{ hasPinSet: boolean }>({
    queryKey: ['auth', 'pin', 'status'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ hasPinSet: boolean }>('/auth/pin/status');
      return data;
    },
    staleTime: 60_000,
  });

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['creator', 'dashboard'],
    queryFn: fetchCreatorDashboard,
    staleTime: 60_000,
  });

  const payoutMutation = useMutation({
    mutationFn: requestPayout,
    onSuccess: (res) => {
      Alert.alert('Payout Requested', res.message ?? 'Your payout request has been submitted.');
      void queryClient.invalidateQueries({ queryKey: ['creator', 'dashboard'] });
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not submit payout request. Please try again.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  function handleRequestPayout() {
    if (!data) return;
    const minThreshold = data.minPayoutThreshold;
    const pending = data.pendingBalance;
    if (pending < minThreshold) {
      Alert.alert(
        'Minimum Not Reached',
        `You need at least ${formatKobo(minThreshold)} in your balance to request a payout. Current balance: ${formatKobo(pending)}.`
      );
      return;
    }
    if (pinStatus?.hasPinSet) {
      setPinInput('');
      setPinError('');
      setPinAttempts(0);
      setPinModalVisible(true);
    } else {
      Alert.alert(
        'Request Payout',
        `Request a payout of ${formatKobo(pending)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Request', onPress: () => payoutMutation.mutate() },
        ]
      );
    }
  }

  const submitPayoutPin = async () => {
    if (pinInput.length !== 4) return;
    // BUG-033 FIX: lockout after PIN_MAX_ATTEMPTS failures.
    if (pinAttempts >= PIN_MAX_ATTEMPTS) {
      setPinError(`Too many incorrect attempts. Please try again later.`);
      return;
    }
    try {
      await apiClient.post('/auth/pin/verify', { pin: pinInput });
      setPinAttempts(0);
      setPinModalVisible(false);
      payoutMutation.mutate();
    } catch {
      const newAttempts = pinAttempts + 1;
      setPinAttempts(newAttempts);
      setPinInput('');
      if (newAttempts >= PIN_MAX_ATTEMPTS) {
        setPinError(`Too many incorrect attempts. Please try again later.`);
      } else {
        setPinError(`Incorrect PIN. ${PIN_MAX_ATTEMPTS - newAttempts} attempt${PIN_MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`);
      }
    }
  };

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.skeletonWrapper}>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} height={i === 0 ? 120 : 80} isDark={isDark} />
          ))}
        </View>
      );
    }
    if (isError || !data) {
      return (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: colors.semantic.error }]}>
            Could not load creator dashboard.
          </Text>
          <Button
            label="Retry"
            size="sm"
            variant="secondary"
            onPress={() => void refetch()}
            accessibilityLabel="Retry loading creator dashboard"
          />
        </View>
      );
    }

    return (
      <>
        {/* Revenue Summary */}
        <SectionCard title="Revenue Summary" isDark={isDark}>
          <StatRow label="Today" value={formatKobo(data.revenue.today)} accent={colors.brand.green} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="This Week" value={formatKobo(data.revenue.thisWeek)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="This Month" value={formatKobo(data.revenue.thisMonth)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="All Time" value={formatKobo(data.revenue.allTime)} accent={colors.brand.gold} isDark={isDark} />
        </SectionCard>

        {/* Revenue Breakdown */}
        <SectionCard title="By Stream" isDark={isDark}>
          <StatRow label="Subscriptions" value={formatKobo(data.breakdown.subscriptions)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="Gifts" value={formatKobo(data.breakdown.gifts)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="Broadcasts" value={formatKobo(data.breakdown.broadcasts)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="Quests" value={formatKobo(data.breakdown.quests)} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="ClassRooms" value={formatKobo(data.breakdown.classrooms)} isDark={isDark} />
        </SectionCard>

        {/* Member Stats */}
        <SectionCard title="Member Stats" isDark={isDark}>
          <StatRow label="Total Members" value={data.memberStats.total.toLocaleString()} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow label="Active This Week" value={data.memberStats.activeThisWeek.toLocaleString()} accent={colors.brand.blue} isDark={isDark} />
          <View style={[styles.divider, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[200] }]} />
          <StatRow
            label="Churn Rate"
            value={`${(data.memberStats.churnRate * 100).toFixed(1)}%`}
            accent={data.memberStats.churnRate > 0.1 ? colors.semantic.error : undefined}
            isDark={isDark}
          />
        </SectionCard>

        {/* Top Gifters */}
        {data.topGifters.length > 0 && (
          <SectionCard title="Top Gifters" isDark={isDark}>
            {data.topGifters.slice(0, 3).map((gifter: TopGifter, idx: number) => (
              <View key={gifter.userId} style={styles.gifterRow}>
                <Text style={styles.gifterRank}>{['🥇', '🥈', '🥉'][idx]}</Text>
                <Text style={styles.gifterEmoji}>{gifter.avatarEmoji}</Text>
                <Text
                  style={[
                    styles.gifterName,
                    { color: isDark ? colors.neutral[200] : colors.neutral[800] },
                  ]}
                  numberOfLines={1}
                >
                  @{gifter.username}
                </Text>
                <Text style={[styles.gifterAmount, { color: colors.brand.gold }]}>
                  🪙 {gifter.totalGiftedCoins.toLocaleString()}
                </Text>
              </View>
            ))}
          </SectionCard>
        )}

        {/* Payout History */}
        <SectionCard title="Recent Payouts" isDark={isDark}>
          {data.recentPayouts.length === 0 ? (
            <Text style={[styles.emptyText, { color: subtitleColor }]}>No payouts yet.</Text>
          ) : (
            data.recentPayouts.slice(0, 5).map((payout: Payout) => (
              <View key={payout.id} style={styles.payoutRow}>
                <View>
                  <Text
                    style={[
                      styles.payoutAmount,
                      { color: isDark ? colors.neutral[100] : colors.neutral[900] },
                    ]}
                  >
                    {formatKobo(payout.amount)}
                  </Text>
                  <Text style={[styles.payoutDate, { color: subtitleColor }]}>
                    {formatDate(payout.createdAt)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: payoutStatusColor(payout.status) + '20' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: payoutStatusColor(payout.status) },
                    ]}
                  >
                    {payout.status.charAt(0).toUpperCase() + payout.status.slice(1)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        {/* Quick actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={[styles.quickActionBtn, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0], borderColor: isDark ? colors.neutral[700] : colors.neutral[200] }]}
            onPress={() => router.push('/creator/broadcasts' as never)}
            accessibilityRole="button"
            accessibilityLabel="Send broadcast to followers"
          >
            <Text style={styles.quickActionEmoji}>📢</Text>
            <Text style={[styles.quickActionLabel, { color: isDark ? colors.neutral[100] : colors.neutral[800] }]}>
              Broadcasts
            </Text>
            <Text style={[styles.quickActionChevron, { color: subtitleColor }]}>›</Text>
          </Pressable>
          <Pressable
            style={[styles.quickActionBtn, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0], borderColor: isDark ? colors.neutral[700] : colors.neutral[200] }]}
            onPress={() => router.push('/creator/marketplace' as never)}
            accessibilityRole="button"
            accessibilityLabel="View sponsored quests marketplace"
          >
            <Text style={styles.quickActionEmoji}>🎯</Text>
            <Text style={[styles.quickActionLabel, { color: isDark ? colors.neutral[100] : colors.neutral[800] }]}>
              Sponsored Quests
            </Text>
            <Text style={[styles.quickActionChevron, { color: subtitleColor }]}>›</Text>
          </Pressable>
        </View>

        {/* Pending Balance + Request Payout */}
        <View
          style={[
            styles.payoutCard,
            {
              backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0],
              borderColor: isDark ? colors.neutral[700] : colors.neutral[200],
            },
          ]}
        >
          <Text style={[styles.payoutCardLabel, { color: subtitleColor }]}>Pending Balance</Text>
          <Text style={[styles.payoutCardAmount, { color: colors.brand.green }]}>
            {formatKobo(data.pendingBalance)}
          </Text>
          <Text style={[styles.payoutThresholdNote, { color: subtitleColor }]}>
            Minimum payout: {formatKobo(data.minPayoutThreshold)}
          </Text>
          <Button
            label="Request Payout"
            size="lg"
            onPress={handleRequestPayout}
            loading={payoutMutation.isPending}
            style={styles.payoutBtn}
            accessibilityLabel="Request creator payout"
          />
        </View>
      </>
    );
  };

  return (
    <Screen scrollable={false} disableBottomInset>
      <FlatList
        data={[0]}
        keyExtractor={(i) => String(i)}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => void refetch()}
            tintColor={colors.brand.blue}
          />
        }
        ListHeaderComponent={
          <View style={styles.pageHeader}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backBtn}
              accessibilityLabel="Go back"
            >
              <Text style={[styles.backText, { color: colors.brand.blue }]}>← Back</Text>
            </Pressable>
            <Text style={[styles.pageTitle, { color: textColor }]}>Creator Dashboard</Text>
          </View>
        }
        renderItem={() => <View style={styles.bodyPadding}>{renderContent()}</View>}
        contentContainerStyle={styles.listContent}
      />

      {/* PIN verification modal for payout */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.pinOverlay}>
          <View style={styles.pinModal}>
            <Text style={styles.pinModalTitle}>Enter PIN</Text>
            <Text style={styles.pinModalSub}>
              Enter your 4-digit PIN to authorise this payout request
            </Text>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={(v) => { setPinInput(v.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              placeholder="••••"
              placeholderTextColor={colors.neutral[400]}
            />
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            <View style={styles.pinBtns}>
              <Pressable onPress={() => setPinModalVisible(false)} style={styles.pinCancelBtn}>
                <Text style={styles.pinCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitPayoutPin}
                style={[styles.pinConfirmBtn, pinInput.length < 4 && styles.pinConfirmDisabled]}
                disabled={pinInput.length < 4}
              >
                <Text style={styles.pinConfirmText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  bodyPadding: {
    paddingHorizontal: 16,
    gap: 12,
  },
  skeletonWrapper: {
    gap: 12,
    paddingTop: 8,
  },
  skeletonBlock: {
    borderRadius: 14,
    width: '100%',
  },
  errorState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },

  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 28,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  gifterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 36,
  },
  gifterRank: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  gifterEmoji: {
    fontSize: 18,
  },
  gifterName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  gifterAmount: {
    fontSize: 14,
    fontWeight: '700',
  },

  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  payoutAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  payoutDate: {
    fontSize: 11,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },

  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    minHeight: 52,
  },
  quickActionEmoji: { fontSize: 20 },
  quickActionLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  quickActionChevron: { fontSize: 18, fontWeight: '600' },

  payoutCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  payoutCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payoutCardAmount: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  payoutThresholdNote: {
    fontSize: 12,
    marginBottom: 4,
  },
  payoutBtn: {
    width: '100%',
    marginTop: 4,
  },
  pinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinModal: {
    width: 300,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.neutral[0],
  },
  pinModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  pinModalSub: {
    fontSize: 13,
    textAlign: 'center',
    color: colors.neutral[500],
  },
  pinInput: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
    borderRadius: 10,
    padding: 12,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 12,
    marginTop: 4,
    color: colors.neutral[900],
  },
  pinError: {
    fontSize: 12,
    color: colors.semantic.error,
  },
  pinBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  pinCancelBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.neutral[100],
  },
  pinCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  pinConfirmBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.brand.blue,
  },
  pinConfirmDisabled: {
    opacity: 0.5,
  },
  pinConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});

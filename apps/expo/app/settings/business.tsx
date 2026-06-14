/**
 * app/settings/business.tsx
 *
 * Business Account settings screen.
 *
 * Features:
 *  - Shows current business plan or "No Business Account"
 *  - Plan options with upgrade button if no account
 *  - Analytics (member count, broadcast credits) if has account
 *  - Verified business badge status link
 */

import React from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BusinessPlan = 'starter' | 'growth' | 'enterprise';

interface BusinessData {
  hasBusiness: boolean;
  plan: BusinessPlan | null;
  memberCount: number;
  broadcastCreditsRemaining: number;
  isVerified: boolean;
  verificationStatus: 'none' | 'pending' | 'approved' | 'rejected';
}

interface PlanOption {
  plan: BusinessPlan;
  label: string;
  price: string;
  features: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLANS: PlanOption[] = [
  {
    plan: 'starter',
    label: 'Starter',
    price: '$9.99/mo',
    features: ['Up to 500 members', '10 broadcasts/month', 'Basic analytics'],
  },
  {
    plan: 'growth',
    label: 'Growth',
    price: '$29.99/mo',
    features: ['Up to 5,000 members', '50 broadcasts/month', 'Advanced analytics', 'Priority support'],
  },
  {
    plan: 'enterprise',
    label: 'Enterprise',
    price: 'Custom',
    features: ['Unlimited members', 'Unlimited broadcasts', 'Dedicated support', 'Custom integrations'],
  },
];

const PLAN_LABELS: Record<BusinessPlan, string> = {
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchBusiness(): Promise<BusinessData> {
  const { data } = await apiClient.get('/business');
  return data;
}

async function upgradeToPlan(plan: BusinessPlan): Promise<void> {
  await apiClient.post('/business/upgrade', { plan });
}

async function requestVerification(): Promise<void> {
  await apiClient.post('/business/verify');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({ label, value }: { label: string; value: string | number }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: themeColors.surface }]}>
      <Text style={[styles.statValue, { color: themeColors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const { colors: themeColors } = useTheme();
  return (
    <Text style={[styles.sectionHeader, { color: themeColors.textMuted }]}>{title}</Text>
  );
}

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function BusinessSettingsScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['business'],
    queryFn: fetchBusiness,
  });

  const upgradeMutation = useMutation({
    mutationFn: upgradeToPlan,
    onSuccess: (_, plan) => {
      queryClient.invalidateQueries({ queryKey: ['business'] });
      Alert.alert('Upgraded!', `You're now on the ${PLAN_LABELS[plan]} plan.`);
    },
    onError: () => Alert.alert('Error', 'Could not process upgrade. Please try again.'),
  });

  const verifyMutation = useMutation({
    mutationFn: requestVerification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business'] });
      Alert.alert('Request Sent', 'Your verification request has been submitted. We\'ll review it within 3 business days.');
    },
    onError: () => Alert.alert('Error', 'Could not send verification request.'),
  });

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load business settings.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: themeColors.surface }]}>
        <Text style={styles.heroEmoji}>🏢</Text>
        <Text style={[styles.heroTitle, { color: themeColors.text }]}>Business Account</Text>
        {data.hasBusiness && data.plan ? (
          <View style={styles.planBadge}>
            <Text style={styles.planBadgeText}>{PLAN_LABELS[data.plan]} Plan</Text>
          </View>
        ) : (
          <Text style={[styles.heroSubtitle, { color: themeColors.textMuted }]}>
            No active business account
          </Text>
        )}
      </View>

      {/* Analytics (existing business) */}
      {data.hasBusiness && (
        <>
          <SectionHeader title="ANALYTICS" />
          <View style={styles.statsRow}>
            <StatBox label="Members" value={(data.memberCount ?? 0).toLocaleString()} />
            <StatBox label="Broadcasts left" value={data.broadcastCreditsRemaining} />
          </View>

          {/* Verification */}
          <SectionHeader title="VERIFICATION" />
          <View style={[styles.card, { backgroundColor: themeColors.surface }]}>
            <View style={styles.verifyRow}>
              <View style={styles.verifyInfo}>
                <Text style={[styles.verifyTitle, { color: themeColors.text }]}>
                  Verified Business Badge
                </Text>
                <Text style={[styles.verifyStatus, {
                  color: data.verificationStatus === 'approved'
                    ? colors.semantic.success
                    : data.verificationStatus === 'pending'
                    ? colors.brand.gold
                    : themeColors.textMuted,
                }]}>
                  {data.verificationStatus === 'none' ? 'Not requested' :
                    data.verificationStatus === 'pending' ? 'Under review' :
                    data.verificationStatus === 'approved' ? '✓ Verified' : 'Not approved'}
                </Text>
              </View>
              {data.verificationStatus === 'none' && (
                <TouchableOpacity
                  style={styles.verifyBtn}
                  onPress={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                  accessibilityRole="button"
                >
                  <Text style={styles.verifyBtnText}>
                    {verifyMutation.isPending ? 'Sending…' : 'Request'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </>
      )}

      {/* Plan options (no account or upgrade) */}
      <SectionHeader title={data.hasBusiness ? 'CHANGE PLAN' : 'CHOOSE A PLAN'} />

      {PLANS.map((planOpt) => {
        const isCurrent = data.plan === planOpt.plan;
        return (
          <View
            key={planOpt.plan}
            style={[
              styles.planCard,
              { backgroundColor: themeColors.surface, borderColor: isCurrent ? colors.brand.blue : themeColors.border },
              isCurrent && styles.planCardCurrent,
            ]}
          >
            <View style={styles.planCardHeader}>
              <View>
                <Text style={[styles.planName, { color: themeColors.text }]}>{planOpt.label}</Text>
                <Text style={styles.planPrice}>{planOpt.price}</Text>
              </View>
              {isCurrent ? (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>Current</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  onPress={() => {
                    Alert.alert(
                      `Upgrade to ${planOpt.label}`,
                      `Switch to the ${planOpt.label} plan for ${planOpt.price}?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Upgrade', onPress: () => upgradeMutation.mutate(planOpt.plan) },
                      ],
                    );
                  }}
                  disabled={upgradeMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Upgrade to ${planOpt.label}`}
                >
                  <Text style={styles.upgradeBtnText}>Upgrade</Text>
                </TouchableOpacity>
              )}
            </View>
            {planOpt.features.map((f) => (
              <Text key={f} style={[styles.featureItem, { color: themeColors.textMuted }]}>
                ✓ {f}
              </Text>
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { gap: 4, padding: 16, paddingBottom: 40 },

  hero: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 14,
    gap: 8,
    marginBottom: 4,
  },
  heroEmoji: { fontSize: 40 },
  heroTitle: { fontSize: 20, fontWeight: '800' },
  heroSubtitle: { fontSize: 14 },
  planBadge: {
    backgroundColor: `${colors.brand.blue}18`,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  planBadgeText: { color: colors.brand.blue, fontSize: 13, fontWeight: '700' },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 6,
  },

  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  card: { borderRadius: 14, padding: 16, marginBottom: 4 },
  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifyInfo: { flex: 1, gap: 2 },
  verifyTitle: { fontSize: 15, fontWeight: '600' },
  verifyStatus: { fontSize: 13, fontWeight: '500' },
  verifyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.brand.blue,
    minHeight: 44,
    justifyContent: 'center',
  },
  verifyBtnText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },

  planCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    marginBottom: 8,
  },
  planCardCurrent: { borderWidth: 2 },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  planName: { fontSize: 16, fontWeight: '700' },
  planPrice: { fontSize: 14, fontWeight: '600', color: colors.brand.blue },
  currentBadge: {
    backgroundColor: `${colors.brand.blue}18`,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  currentBadgeText: { color: colors.brand.blue, fontSize: 12, fontWeight: '700' },
  upgradeBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  upgradeBtnText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },
  featureItem: { fontSize: 13, lineHeight: 20 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 80, borderRadius: 14, backgroundColor: colors.neutral[200] },
});

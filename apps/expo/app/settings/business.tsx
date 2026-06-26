/**
 * app/settings/business.tsx
 *
 * Business Account settings screen (Expo / React Native).
 *
 * Features:
 *  - Create or manage a business account
 *  - Real analytics from /api/business/analytics
 *  - Verification request / cancel via /api/business/verify
 *  - Tier upgrade flow via /api/business/tier (redirects to payment URL)
 */

import React, { useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BusinessTier = 'starter' | 'growth' | 'enterprise';
type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

interface BusinessAccount {
  id: string;
  business_name: string;
  business_type: string | null;
  tier: BusinessTier;
  verified: boolean;
  status: string;
  verification_status: VerificationStatus;
  created_at: string;
}

interface Analytics {
  follower_count: number;
  total_rooms: number;
  total_room_members: number;
  total_earnings_kobo: number;
  broadcasts_sent: number;
  active_subscribers: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<BusinessTier, number> = { starter: 0, growth: 1, enterprise: 2 };

const TIERS: { key: BusinessTier; label: string; price: string; features: string[] }[] = [
  {
    key: 'starter',
    label: 'Starter',
    price: '₦5,000/mo',
    features: ['Verified business badge', 'Broadcast capability', 'Basic analytics'],
  },
  {
    key: 'growth',
    label: 'Growth',
    price: '₦15,000/mo',
    features: ['All Starter features', 'Quest Marketplace access', 'Room promotion credits'],
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    price: '₦50,000+/mo',
    features: ['All Growth features', 'Custom Room theming', 'API access', 'Dedicated account manager'],
  },
];

const VERIFICATION_LABELS: Record<VerificationStatus, { text: string; color: string }> = {
  unverified: { text: 'Not verified', color: colors.neutral[400] },
  pending:    { text: 'Under review', color: colors.brand.gold },
  verified:   { text: '✓ Verified', color: colors.semantic.success },
  rejected:   { text: 'Not approved', color: colors.semantic.error },
};

const BUSINESS_TYPES = ['retail', 'service', 'media', 'other'] as const;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchBusiness(): Promise<BusinessAccount | null> {
  try {
    const { data } = await apiClient.get<{ success: boolean; data: { business: BusinessAccount } }>('/business');
    return data.data.business;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

async function fetchAnalytics(): Promise<Analytics> {
  const { data } = await apiClient.get<{ success: boolean; data: { analytics: Analytics } }>('/business/analytics');
  return data.data.analytics;
}

async function createBusiness(payload: { business_name: string; business_type: string }): Promise<BusinessAccount> {
  const { data } = await apiClient.post<{ success: boolean; data: { business: BusinessAccount } }>('/business', payload);
  return data.data.business;
}

async function updateBusiness(payload: { business_name?: string; business_type?: string }): Promise<BusinessAccount> {
  const { data } = await apiClient.patch<{ success: boolean; data: { business: BusinessAccount } }>('/business', payload);
  return data.data.business;
}

async function requestTierUpgrade(tier: BusinessTier): Promise<string> {
  const { data } = await apiClient.patch<{ success: boolean; data: { paymentUrl: string } }>('/business/tier', { tier });
  return data.data.paymentUrl;
}

async function submitVerification(): Promise<void> {
  await apiClient.post('/business/verify');
}

async function cancelVerification(): Promise<void> {
  await apiClient.delete('/business/verify');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({ label, value }: { label: string; value: string | number }) {
  const { colors: tc } = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: tc.surface }]}>
      <Text style={[styles.statValue, { color: tc.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: tc.textMuted }]}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const { colors: tc } = useTheme();
  return <Text style={[styles.sectionHeader, { color: tc.textMuted }]}>{title}</Text>;
}

function fmtKobo(kobo: number): string {
  if (kobo === 0) return '₦0';
  return `₦${(kobo / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function BusinessSettingsScreen() {
  const { colors: tc } = useTheme();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bizType, setBizType] = useState<string>('retail');

  const bizQuery = useQuery({ queryKey: ['business'], queryFn: fetchBusiness });
  const analyticsQuery = useQuery({
    queryKey: ['businessAnalytics'],
    queryFn: fetchAnalytics,
    enabled: !!bizQuery.data,
  });

  const createMutation = useMutation({
    mutationFn: createBusiness,
    onSuccess: (biz) => {
      queryClient.setQueryData(['business'], biz);
      setEditing(false);
      Alert.alert('Done', 'Business account created!');
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not create business account.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBusiness,
    onSuccess: (biz) => {
      queryClient.setQueryData(['business'], biz);
      setEditing(false);
      Alert.alert('Saved', 'Business info updated!');
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not update business info.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const upgradeMutation = useMutation({
    mutationFn: requestTierUpgrade,
    onSuccess: (paymentUrl) => {
      Linking.openURL(paymentUrl).catch(() =>
        Alert.alert('Error', 'Could not open payment page.')
      );
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not initiate upgrade.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: submitVerification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business'] });
      Alert.alert('Submitted', "Your verification request has been submitted. We'll review it soon.");
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not send verification request.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const cancelVerifyMutation = useMutation({
    mutationFn: cancelVerification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business'] });
      Alert.alert('Cancelled', 'Verification request cancelled.');
    },
    onError: (err: unknown) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? 'Could not cancel request.';
      Alert.alert('Error', translateApiError(t, code, message));
    },
  });

  const isLoading = bizQuery.isLoading;
  const biz = bizQuery.data ?? null;
  const analytics = analyticsQuery.data ?? null;
  const verStatus = (biz?.verification_status ?? 'unverified') as VerificationStatus;
  const verLabel = VERIFICATION_LABELS[verStatus];

  // Edit form pre-fill
  const startEdit = () => {
    setName(biz?.business_name ?? '');
    setBizType(biz?.business_type ?? 'retail');
    setEditing(true);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert('Required', 'Please enter a business name.'); return; }
    if (biz) {
      updateMutation.mutate({ business_name: trimmed, business_type: bizType });
    } else {
      createMutation.mutate({ business_name: trimmed, business_type: bizType });
    }
  };

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={[styles.skeleton, { backgroundColor: tc.surface }]} />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable contentStyle={styles.content}>

      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: tc.surface }]}>
        <Text style={styles.heroEmoji}>🏢</Text>
        <Text style={[styles.heroTitle, { color: tc.text }]}>Business Account</Text>
        {biz ? (
          <View style={styles.tierBadge}>
            <Text style={styles.tierBadgeText}>{biz.tier.charAt(0).toUpperCase() + biz.tier.slice(1)} Plan</Text>
          </View>
        ) : (
          <Text style={[styles.heroSubtitle, { color: tc.textMuted }]}>No active business account</Text>
        )}
      </View>

      {/* Analytics */}
      {biz && analytics && (
        <>
          <SectionHeader title="ANALYTICS" />
          <View style={styles.statsGrid}>
            <StatBox label="Followers" value={analytics.follower_count.toLocaleString()} />
            <StatBox label="Room Members" value={analytics.total_room_members.toLocaleString()} />
            <StatBox label="Subscribers" value={analytics.active_subscribers.toLocaleString()} />
            <StatBox label="Rooms" value={analytics.total_rooms.toLocaleString()} />
            <StatBox label="Broadcasts" value={analytics.broadcasts_sent.toLocaleString()} />
            <StatBox label="Earnings" value={fmtKobo(analytics.total_earnings_kobo)} />
          </View>
        </>
      )}

      {/* Verification */}
      {biz && (
        <>
          <SectionHeader title="VERIFICATION" />
          <View style={[styles.card, { backgroundColor: tc.surface }]}>
            <View style={styles.verifyRow}>
              <View style={styles.verifyInfo}>
                <Text style={[styles.verifyTitle, { color: tc.text }]}>Verified Business Badge</Text>
                <Text style={[styles.verifyStatus, { color: verLabel.color }]}>{verLabel.text}</Text>
              </View>
              {verStatus === 'rejected' && (
                <TouchableOpacity
                  style={styles.verifyBtn}
                  onPress={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Resubmit verification"
                >
                  <Text style={styles.verifyBtnText}>{verifyMutation.isPending ? 'Sending…' : 'Resubmit'}</Text>
                </TouchableOpacity>
              )}
              {verStatus === 'unverified' && (
                <TouchableOpacity
                  style={styles.verifyBtn}
                  onPress={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Request verification"
                >
                  <Text style={styles.verifyBtnText}>{verifyMutation.isPending ? 'Sending…' : 'Request'}</Text>
                </TouchableOpacity>
              )}
              {verStatus === 'pending' && (
                <TouchableOpacity
                  style={styles.cancelVerifyBtn}
                  onPress={() => cancelVerifyMutation.mutate()}
                  disabled={cancelVerifyMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel verification request"
                >
                  <Text style={styles.cancelVerifyBtnText}>{cancelVerifyMutation.isPending ? 'Cancelling…' : 'Cancel'}</Text>
                </TouchableOpacity>
              )}
            </View>
            {verStatus === 'rejected' && (
              <Text style={[styles.verifyNote, { color: tc.textMuted }]}>
                Your request was not approved. Update your business details and resubmit.
              </Text>
            )}
          </View>
        </>
      )}

      {/* Edit / Create form */}
      {(!biz || editing) && (
        <>
          <SectionHeader title={biz ? 'EDIT BUSINESS INFO' : 'CREATE BUSINESS ACCOUNT'} />
          <View style={[styles.card, { backgroundColor: tc.surface }]}>
            <Text style={[styles.fieldLabel, { color: tc.textMuted }]}>Business Name *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Acme Clothing"
              placeholderTextColor={tc.textMuted}
              style={[styles.textInput, { color: tc.text, borderColor: tc.border }]}
              maxLength={100}
              autoCapitalize="words"
            />

            <Text style={[styles.fieldLabel, { color: tc.textMuted, marginTop: 12 }]}>Business Type *</Text>
            <View style={styles.typeRow}>
              {BUSINESS_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setBizType(t)}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: bizType === t ? colors.brand.blue : tc.surface,
                      borderColor: bizType === t ? colors.brand.blue : tc.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t}
                >
                  <Text style={[styles.typeChipText, { color: bizType === t ? colors.neutral[0] : tc.textMuted }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formActions}>
              {biz && (
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: tc.border }]}
                  onPress={() => setEditing(false)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.cancelBtnText, { color: tc.textMuted }]}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.saveBtn, { opacity: createMutation.isPending || updateMutation.isPending ? 0.6 : 1 }]}
                onPress={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                accessibilityRole="button"
              >
                <Text style={styles.saveBtnText}>
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving…'
                    : biz ? 'Save Changes' : 'Create Account'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Edit button (when viewing existing account and not editing) */}
      {biz && !editing && (
        <TouchableOpacity
          style={[styles.editInfoBtn, { borderColor: tc.border }]}
          onPress={startEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit business info"
        >
          <Text style={[styles.editInfoBtnText, { color: tc.text }]}>Edit Business Info</Text>
        </TouchableOpacity>
      )}

      {/* Tier options */}
      <SectionHeader title={biz ? 'UPGRADE PLAN' : 'PLANS'} />
      {TIERS.map((tierOpt) => {
        const isCurrent = biz?.tier === tierOpt.key;
        const isUpgradable = biz ? TIER_ORDER[tierOpt.key] > TIER_ORDER[biz.tier as BusinessTier] : true;
        const isEnterprise = tierOpt.key === 'enterprise';

        return (
          <View
            key={tierOpt.key}
            style={[
              styles.planCard,
              { backgroundColor: tc.surface, borderColor: isCurrent ? colors.brand.blue : tc.border },
              isCurrent && styles.planCardCurrent,
            ]}
          >
            <View style={styles.planCardHeader}>
              <View>
                <Text style={[styles.planName, { color: tc.text }]}>{tierOpt.label}</Text>
                <Text style={styles.planPrice}>{tierOpt.price}</Text>
              </View>
              {isCurrent ? (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>Current</Text>
                </View>
              ) : isUpgradable ? (
                isEnterprise ? (
                  <TouchableOpacity
                    style={styles.upgradeBtn}
                    onPress={() => Linking.openURL('mailto:sales@zobia.app?subject=Enterprise%20Business%20Plan%20Enquiry')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.upgradeBtnText}>Contact Us</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.upgradeBtn, { opacity: upgradeMutation.isPending ? 0.6 : 1 }]}
                    onPress={() => {
                      Alert.alert(
                        `Upgrade to ${tierOpt.label}`,
                        `Switch to the ${tierOpt.label} plan for ${tierOpt.price}?\n\nYou will be redirected to complete payment.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Continue', onPress: () => upgradeMutation.mutate(tierOpt.key) },
                        ],
                      );
                    }}
                    disabled={upgradeMutation.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`Upgrade to ${tierOpt.label}`}
                  >
                    <Text style={styles.upgradeBtnText}>
                      {upgradeMutation.isPending ? 'Loading…' : 'Upgrade'}
                    </Text>
                  </TouchableOpacity>
                )
              ) : null}
            </View>
            {tierOpt.features.map((f) => (
              <Text key={f} style={[styles.featureItem, { color: tc.textMuted }]}>✓ {f}</Text>
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

  loadingContainer: { padding: 16, gap: 12 },
  skeleton: { height: 80, borderRadius: 14 },

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
  tierBadge: {
    backgroundColor: `${colors.brand.blue}18`,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  tierBadgeText: { color: colors.brand.blue, fontSize: 13, fontWeight: '700' },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 6,
  },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: {
    width: '31%',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },

  card: { borderRadius: 14, padding: 16, marginBottom: 4 },

  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  verifyInfo: { flex: 1, gap: 2 },
  verifyTitle: { fontSize: 15, fontWeight: '600' },
  verifyStatus: { fontSize: 13, fontWeight: '500' },
  verifyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.brand.blue,
    minHeight: 40,
    justifyContent: 'center',
  },
  verifyBtnText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },
  cancelVerifyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    minHeight: 40,
    justifyContent: 'center',
  },
  cancelVerifyBtnText: { fontSize: 13, fontWeight: '600', color: colors.neutral[500] },
  verifyNote: { fontSize: 12, marginTop: 8, lineHeight: 17 },

  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 36,
    justifyContent: 'center',
  },
  typeChipText: { fontSize: 13, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.brand.blue,
    minHeight: 44,
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: colors.neutral[0] },

  editInfoBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  editInfoBtnText: { fontSize: 14, fontWeight: '600' },

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
    minHeight: 40,
    justifyContent: 'center',
  },
  upgradeBtnText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },
  featureItem: { fontSize: 13, lineHeight: 20 },
});

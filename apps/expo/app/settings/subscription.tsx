/**
 * app/settings/subscription.tsx
 *
 * Subscription Management screen.
 *
 * Features:
 *  - Displays the user's current plan fetched from GET /api/users/me
 *  - Plan comparison cards: Free / Plus / Pro / Max with features and prices
 *  - For paid plans: "Subscribe" button that triggers Google Play Billing (Android)
 *  - Current plan shown as "Active" (no purchase button)
 *  - Monthly coin bonus and XP multiplier for current plan
 *  - Link to cancellation instructions
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import {
  initGooglePlayBilling,
  purchaseSubscription,
} from '@/lib/payments/googlePlay';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanTier = 'free' | 'plus' | 'pro' | 'max';

interface UserMe {
  id: string;
  displayName: string;
  planTier: PlanTier;
  coinBalance: number;
  xpMultiplier: number;
  monthlyCoins: number;
}

interface PlanFeature {
  label: string;
}

interface PlanConfig {
  tier: PlanTier;
  label: string;
  price: string;
  annualPrice: string;
  priceNote: string;
  emoji: string;
  accentColor: string;
  monthlyCoins: number;
  xpMultiplier: number;
  features: PlanFeature[];
  productId: string | null;
  annualProductId?: string;
}

// ---------------------------------------------------------------------------
// Plan catalogue
// ---------------------------------------------------------------------------

const PLANS: PlanConfig[] = [
  {
    tier: 'free',
    label: 'Free',
    price: '₦0',
    annualPrice: '₦0',
    priceNote: 'Forever free',
    emoji: '🆓',
    accentColor: colors.neutral[500],
    monthlyCoins: 0,
    xpMultiplier: 1.0,
    features: [
      { label: 'Up to 5 DMs per day' },
      { label: 'Join up to 3 guilds' },
      { label: 'Basic rooms access' },
      { label: '1× XP multiplier' },
    ],
    productId: null,
  },
  {
    tier: 'plus',
    label: 'Plus',
    price: '₦500',
    annualPrice: '₦5,000',
    priceNote: 'per month',
    emoji: '⭐',
    accentColor: colors.brand.blue,
    monthlyCoins: 50,
    xpMultiplier: 1.25,
    features: [
      { label: 'Unlimited DMs' },
      { label: 'Join up to 10 guilds' },
      { label: 'VIP rooms access' },
      { label: '50 coins/month bonus' },
      { label: '1.25× XP multiplier' },
      { label: '180-day message history' },
    ],
    productId: 'sub_plus_monthly',
    annualProductId: 'sub_plus_annual',
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: '₦1,500',
    annualPrice: '₦15,000',
    priceNote: 'per month',
    emoji: '🔥',
    accentColor: colors.brand.gold,
    monthlyCoins: 200,
    xpMultiplier: 1.5,
    features: [
      { label: 'Unlimited DMs (free to send)' },
      { label: 'Join up to 30 guilds' },
      { label: 'All rooms + Drop rooms' },
      { label: '200 coins/month bonus' },
      { label: '1.5× XP multiplier' },
      { label: 'Unlimited message history' },
      { label: 'Priority support' },
    ],
    productId: 'sub_pro_monthly',
    annualProductId: 'sub_pro_annual',
  },
  {
    tier: 'max',
    label: 'Max',
    price: '₦3,500',
    annualPrice: '₦35,000',
    priceNote: 'per month',
    emoji: '👑',
    accentColor: colors.brand.green,
    monthlyCoins: 500,
    xpMultiplier: 5.0,
    features: [
      { label: 'Everything in Pro' },
      { label: 'Group chats up to 1,000 members' },
      { label: '500 coins/month bonus' },
      { label: '5× XP multiplier' },
      { label: 'Unlimited DMs (free, 250/day)' },
      { label: 'Early feature access (2 weeks)' },
      { label: 'Custom chat themes' },
      { label: 'Dedicated customer support' },
    ],
    productId: 'sub_max_monthly',
    annualProductId: 'sub_max_annual',
  },
];

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchMe(): Promise<UserMe> {
  const { data } = await apiClient.get('/api/users/me');
  return data.user ?? data;
}

// ---------------------------------------------------------------------------
// Plan card
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PlanConfig;
  isActive: boolean;
  onSubscribe: (plan: PlanConfig) => void;
  subscribing: boolean;
  isAnnual: boolean;
}

function PlanCard({ plan, isActive, onSubscribe, subscribing, isAnnual }: PlanCardProps) {
  const { colors: themeColors } = useTheme();
  const displayPrice = plan.tier === 'free'
    ? plan.price
    : isAnnual ? plan.annualPrice : plan.price;
  const displayNote = plan.tier === 'free'
    ? plan.priceNote
    : isAnnual ? 'per year (2 months free)' : plan.priceNote;

  return (
    <View
      style={[
        styles.planCard,
        { backgroundColor: themeColors.surface, borderColor: themeColors.border },
        isActive && { borderColor: plan.accentColor, borderWidth: 2 },
      ]}
    >
      {/* Card header */}
      <View style={[styles.planHeader, { backgroundColor: `${plan.accentColor}14` }]}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planEmoji}>{plan.emoji}</Text>
          <View>
            <Text style={[styles.planName, { color: plan.accentColor }]}>{plan.label}</Text>
            <Text style={[styles.planPrice, { color: themeColors.text }]}>{displayPrice}</Text>
          </View>
          {isAnnual && plan.tier !== 'free' && (
            <View style={[styles.savingsBadge, { backgroundColor: colors.semantic.success ?? colors.brand.green }]}>
              <Text style={styles.savingsBadgeText}>2 free</Text>
            </View>
          )}
        </View>
        <Text style={[styles.planPriceNote, { color: themeColors.textMuted }]}>
          {displayNote}
        </Text>
        {isActive && (
          <View style={[styles.activeBadge, { backgroundColor: plan.accentColor }]}>
            <Text style={styles.activeBadgeText}>Active Plan</Text>
          </View>
        )}
      </View>

      {/* Features */}
      <View style={styles.featureList}>
        {plan.features.map((f, idx) => (
          <View key={idx} style={styles.featureRow}>
            <Text style={[styles.featureCheck, { color: plan.accentColor }]}>✓</Text>
            <Text style={[styles.featureLabel, { color: themeColors.text }]}>{f.label}</Text>
          </View>
        ))}
      </View>

      {/* Stats row */}
      <View style={[styles.statsRow, { borderTopColor: themeColors.border }]}>
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: plan.accentColor }]}>
            {plan.monthlyCoins > 0 ? `+${plan.monthlyCoins}` : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>Coins/mo</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={[styles.statValue, { color: plan.accentColor }]}>{plan.xpMultiplier}×</Text>
          <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>XP Multiplier</Text>
        </View>
      </View>

      {/* Subscribe button */}
      {!isActive && plan.productId && (
        <Pressable
          style={[
            styles.subscribeBtn,
            { backgroundColor: plan.accentColor },
            subscribing && { opacity: 0.7 },
          ]}
          onPress={() => onSubscribe(plan)}
          disabled={subscribing}
          accessibilityRole="button"
          accessibilityLabel={`Subscribe to ${plan.label}`}
        >
          {subscribing ? (
            <ActivityIndicator size="small" color={colors.neutral[0]} />
          ) : (
            <Text style={styles.subscribeBtnText}>
              Subscribe — {isAnnual ? `${plan.annualPrice}/yr` : `${plan.price}/mo`}
            </Text>
          )}
        </Pressable>
      )}

      {isActive && plan.tier !== 'free' && (
        <Text style={[styles.cancelHint, { color: themeColors.textMuted }]}>
          Manage via Google Play subscriptions
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skeletonCard} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function SubscriptionScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [subscribingTier, setSubscribingTier] = useState<PlanTier | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  const { data: me, isLoading, isError } = useQuery({
    queryKey: ['user-me'],
    queryFn: fetchMe,
    staleTime: 60_000,
  });

  const currentTier: PlanTier = me?.planTier ?? 'free';
  const currentPlan = PLANS.find((p) => p.tier === currentTier) ?? PLANS[0];

  const handleSubscribe = useCallback(
    async (plan: PlanConfig) => {
      const productId = isAnnual ? (plan.annualProductId ?? plan.productId) : plan.productId;
      if (!productId) return;

      if (Platform.OS !== 'android') {
        Alert.alert(
          'Android Only',
          'Subscriptions are managed via Google Play on Android devices.',
        );
        return;
      }

      setSubscribingTier(plan.tier);

      try {
        await initGooglePlayBilling();

        const result = await purchaseSubscription(productId);

        if (result.success) {
          Alert.alert(
            'Subscribed!',
            `You are now on the ${plan.label} plan. Your benefits are active.`,
            [
              {
                text: 'OK',
                onPress: () => queryClient.invalidateQueries({ queryKey: ['user-me'] }),
              },
            ],
          );
        } else if (result.error && result.error !== 'Purchase cancelled') {
          Alert.alert('Subscription Failed', result.error);
        }
      } catch (err) {
        Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      } finally {
        setSubscribingTier(null);
      }
    },
    [queryClient, isAnnual],
  );

  const handleCancelInstructions = useCallback(() => {
    Linking.openURL(
      'https://support.google.com/googleplay/answer/7018481',
    ).catch(() => {
      Alert.alert('Error', 'Could not open the link.');
    });
  }, []);

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load subscription information. Please try again.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Current plan banner */}
      <View style={[styles.currentBanner, { backgroundColor: `${currentPlan.accentColor}14` }]}>
        <Text style={[styles.currentBannerEmoji]}>{currentPlan.emoji}</Text>
        <View>
          <Text style={[styles.currentBannerLabel, { color: themeColors.textMuted }]}>
            Current Plan
          </Text>
          <Text style={[styles.currentBannerPlan, { color: currentPlan.accentColor }]}>
            {currentPlan.label}
          </Text>
        </View>
        {me && (
          <View style={styles.currentBannerStats}>
            <Text style={[styles.currentStatText, { color: themeColors.textMuted }]}>
              🪙 {me.monthlyCoins ?? currentPlan.monthlyCoins}/mo
            </Text>
            <Text style={[styles.currentStatText, { color: themeColors.textMuted }]}>
              ⚡ {me.xpMultiplier ?? currentPlan.xpMultiplier}× XP
            </Text>
          </View>
        )}
      </View>

      {/* Plan cards */}
      <Text style={[styles.sectionTitle, { color: themeColors.text }]}>Choose a Plan</Text>

      {/* Annual / Monthly toggle */}
      <View style={[styles.billingToggleRow, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
        <Text style={[styles.billingToggleLabel, { color: themeColors.text }]}>Monthly</Text>
        <Switch
          value={isAnnual}
          onValueChange={setIsAnnual}
          trackColor={{ false: colors.neutral[300], true: colors.brand.blue }}
          thumbColor={colors.neutral[0]}
          accessibilityLabel="Toggle annual billing"
        />
        <Text style={[styles.billingToggleLabel, { color: themeColors.text }]}>
          Annual
        </Text>
        <View style={[styles.annualSavingsBadge, { backgroundColor: colors.brand.green }]}>
          <Text style={styles.annualSavingsText}>2 months free</Text>
        </View>
      </View>

      {PLANS.map((plan) => (
        <PlanCard
          key={plan.tier}
          plan={plan}
          isActive={plan.tier === currentTier}
          onSubscribe={handleSubscribe}
          subscribing={subscribingTier === plan.tier}
          isAnnual={isAnnual}
        />
      ))}

      {/* Cancellation */}
      <View style={[styles.cancelSection, { borderTopColor: themeColors.border }]}>
        <Text style={[styles.cancelTitle, { color: themeColors.text }]}>
          Cancel Subscription
        </Text>
        <Text style={[styles.cancelDesc, { color: themeColors.textMuted }]}>
          Subscriptions are managed through Google Play. To cancel, open Google Play
          and navigate to Subscriptions.
        </Text>
        <Pressable
          style={styles.cancelLink}
          onPress={handleCancelInstructions}
          accessibilityRole="link"
        >
          <Text style={styles.cancelLinkText}>View cancellation instructions →</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },

  // Current plan banner
  currentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    marginBottom: 4,
  },
  currentBannerEmoji: { fontSize: 36 },
  currentBannerLabel: { fontSize: 12, fontWeight: '600' },
  currentBannerPlan: { fontSize: 20, fontWeight: '800' },
  currentBannerStats: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  currentStatText: { fontSize: 12, fontWeight: '600' },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },

  // Plan card
  planCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 4,
  },
  planHeader: {
    padding: 16,
    gap: 4,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  planEmoji: { fontSize: 28 },
  planName: { fontSize: 18, fontWeight: '800' },
  planPrice: { fontSize: 15, fontWeight: '700' },
  planPriceNote: { fontSize: 12, marginTop: 2 },

  activeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 6,
  },
  activeBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  savingsBadge: {
    marginLeft: 'auto',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'center',
  },
  savingsBadgeText: { color: colors.neutral[0], fontSize: 10, fontWeight: '700' },

  billingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 4,
    gap: 10,
  },
  billingToggleLabel: { fontSize: 14, fontWeight: '600' },
  annualSavingsBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 4,
  },
  annualSavingsText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  featureList: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
  },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureCheck: { fontSize: 14, fontWeight: '800', lineHeight: 20, width: 14 },
  featureLabel: { fontSize: 13, lineHeight: 20, flex: 1 },

  statsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    paddingVertical: 10,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.neutral[200] },
  statValue: { fontSize: 16, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '500' },

  subscribeBtn: {
    marginHorizontal: 16,
    marginBottom: 14,
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  subscribeBtnText: { color: colors.neutral[0], fontSize: 15, fontWeight: '700' },
  cancelHint: { fontSize: 11, textAlign: 'center', marginBottom: 12, paddingHorizontal: 16 },

  // Cancellation section
  cancelSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    marginTop: 4,
    gap: 8,
  },
  cancelTitle: { fontSize: 15, fontWeight: '700' },
  cancelDesc: { fontSize: 13, lineHeight: 20 },
  cancelLink: { alignSelf: 'flex-start' },
  cancelLinkText: { fontSize: 14, color: colors.brand.blue, fontWeight: '600' },

  // Error
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  // Skeleton
  skeletonContainer: { padding: 16, gap: 12 },
  skeletonCard: { height: 200, borderRadius: 14, backgroundColor: colors.neutral[200] },
});

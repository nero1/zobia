/**
 * Coin Store Screen
 *
 * Displays coin pack and star pack cards with NGN prices.
 * Initiates purchase flow by opening the payment provider URL in a WebView.
 *
 * Route: /economy/store
 *
 * @module app/economy/store
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoinPack {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  coinsGranted: number;
  bonusLabel: string | null;
  isFeatured: boolean;
}

interface StarPack {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  starsGranted: number;
  bonusLabel: string | null;
  isFeatured: boolean;
}

interface BoosterItem {
  id: string;
  name: string;
  description: string | null;
  coinsCost: number;
  isFeatured: boolean;
}

interface StoreData {
  coinPacks: CoinPack[];
  starPacks: StarPack[];
  boosters: BoosterItem[];
  paymentEnabled: boolean;
}

interface PurchaseResult {
  paymentUrl: string;
  paymentReference: string;
}

interface PurchaseArgs {
  packId: string;
  packType: 'coin_pack' | 'star_pack';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchStore(): Promise<StoreData> {
  const { data } = await apiClient.get<StoreData>('/economy/store');
  return data;
}

async function initiatePurchase({ packId, packType }: PurchaseArgs): Promise<PurchaseResult> {
  const endpoint = packType === 'star_pack'
    ? '/economy/stars/purchase'
    : '/economy/coins/purchase';
  const { data } = await apiClient.post<PurchaseResult>(endpoint, { packId });
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatKobo(kobo: number, currency = 'NGN'): string {
  const amount = kobo / 100;
  // Basic NGN formatting for React Native (Intl may be limited on some builds)
  return `₦${amount.toLocaleString('en-NG')}`;
}

// ---------------------------------------------------------------------------
// Pack card
// ---------------------------------------------------------------------------

interface PackCardProps {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  grantedAmount: number;
  grantedIcon: string;
  grantedLabel: string;
  bonusLabel: string | null;
  isFeatured: boolean;
  isPurchasing: boolean;
  onBuy: (id: string) => void;
}

function PackCard({
  id,
  name,
  priceKobo,
  currency,
  grantedAmount,
  grantedIcon,
  bonusLabel,
  isFeatured,
  isPurchasing,
  onBuy,
}: PackCardProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View
      style={[
        styles.packCard,
        { backgroundColor: themeColors.surface, borderColor: isFeatured ? colors.brand.blue : colors.neutral[200] },
        isFeatured && styles.packCardFeatured,
      ]}
    >
      {isFeatured && (
        <View style={styles.featuredBadge}>
          <Text style={styles.featuredText}>BEST VALUE</Text>
        </View>
      )}

      {bonusLabel && (
        <View style={styles.bonusBadge}>
          <Text style={styles.bonusText}>{bonusLabel}</Text>
        </View>
      )}

      <View style={styles.packGrantRow}>
        <Text style={styles.packIcon}>{grantedIcon}</Text>
        <Text style={styles.packAmount}>{grantedAmount.toLocaleString()}</Text>
      </View>

      <Text style={styles.packName}>{name}</Text>
      <Text style={styles.packPrice}>{formatKobo(priceKobo, currency)}</Text>

      <Button
        label={isPurchasing ? 'Processing...' : 'Buy Now'}
        onPress={() => onBuy(id)}
        loading={isPurchasing}
        style={styles.buyBtn}
        size="sm"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * StoreScreen — coin and star pack store for mobile.
 */
export default function StoreScreen() {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [purchasingStarId, setPurchasingStarId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<StoreData>({
    queryKey: ['economy', 'store'],
    queryFn: fetchStore,
    staleTime: 5 * 60_000,
  });

  const purchaseMutation = useMutation<PurchaseResult, Error, PurchaseArgs>({
    mutationFn: initiatePurchase,
    onMutate: ({ packId, packType }) => {
      if (packType === 'star_pack') setPurchasingStarId(packId);
      else setPurchasingId(packId);
    },
    onSuccess: async (result) => {
      // Open the provider checkout URL in the device browser
      try {
        const canOpen = await Linking.canOpenURL(result.paymentUrl);
        if (canOpen) {
          await Linking.openURL(result.paymentUrl);
        } else {
          Alert.alert('Error', 'Could not open payment page');
        }
      } catch {
        Alert.alert('Error', 'Failed to open payment page');
      } finally {
        setPurchasingId(null);
        setPurchasingStarId(null);
      }
    },
    onError: (err) => {
      Alert.alert('Purchase Failed', err.message);
      setPurchasingId(null);
      setPurchasingStarId(null);
    },
  });

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand.blue} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>Failed to load store</Text>
          <Button label="Retry" size="sm" variant="ghost" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Coin Store</Text>
      </View>

      {!data.paymentEnabled && (
        <View style={styles.disabledBanner}>
          <Text style={styles.disabledText}>Payments are currently unavailable.</Text>
        </View>
      )}

      {/* Coin Packs */}
      {data.coinPacks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🪙 Coin Packs</Text>
          <View style={styles.packGrid}>
            {data.coinPacks.map((pack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.coinsGranted}
                grantedIcon="🪙"
                grantedLabel="Coins"
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingId === pack.id}
                onBuy={(id) => purchaseMutation.mutate({ packId: id, packType: 'coin_pack' })}
              />
            ))}
          </View>
        </View>
      )}

      {/* Star Packs */}
      {data.starPacks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⭐ Star Packs</Text>
          <View style={styles.packGrid}>
            {data.starPacks.map((pack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.starsGranted}
                grantedIcon="⭐"
                grantedLabel="Stars"
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingStarId === pack.id}
                onBuy={(id) => purchaseMutation.mutate({ packId: id, packType: 'star_pack' })}
              />
            ))}
          </View>
        </View>
      )}

      {/* Booster section */}
      {data.boosters.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚡ Booster Packs</Text>
          {data.boosters.map((booster) => (
            <View
              key={booster.id}
              style={[styles.boosterItem, { backgroundColor: themeColors.surface, borderColor: colors.neutral[200] }]}
            >
              <View style={styles.boosterLeft}>
                <Text style={styles.boosterName}>{booster.name}</Text>
                {booster.description && (
                  <Text style={styles.boosterDesc}>{booster.description}</Text>
                )}
                <Text style={styles.boosterCost}>🪙 {booster.coinsCost?.toLocaleString()} coins</Text>
              </View>
              <Button
                label="Buy"
                size="sm"
                variant="secondary"
                onPress={() =>
                  Alert.alert('Coming Soon', 'Booster purchases are available in the next update.')
                }
              />
            </View>
          ))}
        </View>
      )}

      <View style={styles.bottomSpace} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    padding: 4,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    fontSize: 16,
    color: colors.brand.blue,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  disabledBanner: {
    backgroundColor: colors.neutral[100],
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  disabledText: {
    fontSize: 13,
    color: colors.neutral[500],
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: 12,
  },
  packGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  packCard: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 6,
    position: 'relative',
  },
  packCardFeatured: {
    borderWidth: 2,
  },
  featuredBadge: {
    position: 'absolute',
    top: -10,
    left: 10,
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  featuredText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.neutral[0],
    letterSpacing: 0.5,
  },
  bonusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand.goldLight + '33',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bonusText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.goldDark,
  },
  packGrantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  packIcon: {
    fontSize: 24,
  },
  packAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[900],
    letterSpacing: -0.5,
  },
  packName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  packPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    marginTop: 4,
  },
  buyBtn: {
    marginTop: 6,
  },
  boosterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  boosterLeft: {
    flex: 1,
    gap: 3,
  },
  boosterName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  boosterDesc: {
    fontSize: 12,
    color: colors.neutral[500],
  },
  boosterCost: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand.gold,
  },
  errorText: {
    fontSize: 14,
    color: colors.semantic.error,
  },
  bottomSpace: {
    height: 40,
  },
});

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
  Pressable,
  ActivityIndicator,
  Linking,
  Alert,
  Modal,
  Platform,
  TextInput,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { translateApiError } from '@/lib/i18n/apiErrors';
import { purchaseCoins, COIN_PRODUCTS, initGooglePlayBilling } from '@/lib/payments/googlePlay';
import { useAuth } from '@/lib/auth/hooks';

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
  iapProductId: string | null;
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
  type: string;
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

interface BoosterPurchaseArgs {
  boosterType: string;
}

interface BoosterPurchaseResult {
  success: boolean;
  message?: string;
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

async function purchaseBooster({ boosterType }: BoosterPurchaseArgs): Promise<BoosterPurchaseResult> {
  const { data } = await apiClient.post<BoosterPurchaseResult>('/economy/boosters', { boosterType, quantity: 1 });
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatKobo(kobo: number, currencyCode = 'NGN'): string {
  const amount = kobo / 100;
  // Basic formatting for React Native (Intl may be limited on some builds).
  const formatted = amount.toLocaleString('en-NG');
  return currencyCode === 'NGN' ? `₦${formatted}` : `${formatted} ${currencyCode}`;
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
  const { t } = useTranslation();
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
          <Text style={styles.featuredText}>{t('store.bestValue')}</Text>
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
        label={isPurchasing ? t('store.processing') : t('store.buyNow')}
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
  const currency = useCurrency();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [purchasingStarId, setPurchasingStarId] = useState<string | null>(null);
  const [purchasingBoosterId, setPurchasingBoosterId] = useState<string | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinPending, setPinPending] = useState<PurchaseArgs | null>(null);
  const [boosterPinPending, setBoosterPinPending] = useState<{ boosterId: string; boosterType: string } | null>(null);
  const [pinError, setPinError] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<StoreData>({
    queryKey: ['economy', 'store'],
    queryFn: fetchStore,
    staleTime: 5 * 60_000,
  });

  const { data: pinStatus } = useQuery<{ hasPinSet: boolean }>({
    queryKey: ['auth', 'pin', 'status'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ hasPinSet: boolean }>('/auth/pin/status');
      return data;
    },
    staleTime: 60_000,
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
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message;
      Alert.alert('Purchase Failed', translateApiError(t, code, message));
      setPurchasingId(null);
      setPurchasingStarId(null);
    },
  });

  const boosterMutation = useMutation<BoosterPurchaseResult, Error, BoosterPurchaseArgs>({
    mutationFn: purchaseBooster,
    onSuccess: () => {
      Alert.alert('Purchased!', 'Your booster is now active.');
      setPurchasingBoosterId(null);
      setBoosterPinPending(null);
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message;
      Alert.alert('Purchase Failed', translateApiError(t, code, message));
      setPurchasingBoosterId(null);
      setBoosterPinPending(null);
    },
  });

  const handleBuyBooster = (boosterId: string, boosterType: string) => {
    if (pinStatus?.hasPinSet) {
      setBoosterPinPending({ boosterId, boosterType });
      setPinInput('');
      setPinError('');
      setPinModalVisible(true);
    } else {
      setPurchasingBoosterId(boosterId);
      boosterMutation.mutate({ boosterType });
    }
  };

  const handleBuy = (packId: string, packType: 'coin_pack' | 'star_pack') => {
    // On Android, coin packs must go through Google Play Billing (Play Store policy
    // prohibits external payment URLs for digital content).
    if (Platform.OS === 'android' && packType === 'coin_pack') {
      const pack = data?.coinPacks.find((p) => p.id === packId);
      const playProduct = pack
        ? COIN_PRODUCTS.find((cp) =>
            pack.iapProductId
              ? cp.id === pack.iapProductId
              : cp.coins === pack.coinsGranted
          )
        : null;
      if (!playProduct) {
        Alert.alert('Unavailable', 'This pack is not available for purchase on Android yet.');
        return;
      }
      setPurchasingId(packId);
      (async () => {
        try {
          await initGooglePlayBilling();
          const result = await purchaseCoins(playProduct.id);
          if (result.success) {
            Alert.alert('Success!', `You received ${result.coins.toLocaleString()} coins!`);
          } else if (result.error !== 'Purchase cancelled') {
            Alert.alert('Purchase Failed', result.error ?? 'Could not complete purchase.');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Could not connect to Google Play.';
          Alert.alert('Purchase Failed', msg);
        } finally {
          setPurchasingId(null);
        }
      })();
      return;
    }

    if (pinStatus?.hasPinSet) {
      setPinPending({ packId, packType });
      setPinInput('');
      setPinError('');
      setPinModalVisible(true);
    } else {
      purchaseMutation.mutate({ packId, packType });
    }
  };

  const submitPin = async () => {
    if (pinInput.length !== 4 || (!pinPending && !boosterPinPending)) return;
    try {
      const pinHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${user?.id ?? ''}:${pinInput}`
      );
      await apiClient.post('/auth/pin/verify', { pinHash });
      setPinModalVisible(false);
      if (boosterPinPending) {
        setPurchasingBoosterId(boosterPinPending.boosterId);
        boosterMutation.mutate({ boosterType: boosterPinPending.boosterType });
        setBoosterPinPending(null);
      } else if (pinPending) {
        purchaseMutation.mutate(pinPending);
        setPinPending(null);
      }
    } catch {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
    }
  };

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
          <Text style={styles.errorText}>{t('store.loadError')}</Text>
          <Button label={t('action.retry')} size="sm" variant="ghost" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>{t('store.backBtn')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('store.title')}</Text>
      </View>

      {!data.paymentEnabled && (
        <View style={styles.disabledBanner}>
          <Text style={styles.disabledText}>{t('store.paymentsDisabled')}</Text>
        </View>
      )}

      {/* Coin Packs */}
      {data.coinPacks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('store.coinPacks')}</Text>
          <View style={styles.packGrid}>
            {data.coinPacks.map((pack: CoinPack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.coinsGranted}
                grantedIcon="🪙"
                grantedLabel={currency.softPlural}
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingId === pack.id}
                onBuy={(id) => handleBuy(id, 'coin_pack')}
              />
            ))}
          </View>
        </View>
      )}

      {/* Star Packs */}
      {data.starPacks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('store.starPacks')}</Text>
          <View style={styles.packGrid}>
            {data.starPacks.map((pack: StarPack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.starsGranted}
                grantedIcon="⭐"
                grantedLabel={currency.premiumPlural}
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingStarId === pack.id}
                onBuy={(id) => handleBuy(id, 'star_pack')}
              />
            ))}
          </View>
        </View>
      )}

      {/* Booster section */}
      {data.boosters.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('store.boosterPacks')}</Text>
          {data.boosters.map((booster: BoosterItem) => (
            <View
              key={booster.id}
              style={[styles.boosterItem, { backgroundColor: themeColors.surface, borderColor: colors.neutral[200] }]}
            >
              <View style={styles.boosterLeft}>
                <Text style={styles.boosterName}>{booster.name}</Text>
                {booster.description && (
                  <Text style={styles.boosterDesc}>{booster.description}</Text>
                )}
                <Text style={styles.boosterCost}>🪙 {booster.coinsCost?.toLocaleString()} {currency.softPlural.toLowerCase()}</Text>
              </View>
              <Button
                label={purchasingBoosterId === booster.id ? t('store.processing') : t('store.buy')}
                size="sm"
                variant="secondary"
                loading={purchasingBoosterId === booster.id}
                onPress={() => handleBuyBooster(booster.id, booster.type)}
              />
            </View>
          ))}
        </View>
      )}

      <View style={styles.bottomSpace} />

      {/* PIN verification modal */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <View style={styles.pinOverlay}>
          <View style={[styles.pinModal, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.pinModalTitle, { color: themeColors.text }]}>{t('store.enterPin')}</Text>
            <Text style={[styles.pinModalSub, { color: themeColors.textMuted }]}>
              {t('store.enterPinBody')}
            </Text>
            <TextInput
              style={[styles.pinInput, { color: themeColors.text, borderColor: colors.neutral[300] }]}
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
                <Text style={styles.pinCancelText}>{t('action.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={submitPin}
                style={[styles.pinConfirmBtn, pinInput.length < 4 && styles.pinConfirmDisabled]}
                disabled={pinInput.length < 4}
              >
                <Text style={styles.pinConfirmText}>{t('action.confirm')}</Text>
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
  },
  pinModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  pinModalSub: {
    fontSize: 13,
    textAlign: 'center',
  },
  pinInput: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 12,
    marginTop: 4,
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

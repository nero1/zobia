/**
 * Gift Send Screen
 *
 * Allows users to browse the gift catalogue by tier, select a recipient,
 * preview the gift animation, and confirm sending.
 *
 * Route: /economy/gift-send?recipientId=xxx&recipientUsername=yyy
 *
 * @module app/economy/gift-send
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { GiftAnimation } from '@/components/economy/GiftAnimation';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  starCost: number | null;
  tier: number;
  animationKey: string | null;
}

interface GiftTier {
  tier: number;
  label: string;
  gifts: GiftItem[];
}

interface GiftCatalogue {
  tiers: GiftTier[];
}

interface WalletBalance {
  coins: number;
  stars: number;
}

interface SendGiftResult {
  success: boolean;
  giftId: string;
  gift: {
    emoji: string;
    name: string;
    tier: number;
  };
  spectacleTriggered: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchCatalogue(): Promise<GiftCatalogue> {
  const { data } = await apiClient.get<GiftCatalogue>('/economy/gifts/catalogue');
  return data;
}

async function sendGift(params: {
  giftItemId: string;
  currency?: 'coins' | 'stars';
  recipientId: string;
  roomId?: string;
}): Promise<SendGiftResult> {
  const { data } = await apiClient.post<SendGiftResult>('/economy/gifts/send', params);
  return data;
}

// ---------------------------------------------------------------------------
// Tier label badge
// ---------------------------------------------------------------------------

const TIER_BG: Record<number, string> = {
  1: colors.neutral[200],
  2: '#D1FAE5',
  3: '#FEF3C7',
  4: '#DBEAFE',
  5: '#FEF9C3',
};

const TIER_TEXT: Record<number, string> = {
  1: colors.neutral[600],
  2: colors.semantic.success,
  3: colors.brand.gold,
  4: colors.brand.blue,
  5: colors.brand.goldDark,
};

// ---------------------------------------------------------------------------
// Gift item card
// ---------------------------------------------------------------------------

interface GiftCardProps {
  item: GiftItem;
  isSelected: boolean;
  canAfford: boolean;
  currencyMode: 'coins' | 'stars';
  onSelect: (item: GiftItem) => void;
}

function GiftCard({ item, isSelected, canAfford, currencyMode, onSelect }: GiftCardProps) {
  const cost = currencyMode === 'stars' ? (item.starCost ?? 0) : item.coinCost;
  const icon = currencyMode === 'stars' ? '⭐' : '🪙';
  return (
    <Pressable
      onPress={() => onSelect(item)}
      accessibilityLabel={`${item.name}, ${cost} ${currencyMode}`}
      style={({ pressed }) => [
        styles.giftCard,
        isSelected && styles.giftCardSelected,
        !canAfford && styles.giftCardAfford,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.giftEmoji}>{item.emoji}</Text>
      <Text style={styles.giftName} numberOfLines={1}>
        {item.name}
      </Text>
      <View style={styles.giftCostRow}>
        <Text style={styles.giftCostIcon}>{icon}</Text>
        <Text style={[styles.giftCost, !canAfford && styles.giftCostAfford]}>
          {cost.toLocaleString()}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * GiftSendScreen — gift catalogue and send confirmation flow.
 */
export default function GiftSendScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const currency = useCurrency();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    recipientId: string;
    recipientUsername: string;
    roomId?: string;
  }>();

  const { recipientId, recipientUsername, roomId } = params;

  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [showAnimation, setShowAnimation] = useState(false);
  const [sentGiftResult, setSentGiftResult] = useState<SendGiftResult | null>(null);
  const [activeTier, setActiveTier] = useState<number | null>(null);
  const [currencyMode, setCurrencyMode] = useState<'coins' | 'stars'>('coins');

  // PIN verification state
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const pendingSendParams = useRef<{ giftItemId: string; recipientId: string; roomId?: string; currency?: 'coins' | 'stars' } | null>(null);

  const { data: catalogue, isLoading: catalogueLoading } = useQuery<GiftCatalogue>({
    queryKey: ['gifts', 'catalogue'],
    queryFn: fetchCatalogue,
    staleTime: 5 * 60_000,
  });

  const { data: wallet } = useQuery<WalletBalance>({
    queryKey: ['wallet', 'balance'],
    queryFn: async () => {
      const { data } = await apiClient.get<WalletBalance>('/economy/coins/balance');
      return data;
    },
    staleTime: 30_000,
  });

  const sendMutation = useMutation<SendGiftResult, Error, { giftItemId: string; recipientId: string; roomId?: string; currency?: 'coins' | 'stars' }>({
    mutationFn: sendGift,
    onSuccess: (result) => {
      setSentGiftResult(result);
      setShowAnimation(true);
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
    },
    onError: (err, variables) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message;

      if (code === 'PIN_REQUIRED') {
        // Store params so we can retry after PIN is verified
        pendingSendParams.current = variables;
        setPinInput('');
        setPinError(null);
        setPinModalVisible(true);
        return;
      }

      if (code === 'NO_PIN_CONFIGURED') {
        Alert.alert(
          'PIN Setup Required',
          'You need to set up a PIN before sending gifts. Go to Settings to create one.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Set Up PIN', onPress: () => router.push('/settings/pin') },
          ]
        );
        return;
      }

      Alert.alert('Send Failed', translateApiError(t, code, message));
    },
  });

  const handlePinVerify = async () => {
    const pin = pinInput.trim();
    if (pin.length !== 4) {
      setPinError('Enter your 4-digit PIN');
      return;
    }
    setPinVerifying(true);
    setPinError(null);
    try {
      const { data } = await apiClient.post<{ verified: boolean }>('/auth/pin/verify', { pin });
      if (!data.verified) {
        setPinError('Incorrect PIN. Please try again.');
        return;
      }
      // PIN verified — close modal and retry the gift send
      setPinModalVisible(false);
      setPinInput('');
      if (pendingSendParams.current) {
        sendMutation.mutate(pendingSendParams.current);
        pendingSendParams.current = null;
      }
    } catch (e) {
      const axiosErr = e as AxiosError<{ error?: { message?: string } }>;
      setPinError(axiosErr.response?.data?.error?.message ?? 'Verification failed. Try again.');
    } finally {
      setPinVerifying(false);
    }
  };

  const handleSend = () => {
    if (!selectedGift || !recipientId) return;
    const cost =
      currencyMode === 'stars' ? selectedGift.starCost ?? 0 : selectedGift.coinCost;
    const costLabel =
      currencyMode === 'stars' ? `${cost} ⭐ ${currency.premiumPlural}` : `${cost} 🪙 ${currency.softPlural.toLowerCase()}`;

    Alert.alert(
      'Send Gift?',
      `Send ${selectedGift.emoji} ${selectedGift.name} to @${recipientUsername ?? 'user'} for ${costLabel}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            sendMutation.mutate({
              giftItemId: selectedGift.id,
              recipientId,
              roomId,
              currency: currencyMode,
            });
          },
        },
      ]
    );
  };

  const tiers = catalogue?.tiers ?? [];
  const displayTier = activeTier ?? tiers[0]?.tier ?? 1;
  const rawTierData = tiers.find((t: GiftTier) => t.tier === displayTier);
  const tierData = rawTierData
    ? {
        ...rawTierData,
        gifts:
          currencyMode === 'stars'
            ? rawTierData.gifts.filter((g: GiftItem) => g.starCost != null && g.starCost > 0)
            : rawTierData.gifts,
      }
    : undefined;
  const coinsBalance = wallet?.coins ?? 0;
  const starsBalance = wallet?.stars ?? 0;
  const activeBalance = currencyMode === 'stars' ? starsBalance : coinsBalance;

  return (
    <Screen scrollable={false} disableBottomInset>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>
          Send Gift{recipientUsername ? ` to @${recipientUsername}` : ''}
        </Text>
      </View>

      {/* Currency toggle */}
      <View style={styles.currencyToggleRow}>
        <Pressable
          onPress={() => { setCurrencyMode('coins'); setSelectedGift(null); }}
          style={[styles.currencyToggleBtn, currencyMode === 'coins' && styles.currencyToggleActive]}
        >
          <Text style={[styles.currencyToggleText, currencyMode === 'coins' && styles.currencyToggleTextActive]}>
            🪙 {currency.softPlural}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setCurrencyMode('stars'); setSelectedGift(null); }}
          style={[styles.currencyToggleBtn, currencyMode === 'stars' && styles.currencyToggleActive]}
        >
          <Text style={[styles.currencyToggleText, currencyMode === 'stars' && styles.currencyToggleTextActive]}>
            ⭐ {currency.premiumPlural}
          </Text>
        </Pressable>
      </View>

      {/* Balance reminder */}
      <View style={styles.balanceBar}>
        <Text style={styles.balanceBarText}>
          {currencyMode === 'stars'
            ? `⭐ ${starsBalance.toLocaleString()} ${currency.premiumPlural.toLowerCase()} available`
            : `🪙 ${coinsBalance.toLocaleString()} ${currency.softPlural.toLowerCase()} available`}
        </Text>
        <Pressable onPress={() => router.push('/economy/store')}>
          <Text style={styles.addMoreText}>Add more</Text>
        </Pressable>
      </View>

      {/* Tier tabs */}
      {!catalogueLoading && tiers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tierTabs}
        >
          {tiers.map((tier: GiftTier) => (
            <Pressable
              key={tier.tier}
              onPress={() => {
                setActiveTier(tier.tier);
                setSelectedGift(null);
              }}
              style={[
                styles.tierTab,
                {
                  backgroundColor:
                    displayTier === tier.tier
                      ? TIER_BG[tier.tier] ?? colors.neutral[200]
                      : themeColors.surface,
                  borderColor:
                    displayTier === tier.tier
                      ? TIER_TEXT[tier.tier] ?? colors.neutral[400]
                      : colors.neutral[200],
                },
              ]}
            >
              <Text
                style={[
                  styles.tierTabText,
                  { color: displayTier === tier.tier ? TIER_TEXT[tier.tier] ?? colors.neutral[700] : colors.neutral[500] },
                ]}
              >
                {tier.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Gift grid */}
      {catalogueLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand.blue} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.giftGrid}
          showsVerticalScrollIndicator={false}
        >
          {(tierData?.gifts ?? []).map((item: GiftItem) => {
            const itemCost = currencyMode === 'stars' ? (item.starCost ?? 0) : item.coinCost;
            const canAfford = activeBalance >= itemCost;
            return (
              <GiftCard
                key={item.id}
                item={item}
                isSelected={selectedGift?.id === item.id}
                canAfford={canAfford}
                currencyMode={currencyMode}
                onSelect={(gift) => {
                  const cost = currencyMode === 'stars' ? (gift.starCost ?? 0) : gift.coinCost;
                  if (activeBalance < cost) {
                    const label = currencyMode === 'stars' ? currency.premiumPlural : currency.softPlural;
                    Alert.alert(
                      `Not Enough ${label}`,
                      `You need ${cost} ${label.toLowerCase()} but only have ${activeBalance}.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: `Add ${label}`, onPress: () => router.push('/economy/store') },
                      ]
                    );
                    return;
                  }
                  setSelectedGift(gift);
                }}
              />
            );
          })}
        </ScrollView>
      )}

      {/* Send button */}
      {selectedGift && (
        <View style={styles.sendBar}>
          <View style={styles.selectedPreview}>
            <Text style={styles.selectedEmoji}>{selectedGift.emoji}</Text>
            <View>
              <Text style={styles.selectedName}>{selectedGift.name}</Text>
              <Text style={styles.selectedCost}>
                {currencyMode === 'stars'
                  ? `⭐ ${(selectedGift.starCost ?? 0).toLocaleString()}`
                  : `🪙 ${selectedGift.coinCost.toLocaleString()}`}
              </Text>
            </View>
          </View>
          <Button
            label="Send Gift"
            loading={sendMutation.isPending}
            onPress={handleSend}
            style={styles.sendBtn}
          />
        </View>
      )}

      {/* PIN verification modal */}
      <Modal
        visible={pinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setPinModalVisible(false); setPinInput(''); }}
      >
        <View style={styles.pinOverlay}>
          <View style={[styles.pinSheet, { backgroundColor: themeColors.surface }]}>
            <Text style={[styles.pinTitle, { color: themeColors.text }]}>Enter PIN</Text>
            <Text style={[styles.pinSubtitle, { color: themeColors.textMuted }]}>
              Your PIN is required to send gifts.
            </Text>
            <TextInput
              style={[styles.pinInput, { color: themeColors.text, borderColor: pinError ? colors.semantic.error : themeColors.border, backgroundColor: themeColors.background }]}
              value={pinInput}
              onChangeText={(v) => { setPinInput(v.replace(/[^0-9]/g, '').slice(0, 4)); setPinError(null); }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={themeColors.textMuted}
              autoFocus
            />
            {pinError && <Text style={styles.pinErrorText}>{pinError}</Text>}
            <View style={styles.pinActions}>
              <Pressable
                style={styles.pinCancelBtn}
                onPress={() => { setPinModalVisible(false); setPinInput(''); setPinError(null); pendingSendParams.current = null; }}
              >
                <Text style={[styles.pinCancelText, { color: themeColors.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.pinConfirmBtn, { backgroundColor: colors.brand.blue, opacity: pinVerifying || pinInput.length < 4 ? 0.6 : 1 }]}
                onPress={() => void handlePinVerify()}
                disabled={pinVerifying || pinInput.length < 4}
              >
                {pinVerifying ? (
                  <ActivityIndicator size="small" color={colors.neutral[0]} />
                ) : (
                  <Text style={styles.pinConfirmText}>Verify</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Gift animation overlay */}
      {sentGiftResult && (
        <GiftAnimation
          visible={showAnimation}
          giftEmoji={sentGiftResult.gift.emoji}
          giftName={sentGiftResult.gift.name}
          tier={sentGiftResult.gift.tier}
          senderUsername="You"
          recipientUsername={recipientUsername}
          onDismiss={() => {
            setShowAnimation(false);
            setSentGiftResult(null);
            setSelectedGift(null);
            router.back();
          }}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    flex: 1,
  },
  balanceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    padding: 10,
  },
  balanceBarText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  addMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand.blue,
  },
  tierTabs: {
    paddingHorizontal: 20,
    gap: 8,
    paddingBottom: 12,
  },
  tierTab: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  tierTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 100,
  },
  giftCard: {
    width: '30%',
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
    padding: 10,
    gap: 4,
  },
  giftCardSelected: {
    borderColor: colors.brand.blue,
    backgroundColor: '#EFF6FF',
  },
  giftCardAfford: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
  giftEmoji: {
    fontSize: 32,
    lineHeight: 40,
  },
  giftName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[700],
    textAlign: 'center',
  },
  giftCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  giftCostIcon: {
    fontSize: 11,
  },
  giftCost: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  giftCostAfford: {
    color: colors.semantic.error,
  },
  sendBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.neutral[0],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.neutral[200],
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  selectedPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  selectedEmoji: {
    fontSize: 28,
  },
  selectedName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  selectedCost: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  sendBtn: {
    minWidth: 120,
  },
  currencyToggleRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  currencyToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
    alignItems: 'center',
    backgroundColor: colors.neutral[50],
  },
  currencyToggleActive: {
    borderColor: colors.brand.blue,
    backgroundColor: '#EFF6FF',
  },
  currencyToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  currencyToggleTextActive: {
    color: colors.brand.blue,
  },

  // PIN modal
  pinOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  pinSheet: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    gap: 12,
    alignItems: 'center',
  },
  pinTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  pinSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  pinInput: {
    width: 140,
    height: 52,
    borderWidth: 2,
    borderRadius: 14,
    fontSize: 28,
    textAlign: 'center',
    letterSpacing: 8,
    marginVertical: 8,
  },
  pinErrorText: {
    fontSize: 13,
    color: colors.semantic.error,
    textAlign: 'center',
  },
  pinActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    width: '100%',
  },
  pinCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pinConfirmBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[0],
  },
});

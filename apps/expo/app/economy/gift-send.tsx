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

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { GiftAnimation } from '@/components/economy/GiftAnimation';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';

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
  onSelect: (item: GiftItem) => void;
}

function GiftCard({ item, isSelected, canAfford, onSelect }: GiftCardProps) {
  return (
    <Pressable
      onPress={() => onSelect(item)}
      accessibilityLabel={`${item.name}, ${item.coinCost} coins`}
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
        <Text style={styles.giftCostIcon}>🪙</Text>
        <Text style={[styles.giftCost, !canAfford && styles.giftCostAfford]}>
          {item.coinCost.toLocaleString()}
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

  const sendMutation = useMutation<SendGiftResult, Error, { giftItemId: string; recipientId: string; roomId?: string }>({
    mutationFn: sendGift,
    onSuccess: (result) => {
      setSentGiftResult(result);
      setShowAnimation(true);
      // Invalidate balance cache so header updates
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'balance'] });
    },
    onError: (err) => {
      Alert.alert('Send Failed', err.message);
    },
  });

  const handleSend = () => {
    if (!selectedGift || !recipientId) return;

    Alert.alert(
      'Send Gift?',
      `Send ${selectedGift.emoji} ${selectedGift.name} to @${recipientUsername ?? 'user'} for ${selectedGift.coinCost} coins?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: () => {
            sendMutation.mutate({
              giftItemId: selectedGift.id,
              recipientId,
              roomId,
            });
          },
        },
      ]
    );
  };

  const tiers = catalogue?.tiers ?? [];
  const displayTier = activeTier ?? tiers[0]?.tier ?? 1;
  const tierData = tiers.find((t) => t.tier === displayTier);
  const coinsBalance = wallet?.coins ?? 0;

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

      {/* Coin balance reminder */}
      <View style={styles.balanceBar}>
        <Text style={styles.balanceBarText}>
          🪙 {coinsBalance.toLocaleString()} coins available
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
          {tiers.map((tier) => (
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
          {(tierData?.gifts ?? []).map((item) => (
            <GiftCard
              key={item.id}
              item={item}
              isSelected={selectedGift?.id === item.id}
              canAfford={coinsBalance >= item.coinCost}
              onSelect={(gift) => {
                if (coinsBalance < gift.coinCost) {
                  Alert.alert(
                    'Not Enough Coins',
                    `You need ${gift.coinCost} coins but only have ${coinsBalance}.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Add Coins', onPress: () => router.push('/economy/store') },
                    ]
                  );
                  return;
                }
                setSelectedGift(gift);
              }}
            />
          ))}
        </ScrollView>
      )}

      {/* Send button */}
      {selectedGift && (
        <View style={styles.sendBar}>
          <View style={styles.selectedPreview}>
            <Text style={styles.selectedEmoji}>{selectedGift.emoji}</Text>
            <View>
              <Text style={styles.selectedName}>{selectedGift.name}</Text>
              <Text style={styles.selectedCost}>🪙 {selectedGift.coinCost.toLocaleString()}</Text>
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
});

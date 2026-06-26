/**
 * CoinBalance
 *
 * Small, header-safe coin balance display component.
 * Shows the user's current coin balance alongside a coin emoji icon.
 * Taps to open the wallet screen.
 *
 * Fetches the balance from the API and caches it for 30 seconds.
 *
 * @module components/economy/CoinBalance
 */

import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BalanceResponse {
  coins: number;
  stars: number;
}

interface CoinBalanceProps {
  /** Optional override styles for the outer container. */
  style?: StyleProp<ViewStyle>;
  /**
   * Variant:
   *   - "compact" (default): coin icon + number only
   *   - "full":             coin icon + number + "Coins" label
   */
  variant?: 'compact' | 'full';
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchBalance(): Promise<BalanceResponse> {
  const { data } = await apiClient.get<BalanceResponse>('/economy/coins/balance');
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCoins(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CoinBalance — compact coin balance chip for navigation headers and profile bars.
 *
 * @example
 * // In a header right element:
 * <CoinBalance />
 *
 * // Full variant with label:
 * <CoinBalance variant="full" />
 */
export function CoinBalance({ style, variant = 'compact' }: CoinBalanceProps) {
  const router = useRouter();
  const currency = useCurrency();
  const { colors: themeColors } = useTheme();

  const { data, isLoading } = useQuery<BalanceResponse>({
    queryKey: ['wallet', 'balance'],
    queryFn: fetchBalance,
    staleTime: 30_000,
    refetchInterval: 60_000, // poll every minute while mounted
  });

  const handlePress = () => {
    router.push('/economy/wallet');
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityLabel={`${currency.softPlural} balance: ${data?.coins ?? 0} ${currency.softPlural.toLowerCase()}. Tap to open wallet.`}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: themeColors.surface },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text style={styles.icon} aria-hidden>
        🪙
      </Text>
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.brand.gold} />
      ) : (
        <Text style={styles.amount}>{formatCoins(data?.coins ?? 0)}</Text>
      )}
      {variant === 'full' && (
        <Text style={styles.label}>{currency.softPlural}</Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    minHeight: 32,
    minWidth: 44,
  },
  pressed: {
    opacity: 0.75,
  },
  icon: {
    fontSize: 16,
    lineHeight: 20,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
    letterSpacing: -0.3,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.neutral[500],
  },
});

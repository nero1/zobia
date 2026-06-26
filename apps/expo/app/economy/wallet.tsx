/**
 * Wallet Screen
 *
 * Displays the user's coin and star balances prominently, with a scrollable
 * transaction history and a top-up CTA.
 *
 * Route: /economy/wallet
 *
 * @module app/economy/wallet
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Decimal from 'decimal.js';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/lib/api/client';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Transaction {
  id: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  type: string;
  description: string | null;
  createdAt: string;
}

interface WalletData {
  coins: number;
  stars: number;
  transactions: Transaction[];
  starTransactions: Transaction[];
  plan?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchWallet(): Promise<WalletData> {
  const [{ data: balData }, planRes] = await Promise.all([
    apiClient.get<WalletData>('/economy/coins/balance?limit=30'),
    apiClient.get<{ data?: { plan?: string; subscription?: { plan?: string } } | null }>('/economy/subscriptions').catch(() => ({ data: null })),
  ]);
  const plan =
    (planRes.data as { data?: { plan?: string; subscription?: { plan?: string } } | null } | null)?.data?.plan ??
    (planRes.data as { data?: { plan?: string; subscription?: { plan?: string } } | null } | null)?.data?.subscription?.plan ??
    undefined;
  return { ...balData, plan };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCoins(amount: number): string {
  const d = new Decimal(amount);
  if (d.gte(1_000_000)) return `${d.div(1_000_000).toFixed(2)}M`;
  if (d.gte(1_000)) return `${d.div(1_000).toFixed(1)}K`;
  return d.toNumber().toLocaleString();
}

function formatDate(iso: string, locale = 'en'): string {
  const date = new Date(iso);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function txTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    purchase: 'Purchase',
    gift_sent: 'Gift Sent',
    gift_received: 'Gift Received',
    quest_reward: 'Quest Reward',
    dm_cost: 'Message',
    transfer_sent: 'Transfer Out',
    transfer_received: 'Transfer In',
    admin_grant: 'Bonus',
    refund: 'Refund',
  };
  return labels[type] ?? type;
}

// ---------------------------------------------------------------------------
// Transaction list item
// ---------------------------------------------------------------------------

function TransactionItem({ item }: { item: Transaction }) {
  const { i18n } = useTranslation();
  const isCredit = item.amount > 0;
  return (
    <View style={styles.txItem}>
      <View style={styles.txLeft}>
        <Text style={styles.txIcon}>{isCredit ? '🪙' : '•'}</Text>
        <View>
          <Text style={styles.txType}>{txTypeLabel(item.type)}</Text>
          {item.description ? (
            <Text style={styles.txDesc} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
          <Text style={styles.txDate}>{formatDate(item.createdAt, i18n.language)}</Text>
        </View>
      </View>
      <Text style={[styles.txAmount, isCredit ? styles.txCredit : styles.txDebit]}>
        {isCredit ? '+' : ''}{item.amount.toLocaleString()}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * WalletScreen — user's coin wallet with balance and history.
 */
export default function WalletScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();
  const currency = useCurrency();
  const [txTab, setTxTab] = React.useState<'coins' | 'stars'>('coins');

  const { data, isLoading, isError, refetch, isFetching } = useQuery<WalletData>({
    queryKey: ['wallet', 'balance'],
    queryFn: fetchWallet,
    staleTime: 30_000,
  });

  const txList = txTab === 'coins' ? (data?.transactions ?? []) : (data?.starTransactions ?? []);
  const planLabel = data?.plan
    ? data.plan.charAt(0).toUpperCase() + data.plan.slice(1)
    : 'Free';

  return (
    <Screen scrollable={false} disableBottomInset>
      <FlatList
        data={txList}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />
        }
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={styles.header}>
              <Pressable
                onPress={() => router.back()}
                accessibilityLabel="Go back"
                style={styles.backBtn}
              >
                <Text style={styles.backText}>{t('wallet.backBtn')}</Text>
              </Pressable>
              <Text style={styles.title}>{t('wallet.title')}</Text>
            </View>

            {/* Balance cards */}
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={colors.brand.blue} />
              </View>
            ) : isError ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{t('wallet.loadError')}</Text>
                <Button label={t('action.retry')} size="sm" variant="ghost" onPress={() => void refetch()} />
              </View>
            ) : (
              <>
                {/* Coin balance — prominent */}
                <View style={[styles.balanceCard, { backgroundColor: colors.brand.blue }]}>
                  <Text style={styles.balanceLabel}>{t('wallet.coinBalance')}</Text>
                  <View style={styles.balanceRow}>
                    <Text style={styles.balanceCoinIcon}>🪙</Text>
                    <Text style={styles.balanceAmount}>
                      {formatCoins(data?.coins ?? 0)}
                    </Text>
                  </View>
                  <Text style={styles.balanceExact}>
                    {(data?.coins ?? 0).toLocaleString()} {currency.softPlural.toLowerCase()}
                  </Text>
                </View>

                {/* Star balance + plan row */}
                <View style={styles.secondaryRow}>
                  <View style={[styles.starCard, { backgroundColor: themeColors.surface, flex: 1 }]}>
                    <Text style={styles.starIcon}>⭐</Text>
                    <View>
                      <Text style={styles.starAmount}>
                        {data?.stars ?? 0} {currency.premiumPlural}
                      </Text>
                      <Text style={styles.starSubtext}>{t('wallet.premiumCurrency')}</Text>
                    </View>
                  </View>
                  <Pressable
                    style={[styles.planCard, { backgroundColor: themeColors.surface }]}
                    onPress={() => router.push('/settings/subscription' as never)}
                  >
                    <Text style={styles.planLabel}>{t('subscription.currentPlan')}</Text>
                    <Text style={styles.planName}>{planLabel}</Text>
                    <Text style={styles.planManage}>{t('settings.manageSubscription')}</Text>
                  </Pressable>
                </View>

                {/* Add Coins CTA */}
                <Button
                  label={t('wallet.addCoins')}
                  onPress={() => router.push('/economy/store')}
                  style={styles.addCoinsBtn}
                />
              </>
            )}

            {/* Transaction tab selector */}
            <View style={styles.txTabRow}>
              <Text style={styles.sectionHeader}>{t('wallet.transactionHistory')}</Text>
              <View style={styles.txTabBtns}>
                <Pressable
                  style={[styles.txTabBtn, txTab === 'coins' && styles.txTabBtnActive]}
                  onPress={() => setTxTab('coins')}
                >
                  <Text style={[styles.txTabBtnText, txTab === 'coins' && styles.txTabBtnTextActive]}>
                    🪙 {currency.softPlural}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.txTabBtn, txTab === 'stars' && styles.txTabBtnActive]}
                  onPress={() => setTxTab('stars')}
                >
                  <Text style={[styles.txTabBtnText, txTab === 'stars' && styles.txTabBtnTextActive]}>
                    ⭐ {currency.premiumPlural}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => <TransactionItem item={item} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('wallet.noTransactions')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
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
    fontSize: 22,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  errorContainer: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    color: colors.semantic.error,
  },
  balanceCard: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 20,
    padding: 24,
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  balanceCoinIcon: {
    fontSize: 40,
  },
  balanceAmount: {
    fontSize: 52,
    fontWeight: '800',
    color: colors.neutral[0],
    letterSpacing: -1,
  },
  balanceExact: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  starCard: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  starIcon: {
    fontSize: 32,
  },
  starAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  starSubtext: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  addCoinsBtn: {
    marginHorizontal: 20,
    marginTop: 16,
  },
  secondaryRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    gap: 10,
  },
  planCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 90,
  },
  planLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  planName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  planManage: {
    fontSize: 11,
    color: colors.brand.blue,
    marginTop: 4,
  },
  txTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
    paddingTop: 24,
    paddingBottom: 4,
  },
  txTabBtns: {
    flexDirection: 'row',
    gap: 4,
  },
  txTabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  txTabBtnActive: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blue,
  },
  txTabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  txTabBtnTextActive: {
    color: colors.neutral[0],
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral[700],
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 12,
  },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  txLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  txIcon: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  txType: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  txDesc: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 1,
    maxWidth: 200,
  },
  txDate: {
    fontSize: 11,
    color: colors.neutral[400],
    marginTop: 2,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginLeft: 8,
  },
  txCredit: {
    color: colors.semantic.success,
  },
  txDebit: {
    color: colors.neutral[700],
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.neutral[400],
  },
  listContent: {
    paddingBottom: 40,
  },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

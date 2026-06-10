/**
 * app/(tabs)/wallet.tsx
 *
 * Wallet tab — shows coin balance, star balance, income, and pending payouts.
 * Navigates to the full wallet screen for transactions and coin store.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

interface Balance {
  coins: number;
  stars: number;
  plan?: string;
}

interface PendingPayout {
  id: string;
  gross_kobo: number;
  payout_method: string;
  status: string;
  created_at: string;
}

interface WalletData {
  coins: number;
  stars: number;
  plan: string;
  incomeMonth: number;
  pendingPayouts: PendingPayout[];
}

export default function WalletTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const router = useRouter();

  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const bg = isDark ? colors.neutral[950] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const border = isDark ? colors.neutral[800] : colors.neutral[200];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];
  const textSecondary = isDark ? colors.neutral[400] : colors.neutral[500];

  const load = useCallback(async () => {
    try {
      const [balRes, earningsRes, payoutsRes] = await Promise.all([
        apiClient.get('/api/economy/coins/balance'),
        apiClient.get('/api/creator/earnings').catch(() => null),
        apiClient.get('/api/creator/payouts').catch(() => null),
      ]);

      const bal: Balance = {
        coins: balRes.coins ?? balRes.data?.coins ?? 0,
        stars: balRes.stars ?? balRes.data?.stars ?? 0,
        plan: balRes.plan ?? balRes.data?.plan ?? 'free',
      };

      const earningsData = earningsRes?.data ?? earningsRes ?? {};
      const incomeMonth = earningsData?.month?.total_ngn ?? 0;

      const payoutsData = payoutsRes?.data ?? payoutsRes ?? {};
      const pendingStatuses = new Set(['pending', 'awaiting_approval', 'processing']);
      const pendingPayouts: PendingPayout[] = (payoutsData?.payouts ?? []).filter(
        (p: PendingPayout) => pendingStatuses.has(p.status ?? '')
      );

      setWalletData({ coins: bal.coins, stars: bal.stars, plan: bal.plan ?? 'free', incomeMonth, pendingPayouts });
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color={colors.brand.blue} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: bg }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[styles.heading, { color: textPrimary }]}>Wallet</Text>

      {/* Coin & Star Balance */}
      <View style={styles.balanceRow}>
        <View style={[styles.balanceCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={styles.balanceIcon}>🪙</Text>
          <Text style={[styles.balanceAmount, { color: textPrimary }]}>
            {(walletData?.coins ?? 0).toLocaleString()}
          </Text>
          <Text style={[styles.balanceLabel, { color: textSecondary }]}>Coins</Text>
        </View>
        <View style={[styles.balanceCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={styles.balanceIcon}>⭐</Text>
          <Text style={[styles.balanceAmount, { color: textPrimary }]}>
            {(walletData?.stars ?? 0).toLocaleString()}
          </Text>
          <Text style={[styles.balanceLabel, { color: textSecondary }]}>Stars</Text>
        </View>
      </View>

      {/* Income this month */}
      {(walletData?.incomeMonth ?? 0) > 0 && (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.sectionLabel, { color: textSecondary }]}>Income This Month</Text>
          <View style={styles.row}>
            <Text style={styles.balanceIcon}>💰</Text>
            <Text style={[styles.balanceAmount, { color: textPrimary }]}>
              ₦{walletData!.incomeMonth.toLocaleString()}
            </Text>
          </View>
          <Text style={[styles.cardSubtext, { color: textSecondary }]}>From gifts, tips, and sponsorships</Text>
        </View>
      )}

      {/* Pending Payouts */}
      {(walletData?.pendingPayouts.length ?? 0) > 0 && (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
          <Text style={[styles.sectionLabel, { color: textSecondary }]}>Pending Payouts</Text>
          {walletData!.pendingPayouts.map((p) => (
            <View key={p.id} style={[styles.payoutRow, { borderTopColor: border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.payoutMethod, { color: textPrimary }]}>
                  {(p.payout_method ?? 'bank_transfer').replace(/_/g, ' ')}
                </Text>
                <Text style={[styles.payoutDate, { color: textSecondary }]}>
                  {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[styles.payoutAmount, { color: textPrimary }]}>
                  ₦{((p.gross_kobo ?? 0) / 100).toLocaleString()}
                </Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{(p.status ?? 'pending').replace(/_/g, ' ')}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Plan */}
      <View style={[styles.planRow, { backgroundColor: cardBg, borderColor: border }]}>
        <View>
          <Text style={[styles.sectionLabel, { color: textSecondary }]}>Current Plan</Text>
          <Text style={[styles.planName, { color: textPrimary }]}>
            {((walletData?.plan ?? 'free').charAt(0).toUpperCase() + (walletData?.plan ?? 'free').slice(1))} Plan
          </Text>
        </View>
        <Pressable onPress={() => router.push('/settings/subscription' as never)}>
          <Text style={{ color: colors.brand.blue, fontSize: 13, fontWeight: '600' }}>Manage →</Text>
        </Pressable>
      </View>

      {/* Go to full wallet */}
      <Pressable
        onPress={() => router.push('/economy/wallet' as never)}
        style={[styles.ctaButton, { backgroundColor: colors.brand.blue }]}
      >
        <Text style={styles.ctaText}>View Full Wallet &amp; Buy Coins</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 100 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  balanceRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  balanceCard: {
    flex: 1, borderRadius: 16, borderWidth: 1, padding: 16, alignItems: 'center', gap: 4,
  },
  balanceIcon: { fontSize: 28 },
  balanceAmount: { fontSize: 22, fontWeight: '700' },
  balanceLabel: { fontSize: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardSubtext: { fontSize: 12, marginTop: 4 },
  payoutRow: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 10, borderTopWidth: 1, marginTop: 10 },
  payoutMethod: { fontSize: 14, fontWeight: '500', textTransform: 'capitalize' },
  payoutDate: { fontSize: 12, marginTop: 2 },
  payoutAmount: { fontSize: 14, fontWeight: '700' },
  statusBadge: { backgroundColor: '#fef3c7', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, fontWeight: '600', color: '#92400e', textTransform: 'capitalize' },
  planRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12,
  },
  planName: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  ctaButton: { borderRadius: 16, padding: 14, alignItems: 'center', marginTop: 4 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

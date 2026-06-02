/**
 * Profile tab — Phase 3 update.
 *
 * Adds coin balance chip in the header row alongside the username.
 * Future phases will add avatar, rank ring, stats, settings menu, etc.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth/hooks';
import { CoinBalance } from '@/components/economy/CoinBalance';
import { colors } from '@/lib/theme/colors';

/**
 * ProfileScreen — user profile tab with Phase 3 economy header.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  return (
    <Screen scrollable>
      {/* ── Profile header ─────────────────────────────────────── */}
      <View style={styles.header}>
        {/* Avatar placeholder */}
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarEmoji}>
            {user?.avatarEmoji ?? '🙂'}
          </Text>
        </View>

        <View style={styles.headerMeta}>
          <Text style={styles.username}>
            {user?.username ?? t('profile.title')}
          </Text>
          {user?.displayName ? (
            <Text style={styles.displayName}>{user.displayName}</Text>
          ) : null}
        </View>

        {/* Coin balance chip — taps to wallet */}
        <CoinBalance style={styles.coinChip} />
      </View>

      {/* ── Wallet shortcut card ────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/economy/wallet')}
        accessibilityLabel="Open wallet"
        style={({ pressed }) => [
          styles.walletCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.walletRow}>
          <Text style={styles.walletIcon}>🪙</Text>
          <View style={styles.walletTextGroup}>
            <Text style={styles.walletTitle}>My Wallet</Text>
            <Text style={styles.walletSubtitle}>Coins, stars & transactions</Text>
          </View>
          <Text style={styles.walletChevron}>›</Text>
        </View>
      </Pressable>

      {/* ── Store shortcut ──────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/economy/store')}
        accessibilityLabel="Open coin store"
        style={({ pressed }) => [
          styles.walletCard,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.walletRow}>
          <Text style={styles.walletIcon}>🛒</Text>
          <View style={styles.walletTextGroup}>
            <Text style={styles.walletTitle}>Coin Store</Text>
            <Text style={styles.walletSubtitle}>Buy coins and star packs</Text>
          </View>
          <Text style={styles.walletChevron}>›</Text>
        </View>
      </Pressable>

      {/* ── Coming soon placeholder ─────────────────────────────── */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          {t('common.comingSoon')}
        </Text>
        <Text style={styles.placeholderSub}>
          Avatar, rank ring, stats and achievements coming soon.
        </Text>
      </View>
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
    paddingTop: 20,
    paddingBottom: 16,
    gap: 12,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.neutral[200],
  },
  avatarEmoji: {
    fontSize: 28,
    lineHeight: 34,
  },
  headerMeta: {
    flex: 1,
    gap: 2,
  },
  username: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.neutral[900],
    letterSpacing: -0.3,
  },
  displayName: {
    fontSize: 13,
    color: colors.neutral[500],
  },
  coinChip: {
    // Overridden via the CoinBalance style prop; keeps it right-aligned
    flexShrink: 0,
  },
  walletCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.75,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  walletIcon: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  walletTextGroup: {
    flex: 1,
  },
  walletTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  walletSubtitle: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  walletChevron: {
    fontSize: 22,
    color: colors.neutral[400],
    fontWeight: '300',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 48,
    gap: 8,
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  placeholderSub: {
    fontSize: 13,
    color: colors.neutral[400],
    textAlign: 'center',
    lineHeight: 20,
  },
});

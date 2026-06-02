/**
 * components/rooms/TopGifters.tsx
 *
 * Top gifters leaderboard panel for the room.
 *
 * Shows the top 5 gifters in the last 24 hours.
 * The current #1 is highlighted with a gold ring.
 * Coin amounts are displayed prominently.
 *
 * NO purple. NO gradients.
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GifterEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  totalCoins: number;
  giftCount: number;
}

export interface TopGiftersProps {
  gifters: GifterEntry[];
  style?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Rank medal config
// ---------------------------------------------------------------------------

const RANK_MEDALS: Record<number, { label: string; color: string }> = {
  1: { label: '🥇', color: colors.brand.gold },
  2: { label: '🥈', color: colors.neutral[400] },
  3: { label: '🥉', color: '#CD7F32' },
};

// ---------------------------------------------------------------------------
// Sub-component: single gifter row
// ---------------------------------------------------------------------------

interface GifterRowProps {
  gifter: GifterEntry;
  isFirst: boolean;
}

function GifterRow({ gifter, isFirst }: GifterRowProps) {
  const medal = RANK_MEDALS[gifter.rank];

  return (
    <View style={[styles.row, isFirst && styles.rowFirst]}>
      {/* Rank / medal */}
      <View style={styles.rankCol}>
        {medal ? (
          <Text style={styles.medal}>{medal.label}</Text>
        ) : (
          <Text style={styles.rankNumber}>{gifter.rank}</Text>
        )}
      </View>

      {/* Avatar */}
      <View
        style={[
          styles.avatar,
          isFirst && styles.avatarFirst,
        ]}
      >
        <Text style={styles.avatarEmoji}>{gifter.avatarEmoji}</Text>
      </View>

      {/* Name */}
      <View style={styles.nameCol}>
        <Text
          style={[styles.displayName, isFirst && styles.displayNameFirst]}
          numberOfLines={1}
        >
          {gifter.displayName}
        </Text>
        <Text style={styles.username} numberOfLines={1}>
          @{gifter.username}
        </Text>
      </View>

      {/* Coins */}
      <View style={styles.coinsCol}>
        <View style={styles.coinsRow}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={[styles.coinAmount, isFirst && styles.coinAmountFirst]}>
            {gifter.totalCoins.toLocaleString()}
          </Text>
        </View>
        <Text style={styles.giftCount}>{gifter.giftCount} gifts</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * TopGifters — leaderboard panel showing the room's top 5 gifters.
 *
 * @param gifters - Sorted array of gifters (rank 1 = highest)
 * @param style   - Optional outer container override
 */
export const TopGifters = memo(function TopGifters({
  gifters,
  style,
}: TopGiftersProps) {
  if (gifters.length === 0) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.header}>Top Gifters (24h)</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No gifts yet — be the first! 🎁</Text>
        </View>
      </View>
    );
  }

  const topFive = gifters.slice(0, 5);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Top Gifters</Text>
        <Text style={styles.headerSub}>Last 24 hours</Text>
      </View>

      {topFive.map((gifter) => (
        <GifterRow
          key={gifter.userId}
          gifter={gifter}
          isFirst={gifter.rank === 1}
        />
      ))}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.neutral[0],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    overflow: 'hidden',
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  header: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  headerSub: {
    fontSize: 12,
    color: colors.neutral[500],
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[50],
  },
  rowFirst: {
    backgroundColor: `${colors.brand.gold}0D`,
  },

  // Rank
  rankCol: {
    width: 24,
    alignItems: 'center',
  },
  medal: {
    fontSize: 18,
  },
  rankNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[500],
  },

  // Avatar
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.neutral[200],
  },
  avatarFirst: {
    borderColor: colors.brand.gold,
    borderWidth: 2,
  },
  avatarEmoji: {
    fontSize: 20,
  },

  // Name
  nameCol: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  displayNameFirst: {
    color: colors.neutral[900],
    fontWeight: '700',
  },
  username: {
    fontSize: 11,
    color: colors.neutral[500],
  },

  // Coins
  coinsCol: {
    alignItems: 'flex-end',
  },
  coinsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  coinIcon: {
    fontSize: 12,
  },
  coinAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  coinAmountFirst: {
    color: colors.brand.goldDark,
    fontSize: 14,
  },
  giftCount: {
    fontSize: 11,
    color: colors.neutral[400],
  },

  // Empty
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: colors.neutral[500],
  },
});

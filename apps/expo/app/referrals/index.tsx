/**
 * app/referrals/index.tsx
 *
 * Referrals screen.
 *
 * Features:
 *  - Shows the user's referral link with Copy + Share buttons
 *  - Tier 1 and Tier 2 referral counts + XP/Coins earned
 *  - List of referred users with status
 */

import React from 'react';
import {
  Alert,
  Clipboard,
  FlatList,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferredUser {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  tier: 1 | 2;
  status: 'joined' | 'qualifying_done' | 'pending';
  joinedAt: string;
}

interface ReferralData {
  referralLink: string;
  tier1Count: number;
  tier2Count: number;
  totalXPEarned: number;
  totalCoinsEarned: number;
  referredUsers: ReferredUser[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchReferrals(): Promise<ReferralData> {
  const { data } = await apiClient.get<Record<string, unknown>>('/api/referrals');
  // API wraps response in { success, data: { referralUrl, referrals, ... } }
  const apiData = ((data.data ?? data) as Record<string, unknown>);
  const rawReferrals = (apiData.referrals ?? []) as Record<string, unknown>[];
  return {
    referralLink: String(apiData.referralUrl ?? apiData.referralLink ?? ''),
    tier1Count: Number(apiData.tier1Count ?? 0),
    tier2Count: Number(apiData.tier2Count ?? 0),
    totalXPEarned: Number(apiData.xpEarned ?? apiData.totalXPEarned ?? 0),
    totalCoinsEarned: Number(apiData.coinsEarned ?? apiData.totalCoinsEarned ?? 0),
    referredUsers: rawReferrals.map((r) => ({
      userId: String(r.id ?? r.userId ?? ''),
      displayName: String(r.referredDisplayName ?? r.displayName ?? 'Unknown'),
      avatarEmoji: String(r.referredAvatarEmoji ?? r.avatarEmoji ?? '😊'),
      tier: (Number(r.tier) === 1 ? 1 : 2) as 1 | 2,
      status: r.qualified ? 'qualifying_done' : 'joined',
      joinedAt: String(r.createdAt ?? r.created_at ?? ''),
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ReferredUser['status'], string> = {
  joined: 'Joined',
  qualifying_done: 'Qualifying done ✓',
  pending: 'Pending',
};

const STATUS_COLORS: Record<ReferredUser['status'], string> = {
  joined: colors.brand.blue,
  qualifying_done: colors.semantic.success,
  pending: colors.neutral[500],
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: themeColors.surface }]}>
      <Text style={[styles.statValue, { color: themeColors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>{label}</Text>
      {subtitle ? <Text style={[styles.statSub, { color: themeColors.textMuted }]}>{subtitle}</Text> : null}
    </View>
  );
}

function ReferredRow({ user }: { user: ReferredUser }) {
  const { colors: themeColors } = useTheme();
  const statusColor = STATUS_COLORS[user.status];
  return (
    <View style={[styles.referredRow, { borderBottomColor: themeColors.border }]}>
      <View style={styles.referredAvatar}>
        <Text style={styles.referredAvatarEmoji}>{user.avatarEmoji}</Text>
      </View>
      <View style={styles.referredInfo}>
        <Text style={[styles.referredName, { color: themeColors.text }]} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={[styles.referredStatus, { color: statusColor }]}>
          {STATUS_LABELS[user.status]}
        </Text>
      </View>
      <View style={[styles.tierBadge, user.tier === 1 ? styles.tier1Badge : styles.tier2Badge]}>
        <Text style={styles.tierBadgeText}>T{user.tier}</Text>
      </View>
    </View>
  );
}

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonLink} />
      <View style={styles.skeletonStatsRow}>
        {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonStat} />)}
      </View>
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ReferralsScreen() {
  const { colors: themeColors } = useTheme();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['referrals'],
    queryFn: fetchReferrals,
  });

  function handleCopy() {
    if (!data?.referralLink) return;
    Clipboard.setString(data.referralLink);
    Alert.alert('Copied!', 'Referral link copied to clipboard.');
  }

  async function handleShare() {
    if (!data?.referralLink) return;
    try {
      await Share.share({
        message: `Join me on Zobia Social! ${data.referralLink}`,
        url: data.referralLink,
      });
    } catch {
      // User cancelled or share not available
    }
  }

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError || !data) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load referral data.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={data.referredUsers}
        keyExtractor={(u) => u.userId}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View>
            {/* Title */}
            <View style={styles.titleSection}>
              <Text style={styles.titleEmoji}>🤝</Text>
              <Text style={[styles.title, { color: themeColors.text }]}>Referrals</Text>
              <Text style={[styles.subtitle, { color: themeColors.textMuted }]}>
                Earn XP and coins for every friend you bring to Zobia.
              </Text>
            </View>

            {/* Referral link */}
            <View style={[styles.linkCard, { backgroundColor: themeColors.surface }]}>
              <Text style={[styles.linkLabel, { color: themeColors.textMuted }]}>Your referral link</Text>
              <Text style={[styles.linkText, { color: themeColors.text }]} numberOfLines={2} selectable>
                {data.referralLink}
              </Text>
              <View style={styles.linkActions}>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={handleCopy}
                  accessibilityRole="button"
                  accessibilityLabel="Copy referral link"
                >
                  <Text style={styles.copyBtnText}>Copy Link</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => void handleShare()}
                  accessibilityRole="button"
                  accessibilityLabel="Share referral link"
                >
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
              <StatCard label="Tier 1 Referrals" value={data.tier1Count.toString()} />
              <StatCard label="Tier 2 Referrals" value={data.tier2Count.toString()} />
              <StatCard label="Total XP" value={`+${data.totalXPEarned.toLocaleString()}`} />
            </View>

            <View style={styles.coinsEarned}>
              <Text style={[styles.coinsEarnedLabel, { color: themeColors.textMuted }]}>Coins earned from referrals</Text>
              <Text style={styles.coinsEarnedValue}>🪙 {data.totalCoinsEarned.toLocaleString()}</Text>
            </View>

            {/* Section header */}
            {data.referredUsers.length > 0 && (
              <Text style={[styles.listHeader, { color: themeColors.text }]}>
                Referred Users ({data.referredUsers.length})
              </Text>
            )}
          </View>
        )}
        renderItem={({ item }) => <ReferredRow user={item} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              No referrals yet. Share your link to get started!
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  titleSection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  titleEmoji: { fontSize: 40 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  linkCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    marginBottom: 12,
  },
  linkLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  linkText: { fontSize: 14, lineHeight: 20 },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  copyBtn: {
    flex: 1,
    backgroundColor: colors.neutral[100],
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: colors.neutral[700] },
  shareBtn: {
    flex: 1,
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: colors.neutral[0] },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },
  statSub: { fontSize: 10, textAlign: 'center' },

  coinsEarned: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: `${colors.brand.gold}14`,
  },
  coinsEarnedLabel: { fontSize: 13 },
  coinsEarnedValue: { fontSize: 15, fontWeight: '800', color: colors.brand.goldDark },

  listHeader: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  referredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    minHeight: 56,
  },
  referredAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  referredAvatarEmoji: { fontSize: 22 },
  referredInfo: { flex: 1 },
  referredName: { fontSize: 14, fontWeight: '600' },
  referredStatus: { fontSize: 12, marginTop: 2 },
  tierBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 32,
    alignItems: 'center',
  },
  tier1Badge: { backgroundColor: colors.brand.blue },
  tier2Badge: { backgroundColor: colors.neutral[400] },
  tierBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonLink: { height: 120, borderRadius: 14, backgroundColor: colors.neutral[200] },
  skeletonStatsRow: { flexDirection: 'row', gap: 8 },
  skeletonStat: { flex: 1, height: 70, borderRadius: 12, backgroundColor: colors.neutral[200] },
  skeletonRow: { height: 56, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

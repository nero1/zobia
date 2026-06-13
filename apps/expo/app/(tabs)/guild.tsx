/**
 * app/(tabs)/guild.tsx
 *
 * Guild tab — overview of the user's guild.
 *
 * State A — not in a guild:
 *  - "Find Your Crew" hero with description
 *  - "Discover Guilds" button → /guilds
 *  - "Create Guild" button → /guilds/create
 *
 * State B — in a guild:
 *  - Guild header: crest emoji, name, tier badge
 *  - Treasury balance and XP tier progress bar
 *  - Active war card (if any): opponent, scores, time remaining, "Join War"
 *  - User's contribution score
 *  - Member count / max members
 *  - "View Full Guild" button → /guilds/[guildId]
 *
 * Data: GET /api/guilds?mine=true
 * Offline-tolerant: shows cached data via staleTime / placeholderData.
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GuildTier = 'iron' | 'bronze' | 'silver' | 'gold' | 'diamond';

interface ActiveWar {
  warId: string;
  opponentName: string;
  opponentCrest: string;
  ourScore: number;
  theirScore: number;
  endsAt: string; // ISO timestamp
}

interface MyGuild {
  id: string;
  name: string;
  crestEmoji: string;
  tier: GuildTier;
  memberCount: number;
  maxMembers: number;
  treasuryCoins: number;
  /** XP earned this tier, 0–tierXPGoal */
  currentXP: number;
  /** XP needed to reach the next tier */
  tierXPGoal: number;
  /** Authenticated user's contribution XP */
  myContributionXP: number;
  activeWar: ActiveWar | null;
}

interface GuildListResponse {
  guilds: MyGuild[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<GuildTier, { label: string; color: string }> = {
  iron: { label: 'Iron', color: colors.neutral[500] },
  bronze: { label: 'Bronze', color: '#CD7F32' },
  silver: { label: 'Silver', color: '#A8A9AD' },
  gold: { label: 'Gold', color: colors.brand.gold },
  diamond: { label: 'Diamond', color: colors.brand.blue },
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchMyGuilds(): Promise<MyGuild[]> {
  const { data } = await apiClient.get<GuildListResponse>('/guilds?mine=true');
  return data.guilds ?? [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats "2h 15m remaining" or "Ended" from an ISO end timestamp. */
function formatTimeRemaining(endsAt: string): string {
  const diffMs = new Date(endsAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Ended';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GuildTabSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonHeader} />
      <View style={styles.skeletonBar} />
      <View style={styles.skeletonCard} />
      <View style={styles.skeletonCard} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Tier progress bar. */
function XPProgressBar({
  currentXP,
  tierXPGoal,
  tierColor,
}: {
  currentXP: number;
  tierXPGoal: number;
  tierColor: string;
}) {
  const progress = tierXPGoal > 0 ? Math.min(currentXP / tierXPGoal, 1) : 0;
  return (
    <View style={styles.progressWrapper}>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: tierColor },
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {currentXP.toLocaleString()} / {tierXPGoal.toLocaleString()} XP
      </Text>
    </View>
  );
}

/** Active war card. */
function WarCard({ war, onJoin }: { war: ActiveWar; onJoin: () => void }) {
  const timeLabel = formatTimeRemaining(war.endsAt);
  const isEnded = timeLabel === 'Ended';
  return (
    <View style={styles.warCard}>
      <View style={styles.warCardHeader}>
        <Text style={styles.warCardTitle}>⚔️ Active War</Text>
        <Text style={[styles.warTimeLabel, isEnded && { color: colors.semantic.error }]}>
          {timeLabel}
        </Text>
      </View>
      <View style={styles.warScoreRow}>
        <Text style={styles.warScore}>{war.ourScore}</Text>
        <View style={styles.warVsBlock}>
          <Text style={styles.warOpponentCrest}>{war.opponentCrest}</Text>
          <Text style={styles.warVsText}>vs</Text>
          <Text style={styles.warOpponentName} numberOfLines={1}>
            {war.opponentName}
          </Text>
        </View>
        <Text style={styles.warScore}>{war.theirScore}</Text>
      </View>
      {!isEnded && (
        <Pressable
          style={({ pressed }) => [styles.joinWarBtn, pressed && styles.joinWarBtnPressed]}
          onPress={onJoin}
          accessibilityRole="button"
          accessibilityLabel="Join the war"
        >
          <Text style={styles.joinWarBtnText}>Join War</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// State A — no guild
// ---------------------------------------------------------------------------

function NoGuildView({
  onDiscover,
  onCreate,
}: {
  onDiscover: () => void;
  onCreate: () => void;
}) {
  return (
    <View style={styles.noGuildContainer}>
      <Text style={styles.noGuildEmoji}>🛡️</Text>
      <Text style={styles.noGuildTitle}>Find Your Crew</Text>
      <Text style={styles.noGuildDesc}>
        Guilds are squads of players who compete in wars, share a treasury, and
        climb the leaderboard together. Join one or build your own.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
        onPress={onDiscover}
        accessibilityRole="button"
        accessibilityLabel="Discover guilds"
      >
        <Text style={styles.primaryBtnText}>Discover Guilds</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
        onPress={onCreate}
        accessibilityRole="button"
        accessibilityLabel="Create a guild"
      >
        <Text style={styles.secondaryBtnText}>Create Guild</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// State B — in a guild
// ---------------------------------------------------------------------------

function MyGuildView({ guild }: { guild: MyGuild }) {
  const router = useRouter();
  const tierCfg = TIER_CONFIG[guild.tier];

  const handleViewFull = useCallback(() => {
    router.push(`/guilds/${guild.id}` as never);
  }, [router, guild.id]);

  const handleJoinWar = useCallback(() => {
    if (guild.activeWar) {
      router.push(`/guilds/${guild.id}/war/${guild.activeWar.warId}` as never);
    }
  }, [router, guild.id, guild.activeWar]);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.guildScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Guild header */}
      <View style={styles.guildHeader}>
        <Text style={styles.guildCrest}>{guild.crestEmoji}</Text>
        <Text style={styles.guildName}>{guild.name}</Text>
        <View style={[styles.tierBadge, { backgroundColor: tierCfg.color }]}>
          <Text style={styles.tierBadgeText}>{tierCfg.label}</Text>
        </View>
      </View>

      {/* Treasury */}
      <View style={styles.treasuryRow}>
        <Text style={styles.treasuryLabel}>🏦 Treasury</Text>
        <Text style={styles.treasuryValue}>
          🪙 {guild.treasuryCoins.toLocaleString()} coins
        </Text>
      </View>

      {/* XP progress */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionCardTitle}>Tier Progress</Text>
        <XPProgressBar
          currentXP={guild.currentXP}
          tierXPGoal={guild.tierXPGoal}
          tierColor={tierCfg.color}
        />
      </View>

      {/* Active war */}
      {guild.activeWar && (
        <WarCard war={guild.activeWar} onJoin={handleJoinWar} />
      )}

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>
            {guild.memberCount}/{guild.maxMembers}
          </Text>
          <Text style={styles.statLabel}>Members</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCell}>
          <Text style={styles.statValue}>
            {guild.myContributionXP.toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>My XP</Text>
        </View>
      </View>

      {/* View full guild */}
      <Pressable
        style={({ pressed }) => [styles.viewFullBtn, pressed && styles.viewFullBtnPressed]}
        onPress={handleViewFull}
        accessibilityRole="button"
        accessibilityLabel={`View full guild profile for ${guild.name}`}
      >
        <Text style={styles.viewFullBtnText}>View Full Guild →</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * GuildScreen — shows the user's guild overview or an invitation to join/create.
 */
export default function GuildScreen() {
  const router = useRouter();

  const {
    data: guilds,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['my-guilds'],
    queryFn: fetchMyGuilds,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const handleDiscover = useCallback(() => {
    router.push('/guilds' as never);
  }, [router]);

  const handleCreate = useCallback(() => {
    router.push('/guilds/create' as never);
  }, [router]);

  // Render loading state
  if (isLoading && !guilds) {
    return (
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>Guild</Text>
        </View>
        <GuildTabSkeleton />
      </Screen>
    );
  }

  // Render error with no cached data
  if (isError && !guilds) {
    return (
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>Guild</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            Could not load guild data. Check your connection.
          </Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => refetch()}
            accessibilityRole="button"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const myGuild = guilds && guilds.length > 0 ? guilds[0] : null;

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Guild</Text>
        {isLoading && (
          <ActivityIndicator size="small" color={colors.brand.blue} />
        )}
      </View>

      {myGuild ? (
        <MyGuildView guild={myGuild} />
      ) : (
        <NoGuildView onDiscover={handleDiscover} onCreate={handleCreate} />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.neutral[900],
  },

  // Centered utility
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: colors.semantic.error,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[700],
  },

  // -----------------------------------------------------------------------
  // State A — no guild
  // -----------------------------------------------------------------------
  noGuildContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  noGuildEmoji: {
    fontSize: 64,
    marginBottom: 4,
  },
  noGuildTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.neutral[900],
    textAlign: 'center',
  },
  noGuildDesc: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[500],
    textAlign: 'center',
    marginBottom: 8,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnPressed: {
    backgroundColor: colors.brand.blueDark,
  },
  primaryBtnText: {
    color: colors.neutral[0],
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: colors.neutral[100],
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
  },
  secondaryBtnPressed: {
    backgroundColor: colors.neutral[200],
  },
  secondaryBtnText: {
    color: colors.neutral[700],
    fontSize: 16,
    fontWeight: '700',
  },

  // -----------------------------------------------------------------------
  // State B — in a guild
  // -----------------------------------------------------------------------
  guildScrollContent: {
    paddingBottom: 40,
    gap: 12,
  },

  // Guild header
  guildHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 8,
  },
  guildCrest: {
    fontSize: 56,
  },
  guildName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[900],
    textAlign: 'center',
  },
  tierBadge: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  tierBadgeText: {
    color: colors.neutral[0],
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Treasury
  treasuryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    backgroundColor: `${colors.brand.gold}18`,
    borderRadius: 10,
    padding: 12,
  },
  treasuryLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.brand.goldDark,
  },
  treasuryValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.brand.gold,
  },

  // Section card (XP progress)
  sectionCard: {
    marginHorizontal: 16,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    gap: 10,
  },
  sectionCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[600],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // XP progress bar
  progressWrapper: {
    gap: 6,
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.neutral[200],
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: 12,
    color: colors.neutral[500],
    textAlign: 'right',
  },

  // War card
  warCard: {
    marginHorizontal: 16,
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.semantic.error,
    gap: 12,
  },
  warCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  warTimeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  warScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  warScore: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.neutral[900],
    width: 56,
    textAlign: 'center',
  },
  warVsBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  warOpponentCrest: {
    fontSize: 28,
  },
  warVsText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[400],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  warOpponentName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[600],
    textAlign: 'center',
  },
  joinWarBtn: {
    backgroundColor: colors.semantic.error,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  joinWarBtnPressed: {
    opacity: 0.85,
  },
  joinWarBtnText: {
    color: colors.neutral[0],
    fontSize: 15,
    fontWeight: '700',
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  statLabel: {
    fontSize: 11,
    color: colors.neutral[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.neutral[200],
    marginVertical: 4,
  },

  // View full guild button
  viewFullBtn: {
    marginHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.brand.blue,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  viewFullBtnPressed: {
    backgroundColor: `${colors.brand.blue}12`,
  },
  viewFullBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.brand.blue,
  },

  // -----------------------------------------------------------------------
  // Skeleton
  // -----------------------------------------------------------------------
  skeletonContainer: {
    padding: 16,
    gap: 12,
  },
  skeletonHeader: {
    height: 140,
    borderRadius: 14,
    backgroundColor: colors.neutral[200],
  },
  skeletonBar: {
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.neutral[200],
  },
  skeletonCard: {
    height: 88,
    borderRadius: 12,
    backgroundColor: colors.neutral[200],
  },
});

/**
 * app/guilds/[guildId].tsx
 *
 * Guild detail screen.
 *
 * Features:
 *  - Guild header: crest emoji, name, tier badge, city
 *  - Stats row: members, wars won, XP total
 *  - Treasury balance (visible to members only)
 *  - Member list with contribution scores
 *  - War history
 *  - Join / Leave button
 *  - Skeleton loader + offline graceful state
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import {
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GuildTier = 'iron' | 'bronze' | 'silver' | 'gold' | 'diamond' | 'legend';

interface GuildMember {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  role: 'leader' | 'officer' | 'member';
  contributionXP: number;
  joinedAt: string;
}

interface WarRecord {
  warId: string;
  opponentName: string;
  opponentCrest: string;
  ourScore: number;
  theirScore: number;
  outcome: 'win' | 'loss' | 'draw';
  endedAt: string;
}

interface Guild {
  id: string;
  name: string;
  crestEmoji: string;
  tier: GuildTier;
  city: string | null;
  description: string | null;
  memberCount: number;
  maxMembers: number;
  warsWon: number;
  totalXP: number;
  treasuryCoins: number;
  isMember: boolean;
  isLeader: boolean;
  members: GuildMember[];
  warHistory: WarRecord[];
}

// ---------------------------------------------------------------------------
// Tier config
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<GuildTier, { label: string; color: string }> = {
  iron: { label: 'Iron', color: colors.neutral[500] },
  bronze: { label: 'Bronze', color: '#CD7F32' },
  silver: { label: 'Silver', color: '#A8A9AD' },
  gold: { label: 'Gold', color: colors.brand.gold },
  diamond: { label: 'Diamond', color: colors.brand.blue },
  legend: { label: 'Legend', color: '#FF6B00' },
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchGuild(guildId: string): Promise<Guild> {
  const { data } = await apiClient.get(`/guilds/${guildId}`);
  return data.guild;
}

async function joinGuild(guildId: string): Promise<void> {
  await apiClient.post(`/guilds/${guildId}/join`);
}

async function leaveGuild(guildId: string): Promise<void> {
  await apiClient.post(`/guilds/${guildId}/leave`);
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GuildSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonHeader} />
      <View style={styles.skeletonStatsRow}>
        {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonStat} />)}
      </View>
      {[1, 2, 3, 4].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StatBoxProps {
  label: string;
  value: string;
}

function StatBox({ label, value }: StatBoxProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color: themeColors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>{label}</Text>
    </View>
  );
}

function MemberRow({ member }: { member: GuildMember }) {
  const { colors: themeColors } = useTheme();
  const roleColors: Record<string, string> = {
    leader: colors.brand.gold,
    officer: colors.brand.blue,
    member: colors.neutral[500],
  };
  return (
    <View style={[styles.memberRow, { borderBottomColor: themeColors.border }]}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarEmoji}>{member.avatarEmoji}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: themeColors.text }]} numberOfLines={1}>
          {member.displayName}
        </Text>
        <Text style={[styles.memberRole, { color: roleColors[member.role] }]}>
          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
        </Text>
      </View>
      <View style={styles.memberContrib}>
        <Text style={styles.memberContribXP}>
          {member.contributionXP.toLocaleString()} XP
        </Text>
      </View>
    </View>
  );
}

function WarRow({ war }: { war: WarRecord }) {
  const { colors: themeColors } = useTheme();
  const outcomeColor =
    war.outcome === 'win'
      ? colors.semantic.success
      : war.outcome === 'loss'
      ? colors.semantic.error
      : colors.neutral[500];

  return (
    <View style={[styles.warRow, { borderBottomColor: themeColors.border }]}>
      <Text style={styles.warCrest}>{war.opponentCrest}</Text>
      <View style={styles.warInfo}>
        <Text style={[styles.warOpponent, { color: themeColors.text }]} numberOfLines={1}>
          vs {war.opponentName}
        </Text>
        <Text style={[styles.warDate, { color: themeColors.textMuted }]}>
          {new Date(war.endedAt).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.warScores}>
        <Text style={[styles.warOutcome, { color: outcomeColor }]}>
          {war.outcome.toUpperCase()}
        </Text>
        <Text style={[styles.warScore, { color: themeColors.textMuted }]}>
          {war.ourScore} – {war.theirScore}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * GuildDetailScreen — displays full guild profile with member list and wars.
 */
export default function GuildDetailScreen() {
  const { guildId } = useLocalSearchParams<{ guildId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const currency = useCurrency();

  const { data: guild, isLoading, isError } = useQuery({
    queryKey: ['guild', guildId],
    queryFn: () => fetchGuild(guildId!),
    enabled: !!guildId,
  });

  const joinMutation = useMutation({
    mutationFn: () => joinGuild(guildId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guild', guildId] }),
    onError: () => Alert.alert('Error', 'Could not join guild.'),
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveGuild(guildId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guild', guildId] }),
    onError: () => Alert.alert('Error', 'Could not leave guild.'),
  });

  const handleJoinLeave = useCallback(() => {
    if (!guild) return;
    if (guild.isMember) {
      Alert.alert('Leave Guild', `Leave ${guild.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => leaveMutation.mutate() },
      ]);
    } else {
      joinMutation.mutate();
    }
  }, [guild, joinMutation, leaveMutation]);

  // Legend tier: pulsing crest animation (Reanimated loop, no gradient per PRD Appendix B)
  // Hooks must run unconditionally on every render, so this stays above the
  // isLoading/isError early returns below (guild may be undefined here).
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!guild || guild.tier !== 'legend') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [guild, pulseAnim]);

  if (isLoading) {
    return (
      <Screen>
        <GuildSkeleton />
      </Screen>
    );
  }

  if (isError || !guild) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load guild. Check your connection.
          </Text>
        </View>
      </Screen>
    );
  }

  const tierCfg = TIER_CONFIG[guild.tier as GuildTier];

  return (
    <Screen>
      <SectionList<GuildMember | WarRecord>
        sections={[
          { title: 'members', data: guild.members as (GuildMember | WarRecord)[] },
          { title: 'wars', data: guild.warHistory as (GuildMember | WarRecord)[] },
        ]}
        keyExtractor={(item) =>
          'userId' in item ? item.userId : (item as WarRecord).warId
        }
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={() => (
          <View>
            {/* Guild header */}
            <View style={[styles.header, { backgroundColor: themeColors.surface }]}>
              <Animated.Text style={[styles.crestEmoji, guild.tier === 'legend' && { transform: [{ scale: pulseAnim }] }]}>{guild.crestEmoji}</Animated.Text>
              <Text style={[styles.guildName, { color: themeColors.text }]}>{guild.name}</Text>
              <View style={[styles.tierBadge, { backgroundColor: tierCfg.color }]}>
                <Text style={styles.tierBadgeText}>{tierCfg.label}</Text>
              </View>
              {guild.city && (
                <Text style={[styles.city, { color: themeColors.textMuted }]}>
                  📍 {guild.city}
                </Text>
              )}
              {guild.description && (
                <Text style={[styles.description, { color: themeColors.textMuted }]}>
                  {guild.description}
                </Text>
              )}
            </View>

            {/* Stats */}
            <View style={[styles.statsRow, { borderBottomColor: themeColors.border }]}>
              <StatBox label="Members" value={`${guild.memberCount}/${guild.maxMembers}`} />
              <View style={styles.statDivider} />
              <StatBox label="Wars Won" value={guild.warsWon.toLocaleString()} />
              <View style={styles.statDivider} />
              <StatBox label="Total XP" value={`${(guild.totalXP / 1000).toFixed(1)}K`} />
            </View>

            {/* Treasury (members only) */}
            {guild.isMember && (
              <View style={[styles.treasury, { backgroundColor: `${colors.brand.gold}18` }]}>
                <Text style={styles.treasuryLabel}>🏦 Treasury</Text>
                <Text style={styles.treasuryValue}>
                  🪙 {guild.treasuryCoins.toLocaleString()} {currency.softPlural.toLowerCase()}
                </Text>
              </View>
            )}

            {/* Guild Chat (members only) */}
            {guild.isMember && (
              <Pressable
                style={[styles.chatButton, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
                onPress={() => router.push(`/guilds/${guildId}/chat`)}
              >
                <Text style={styles.chatButtonIcon}>💬</Text>
                <Text style={[styles.chatButtonLabel, { color: themeColors.text }]}>Guild Chat</Text>
                <Text style={styles.chatButtonChevron}>›</Text>
              </Pressable>
            )}

            {/* Join / Leave */}
            {!guild.isLeader && (
              <View style={styles.joinSection}>
                <Button
                  label={guild.isMember ? 'Leave Guild' : `Join Guild`}
                  variant={guild.isMember ? 'secondary' : 'primary'}
                  onPress={handleJoinLeave}
                  loading={joinMutation.isPending || leaveMutation.isPending}
                />
              </View>
            )}

            <Text style={[styles.sectionHeading, { color: themeColors.text }]}>
              Members ({guild.memberCount})
            </Text>
          </View>
        )}
        renderItem={({ item, section }) => {
          if (section.title === 'members') {
            return <MemberRow member={item as GuildMember} />;
          }
          return <WarRow war={item as WarRecord} />;
        }}
        renderSectionHeader={({ section }) =>
          section.title === 'wars' ? (
            <Text style={[styles.sectionHeading, { color: themeColors.text, paddingHorizontal: 16 }]}>
              War History
            </Text>
          ) : null
        }
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
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 8,
  },
  crestEmoji: { fontSize: 56 },
  guildName: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  tierBadge: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tierBadgeText: { color: colors.neutral[0], fontSize: 12, fontWeight: '700' },
  city: { fontSize: 13 },
  description: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  statsRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.neutral[200],
    marginVertical: 4,
  },

  treasury: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
  },
  treasuryLabel: { fontSize: 14, fontWeight: '700', color: colors.brand.goldDark },
  treasuryValue: { fontSize: 15, fontWeight: '800', color: colors.brand.gold },

  joinSection: { paddingHorizontal: 16, marginTop: 12, marginBottom: 4 },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  chatButtonIcon: { fontSize: 20 },
  chatButtonLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  chatButtonChevron: { fontSize: 20, color: '#999' },

  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarEmoji: { fontSize: 22 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '600' },
  memberRole: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  memberContrib: { alignItems: 'flex-end' },
  memberContribXP: { fontSize: 13, fontWeight: '700', color: colors.brand.blue },

  warRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  warCrest: { fontSize: 28 },
  warInfo: { flex: 1 },
  warOpponent: { fontSize: 14, fontWeight: '600' },
  warDate: { fontSize: 12, marginTop: 1 },
  warScores: { alignItems: 'flex-end', gap: 2 },
  warOutcome: { fontSize: 12, fontWeight: '800' },
  warScore: { fontSize: 12 },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonHeader: {
    height: 160,
    borderRadius: 14,
    backgroundColor: colors.neutral[200],
  },
  skeletonStatsRow: { flexDirection: 'row', gap: 12 },
  skeletonStat: { flex: 1, height: 52, borderRadius: 10, backgroundColor: colors.neutral[200] },
  skeletonRow: { height: 56, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

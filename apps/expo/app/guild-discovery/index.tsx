/**
 * Zobia Social — Guild Discovery Screen.
 *
 * Shown after the user's first 24 hours via deep link or notification.
 * Fetches suggested guilds and lets the user join one.
 *
 * Route: /guild-discovery
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuildDiscovery {
  id: string;
  name: string;
  crestEmoji: string;
  city: string | null;
  tier: string;
  memberCount: number;
  warWins: number;
  xpBoostPercent: number;
  isRecruiting: boolean;
}

interface GuildDiscoveryResponse {
  data: {
    guilds: GuildDiscovery[];
    userCity: string | null;
    guildEmphasis: 'guild' | 'solo' | null;
    soloNote: string | null;
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchDiscoveryGuilds(): Promise<GuildDiscoveryResponse> {
  const { data } = await apiClient.get<GuildDiscoveryResponse>('/guilds/discovery');
  return data;
}

async function joinGuild(guildId: string): Promise<void> {
  await apiClient.post(`/guilds/${guildId}/join`);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface GuildCardProps {
  guild: GuildDiscovery;
  onJoin: (guildId: string) => void;
  joinedId: string | null;
  joiningId: string | null;
  isDark: boolean;
}

function GuildCard({ guild, onJoin, joinedId, joiningId, isDark }: GuildCardProps) {
  const isJoined = joinedId === guild.id;
  const isJoining = joiningId === guild.id;
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const cardBorder = isJoined
    ? colors.brand.green
    : isDark ? colors.neutral[700] : colors.neutral[200];

  return (
    <View
      style={[
        styles.guildCard,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      {/* Crest + Title row */}
      <View style={styles.guildHeader}>
        <View style={[styles.crestCircle, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[100] }]}>
          <Text style={styles.crestEmoji}>{guild.crestEmoji}</Text>
        </View>
        <View style={styles.guildInfo}>
          <View style={styles.guildTitleRow}>
            <Text style={[styles.guildName, { color: textColor }]} numberOfLines={1}>
              {guild.name}
            </Text>
            <View style={[styles.tierBadge, { backgroundColor: colors.brand.gold + '20' }]}>
              <Text style={[styles.tierText, { color: colors.brand.goldDark ?? colors.brand.gold }]}>
                {guild.tier}
              </Text>
            </View>
          </View>
          {guild.city ? (
            <Text style={[styles.guildCity, { color: subtitleColor }]}>
              📍 {guild.city}
            </Text>
          ) : null}
          <View style={styles.guildMetaRow}>
            <Text style={[styles.guildMeta, { color: subtitleColor }]}>
              {guild.memberCount} members
            </Text>
            {guild.warWins > 0 && (
              <Text style={[styles.guildMeta, { color: subtitleColor }]}>
                · {guild.warWins} wars won
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* XP Boost + Join row */}
      <View style={styles.guildFooter}>
        <View style={[styles.xpBoostBadge, { backgroundColor: colors.brand.blue + '15' }]}>
          <Text style={[styles.xpBoostText, { color: colors.brand.blue }]}>
            +{guild.xpBoostPercent}% XP
          </Text>
        </View>

        {isJoined ? (
          <View style={styles.joinedBadge}>
            <Text style={styles.joinedText}>✓ Joined!</Text>
          </View>
        ) : (
          <Pressable
            style={[
              styles.joinBtn,
              { backgroundColor: colors.brand.blue },
              isJoining && { opacity: 0.7 },
            ]}
            onPress={() => onJoin(guild.id)}
            disabled={isJoining || !!joinedId}
            accessibilityRole="button"
            accessibilityLabel={`Join ${guild.name} guild`}
          >
            {isJoining ? (
              <ActivityIndicator size="small" color={colors.neutral[0]} />
            ) : (
              <Text style={styles.joinBtnText}>Join</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const bg = isDark ? colors.neutral[700] : colors.neutral[200];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];
  return (
    <View style={[styles.guildCard, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.guildHeader}>
        <View style={[styles.crestCircle, { backgroundColor: bg }]} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={[styles.skeletonLine, { width: '60%', backgroundColor: bg }]} />
          <View style={[styles.skeletonLine, { width: '40%', backgroundColor: bg }]} />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * GuildDiscoveryScreen — suggested guilds near the user, with join actions.
 */
export default function GuildDiscoveryScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guilds', 'discovery'],
    queryFn: fetchDiscoveryGuilds,
    staleTime: 120_000,
  });

  const joinMutation = useMutation({
    mutationFn: joinGuild,
    onMutate: (guildId) => {
      setJoiningId(guildId);
    },
    onSuccess: (_, guildId) => {
      setJoinedId(guildId);
      setJoiningId(null);
    },
    onError: () => {
      setJoiningId(null);
    },
  });

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const guilds = data?.data?.guilds ?? [];
  const guildEmphasis = data?.data?.guildEmphasis ?? null;
  const soloNote = data?.data?.soloNote ?? null;

  return (
    <Screen scrollable={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: textColor }]}>Crews Near You</Text>
          <Text style={[styles.subtitle, { color: subtitleColor }]}>
            Join a Guild to earn more XP and compete together
          </Text>
        </View>

        {/* Solo note for lone-wolf users */}
        {soloNote ? (
          <View style={[styles.soloNoteCard, { backgroundColor: isDark ? colors.neutral[800] : '#eff6ff', borderColor: isDark ? colors.neutral[700] : '#bfdbfe' }]}>
            <Text style={[styles.soloNoteText, { color: isDark ? colors.neutral[200] : '#1d4ed8' }]}>
              💡 {soloNote}
            </Text>
          </View>
        ) : null}

        {/* Guild cards */}
        {isLoading ? (
          [0, 1, 2].map((i) => <SkeletonCard key={i} isDark={isDark} />)
        ) : isError ? (
          <View style={styles.errorState}>
            <Text style={[styles.errorText, { color: colors.semantic.error }]}>
              Could not load guilds nearby.
            </Text>
            <Button
              label="Retry"
              size="sm"
              variant="secondary"
              onPress={() => void refetch()}
              accessibilityLabel="Retry loading guilds"
            />
          </View>
        ) : guilds.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏛️</Text>
            <Text style={[styles.emptyText, { color: subtitleColor }]}>
              No guilds near you yet. Check back soon!
            </Text>
          </View>
        ) : (
          guilds.slice(0, 3).map((guild: GuildDiscovery) => (
            <GuildCard
              key={guild.id}
              guild={guild}
              onJoin={(id) => joinMutation.mutate(id)}
              joinedId={joinedId}
              joiningId={joiningId}
              isDark={isDark}
            />
          ))
        )}

        {/* Skip / Solo CTA */}
        <Button
          label={guildEmphasis === 'solo' ? "Continue solo — I'll explore guilds later" : "Explore on my own"}
          variant="ghost"
          size="lg"
          onPress={() => router.replace('/(tabs)')}
          style={styles.maybeLaterBtn}
          accessibilityLabel="Skip guild discovery and go to home"
        />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 14,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },

  guildCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
  },
  guildHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  crestCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  crestEmoji: {
    fontSize: 28,
  },
  guildInfo: {
    flex: 1,
    gap: 4,
  },
  guildTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  guildName: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  tierBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tierText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  guildCity: {
    fontSize: 13,
  },
  guildMetaRow: {
    flexDirection: 'row',
    gap: 4,
  },
  guildMeta: {
    fontSize: 12,
    fontWeight: '500',
  },
  guildFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  xpBoostBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  xpBoostText: {
    fontSize: 13,
    fontWeight: '700',
  },
  joinBtn: {
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },
  joinedBadge: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.brand.green + '20',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinedText: {
    color: colors.brand.green,
    fontSize: 14,
    fontWeight: '700',
  },

  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },

  errorState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
  },
  maybeLaterBtn: {
    marginTop: 8,
  },
  soloNoteCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 4,
  },
  soloNoteText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

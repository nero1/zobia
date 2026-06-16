/**
 * Zobia Social — Onboarding Guild Discovery (Step 5).
 *
 * Shown after the user's first 24 hours as part of onboarding follow-up.
 * Fetches local guilds and prompts the user to join one before heading home.
 *
 * Route: /onboarding/guild-discovery
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
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Guild {
  id: string;
  name: string;
  crestEmoji: string;
  city: string | null;
  tier: string;
  memberCount: number;
  warWins: number;
  xpBoostPercent: number;
}

interface GuildDiscoveryResponse {
  data: {
    guilds: Guild[];
    userCity: string | null;
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
  guild: Guild;
  onJoin: (id: string) => void;
  joinedId: string | null;
  joiningId: string | null;
  isDark: boolean;
}

function GuildCard({ guild, onJoin, joinedId, joiningId, isDark }: GuildCardProps) {
  const { t } = useTranslation();
  const isJoined = joinedId === guild.id;
  const isJoining = joiningId === guild.id;
  const anyJoined = joinedId !== null;
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const cardBg = isDark ? colors.neutral[800] : colors.neutral[0];
  const cardBorder = isJoined
    ? colors.brand.green
    : isDark ? colors.neutral[700] : colors.neutral[200];

  return (
    <View style={[styles.guildCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.guildLeft}>
        <View style={[styles.crestCircle, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[100] }]}>
          <Text style={styles.crestEmoji}>{guild.crestEmoji}</Text>
        </View>
        <View style={styles.guildInfo}>
          <Text style={[styles.guildName, { color: textColor }]} numberOfLines={1}>
            {guild.name}
          </Text>
          {guild.city ? (
            <Text style={[styles.guildCity, { color: subtitleColor }]}>📍 {guild.city}</Text>
          ) : null}
          <View style={styles.guildMeta}>
            <Text style={[styles.guildMetaText, { color: subtitleColor }]}>
              {t('guildDiscovery.members', { count: guild.memberCount })}
            </Text>
            {guild.warWins > 0 && (
              <Text style={[styles.guildMetaText, { color: subtitleColor }]}>
                · {t('guildDiscovery.warsWon', { count: guild.warWins })}
              </Text>
            )}
          </View>
          <View style={[styles.xpBoost, { backgroundColor: colors.brand.blue + '15' }]}>
            <Text style={[styles.xpBoostText, { color: colors.brand.blue }]}>
              {t('guildDiscovery.xpBoost', { pct: guild.xpBoostPercent })}
            </Text>
          </View>
        </View>
      </View>

      {isJoined ? (
        <View style={[styles.joinedBadge]}>
          <Text style={[styles.joinedText, { color: colors.brand.green }]}>{t('guildDiscovery.joined')}</Text>
        </View>
      ) : (
        <Pressable
          style={[
            styles.joinBtn,
            { backgroundColor: anyJoined ? colors.neutral[300] : colors.brand.blue },
            isJoining && { opacity: 0.7 },
          ]}
          onPress={() => onJoin(guild.id)}
          disabled={isJoining || anyJoined}
          accessibilityRole="button"
          accessibilityLabel={`Join ${guild.name} guild`}
        >
          {isJoining ? (
            <ActivityIndicator size="small" color={colors.neutral[0]} />
          ) : (
            <Text style={styles.joinBtnText}>{t('guildDiscovery.join')}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * OnboardingGuildDiscovery — Step 5 of the onboarding follow-up flow.
 */
export default function OnboardingGuildDiscovery() {
  const { isDark } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
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
  const guilds = data?.data?.guilds?.slice(0, 3) ?? [];

  return (
    <Screen scrollable={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.stepBadge, { color: colors.brand.blue }]}>
            {t('guildDiscovery.stepBadge')}
          </Text>
          <Text style={[styles.title, { color: textColor }]}>
            {t('guildDiscovery.title')}
          </Text>
          <Text style={[styles.subtitle, { color: subtitleColor }]}>
            {t('guildDiscovery.subtitle')}
          </Text>
        </View>

        {/* Guild cards */}
        {isLoading ? (
          [0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.skeletonCard,
                {
                  backgroundColor: isDark ? colors.neutral[800] : colors.neutral[200],
                },
              ]}
            />
          ))
        ) : isError ? (
          <View style={styles.errorState}>
            <Text style={[styles.errorMsg, { color: colors.semantic.error }]}>
              {t('guildDiscovery.error')}
            </Text>
            <Button
              label={t('guildDiscovery.retry')}
              size="sm"
              variant="secondary"
              onPress={() => void refetch()}
              accessibilityLabel="Retry loading guilds"
            />
          </View>
        ) : guilds.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🏛️</Text>
            <Text style={[styles.emptyMsg, { color: subtitleColor }]}>
              {t('guildDiscovery.empty')}
            </Text>
          </View>
        ) : (
          guilds.map((guild: Guild) => (
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

        {/* Explore on my own CTA */}
        <Button
          label={joinedId ? t('guildDiscovery.continueHome') : t('guildDiscovery.exploreOwn')}
          variant={joinedId ? 'primary' : 'ghost'}
          size="lg"
          onPress={() => router.replace('/(tabs)')}
          style={styles.skipBtn}
          accessibilityLabel="Skip guild selection and go to home"
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 14,
  },
  header: {
    gap: 8,
    marginBottom: 8,
  },
  stepBadge: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 26,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  guildLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  crestCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  crestEmoji: {
    fontSize: 26,
  },
  guildInfo: {
    flex: 1,
    gap: 4,
  },
  guildName: {
    fontSize: 15,
    fontWeight: '700',
  },
  guildCity: {
    fontSize: 12,
  },
  guildMeta: {
    flexDirection: 'row',
    gap: 4,
  },
  guildMetaText: {
    fontSize: 11,
    fontWeight: '500',
  },
  xpBoost: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  xpBoostText: {
    fontSize: 11,
    fontWeight: '700',
  },

  joinBtn: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  joinBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },
  joinedBadge: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.brand.green + '15',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  joinedText: {
    fontSize: 13,
    fontWeight: '700',
  },

  skeletonCard: {
    height: 90,
    borderRadius: 14,
  },
  errorState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  errorMsg: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyMsg: {
    fontSize: 14,
    textAlign: 'center',
  },
  skipBtn: {
    marginTop: 8,
  },
});

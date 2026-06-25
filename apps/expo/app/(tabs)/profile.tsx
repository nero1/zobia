/**
 * Profile tab — own profile view.
 *
 * Shows:
 *  - Avatar ring (rank-coloured), edit profile button
 *  - Username + prestige stars, display name, "Playing since"
 *  - Rank badge + legacy score
 *  - Six track progress bars
 *  - Guild badge (taps to guild screen)
 *  - Season history horizontal shelf
 *  - Wallet + Store shortcut cards
 *  - Settings button (top-right)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth/hooks';
import { CoinBalance } from '@/components/economy/CoinBalance';
import { colors, rankColors, type RankTier } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackLevel {
  track: string;
  emoji: string;
  level: number;
  maxLevel: number;
}

interface PastSeason {
  id: string;
  name: string;
  themeEmoji: string;
  year: number;
  finalRank: number | null;
}

interface OwnProfile {
  userId: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  city: string | null;
  joinedAt: string;
  rankTier: RankTier;
  rankLabel: string;
  subLevel: number;
  prestigeStars: number;
  legacyScore: number;
  trackLevels: TrackLevel[];
  guildName: string | null;
  guildCrest: string | null;
  guildId: string | null;
  pastSeasons: PastSeason[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchOwnProfile(userId: string): Promise<OwnProfile> {
  const { data } = await apiClient.get(`/profile/${userId}`);
  return data.profile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string as "Month YYYY" (e.g. "March 2024"). */
function formatPlayingSince(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Format a number with comma separators (e.g. 12450 → "12,450"). */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TrackBarProps {
  track: TrackLevel;
}

function TrackBar({ track }: TrackBarProps) {
  const progress = track.maxLevel > 0 ? track.level / track.maxLevel : 0;

  return (
    <View style={styles.trackBarRow}>
      <Text style={styles.trackBarEmoji}>{track.emoji}</Text>
      <View style={styles.trackBarInfo}>
        <View style={styles.trackBarHeader}>
          <Text style={styles.trackBarName}>{track.track}</Text>
          <Text style={styles.trackBarLevel}>Lvl {track.level}</Text>
        </View>
        <View style={styles.trackBarOuter}>
          <View
            style={[
              styles.trackBarInner,
              { width: `${Math.min(progress * 100, 100)}%` },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * ProfileScreen — current user's own profile tab.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const currency = useCurrency();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['ownProfile', user?.id],
    queryFn: () => fetchOwnProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const rankColor = profile
    ? (rankColors[profile.rankTier as RankTier] ?? colors.brand.blue)
    : colors.neutral[200];

  return (
    <Screen scrollable>
      {/* ── Top action bar ──────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>{t('profile.title', 'Profile')}</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel="Settings"
          style={({ pressed }) => [styles.settingsBtn, pressed && styles.pressed]}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </Pressable>
      </View>

      {/* ── Avatar section ─────────────────────────────────────── */}
      <View style={styles.avatarSection}>
        <View style={[styles.rankRing, { borderColor: rankColor }]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarEmoji}>
              {profile?.avatarEmoji ?? user?.avatarEmoji ?? '🙂'}
            </Text>
          </View>
        </View>

        {/* Prestige stars */}
        {profile && profile.prestigeStars > 0 && (
          <View style={styles.prestigeRow}>
            {Array.from({ length: Math.min(profile.prestigeStars, 5) }).map((_, i) => (
              <Text key={i} style={styles.prestigeStar}>⭐</Text>
            ))}
          </View>
        )}

        {/* Edit profile */}
        <Pressable
          onPress={() => router.push('/profile/edit')}
          accessibilityLabel="Edit profile"
          style={({ pressed }) => [styles.editProfileBtn, pressed && styles.pressed]}
        >
          <Text style={styles.editProfileText}>Edit Profile</Text>
        </Pressable>
      </View>

      {/* ── Name + meta ────────────────────────────────────────── */}
      <View style={styles.nameSection}>
        <Text style={styles.username}>
          {profile?.username ?? user?.username ?? t('profile.title')}
        </Text>
        {profile?.displayName ? (
          <Text style={styles.displayName}>{profile.displayName}</Text>
        ) : null}
        {profile?.joinedAt ? (
          <Text style={styles.metaText}>
            Playing since {formatPlayingSince(profile.joinedAt)}
          </Text>
        ) : null}
      </View>

      {/* ── Rank badge + Legacy Score ───────────────────────────── */}
      {profile && (
        <View style={styles.rankRow}>
          <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
            <Text style={styles.rankBadgeText}>
              {profile.rankLabel} {(['I', 'II', 'III'][profile.subLevel - 1] ?? 'I')}
            </Text>
          </View>
          <View style={styles.legacyChip}>
            <Text style={styles.legacyLabel}>Legacy Score</Text>
            <Text style={styles.legacyValue}>{formatNumber(profile.legacyScore)}</Text>
          </View>
        </View>
      )}

      {/* ── Loading spinner ─────────────────────────────────────── */}
      {isLoading && (
        <View style={styles.loaderRow}>
          <ActivityIndicator size="small" color={colors.brand.blue} />
        </View>
      )}

      {/* ── Six track progress bars ─────────────────────────────── */}
      {profile && profile.trackLevels.length > 0 && (
        <View style={styles.trackSection}>
          <Text style={styles.sectionTitle}>Track Levels</Text>
          {profile.trackLevels.map((t: TrackLevel) => (
            <TrackBar key={t.track} track={t} />
          ))}
        </View>
      )}

      {/* ── Guild info ──────────────────────────────────────────── */}
      {profile && (
        <Pressable
          style={({ pressed }) => [
            styles.guildCard,
            pressed && styles.pressed,
          ]}
          onPress={() => {
            if (profile.guildId) {
              router.push(`/guilds/${profile.guildId}` as never);
            }
          }}
          accessibilityLabel={profile.guildName ? `Guild: ${profile.guildName}` : 'No guild'}
        >
          <Text style={styles.guildCrest}>
            {profile.guildCrest ?? '🏛️'}
          </Text>
          <View style={styles.guildTextGroup}>
            <Text style={styles.guildLabel}>Guild</Text>
            <Text style={styles.guildName}>
              {profile.guildName ?? 'No Guild'}
            </Text>
          </View>
          {profile.guildId && <Text style={styles.guildChevron}>›</Text>}
        </Pressable>
      )}

      {/* ── Season history shelf ────────────────────────────────── */}
      {profile && (
        <View style={styles.seasonSection}>
          <Text style={styles.sectionTitle}>Season History</Text>
          {profile.pastSeasons.length === 0 ? (
            <View style={styles.seasonPlaceholder}>
              <Text style={styles.seasonPlaceholderText}>
                No past seasons yet. Keep playing!
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.seasonsScroll}
            >
              {profile.pastSeasons.map((s: PastSeason) => (
                <View key={s.id} style={styles.seasonCard}>
                  <Text style={styles.seasonEmoji}>{s.themeEmoji}</Text>
                  <Text style={styles.seasonName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.seasonYear}>{s.year}</Text>
                  {s.finalRank !== null && (
                    <Text style={styles.seasonRank}>#{s.finalRank}</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Wallet shortcut card ────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/economy/wallet')}
        accessibilityLabel="Open wallet"
        style={({ pressed }) => [styles.walletCard, pressed && styles.pressed]}
      >
        <View style={styles.walletRow}>
          <Text style={styles.walletIcon}>🪙</Text>
          <View style={styles.walletTextGroup}>
            <Text style={styles.walletTitle}>My Wallet</Text>
            <Text style={styles.walletSubtitle}>{currency.softPlural}, {currency.premiumPlural.toLowerCase()} & transactions</Text>
          </View>
          <CoinBalance style={styles.coinChip} />
          <Text style={styles.walletChevron}>›</Text>
        </View>
      </Pressable>

      {/* ── Store shortcut ──────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/economy/store')}
        accessibilityLabel={`Open ${currency.softPlural.toLowerCase()} store`}
        style={({ pressed }) => [styles.walletCard, pressed && styles.pressed]}
      >
        <View style={styles.walletRow}>
          <Text style={styles.walletIcon}>🛒</Text>
          <View style={styles.walletTextGroup}>
            <Text style={styles.walletTitle}>{currency.softPlural} Store</Text>
            <Text style={styles.walletSubtitle}>Buy {currency.softPlural.toLowerCase()} and {currency.premiumPlural.toLowerCase()} packs</Text>
          </View>
          <Text style={styles.walletChevron}>›</Text>
        </View>
      </Pressable>

      {/* ── Creator Dashboard (shown for creators) ─────────────── */}
      <Pressable
        onPress={() => router.push('/creator/dashboard')}
        accessibilityLabel="Open creator dashboard"
        style={({ pressed }) => [styles.walletCard, pressed && styles.pressed]}
      >
        <View style={styles.walletRow}>
          <Text style={styles.walletIcon}>🎙️</Text>
          <View style={styles.walletTextGroup}>
            <Text style={styles.walletTitle}>Creator Dashboard</Text>
            <Text style={styles.walletSubtitle}>Revenue, members & payouts</Text>
          </View>
          <Text style={styles.walletChevron}>›</Text>
        </View>
      </Pressable>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  topBarTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.neutral[900],
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.neutral[100],
  },
  settingsIcon: {
    fontSize: 20,
  },

  // Avatar
  avatarSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  rankRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 48,
  },
  prestigeRow: {
    flexDirection: 'row',
    gap: 2,
  },
  prestigeStar: {
    fontSize: 16,
  },
  editProfileBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
    paddingHorizontal: 20,
    paddingVertical: 7,
    marginTop: 4,
  },
  editProfileText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
  },

  // Name / meta
  nameSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 8,
    gap: 3,
  },
  username: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[900],
    letterSpacing: -0.3,
  },
  displayName: {
    fontSize: 14,
    color: colors.neutral[500],
  },
  metaText: {
    fontSize: 12,
    color: colors.neutral[400],
    marginTop: 2,
  },

  // Rank + legacy
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexWrap: 'wrap',
  },
  rankBadge: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  rankBadgeText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '700',
  },
  legacyChip: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.brand.gold,
    paddingHorizontal: 14,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legacyLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.brand.goldDark,
  },
  legacyValue: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.brand.gold,
  },

  // Loader
  loaderRow: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  // Track bars
  trackSection: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[800],
    marginBottom: 2,
  },
  trackBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trackBarEmoji: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  trackBarInfo: {
    flex: 1,
    gap: 4,
  },
  trackBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trackBarName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  trackBarLevel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brand.blue,
  },
  trackBarOuter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  trackBarInner: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.blue,
  },

  // Guild
  guildCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: 14,
    gap: 12,
    minHeight: 56,
  },
  guildCrest: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  guildTextGroup: {
    flex: 1,
  },
  guildLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  guildName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
    marginTop: 1,
  },
  guildChevron: {
    fontSize: 22,
    color: colors.neutral[400],
    fontWeight: '300',
  },

  // Season history
  seasonSection: {
    marginBottom: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  seasonsScroll: {
    gap: 10,
    paddingBottom: 4,
  },
  seasonCard: {
    width: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[50],
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  seasonEmoji: {
    fontSize: 24,
  },
  seasonName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.neutral[800],
    textAlign: 'center',
  },
  seasonYear: {
    fontSize: 10,
    color: colors.neutral[500],
  },
  seasonRank: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brand.gold,
  },
  seasonPlaceholder: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  seasonPlaceholderText: {
    fontSize: 13,
    color: colors.neutral[400],
    textAlign: 'center',
  },

  // Wallet / Store cards
  walletCard: {
    marginHorizontal: 16,
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
  coinChip: {
    flexShrink: 0,
  },
});

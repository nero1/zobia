/**
 * app/profile/[userId].tsx
 *
 * Public profile screen.
 *
 * Features:
 *  - Avatar (emoji) with rank ring
 *  - Display name, username, city, "Playing since"
 *  - Rank badge + sub-level
 *  - Six track level bars
 *  - Prestige stars
 *  - Guild badge
 *  - Season history shelf
 *  - Friend/Follow/Gift/Report buttons
 *  - Creator card if is_creator
 */

import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { PresenceDot } from '@/components/ui/PresenceDot';
import { useTheme } from '@/lib/theme';
import { colors, rankColors, type RankTier } from '@/lib/theme/colors';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

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
  theme: string;
  starts_at: string;
  finalRank: number | null;
}

interface UserProfile {
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
  isCreator: boolean;
  creatorBio: string | null;
  creatorCategory: string | null;
  isFriend: boolean;
  isFollowing: boolean;
  isOwnProfile: boolean;
  pastSeasons: PastSeason[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchProfile(userId: string): Promise<UserProfile> {
  const { data } = await apiClient.get(`/users/${userId}/profile`);
  return data.profile;
}

async function toggleFriend(userId: string, isFriend: boolean): Promise<void> {
  if (isFriend) {
    await apiClient.delete(`/friends/${userId}`);
  } else {
    await apiClient.post(`/friends/${userId}`);
  }
}

async function toggleFollow(userId: string, isFollowing: boolean): Promise<void> {
  if (isFollowing) {
    await apiClient.delete(`/follows/${userId}`);
  } else {
    await apiClient.post(`/follows/${userId}`);
  }
}

async function reportUser(userId: string, reason: string): Promise<void> {
  await apiClient.post(`/users/${userId}/report`, { reason });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, { width: '60%' }]} />
      {[1, 2, 3, 4, 5, 6].map((i) => <View key={i} style={styles.skeletonBar} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface LevelBarProps {
  track: TrackLevel;
}

function LevelBar({ track }: LevelBarProps) {
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();
  const progress = track.level / track.maxLevel;

  return (
    <View style={styles.levelBarRow}>
      <Text style={styles.levelBarEmoji}>{track.emoji}</Text>
      <View style={styles.levelBarInfo}>
        <View style={styles.levelBarHeader}>
          <Text style={[styles.levelBarTrack, { color: themeColors.text }]}>{track.track}</Text>
          <Text style={[styles.levelBarLevel, { color: colors.brand.blue }]}>{t('publicProfile.lv', { level: track.level })}</Text>
        </View>
        <View style={styles.levelBarOuter}>
          <View
            style={[
              styles.levelBarInner,
              {
                width: `${progress * 100}%`,
                backgroundColor: colors.brand.blue,
              },
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

const REPORT_REASONS = ['Harassment', 'Spam', 'Fake Account', 'Inappropriate Content', 'Other'];

/**
 * PublicProfileScreen — full public profile with stats, levels, and social actions.
 */
export default function PublicProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const { t } = useTranslation();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
  });

  const friendMutation = useMutation({
    mutationFn: () => toggleFriend(userId!, profile!.isFriend),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });

  const followMutation = useMutation({
    mutationFn: () => toggleFollow(userId!, profile!.isFollowing),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });

  const handleReport = () => {
    Alert.alert(t('publicProfile.reportTitle'), t('publicProfile.reportSelectReason'), [
      ...REPORT_REASONS.map((reason) => ({
        text: reason,
        onPress: () => {
          reportUser(userId!, reason).catch(() => {
            Alert.alert('Error', t('publicProfile.reportError'));
          });
          Alert.alert(t('publicProfile.reportedTitle'), t('publicProfile.reportedBody'));
        },
      })),
      { text: t('action.cancel'), style: 'cancel' },
    ]);
  };

  if (isLoading) return <Screen><ProfileSkeleton /></Screen>;

  if (isError || !profile) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            {t('publicProfile.loadError')}
          </Text>
        </View>
      </Screen>
    );
  }

  const rankColor = rankColors[profile.rankTier as RankTier] ?? colors.brand.blue;
  const joinYear = new Date(profile.joinedAt).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

  return (
    <Screen scrollable contentStyle={styles.content}>
      {/* Avatar + rank ring + presence dot */}
      <View style={styles.avatarSection}>
        <View style={{ position: 'relative' }}>
          <View style={[styles.rankRing, { borderColor: rankColor }]}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarEmoji}>{profile.avatarEmoji}</Text>
            </View>
          </View>
          <View style={styles.presenceDotWrap}>
            <PresenceDot userId={profile.userId} size={14} />
          </View>
        </View>
        {/* Prestige stars */}
        {profile.prestigeStars > 0 && (
          <View style={styles.prestigeRow}>
            {Array.from({ length: Math.min(profile.prestigeStars, 5) }).map((_, i) => (
              <Text key={i} style={styles.prestigeStar}>⭐</Text>
            ))}
          </View>
        )}
      </View>

      {/* Name + meta */}
      <View style={styles.nameSection}>
        <Text style={[styles.displayName, { color: themeColors.text }]}>{profile.displayName}</Text>
        <Text style={[styles.username, { color: themeColors.textMuted }]}>@{profile.username}</Text>
        <View style={styles.metaRow}>
          {profile.city && <Text style={[styles.metaText, { color: themeColors.textMuted }]}>📍 {profile.city}</Text>}
          <Text style={[styles.metaText, { color: themeColors.textMuted }]}>{t('publicProfile.playingSince', { year: joinYear })}</Text>
        </View>
      </View>

      {/* Rank badge */}
      <View style={styles.rankSection}>
        <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
          <Text style={styles.rankBadgeText}>
            {profile.rankLabel} {(['I', 'II', 'III'][profile.subLevel - 1] ?? 'I')}
          </Text>
        </View>
        {profile.legacyScore > 0 && (
          <Text style={[styles.legacyScore, { color: colors.brand.gold }]}>
            ⚜️ {profile.legacyScore.toLocaleString()}
          </Text>
        )}
      </View>

      {/* Guild badge */}
      {profile.guildName && (
        <Pressable
          style={[styles.guildBadge, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
          onPress={() => profile.guildId && router.push(`/guilds/${profile.guildId}`)}
        >
          <Text style={styles.guildCrest}>{profile.guildCrest}</Text>
          <Text style={[styles.guildName, { color: themeColors.text }]}>{profile.guildName}</Text>
        </Pressable>
      )}

      {/* Action buttons (not own profile) */}
      {!profile.isOwnProfile && (
        <View style={styles.actions}>
          <View style={styles.actionsRow}>
            <Button
              label={profile.isFriend ? t('publicProfile.friends') : t('publicProfile.addFriend')}
              variant={profile.isFriend ? 'secondary' : 'primary'}
              onPress={() => friendMutation.mutate()}
              loading={friendMutation.isPending}
              style={styles.actionBtn}
            />
            <Button
              label={profile.isFollowing ? t('publicProfile.following') : t('publicProfile.follow')}
              variant={profile.isFollowing ? 'secondary' : 'primary'}
              onPress={() => followMutation.mutate()}
              loading={followMutation.isPending}
              style={styles.actionBtn}
            />
          </View>
          <View style={styles.actionsRow}>
            <Button
              label={t('publicProfile.gift')}
              variant="secondary"
              onPress={() => router.push({ pathname: '/economy/gift-send', params: { toUserId: userId } })}
              style={styles.actionBtn}
            />
            <Button
              label={t('publicProfile.report')}
              variant="ghost"
              onPress={handleReport}
              style={styles.actionBtn}
            />
          </View>
        </View>
      )}

      {/* Creator card */}
      {profile.isCreator && (
        <View style={[styles.creatorCard, { borderColor: colors.brand.blue }]}>
          <View style={styles.creatorHeader}>
            <Text style={styles.creatorBadge}>{t('publicProfile.creatorBadge')}</Text>
            {profile.creatorCategory && (
              <Text style={[styles.creatorCategory, { color: themeColors.textMuted }]}>
                {profile.creatorCategory}
              </Text>
            )}
          </View>
          {profile.creatorBio && (
            <Text style={[styles.creatorBio, { color: themeColors.text }]}>
              {profile.creatorBio}
            </Text>
          )}
        </View>
      )}

      {/* Track level bars */}
      <View style={[styles.trackSection, { backgroundColor: themeColors.surface }]}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{t('publicProfile.trackLevels')}</Text>
        {profile.trackLevels.map((tl: TrackLevel) => (
          <LevelBar key={tl.track} track={tl} />
        ))}
      </View>

      {/* Season history */}
      {profile.pastSeasons.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: themeColors.text, paddingHorizontal: 16 }]}>
            {t('publicProfile.seasonHistory')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonsScroll}>
            {profile.pastSeasons.map((s: PastSeason) => (
              <View key={s.id} style={[styles.seasonCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
                <Text style={styles.seasonEmoji}>{s.theme}</Text>
                <Text style={[styles.seasonName, { color: themeColors.text }]} numberOfLines={1}>{s.name}</Text>
                <Text style={[styles.seasonYear, { color: themeColors.textMuted }]}>
                  {new Date(s.starts_at).getFullYear()}
                </Text>
                {s.finalRank !== null && (
                  <Text style={styles.seasonRank}>#{s.finalRank}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },

  avatarSection: { alignItems: 'center', paddingTop: 24, gap: 8 },
  presenceDotWrap: {
    position: 'absolute',
    bottom: 2,
    right: 2,
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
  avatarEmoji: { fontSize: 48 },
  prestigeRow: { flexDirection: 'row', gap: 2 },
  prestigeStar: { fontSize: 14 },

  nameSection: { alignItems: 'center', paddingHorizontal: 20, gap: 4 },
  displayName: { fontSize: 22, fontWeight: '800' },
  username: { fontSize: 14 },
  metaRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  metaText: { fontSize: 13 },

  rankSection: { alignItems: 'center', paddingTop: 4, gap: 4 },
  rankBadge: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 5 },
  rankBadgeText: { color: colors.neutral[0], fontSize: 13, fontWeight: '700' },
  legacyScore: { fontSize: 13, fontWeight: '700' },

  guildBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    marginTop: 8,
    minHeight: 44,
  },
  guildCrest: { fontSize: 20 },
  guildName: { fontSize: 14, fontWeight: '600' },

  actions: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },

  creatorCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
    backgroundColor: `${colors.brand.blue}08`,
  },
  creatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creatorBadge: {
    backgroundColor: colors.brand.blue,
    color: colors.neutral[0],
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  creatorCategory: { fontSize: 12 },
  creatorBio: { fontSize: 14, lineHeight: 20 },

  trackSection: {
    margin: 16,
    borderRadius: 14,
    padding: 16,
    gap: 14,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' },

  levelBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelBarEmoji: { fontSize: 20, width: 28, textAlign: 'center' },
  levelBarInfo: { flex: 1, gap: 4 },
  levelBarHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  levelBarTrack: { fontSize: 13, fontWeight: '600' },
  levelBarLevel: { fontSize: 12, fontWeight: '700' },
  levelBarOuter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  levelBarInner: { height: 6, borderRadius: 3 },

  seasonsScroll: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  seasonCard: {
    width: 100,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  seasonEmoji: { fontSize: 24 },
  seasonName: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  seasonYear: { fontSize: 10 },
  seasonRank: { fontSize: 12, fontWeight: '700', color: colors.brand.gold },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12, alignItems: 'center' },
  skeletonAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.neutral[200] },
  skeletonLine: { height: 20, width: '80%', borderRadius: 8, backgroundColor: colors.neutral[200] },
  skeletonBar: { height: 32, width: '90%', borderRadius: 8, backgroundColor: colors.neutral[200] },
});

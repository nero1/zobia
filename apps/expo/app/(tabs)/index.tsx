/**
 * app/(tabs)/index.tsx
 *
 * Home tab — Phase 2 full implementation.
 *
 * Features:
 *  - Activity Banner: "X people earned XP in the last hour" (GET /api/presence)
 *  - Online Friends Row: horizontal scroll of friend avatars with online rings
 *    (GET /api/friends)
 *  - Nemesis Widget: side-by-side XP comparison + Challenge button
 *    (GET /api/nemesis)
 *  - Daily Quest Deck: today's quests with progress bars and XP rewards
 *    (GET /api/quests/daily)
 *  - Leaderboard Position Card: user's rank + movement indicator
 *    (GET /api/leaderboards/me)
 *  - Daily Login XP: POST /api/login/daily on mount, toast if first login today
 *  - Skeleton loaders, error states, offline graceful fallback
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { useFloatingNotification } from '@/hooks/useFloatingNotification';
import { storage } from '@/lib/offline/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresenceData {
  recentXPEarners: number;
}

interface Friend {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  isOnline: boolean;
}

interface FriendsResponse {
  friends: Friend[];
}

interface NemesisMe {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
}

interface NemesisOpponent {
  userId: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
}

interface NemesisData {
  me: NemesisMe;
  nemesis: NemesisOpponent;
  sprintActive: boolean;
  sprintEndsAt: string | null;
}

interface Quest {
  id: string;
  name: string;
  description: string;
  xpReward: number;
  progress: number;
  goal: number;
  completed: boolean;
}

interface QuestApiRow {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  xp_reward?: unknown;
  xpReward?: unknown;
  progress_count?: unknown;
  progress?: unknown;
  target_count?: unknown;
  goal?: unknown;
  completed?: unknown;
}

interface QuestsApiResponse {
  quests?: QuestApiRow[];
}

interface LeaderboardMeData {
  rank: number;
  previousRank: number | null;
  score: number;
  displayName: string;
  avatarEmoji: string;
}

interface DailyLoginResponse {
  firstLoginToday: boolean;
  xpAwarded: number;
}

interface GuildDiscovery {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  memberCount: number;
  guildXp: number;
  tier: string;
  warWins: number;
  isRecruiting: boolean;
  sameCity: boolean;
}

interface GuildDiscoveryResponse {
  data: {
    guilds: GuildDiscovery[];
    userCity: string | null;
  };
}

interface UserProfileResponse {
  created_at: string;
  guild_id: string | null;
}

interface NewMemberQuestProgress {
  step: number;
  steps: { id: string; label: string; completed: boolean }[];
  allComplete: boolean;
  rewardClaimed: boolean;
}

interface SpotlightCreator {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

interface SpotlightData {
  month_year: string;
  blurb: string | null;
  creator: SpotlightCreator;
}

// ---------------------------------------------------------------------------
// API fetchers
// ---------------------------------------------------------------------------

async function fetchPresence(): Promise<PresenceData> {
  const { data } = await apiClient.get<PresenceData>('/presence');
  return data;
}

async function fetchFriends(): Promise<FriendsResponse> {
  const { data } = await apiClient.get<FriendsResponse>('/friends');
  return data;
}

async function fetchNemesis(): Promise<NemesisData> {
  const { data } = await apiClient.get<NemesisData>('/nemesis');
  return data;
}

async function fetchDailyQuests(): Promise<{ quests: Quest[] }> {
  const { data } = await apiClient.get<QuestsApiResponse>('/quests/daily');
  const quests: Quest[] = (data?.quests ?? []).map((q) => ({
    id: String(q.id ?? ''),
    name: String(q.title ?? q.name ?? ''),
    description: String(q.description ?? ''),
    xpReward: Number(q.xp_reward ?? q.xpReward ?? 0),
    progress: Number(q.progress_count ?? q.progress ?? 0),
    goal: Number(q.target_count ?? q.goal ?? 1),
    completed: Boolean(q.completed ?? false),
  }));
  return { quests };
}

async function fetchLeaderboardMe(): Promise<LeaderboardMeData> {
  const { data } = await apiClient.get<LeaderboardMeData>('/leaderboards/me');
  return data;
}

async function postDailyLogin(): Promise<DailyLoginResponse> {
  const { data } = await apiClient.post<DailyLoginResponse>('/login/daily');
  return data;
}

async function fetchGuildDiscovery(): Promise<GuildDiscoveryResponse> {
  const { data } = await apiClient.get<GuildDiscoveryResponse>('/guilds/discovery');
  return data;
}

async function fetchUserProfile(): Promise<UserProfileResponse> {
  const { data } = await apiClient.get<UserProfileResponse>('/users/me');
  return data;
}

async function fetchNewMemberQuest(): Promise<NewMemberQuestProgress> {
  const { data } = await apiClient.get('/quests/new-member');
  return data.data ?? data;
}

async function fetchCreatorSpotlight(): Promise<SpotlightData | null> {
  try {
    const { data } = await apiClient.get('/creator-spotlight');
    return data.spotlight ?? null;
  } catch {
    return null;
  }
}

/** Returns true if the user signed up more than 24 hours ago and has no guild. */
function shouldShowGuildDiscovery(
  profile: UserProfileResponse | undefined
): boolean {
  if (!profile) return false;
  if (profile.guild_id) return false; // already in a guild
  const signupMs = new Date(profile.created_at).getTime();
  const hoursElapsed = (Date.now() - signupMs) / (1000 * 60 * 60);
  return hoursElapsed >= 24;
}

// ---------------------------------------------------------------------------
// Member Quest Banner
// ---------------------------------------------------------------------------

function MemberQuestBanner({ quest }: { quest: NewMemberQuestProgress }) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const currency = useCurrency();
  if (quest.rewardClaimed) return null;

  const completedCount = quest.steps.filter((s) => s.completed).length;
  const totalCount = quest.steps.length;
  const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Pressable
      style={[styles.memberQuestBanner, { backgroundColor: themeColors.surface, borderColor: colors.brand.blue }]}
      onPress={() => router.push('/quests/new-member' as never)}
      accessibilityRole="button"
      accessibilityLabel="View New Member Quest"
    >
      <View style={styles.memberQuestHeader}>
        <Text style={styles.memberQuestEmoji}>⭐</Text>
        <View style={styles.memberQuestInfo}>
          <Text style={[styles.memberQuestTitle, { color: themeColors.text }]}>
            New Member Quest
          </Text>
          <Text style={[styles.memberQuestSubtitle, { color: themeColors.textMuted }]}>
            {completedCount}/{totalCount} steps · Earn 1,000 {currency.softPlural.toLowerCase()} + 2,000 XP
          </Text>
        </View>
        <Text style={[styles.memberQuestChevron, { color: colors.brand.blue }]}>›</Text>
      </View>
      <View style={styles.memberQuestProgressOuter}>
        <View style={[styles.memberQuestProgressInner, { width: `${pct}%` }]} />
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Creator Spotlight
// ---------------------------------------------------------------------------

function CreatorSpotlightCard({ spotlight }: { spotlight: SpotlightData }) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const displayName = spotlight.creator.display_name ?? spotlight.creator.username;

  const [year, month] = spotlight.month_year.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  const monthLabel = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <Pressable
      style={[styles.spotlightCard, { backgroundColor: themeColors.surface, borderColor: '#f59e0b' }]}
      onPress={() => router.push(`/profile/${spotlight.creator.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`View creator ${displayName}`}
    >
      <View style={styles.spotlightBadge}>
        <Text style={styles.spotlightBadgeText}>⭐ Creator of the Month — {monthLabel}</Text>
      </View>
      <View style={styles.spotlightBody}>
        <View style={styles.spotlightAvatar}>
          <Text style={styles.spotlightAvatarEmoji}>
            {spotlight.creator.avatar_emoji ?? '🧑'}
          </Text>
        </View>
        <View style={styles.spotlightInfo}>
          <Text style={[styles.spotlightName, { color: themeColors.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.spotlightUsername, { color: themeColors.textMuted }]}>
            @{spotlight.creator.username}
          </Text>
          {spotlight.blurb ? (
            <Text style={[styles.spotlightBlurb, { color: themeColors.textMuted }]} numberOfLines={2}>
              {spotlight.blurb}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Guild Discovery Panel
// ---------------------------------------------------------------------------

interface GuildDiscoveryPanelProps {
  guilds: GuildDiscovery[];
}

function GuildDiscoveryPanel({ guilds }: GuildDiscoveryPanelProps) {
  const { t } = useTranslation();
  const router = useRouter();

  if (guilds.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {t('home.guildDiscovery', 'Crews near you are recruiting')}
      </Text>
      {guilds.map((guild) => (
        <Pressable
          key={guild.id}
          style={styles.guildDiscoveryCard}
          onPress={() => router.push(`/guilds/${guild.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`View ${guild.name} guild`}
        >
          <View style={styles.guildDiscoveryLeft}>
            <Text style={styles.guildCrestEmoji}>{guild.crestEmoji}</Text>
          </View>
          <View style={styles.guildDiscoveryBody}>
            <View style={styles.guildDiscoveryTitleRow}>
              <Text style={styles.guildDiscoveryName} numberOfLines={1}>
                {guild.name}
              </Text>
              {guild.sameCity && guild.city ? (
                <View style={styles.sameCityBadge}>
                  <Text style={styles.sameCityBadgeText}>{guild.city}</Text>
                </View>
              ) : null}
            </View>
            {guild.description ? (
              <Text style={styles.guildDiscoveryDesc} numberOfLines={2}>
                {guild.description}
              </Text>
            ) : null}
            <Text style={styles.guildDiscoveryMeta}>
              {guild.memberCount} {guild.memberCount === 1 ? 'member' : 'members'}
              {' · '}Tier {guild.tier}
              {guild.warWins > 0 ? ` · ${guild.warWins} war wins` : ''}
            </Text>
          </View>
          <Text style={styles.guildDiscoveryChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toast component
// ---------------------------------------------------------------------------

interface ToastProps {
  message: string;
  visible: boolean;
}

function Toast({ message, visible }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.delay(2500),
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Activity Banner
// ---------------------------------------------------------------------------

interface ActivityBannerProps {
  count: number;
}

function ActivityBanner({ count }: ActivityBannerProps) {
  return (
    <View style={styles.activityBanner}>
      <View style={styles.activityDot} />
      <Text style={styles.activityBannerText}>
        {count.toLocaleString()} {count === 1 ? 'person' : 'people'} earned XP in the last hour
      </Text>
    </View>
  );
}

function ActivityBannerSkeleton() {
  return <View style={styles.activityBannerSkeleton} />;
}

// ---------------------------------------------------------------------------
// Online Friends Row
// ---------------------------------------------------------------------------

interface FriendAvatarProps {
  friend: Friend;
}

function FriendAvatar({ friend }: FriendAvatarProps) {
  return (
    <View style={styles.friendAvatarWrapper}>
      <View style={[styles.friendAvatarCircle, friend.isOnline && styles.friendAvatarOnline]}>
        <Text style={styles.friendAvatarEmoji}>{friend.avatarEmoji}</Text>
      </View>
      {friend.isOnline && <View style={styles.onlineRing} />}
      <Text style={styles.friendName} numberOfLines={1}>
        {friend.displayName.split(' ')[0]}
      </Text>
    </View>
  );
}

interface OnlineFriendsRowProps {
  friends: Friend[];
}

function OnlineFriendsRow({ friends }: OnlineFriendsRowProps) {
  const { t } = useTranslation();
  const visible = friends.slice(0, 10);

  if (visible.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('home.onlineFriends', 'Online Friends')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.friendsScrollContent}
      >
        {visible.map((f) => (
          <FriendAvatar key={f.userId} friend={f} />
        ))}
      </ScrollView>
    </View>
  );
}

function OnlineFriendsRowSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.skeletonLineShort} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.friendsScrollContent}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.friendAvatarWrapper}>
            <View style={styles.friendAvatarSkeletonCircle} />
            <View style={styles.friendNameSkeleton} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Nemesis Widget
// ---------------------------------------------------------------------------

interface NemesisWidgetProps {
  data: NemesisData;
  onChallenge: () => void;
  challengePending: boolean;
}

function NemesisXPBar({ myXP, nemesisXP }: { myXP: number; nemesisXP: number }) {
  const total = myXP + nemesisXP;
  const myRatio = total === 0 ? 0.5 : myXP / total;
  return (
    <View style={styles.xpBarOuter}>
      <View style={[styles.xpBarMe, { flex: Math.max(myRatio, 0.005) }]} />
      <View style={[styles.xpBarNemesis, { flex: Math.max(1 - myRatio, 0.005) }]} />
    </View>
  );
}

function NemesisWidget({ data, onChallenge, challengePending }: NemesisWidgetProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const xpDiff = Math.abs(data.me.xp - data.nemesis.xp);
  const iAhead = data.me.xp >= data.nemesis.xp;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('home.nemesis', 'Your Nemesis')}</Text>
      <Pressable
        style={styles.nemesisCard}
        onPress={() => router.push('/nemesis' as never)}
        accessibilityRole="button"
        accessibilityLabel="View nemesis details"
      >
        {/* VS row */}
        <View style={styles.nemesisVsRow}>
          {/* Me */}
          <View style={styles.nemesisSide}>
            <View style={[styles.nemesisAvatar, { borderColor: colors.brand.blue }]}>
              <Text style={styles.nemesisEmoji}>{data.me.avatarEmoji}</Text>
            </View>
            <Text style={styles.nemesisName} numberOfLines={1}>{data.me.displayName}</Text>
            <Text style={[styles.nemesisXP, { color: colors.brand.blue }]}>
              {data.me.xp.toLocaleString()} XP
            </Text>
          </View>

          <View style={styles.vsCenter}>
            <Text style={styles.vsText}>VS</Text>
          </View>

          {/* Nemesis */}
          <View style={styles.nemesisSide}>
            <View style={[styles.nemesisAvatar, { borderColor: colors.semantic.error }]}>
              <Text style={styles.nemesisEmoji}>{data.nemesis.avatarEmoji}</Text>
            </View>
            <Text style={styles.nemesisName} numberOfLines={1}>{data.nemesis.displayName}</Text>
            <Text style={[styles.nemesisXP, { color: colors.semantic.error }]}>
              {data.nemesis.xp.toLocaleString()} XP
            </Text>
          </View>
        </View>

        {/* XP bar */}
        <NemesisXPBar myXP={data.me.xp} nemesisXP={data.nemesis.xp} />

        {/* Delta */}
        <Text style={[styles.deltaText, { color: iAhead ? colors.semantic.success : colors.semantic.error }]}>
          {iAhead
            ? t('home.nemesisAhead', "You're {{amount}} XP ahead", { amount: xpDiff.toLocaleString() })
            : t('home.nemesisBehind', "They're {{amount}} XP ahead", { amount: xpDiff.toLocaleString() })}
        </Text>

        {/* Sprint active banner */}
        {data.sprintActive && (
          <View style={styles.sprintBanner}>
            <Text style={styles.sprintBannerText}>
              {t('home.sprintActive', 'Sprint Active')}
            </Text>
          </View>
        )}

        {/* Challenge button */}
        {!data.sprintActive && (
          <Pressable
            style={[styles.challengeBtn, challengePending && styles.challengeBtnDisabled]}
            onPress={(e) => {
              e.stopPropagation?.();
              onChallenge();
            }}
            disabled={challengePending}
            accessibilityRole="button"
            accessibilityLabel="Challenge nemesis to a 7-day sprint"
          >
            {challengePending ? (
              <ActivityIndicator size="small" color={colors.neutral[0]} />
            ) : (
              <Text style={styles.challengeBtnText}>
                {t('home.challenge', 'Challenge')}
              </Text>
            )}
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

function NemesisWidgetSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.skeletonLineShort} />
      <View style={styles.nemesisSkeletonCard}>
        <View style={styles.nemesisVsRow}>
          <View style={styles.nemesisSide}>
            <View style={styles.skeletonAvatarLg} />
            <View style={[styles.skeletonLine, { width: 60 }]} />
          </View>
          <View style={styles.vsCenter}>
            <View style={[styles.skeletonLine, { width: 24, height: 20 }]} />
          </View>
          <View style={styles.nemesisSide}>
            <View style={styles.skeletonAvatarLg} />
            <View style={[styles.skeletonLine, { width: 60 }]} />
          </View>
        </View>
        <View style={[styles.skeletonLine, { marginTop: 12, height: 10 }]} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Quest Deck
// ---------------------------------------------------------------------------

interface QuestCardProps {
  quest: Quest;
}

function QuestCard({ quest }: QuestCardProps) {
  const progressPct = quest.goal === 0 ? 1 : Math.min(quest.progress / quest.goal, 1);

  return (
    <View style={[styles.questCard, quest.completed && styles.questCardCompleted]}>
      <View style={styles.questTopRow}>
        <Text style={styles.questName} numberOfLines={1}>{quest.name}</Text>
        <Text style={[styles.questXP, { color: quest.completed ? colors.semantic.success : colors.brand.gold }]}>
          +{quest.xpReward} XP
        </Text>
      </View>
      {quest.description ? (
        <Text style={styles.questDesc} numberOfLines={2}>{quest.description}</Text>
      ) : null}
      <View style={styles.questProgressRow}>
        <View style={styles.questProgressTrack}>
          <View
            style={[
              styles.questProgressFill,
              {
                flex: Math.max(progressPct, 0.005),
                backgroundColor: quest.completed ? colors.semantic.success : colors.brand.blue,
              },
            ]}
          />
          <View style={[styles.questProgressEmpty, { flex: Math.max(1 - progressPct, 0.005) }]} />
        </View>
        <Text style={styles.questProgressLabel}>
          {quest.progress}/{quest.goal}
        </Text>
      </View>
    </View>
  );
}

interface QuestDeckProps {
  quests: Quest[];
}

function QuestDeck({ quests }: QuestDeckProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('home.dailyQuests', 'Daily Quests')}</Text>
      {quests.map((q) => (
        <QuestCard key={q.id} quest={q} />
      ))}
    </View>
  );
}

function QuestDeckSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.skeletonLineShort} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.questSkeletonCard} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard Position Card
// ---------------------------------------------------------------------------

interface LeaderboardCardProps {
  data: LeaderboardMeData;
}

function LeaderboardCard({ data }: LeaderboardCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const moved =
    data.previousRank !== null ? data.previousRank - data.rank : null;
  const movedUp = moved !== null && moved > 0;
  const movedDown = moved !== null && moved < 0;
  const movedSame = moved === 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('home.leaderboard', 'Leaderboard')}</Text>
      <Pressable
        style={styles.leaderboardCard}
        onPress={() => router.push('/leaderboards' as never)}
        accessibilityRole="button"
        accessibilityLabel="View leaderboards"
      >
        <View style={styles.leaderboardLeft}>
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>#{data.rank}</Text>
          </View>
          <View>
            <Text style={styles.leaderboardName} numberOfLines={1}>{data.displayName}</Text>
            <Text style={styles.leaderboardScore}>{data.score.toLocaleString()} XP</Text>
          </View>
        </View>
        <View style={styles.leaderboardRight}>
          {movedUp && (
            <View style={styles.movementBadge}>
              <Text style={[styles.movementIcon, { color: colors.semantic.success }]}>▲</Text>
              <Text style={[styles.movementText, { color: colors.semantic.success }]}>
                {moved}
              </Text>
            </View>
          )}
          {movedDown && (
            <View style={styles.movementBadge}>
              <Text style={[styles.movementIcon, { color: colors.semantic.error }]}>▼</Text>
              <Text style={[styles.movementText, { color: colors.semantic.error }]}>
                {Math.abs(moved!)}
              </Text>
            </View>
          )}
          {movedSame && (
            <Text style={[styles.movementText, { color: colors.neutral[400] }]}>–</Text>
          )}
          {moved === null && (
            <Text style={[styles.movementText, { color: colors.neutral[400] }]}>New</Text>
          )}
          <Text style={styles.leaderboardChevron}>›</Text>
        </View>
      </Pressable>
    </View>
  );
}

function LeaderboardCardSkeleton() {
  return (
    <View style={styles.section}>
      <View style={styles.skeletonLineShort} />
      <View style={styles.leaderboardSkeletonCard} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface SectionErrorProps {
  message: string;
  onRetry?: () => void;
}

function SectionError({ message, onRetry }: SectionErrorProps) {
  return (
    <View style={styles.sectionError}>
      <Text style={styles.sectionErrorText}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * HomeScreen — full Phase 2 implementation with nemesis widget, quest deck,
 * activity banner, online friends row, leaderboard position card, and
 * daily login XP recording.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const { questUpdateKey } = useFloatingNotification();
  const [showLoginToast, setShowLoginToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const loginToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Data queries
  // -------------------------------------------------------------------------

  const presenceQuery = useQuery({
    queryKey: ['presence'],
    queryFn: fetchPresence,
    staleTime: 60_000,
  });

  const friendsQuery = useQuery({
    queryKey: ['friends'],
    queryFn: fetchFriends,
    staleTime: 2 * 60_000,
  });

  const nemesisQuery = useQuery({
    queryKey: ['nemesis'],
    queryFn: fetchNemesis,
    staleTime: 2 * 60_000,
  });

  const questsQuery = useQuery({
    queryKey: ['quests', 'daily'],
    queryFn: fetchDailyQuests,
    staleTime: 60_000,
  });

  const leaderboardMeQuery = useQuery({
    queryKey: ['leaderboard', 'me'],
    queryFn: fetchLeaderboardMe,
    staleTime: 5 * 60_000,
  });

  const userProfileQuery = useQuery({
    queryKey: ['users', 'me'],
    queryFn: fetchUserProfile,
    staleTime: 5 * 60_000,
  });

  // Guild discovery: only fetch if user has been signed up for >24h and has no guild
  const showGuildDiscovery = shouldShowGuildDiscovery(userProfileQuery.data);
  const guildDiscoveryQuery = useQuery({
    queryKey: ['guilds', 'discovery'],
    queryFn: fetchGuildDiscovery,
    enabled: showGuildDiscovery,
    staleTime: 10 * 60_000,
  });

  // New member quest — only fetch for users signed up <7 days ago
  const isNewUser = React.useMemo(() => {
    if (!userProfileQuery.data) return false;
    const signupMs = new Date(userProfileQuery.data.created_at).getTime();
    const daysElapsed = (Date.now() - signupMs) / (1000 * 60 * 60 * 24);
    return daysElapsed < 7;
  }, [userProfileQuery.data]);
  const newMemberQuestQuery = useQuery({
    queryKey: ['new-member-quest'],
    queryFn: fetchNewMemberQuest,
    enabled: isNewUser,
    staleTime: 30_000,
  });

  const creatorSpotlightQuery = useQuery({
    queryKey: ['creator-spotlight'],
    queryFn: fetchCreatorSpotlight,
    staleTime: 5 * 60_000,
  });

  // -------------------------------------------------------------------------
  // Daily login mutation — fire on mount
  // -------------------------------------------------------------------------

  const dailyLoginMutation = useMutation({
    mutationFn: postDailyLogin,
    onSuccess: (result) => {
      const today = new Date().toISOString().slice(0, 10);
      try { storage.set('daily_login_last_date', today); } catch {}
      if (result.firstLoginToday) {
        setToastMessage(
          t('home.dailyLoginXP', 'Daily login: +{{xp}} XP', { xp: result.xpAwarded })
        );
        setShowLoginToast(true);
        if (loginToastTimerRef.current) clearTimeout(loginToastTimerRef.current);
        loginToastTimerRef.current = setTimeout(() => {
          setShowLoginToast(false);
          loginToastTimerRef.current = null;
        }, 3500);
      }
    },
    onError: (err) => {
      console.warn('[daily-login] Failed to award daily XP', err);
    },
  });

  useEffect(() => {
    // BUG-040 FIX: use ISO date (YYYY-MM-DD) instead of toDateString()
    // which is locale/timezone-dependent and differs across devices.
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (storage.getString('daily_login_last_date') === today) return;
    } catch {
      // MMKV not yet initialized; still fire the mutation (server deduplicates)
    }
    dailyLoginMutation.mutate();
    return () => {
      if (loginToastTimerRef.current) clearTimeout(loginToastTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh quest list whenever a quest_complete / deck_complete realtime event arrives
  useEffect(() => {
    if (questUpdateKey === 0) return;
    queryClient.invalidateQueries({ queryKey: ['quests', 'daily'] });
  }, [questUpdateKey, queryClient]);

  // -------------------------------------------------------------------------
  // Challenge mutation
  // -------------------------------------------------------------------------

  const challengeMutation = useMutation({
    mutationFn: async () => apiClient.post('/nemesis/challenge'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nemesis'] });
    },
  });

  // -------------------------------------------------------------------------
  // Pull-to-refresh
  // -------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ['presence'] }),
      queryClient.invalidateQueries({ queryKey: ['friends'] }),
      queryClient.invalidateQueries({ queryKey: ['nemesis'] }),
      queryClient.invalidateQueries({ queryKey: ['quests', 'daily'] }),
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'me'] }),
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] }),
      queryClient.invalidateQueries({ queryKey: ['guilds', 'discovery'] }),
      queryClient.invalidateQueries({ queryKey: ['new-member-quest'] }),
      queryClient.invalidateQueries({ queryKey: ['creator-spotlight'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderActivityBanner = () => {
    if (presenceQuery.isLoading) return <ActivityBannerSkeleton />;
    if (presenceQuery.isError || !presenceQuery.data) return null;
    return <ActivityBanner count={presenceQuery.data.recentXPEarners} />;
  };

  const renderFriendsRow = () => {
    if (friendsQuery.isLoading) return <OnlineFriendsRowSkeleton />;
    if (friendsQuery.isError || !friendsQuery.data) return null;
    return <OnlineFriendsRow friends={friendsQuery.data.friends} />;
  };

  const renderNemesisWidget = () => {
    if (nemesisQuery.isLoading) return <NemesisWidgetSkeleton />;
    if (nemesisQuery.isError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('home.nemesis', 'Your Nemesis')}</Text>
          <SectionError
            message={t('home.nemesisError', 'Could not load nemesis. Keep earning XP!')}
            onRetry={() => nemesisQuery.refetch()}
          />
        </View>
      );
    }
    if (!nemesisQuery.data) return null;
    return (
      <NemesisWidget
        data={nemesisQuery.data}
        onChallenge={() => challengeMutation.mutate()}
        challengePending={challengeMutation.isPending}
      />
    );
  };

  const renderQuestDeck = () => {
    if (questsQuery.isLoading) return <QuestDeckSkeleton />;
    if (questsQuery.isError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('home.dailyQuests', 'Daily Quests')}</Text>
          <SectionError
            message={t('home.questsError', 'Could not load quests.')}
            onRetry={() => questsQuery.refetch()}
          />
        </View>
      );
    }
    if (!questsQuery.data) return null;
    return <QuestDeck quests={questsQuery.data.quests} />;
  };

  const renderLeaderboardCard = () => {
    if (leaderboardMeQuery.isLoading) return <LeaderboardCardSkeleton />;
    if (leaderboardMeQuery.isError || !leaderboardMeQuery.data) return null;
    return <LeaderboardCard data={leaderboardMeQuery.data} />;
  };

  const renderGuildDiscovery = () => {
    // Only show the panel if the user has been around >24h and is guildless
    if (!showGuildDiscovery) return null;
    if (guildDiscoveryQuery.isLoading || !guildDiscoveryQuery.data) return null;
    const guilds = guildDiscoveryQuery.data.data?.guilds ?? [];
    if (guilds.length === 0) return null;
    return <GuildDiscoveryPanel guilds={guilds} />;
  };

  // -------------------------------------------------------------------------
  // Screen
  // -------------------------------------------------------------------------

  return (
    <Screen>
      <ScrollView
        style={styles.fill}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand.blue}
          />
        }
      >
        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: themeColors.text }]}>{t('home.title', 'Home')}</Text>
          {user?.username ? (
            <Text style={styles.pageSubtitle}>
              {t('home.greeting', 'Hey, {{name}}', { name: user.username.split(' ')[0] })}
            </Text>
          ) : null}
        </View>

        {/* Activity Banner */}
        {renderActivityBanner()}

        {/* New Member Quest Banner — shown to users signed up <7 days ago */}
        {isNewUser && newMemberQuestQuery.data && !newMemberQuestQuery.data.rewardClaimed && (
          <MemberQuestBanner quest={newMemberQuestQuery.data} />
        )}

        {/* Creator Spotlight */}
        {creatorSpotlightQuery.data && (
          <CreatorSpotlightCard spotlight={creatorSpotlightQuery.data} />
        )}

        {/* Online Friends */}
        {renderFriendsRow()}

        {/* Nemesis Widget */}
        {renderNemesisWidget()}

        {/* Daily Quest Deck */}
        {renderQuestDeck()}

        {/* Leaderboard Position */}
        {renderLeaderboardCard()}

        {/* Guild Discovery Panel — shown after 24h for guildless users */}
        {renderGuildDiscovery()}

        {/* Bottom padding */}
        <View style={styles.bottomPad} />
      </ScrollView>

      {/* Daily login toast */}
      <Toast message={toastMessage} visible={showLoginToast} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },

  // Page header
  pageHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 14,
    color: colors.neutral[500],
    marginTop: 2,
  },

  // Activity Banner
  activityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.brand.blue}12`,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: `${colors.brand.blue}20`,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.green,
  },
  activityBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
    flex: 1,
  },
  activityBannerSkeleton: {
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.neutral[200],
    marginHorizontal: 16,
    marginVertical: 8,
  },

  // Section wrapper
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[800],
    marginBottom: 10,
  },

  // Friends row
  friendsScrollContent: {
    gap: 14,
    paddingRight: 4,
  },
  friendAvatarWrapper: {
    alignItems: 'center',
    width: 60,
  },
  friendAvatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.neutral[200],
  },
  friendAvatarOnline: {
    borderColor: colors.brand.green,
  },
  friendAvatarEmoji: {
    fontSize: 28,
  },
  onlineRing: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.brand.green,
    borderWidth: 2,
    borderColor: colors.neutral[0],
  },
  friendName: {
    fontSize: 11,
    color: colors.neutral[600],
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 56,
  },
  friendAvatarSkeletonCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.neutral[200],
  },
  friendNameSkeleton: {
    height: 10,
    width: 40,
    borderRadius: 5,
    backgroundColor: colors.neutral[200],
    marginTop: 6,
  },

  // Nemesis Widget
  nemesisCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    overflow: 'hidden',
  },
  nemesisVsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  nemesisSide: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  nemesisAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  nemesisEmoji: { fontSize: 36 },
  nemesisName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[800],
    textAlign: 'center',
  },
  nemesisXP: { fontSize: 14, fontWeight: '900' },
  vsCenter: { width: 36, alignItems: 'center' },
  vsText: { fontSize: 16, fontWeight: '800', color: colors.neutral[400] },
  xpBarOuter: { flexDirection: 'row', height: 8 },
  xpBarMe: { backgroundColor: colors.brand.blue },
  xpBarNemesis: { backgroundColor: colors.semantic.error },
  deltaText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 10,
  },
  sprintBanner: {
    backgroundColor: colors.semantic.warning,
    paddingVertical: 6,
    alignItems: 'center',
  },
  sprintBannerText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '700',
  },
  challengeBtn: {
    margin: 12,
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  challengeBtnDisabled: {
    opacity: 0.6,
  },
  challengeBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },
  nemesisSkeletonCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    padding: 16,
  },

  // Quest Deck
  questCard: {
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: 14,
    marginBottom: 10,
  },
  questCardCompleted: {
    borderColor: colors.brand.green,
    backgroundColor: `${colors.brand.green}08`,
  },
  questTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  questName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
    flex: 1,
    marginRight: 8,
  },
  questXP: {
    fontSize: 13,
    fontWeight: '800',
  },
  questDesc: {
    fontSize: 12,
    color: colors.neutral[500],
    marginBottom: 8,
  },
  questProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  questProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: colors.neutral[200],
  },
  questProgressFill: {
    borderRadius: 3,
  },
  questProgressEmpty: {
    backgroundColor: 'transparent',
  },
  questProgressLabel: {
    fontSize: 11,
    color: colors.neutral[500],
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  questSkeletonCard: {
    height: 84,
    borderRadius: 12,
    backgroundColor: colors.neutral[200],
    marginBottom: 10,
  },

  // Leaderboard Card
  leaderboardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  leaderboardLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rankBadge: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  rankBadgeText: {
    color: colors.neutral[0],
    fontSize: 16,
    fontWeight: '900',
  },
  leaderboardName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  leaderboardScore: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  leaderboardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  movementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  movementIcon: {
    fontSize: 11,
    fontWeight: '700',
  },
  movementText: {
    fontSize: 13,
    fontWeight: '700',
  },
  leaderboardChevron: {
    fontSize: 20,
    color: colors.neutral[400],
    marginLeft: 4,
  },
  leaderboardSkeletonCard: {
    height: 68,
    borderRadius: 12,
    backgroundColor: colors.neutral[200],
  },

  // Section error
  sectionError: {
    backgroundColor: colors.neutral[50],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  sectionErrorText: {
    fontSize: 13,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '700',
  },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: colors.brand.green,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  toastText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },

  // Shared skeleton primitives
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.neutral[200],
  },
  skeletonLineShort: {
    height: 16,
    width: 120,
    borderRadius: 8,
    backgroundColor: colors.neutral[200],
    marginBottom: 10,
  },
  skeletonAvatarLg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neutral[200],
  },

  bottomPad: {
    height: 16,
  },

  // Guild Discovery Panel
  guildDiscoveryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  guildDiscoveryLeft: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  guildCrestEmoji: {
    fontSize: 24,
  },
  guildDiscoveryBody: {
    flex: 1,
    gap: 3,
  },
  guildDiscoveryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  guildDiscoveryName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
    flex: 1,
  },
  sameCityBadge: {
    backgroundColor: `${colors.brand.blue}18`,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sameCityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand.blue,
  },
  guildDiscoveryDesc: {
    fontSize: 12,
    color: colors.neutral[500],
  },
  guildDiscoveryMeta: {
    fontSize: 11,
    color: colors.neutral[400],
    fontWeight: '500',
  },
  guildDiscoveryChevron: {
    fontSize: 20,
    color: colors.neutral[400],
  },

  // Member Quest Banner
  memberQuestBanner: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 10,
  },
  memberQuestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberQuestEmoji: { fontSize: 24 },
  memberQuestInfo: { flex: 1 },
  memberQuestTitle: { fontSize: 15, fontWeight: '700' },
  memberQuestSubtitle: { fontSize: 12, marginTop: 1 },
  memberQuestChevron: { fontSize: 20, fontWeight: '600' },
  memberQuestProgressOuter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
  },
  memberQuestProgressInner: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand.blue,
  },

  // Creator Spotlight
  spotlightCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 10,
  },
  spotlightBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  spotlightBadgeText: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  spotlightBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spotlightAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotlightAvatarEmoji: { fontSize: 28 },
  spotlightInfo: { flex: 1, gap: 2 },
  spotlightName: { fontSize: 15, fontWeight: '700' },
  spotlightUsername: { fontSize: 12 },
  spotlightBlurb: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

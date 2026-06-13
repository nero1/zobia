/**
 * Zobia Social — Moments Feed Screen.
 *
 * Real feed fetched from GET /api/moments.
 * Features: FlatList of moment cards, pull-to-refresh, empty state,
 * loading skeleton, "+ Share Moment" FAB.
 *
 * Route: /moments
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Moment {
  id: string;
  user_id: string;
  username: string;
  avatar_emoji: string;
  content: string;
  view_count: number;
  reactions_count: number;
  expires_at: string;
  created_at: string;
  has_viewed: boolean;
}

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '😮', '👏', '💯'];

interface MomentsResponse {
  data: {
    moments: Moment[];
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchMoments(): Promise<Moment[]> {
  const { data } = await apiClient.get<MomentsResponse>('/moments');
  return data.data?.moments ?? [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h left` : `${m}m left`;
}

function timeAgo(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MomentCardProps {
  moment: Moment;
  isDark: boolean;
  onReact: (momentId: string, emoji: string) => void;
}

function MomentCard({ moment, isDark, onReact }: MomentCardProps) {
  const [showReactions, setShowReactions] = React.useState(false);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0],
          borderColor: moment.has_viewed
            ? isDark ? colors.neutral[700] : colors.neutral[200]
            : colors.brand.blue,
          borderLeftWidth: moment.has_viewed ? 0 : 3,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.authorRow}>
          <Text style={styles.authorEmoji}>{moment.avatar_emoji}</Text>
          <Text
            style={[
              styles.authorName,
              { color: isDark ? colors.neutral[100] : colors.neutral[900] },
            ]}
          >
            @{moment.username}
          </Text>
        </View>
        <View style={styles.cardMeta}>
          <Text
            style={[
              styles.timeAgo,
              { color: isDark ? colors.neutral[500] : colors.neutral[400] },
            ]}
          >
            {timeAgo(moment.created_at)}
          </Text>
          <Text
            style={[
              styles.timeLeft,
              { color: isDark ? colors.neutral[500] : colors.neutral[400] },
            ]}
          >
            {timeLeft(moment.expires_at)}
          </Text>
        </View>
      </View>

      <Text
        style={[
          styles.content,
          { color: isDark ? colors.neutral[200] : colors.neutral[700] },
        ]}
      >
        {moment.content}
      </Text>

      <View style={styles.cardFooter}>
        <Text style={[styles.viewCount, { color: isDark ? colors.neutral[500] : colors.neutral[400] }]}>
          {moment.view_count.toLocaleString()} {moment.view_count === 1 ? 'view' : 'views'}
        </Text>
        <View style={styles.reactRow}>
          <Text style={[styles.reactCount, { color: isDark ? colors.neutral[500] : colors.neutral[400] }]}>
            {(moment.reactions_count ?? 0).toLocaleString()} reactions
          </Text>
          <Pressable
            onPress={() => setShowReactions((v) => !v)}
            style={[styles.reactBtn, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[100] }]}
            accessibilityRole="button"
            accessibilityLabel="React to moment"
          >
            <Text style={styles.reactBtnText}>😊 React</Text>
          </Pressable>
        </View>
      </View>
      {showReactions && (
        <View style={[styles.reactionPicker, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[50] }]}>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => { onReact(moment.id, emoji); setShowReactions(false); }}
              style={styles.reactionEmoji}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
            >
              <Text style={styles.reactionEmojiText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const bg = isDark ? colors.neutral[700] : colors.neutral[200];
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0],
          borderColor: isDark ? colors.neutral[700] : colors.neutral[200],
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.authorRow}>
          <View style={[styles.skeletonCircle, { backgroundColor: bg }]} />
          <View style={[styles.skeletonLine, { width: 80, backgroundColor: bg }]} />
        </View>
        <View style={[styles.skeletonLine, { width: 40, backgroundColor: bg }]} />
      </View>
      <View style={[styles.skeletonLine, { width: '90%', marginBottom: 6, backgroundColor: bg }]} />
      <View style={[styles.skeletonLine, { width: '60%', backgroundColor: bg }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * MomentsScreen — live feed of 24-hour moments.
 */
export default function MomentsScreen() {
  const { isDark } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: moments, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['moments'],
    queryFn: fetchMoments,
    staleTime: 30_000,
  });

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['moments'] });
  }, [queryClient]);

  const handleReact = useCallback(async (momentId: string, emoji: string) => {
    try {
      await apiClient.post(`/moments/${momentId}/reactions`, { emoji });
      void queryClient.invalidateQueries({ queryKey: ['moments'] });
    } catch {
      // Non-fatal
    }
  }, [queryClient]);

  const bg = isDark ? colors.neutral[900] : colors.neutral[50];
  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const subtitleColor = isDark ? colors.neutral[400] : colors.neutral[500];

  return (
    <Screen scrollable={false} disableBottomInset>
      <FlatList
        data={isLoading ? undefined : moments}
        keyExtractor={(m) => m.id}
        style={{ backgroundColor: bg }}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={handleRefresh}
            tintColor={colors.brand.blue}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>Moments</Text>
            <Text style={[styles.subtitle, { color: subtitleColor }]}>
              Disappear after 24 hours
            </Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View>
              {[0, 1, 2].map((i) => (
                <SkeletonCard key={i} isDark={isDark} />
              ))}
            </View>
          ) : isError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>⚠️</Text>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                Could not load moments
              </Text>
              <Button
                label="Retry"
                size="sm"
                variant="secondary"
                onPress={() => void refetch()}
                style={styles.emptyBtn}
                accessibilityLabel="Retry loading moments"
              />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>✨</Text>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                No moments yet. Be the first!
              </Text>
              <Button
                label="Share a Moment"
                size="sm"
                onPress={() => router.push('/moments/create')}
                style={styles.emptyBtn}
                accessibilityLabel="Share the first moment"
              />
            </View>
          )
        }
        renderItem={({ item }) => <MomentCard moment={item} isDark={isDark} onReact={handleReact} />}
      />

      {/* Floating Action Button */}
      {!isLoading && (
        <Pressable
          style={[styles.fab, { backgroundColor: colors.brand.blue }]}
          onPress={() => router.push('/moments/create')}
          accessibilityRole="button"
          accessibilityLabel="Share a new moment"
        >
          <Text style={styles.fabText}>+ Share Moment</Text>
        </Pressable>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  authorEmoji: {
    fontSize: 20,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  cardMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  timeAgo: {
    fontSize: 11,
  },
  timeLeft: {
    fontSize: 10,
    fontWeight: '500',
  },
  content: {
    fontSize: 15,
    lineHeight: 22,
  },
  viewCount: {
    fontSize: 11,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  reactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reactCount: { fontSize: 11 },
  reactBtn: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reactBtnText: { fontSize: 12, fontWeight: '600' },
  reactionPicker: {
    flexDirection: 'row',
    gap: 4,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  reactionEmoji: { padding: 4 },
  reactionEmojiText: { fontSize: 22 },

  // Skeleton
  skeletonCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    marginBottom: 4,
  },

  // Empty / error
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: 4,
    minWidth: 160,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: {
    color: colors.neutral[0],
    fontSize: 15,
    fontWeight: '700',
  },
});

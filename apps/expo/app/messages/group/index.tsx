/**
 * app/messages/group/index.tsx
 *
 * Group Chats list screen.
 *
 * Features:
 *  - Lists the user's group chats with group name, member count,
 *    last message preview, and unread count badge
 *  - Pull-to-refresh
 *  - Skeleton loaders
 *  - Empty state
 *  - "+" FAB to create a new group (navigates to /messages/group/create)
 *  - Tapping a row navigates to /messages/group/[groupId]
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
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupChat {
  id: string;
  name: string;
  tag: 'study_group' | 'crew' | 'business' | string;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  avatarEmoji: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffHrs < 48) return 'yesterday';
  return new Date(iso).toLocaleDateString();
}

function truncate(text: string | null, len = 40): string {
  if (!text) return '';
  return text.length > len ? text.slice(0, len).trimEnd() + '…' : text;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchGroupChats(): Promise<GroupChat[]> {
  const { data } = await apiClient.get('/messages/group');
  return data.groups ?? [];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonBody}>
        <View style={styles.skeletonLineName} />
        <View style={styles.skeletonLinePreview} />
      </View>
    </View>
  );
}

function SkeletonList() {
  return (
    <View style={styles.skeletonContainer}>
      {[0, 1, 2].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Group row
// ---------------------------------------------------------------------------

interface GroupRowProps {
  item: GroupChat;
  onPress: (item: GroupChat) => void;
}

function GroupRow({ item, onPress }: GroupRowProps) {
  const hasUnread = item.unreadCount > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.convRow, pressed && styles.convRowPressed]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Group chat: ${item.name}, ${item.memberCount} members`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>{item.avatarEmoji || '👥'}</Text>
      </View>

      <View style={styles.convBody}>
        <View style={styles.convTopRow}>
          <Text
            style={[styles.convName, hasUnread && styles.convNameBold]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.lastMessageAt && (
            <Text style={styles.convTime}>{relativeTime(item.lastMessageAt)}</Text>
          )}
        </View>
        <View style={styles.convBottomRow}>
          <Text style={styles.memberCountText}>{item.memberCount} members</Text>
          <Text
            style={[styles.convPreview, hasUnread && styles.convPreviewBold]}
            numberOfLines={1}
          >
            {truncate(item.lastMessage) || 'No messages yet'}
          </Text>
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function GroupChatsScreen() {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const {
    data: groups = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['group-chats'],
    queryFn: fetchGroupChats,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const handleGroupPress = useCallback(
    (item: GroupChat) => {
      router.push(`/messages/group/${item.id}` as never);
    },
    [router],
  );

  const handleCreate = useCallback(() => {
    router.push('/messages/group/create' as never);
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: GroupChat }) => (
      <GroupRow item={item} onPress={handleGroupPress} />
    ),
    [handleGroupPress],
  );

  const renderEmpty = () => {
    if (isLoading) return <SkeletonList />;
    if (isError) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.semantic.error }]}>
            Could not load group chats. Check your connection.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyEmoji}>👥</Text>
        <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No group chats yet.</Text>
        <Text style={[styles.emptySubText, { color: themeColors.textMuted }]}>
          Create a group to start chatting.
        </Text>
      </View>
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>Group Chats</Text>
        <Pressable
          style={styles.newBtn}
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel="Create new group"
        >
          <Text style={styles.newBtnText}>+ New Group</Text>
        </Pressable>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={
          groups.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.brand.blue}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={handleCreate}
        accessibilityRole="button"
        accessibilityLabel="Create new group chat"
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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
  },
  newBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },

  listContent: { paddingBottom: 100 },
  emptyContainer: { flexGrow: 1 },

  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
  },
  convRowPressed: { backgroundColor: colors.neutral[50] },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 26 },

  convBody: { flex: 1, gap: 3 },
  convTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  convName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.neutral[800],
  },
  convNameBold: { fontWeight: '700', color: colors.neutral[900] },
  convTime: { fontSize: 12, color: colors.neutral[400], flexShrink: 0 },
  convBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberCountText: {
    fontSize: 11,
    color: colors.neutral[400],
    flexShrink: 0,
  },
  convPreview: {
    flex: 1,
    fontSize: 13,
    color: colors.neutral[500],
  },
  convPreviewBold: { color: colors.neutral[700], fontWeight: '600' },

  unreadBadge: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  unreadBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyEmoji: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptySubText: { fontSize: 14, textAlign: 'center' },
  errorText: { fontSize: 14, textAlign: 'center' },

  skeletonContainer: { paddingTop: 8 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutral[200],
  },
  skeletonBody: { flex: 1, gap: 8 },
  skeletonLineName: {
    height: 14,
    width: '50%',
    borderRadius: 7,
    backgroundColor: colors.neutral[200],
  },
  skeletonLinePreview: {
    height: 12,
    width: '80%',
    borderRadius: 6,
    backgroundColor: colors.neutral[100],
  },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand.blue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.neutral[900],
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  fabPressed: { backgroundColor: colors.brand.blueDark },
  fabIcon: { fontSize: 28, color: colors.neutral[0], fontWeight: '400', lineHeight: 32 },
});

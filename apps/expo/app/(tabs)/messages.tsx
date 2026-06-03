/**
 * app/(tabs)/messages.tsx
 *
 * Messages tab — DM conversations list.
 *
 * Features:
 *  - List of recent DM conversations with avatar emoji, display name,
 *    last message preview (truncated to ~40 chars), relative timestamp,
 *    and unread count badge when > 0
 *  - Skeleton loaders (3 rows) on first load
 *  - Pull-to-refresh
 *  - Empty state with prompt to start a new conversation
 *  - "New Message" FAB navigates to /messages/new
 *  - Tapping a row navigates to /messages/[conversationId]
 *  - Offline-tolerant: shows cached data via staleTime / placeholderData
 */

import React, { useCallback } from 'react';
import {
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
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DMConversation {
  conversationId: string;
  otherUserId: string;
  otherDisplayName: string;
  otherAvatarEmoji: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

interface DMListResponse {
  conversations: DMConversation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable relative timestamp.
 *  < 60s   → "just now"
 *  < 60m   → "Xm ago"
 *  < 24h   → "Xh ago"
 *  < 48h   → "yesterday"
 *  else    → locale date string
 */
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

async function fetchDMList(): Promise<DMConversation[]> {
  const { data } = await apiClient.get<DMListResponse>('/api/messages/dm');
  return data.conversations ?? [];
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
// Conversation row
// ---------------------------------------------------------------------------

interface ConvRowProps {
  item: DMConversation;
  onPress: (item: DMConversation) => void;
}

function ConvRow({ item, onPress }: ConvRowProps) {
  const hasUnread = item.unreadCount > 0;
  return (
    <Pressable
      style={({ pressed }) => [styles.convRow, pressed && styles.convRowPressed]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${item.otherDisplayName}`}
    >
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>{item.otherAvatarEmoji || '👤'}</Text>
      </View>

      {/* Text area */}
      <View style={styles.convBody}>
        <View style={styles.convTopRow}>
          <Text
            style={[styles.convName, hasUnread && styles.convNameBold]}
            numberOfLines={1}
          >
            {item.otherDisplayName}
          </Text>
          {item.lastMessageAt && (
            <Text style={styles.convTime}>{relativeTime(item.lastMessageAt)}</Text>
          )}
        </View>
        <View style={styles.convBottomRow}>
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

/**
 * MessagesScreen — lists active DM conversations.
 */
export default function MessagesScreen() {
  const router = useRouter();

  const {
    data: conversations = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['dm-list'],
    queryFn: fetchDMList,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const handleConvPress = useCallback(
    (item: DMConversation) => {
      router.push(`/messages/${item.conversationId}` as never);
    },
    [router],
  );

  const handleNewMessage = useCallback(() => {
    router.push('/messages/new' as never);
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: DMConversation }) => (
      <ConvRow item={item} onPress={handleConvPress} />
    ),
    [handleConvPress],
  );

  const renderEmpty = () => {
    if (isLoading) return <SkeletonList />;
    if (isError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            Could not load messages. Check your connection.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyEmoji}>💬</Text>
        <Text style={styles.emptyTitle}>No conversations yet.</Text>
        <Text style={styles.emptySubText}>Start a new message.</Text>
      </View>
    );
  };

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Pressable
          style={styles.newBtn}
          onPress={handleNewMessage}
          accessibilityRole="button"
          accessibilityLabel="New message"
        >
          <Text style={styles.newBtnText}>+ New</Text>
        </Pressable>
      </View>

      {/* Conversation list */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversationId}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={
          conversations.length === 0 ? styles.emptyContainer : styles.listContent
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

      {/* FAB — New Message */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={handleNewMessage}
        accessibilityRole="button"
        accessibilityLabel="New message"
      >
        <Text style={styles.fabIcon}>✉</Text>
      </Pressable>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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

  // List
  listContent: {
    paddingBottom: 100,
  },
  emptyContainer: {
    flexGrow: 1,
  },

  // Conversation row
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
  convRowPressed: {
    backgroundColor: colors.neutral[50],
  },

  // Avatar
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 26,
  },

  // Body
  convBody: {
    flex: 1,
    gap: 3,
  },
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
  convNameBold: {
    fontWeight: '700',
    color: colors.neutral[900],
  },
  convTime: {
    fontSize: 12,
    color: colors.neutral[400],
    flexShrink: 0,
  },
  convBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  convPreview: {
    flex: 1,
    fontSize: 13,
    color: colors.neutral[500],
  },
  convPreviewBold: {
    color: colors.neutral[700],
    fontWeight: '600',
  },

  // Unread badge
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
  unreadBadgeText: {
    color: colors.neutral[0],
    fontSize: 11,
    fontWeight: '700',
  },

  // Empty / error
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.neutral[700],
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: 14,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: colors.semantic.error,
    textAlign: 'center',
  },

  // Skeleton
  skeletonContainer: {
    paddingTop: 8,
  },
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
  skeletonBody: {
    flex: 1,
    gap: 8,
  },
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

  // FAB
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
  fabPressed: {
    backgroundColor: colors.brand.blueDark,
  },
  fabIcon: {
    fontSize: 22,
    color: colors.neutral[0],
  },
});

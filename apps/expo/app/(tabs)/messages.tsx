/**
 * app/(tabs)/messages.tsx
 *
 * Messages tab — Direct Messages and Group Chats.
 *
 * Features:
 *  - Two sections: "Direct Messages" and "Group Chats"
 *  - DM conversations list with avatar emoji, display name, last message
 *    preview, relative timestamp, and unread count badge
 *  - Group chats list with group name, member count, last message preview
 *  - Skeleton loaders on first load
 *  - Pull-to-refresh (both sections)
 *  - Empty states with prompts
 *  - "New Message" button navigates to /messages/new
 *  - "New Group" button navigates to /messages/group/create
 *  - Tapping a DM row navigates to /messages/[conversationId]
 *  - Tapping a Group row navigates to /messages/group/[groupId]
 */

import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
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

interface GroupChat {
  id: string;
  name: string;
  tag: string;
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

async function fetchDMList(): Promise<DMConversation[]> {
  const { data } = await apiClient.get('/messages/dm');
  return data.conversations ?? [];
}

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

function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DM conversation row
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
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>{item.otherAvatarEmoji || '👤'}</Text>
      </View>
      <View style={styles.convBody}>
        <View style={styles.convTopRow}>
          <Text style={[styles.convName, hasUnread && styles.convNameBold]} numberOfLines={1}>
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
// Group chat row
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
          <Text style={[styles.convName, hasUnread && styles.convNameBold]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.lastMessageAt && (
            <Text style={styles.convTime}>{relativeTime(item.lastMessageAt)}</Text>
          )}
        </View>
        <View style={styles.convBottomRow}>
          <Text style={styles.memberCount}>{item.memberCount} members</Text>
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
// Section header
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}

function SectionHeader({ title, action }: SectionHeaderProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{title}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          style={styles.sectionAction}
          accessibilityRole="button"
        >
          <Text style={styles.sectionActionText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MessagesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors: themeColors } = useTheme();

  const {
    data: conversations = [],
    isLoading: dmLoading,
    isError: dmError,
    refetch: refetchDMs,
    isRefetching: dmRefreshing,
  } = useQuery({
    queryKey: ['dm-list'],
    queryFn: fetchDMList,
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });

  const {
    data: groups = [],
    isLoading: groupsLoading,
    isError: groupsError,
    refetch: refetchGroups,
    isRefetching: groupsRefreshing,
  } = useQuery({
    queryKey: ['group-chats'],
    queryFn: fetchGroupChats,
    staleTime: 5_000,
    placeholderData: (prev) => prev,
  });

  const handleConvPress = useCallback(
    (item: DMConversation) => {
      router.push(`/messages/${item.conversationId}` as Parameters<typeof router.push>[0]);
    },
    [router],
  );

  const handleGroupPress = useCallback(
    (item: GroupChat) => {
      router.push(`/messages/group/${item.id}` as Parameters<typeof router.push>[0]);
    },
    [router],
  );

  const handleNewMessage = useCallback(() => {
    router.push('/messages/new' as Parameters<typeof router.push>[0]);
  }, [router]);

  const handleNewGroup = useCallback(() => {
    router.push('/messages/group/create' as Parameters<typeof router.push>[0]);
  }, [router]);

  const handleRefresh = useCallback(() => {
    refetchDMs();
    refetchGroups();
  }, [refetchDMs, refetchGroups]);

  const isRefreshing = dmRefreshing || groupsRefreshing;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>{t('messages.title')}</Text>
        <Pressable
          style={styles.newBtn}
          onPress={handleNewMessage}
          accessibilityRole="button"
          accessibilityLabel="New message"
        >
          <Text style={styles.newBtnText}>{t('messages.newBtn')}</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand.blue}
          />
        }
      >
        {/* Direct Messages section */}
        <SectionHeader title={t('messages.directMessages')} />

        {dmLoading ? (
          <SkeletonList count={3} />
        ) : dmError ? (
          <View style={styles.inlineCentered}>
            <Text style={styles.errorText}>{t('messages.dmLoadError')}</Text>
          </View>
        ) : conversations.length === 0 ? (
          <View style={styles.inlineCentered}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>{t('messages.noConversations')}</Text>
            <Pressable
              onPress={handleNewMessage}
              style={styles.emptyAction}
              accessibilityRole="button"
            >
              <Text style={styles.emptyActionText}>{t('messages.startConversation')}</Text>
            </Pressable>
          </View>
        ) : (
          conversations.map((item: DMConversation) => (
            <ConvRow key={item.conversationId} item={item} onPress={handleConvPress} />
          ))
        )}

        {/* Group Chats section */}
        <SectionHeader
          title={t('messages.groupChats')}
          action={{ label: t('messages.newGroup'), onPress: handleNewGroup }}
        />

        {groupsLoading ? (
          <SkeletonList count={2} />
        ) : groupsError ? (
          <View style={styles.inlineCentered}>
            <Text style={styles.errorText}>{t('messages.groupLoadError')}</Text>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.inlineCentered}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyText}>{t('messages.noGroupChats')}</Text>
            <Pressable
              onPress={handleNewGroup}
              style={styles.emptyAction}
              accessibilityRole="button"
            >
              <Text style={styles.emptyActionText}>{t('messages.createGroup')}</Text>
            </Pressable>
          </View>
        ) : (
          groups.map((item: GroupChat) => (
            <GroupRow key={item.id} item={item} onPress={handleGroupPress} />
          ))
        )}
      </ScrollView>
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

  scrollContent: {
    paddingBottom: 100,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  sectionAction: {
    backgroundColor: colors.brand.blue,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  sectionActionText: {
    color: colors.neutral[0],
    fontSize: 12,
    fontWeight: '700',
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
  avatarEmoji: { fontSize: 26 },

  // Body
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
    justifyContent: 'space-between',
    gap: 8,
  },
  memberCount: {
    fontSize: 11,
    color: colors.neutral[400],
    flexShrink: 0,
    marginRight: 4,
  },
  convPreview: { flex: 1, fontSize: 13, color: colors.neutral[500] },
  convPreviewBold: { color: colors.neutral[700], fontWeight: '600' },

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
  unreadBadgeText: { color: colors.neutral[0], fontSize: 11, fontWeight: '700' },

  // Empty / error inline
  inlineCentered: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 32,
    gap: 6,
  },
  emptyEmoji: { fontSize: 36, marginBottom: 4 },
  emptyText: { fontSize: 14, color: colors.neutral[500], textAlign: 'center' },
  emptyAction: { marginTop: 6 },
  emptyActionText: { fontSize: 14, color: colors.brand.blue, fontWeight: '600' },
  errorText: { fontSize: 14, color: colors.semantic.error, textAlign: 'center' },

  // Skeleton
  skeletonContainer: { paddingTop: 4 },
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
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

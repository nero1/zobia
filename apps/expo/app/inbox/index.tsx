/**
 * app/inbox/index.tsx
 *
 * Admin messages inbox.
 *
 * Features:
 *  - List of admin messages (subject, date, read status)
 *  - "From Zobia" badge
 *  - Tap to view full message in a detail modal
 *  - Cannot reply
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  isRead: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

interface InboxPage {
  messages: AdminMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

async function fetchInboxPage(cursor?: string): Promise<InboxPage> {
  const url = cursor ? `/inbox?cursor=${encodeURIComponent(cursor)}&limit=20` : '/inbox?limit=20';
  const { data } = await apiClient.get<Record<string, unknown>>(url);
  const rawList = (
    Array.isArray(data) ? data :
    Array.isArray((data as Record<string, unknown[]>).items) ? (data as Record<string, unknown[]>).items :
    (data as Record<string, unknown[]>).messages ?? []
  ) as Record<string, unknown>[];
  const messages = rawList.map((m) => ({
    id: String(m.id ?? ''),
    subject: String(m.subject ?? '(no subject)'),
    body: String(m.body ?? ''),
    sentAt: String(m.created_at ?? m.sentAt ?? new Date().toISOString()),
    isRead: m.read_at != null || Boolean(m.isRead),
  }));
  const nextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
  return { messages, nextCursor, hasMore: !!nextCursor };
}

async function markAsRead(messageId: string): Promise<void> {
  await apiClient.post(`/inbox/${messageId}/read`);
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function InboxSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Message detail modal
// ---------------------------------------------------------------------------

interface MessageModalProps {
  message: AdminMessage | null;
  onClose: () => void;
}

function MessageModal({ message, onClose }: MessageModalProps) {
  const { colors: themeColors } = useTheme();
  if (!message) return null;

  const formattedDate = new Date(message.sentAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { backgroundColor: themeColors.surface }]}>
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: themeColors.border }]}>
            <View style={styles.zobiaLabelRow}>
              <View style={styles.zobiaLogo}>
                <Text style={styles.zobiaLogoText}>Z</Text>
              </View>
              <Text style={[styles.zobiaLabel, { color: colors.brand.blue }]}>From Zobia</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Close message"
              accessibilityRole="button"
            >
              <Text style={[styles.closeBtnText, { color: themeColors.text }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalSubject, { color: themeColors.text }]}>
              {message.subject}
            </Text>
            <Text style={[styles.modalDate, { color: themeColors.textMuted }]}>
              {formattedDate}
            </Text>
            <Text style={[styles.modalBodyText, { color: themeColors.text }]}>
              {message.body}
            </Text>
          </ScrollView>

          {/* No-reply notice */}
          <View style={[styles.noReplyBanner, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
            <Text style={[styles.noReplyText, { color: themeColors.textMuted }]}>
              This is a system message. You cannot reply.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------------

interface MessageRowProps {
  message: AdminMessage;
  onPress: () => void;
}

function MessageRow({ message, onPress }: MessageRowProps) {
  const { colors: themeColors } = useTheme();
  const date = new Date(message.sentAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        { borderBottomColor: themeColors.border },
        !message.isRead && { backgroundColor: `${colors.brand.blue}08` },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${message.subject}, ${message.isRead ? 'read' : 'unread'}`}
    >
      {/* Unread dot */}
      <View style={styles.dotCol}>
        {!message.isRead && <View style={styles.unreadDot} />}
      </View>

      {/* Content */}
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <View style={styles.zobiaSmallBadge}>
            <Text style={styles.zobiaSmallBadgeText}>Zobia</Text>
          </View>
          <Text style={[styles.rowDate, { color: themeColors.textMuted }]}>{date}</Text>
        </View>
        <Text
          style={[
            styles.rowSubject,
            { color: themeColors.text },
            !message.isRead && styles.rowSubjectBold,
          ]}
          numberOfLines={1}
        >
          {message.subject}
        </Text>
        <Text style={[styles.rowPreview, { color: themeColors.textMuted }]} numberOfLines={2}>
          {message.body}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * InboxScreen — admin messages from Zobia, read-only.
 */
export default function InboxScreen() {
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const [selectedMessage, setSelectedMessage] = useState<AdminMessage | null>(null);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<InboxPage>({
    queryKey: ['inbox-admin'],
    queryFn: ({ pageParam }) => fetchInboxPage(pageParam as string | undefined),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });

  const messages = data?.pages.flatMap((p) => p.messages) ?? [];

  const readMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox-admin'] }),
  });

  const handleOpen = (msg: AdminMessage) => {
    setSelectedMessage(msg);
    if (!msg.isRead) {
      readMutation.mutate(msg.id);
    }
  };

  return (
    <Screen>
      {isLoading ? (
        <InboxSkeleton />
      ) : isError ? (
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load messages. Check your connection.
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageRow message={item} onPress={() => handleOpen(item)} />
          )}
          showsVerticalScrollIndicator={false}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={() => (
            <View style={[styles.listHeader, { borderBottomColor: themeColors.border }]}>
              <Text style={[styles.listHeaderTitle, { color: themeColors.text }]}>Inbox</Text>
              <Text style={[styles.listHeaderSub, { color: themeColors.textMuted }]}>
                Messages from the Zobia team
              </Text>
            </View>
          )}
          ListFooterComponent={isFetchingNextPage ? () => (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={colors.brand.blue} />
            </View>
          ) : null}
          ListEmptyComponent={() => (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>📬</Text>
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No messages yet. We'll send updates here!
              </Text>
            </View>
          )}
        />
      )}

      <MessageModal
        message={selectedMessage}
        onClose={() => setSelectedMessage(null)}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  listHeader: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listHeaderTitle: { fontSize: 22, fontWeight: '800' },
  listHeaderSub: { fontSize: 13, marginTop: 2 },

  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 72,
  },
  dotCol: { width: 10, alignItems: 'center', paddingTop: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.blue,
  },
  rowContent: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zobiaSmallBadge: {
    backgroundColor: colors.brand.blue,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  zobiaSmallBadgeText: { color: colors.neutral[0], fontSize: 10, fontWeight: '700' },
  rowDate: { fontSize: 12 },
  rowSubject: { fontSize: 14 },
  rowSubjectBold: { fontWeight: '700' },
  rowPreview: { fontSize: 12, lineHeight: 17 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    minHeight: '50%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  zobiaLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zobiaLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zobiaLogoText: { color: colors.neutral[0], fontSize: 14, fontWeight: '900' },
  zobiaLabel: { fontSize: 14, fontWeight: '700' },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontSize: 18, fontWeight: '600' },
  modalBody: { padding: 20 },
  modalSubject: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  modalDate: { fontSize: 12, marginBottom: 16 },
  modalBodyText: { fontSize: 15, lineHeight: 23 },
  noReplyBanner: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    alignItems: 'center',
  },
  noReplyText: { fontSize: 13 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  loadingMore: { paddingVertical: 16, alignItems: 'center' },

  skeletonContainer: { padding: 16, gap: 10 },
  skeletonRow: { height: 72, borderRadius: 10, backgroundColor: colors.neutral[200] },
});

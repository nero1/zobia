/**
 * app/messages/group/[groupId].tsx
 *
 * Group chat conversation screen.
 *
 * Features:
 *  - Inverted FlatList of group messages with sender names
 *  - Text input + send button
 *  - Polling via refetchInterval (3s)
 *  - Anti-spam notice if content is blocked
 *  - No coin cost for group messages
 *  - Loading / empty / error states
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { queueMessage } from '@/lib/offline/sqlite';
import { useAuth } from '@/lib/auth/hooks';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { readCachedMessages, writeCachedMessages } from '@/lib/chat/messageCache';
import { newestCreatedAt, mergeNewestFirst } from '@/lib/chat/delta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupMessage {
  id: string;
  content: string;
  senderUserId: string;
  senderDisplayName: string;
  createdAt: string;
  blocked?: boolean;
}

interface GroupMeta {
  id: string;
  name: string;
  tag: string;
  memberCount: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw group message row (snake_case from the API) into the camelCase
 * `GroupMessage` shape. The list endpoint returns rows under `data` (not
 * `messages`), so without this the conversation was always empty.
 */
function mapGroupMessage(raw: Record<string, unknown>): GroupMessage {
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const username = str(raw.username ?? raw.senderUsername);
  return {
    id: str(raw.id),
    content: str(raw.content),
    senderUserId: str(raw.sender_id ?? raw.senderUserId),
    senderDisplayName: str(raw.display_name ?? raw.senderDisplayName, username || 'Member'),
    createdAt: str(raw.created_at ?? raw.createdAt, new Date().toISOString()),
    blocked: Boolean(raw.is_blocked ?? raw.blocked),
  };
}

async function fetchGroupMeta(groupId: string): Promise<GroupMeta> {
  // The group list endpoint carries the meta; find this group within it.
  const { data } = await apiClient.get('/messages/group');
  const items: Record<string, unknown>[] = data.items ?? [];
  const g = items.find((it) => it.id === groupId) ?? {};
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    id: str(g.id, groupId),
    name: str(g.name, 'Group'),
    tag: str(g.tag),
    memberCount: num(g.member_count ?? g.memberCount),
  };
}

async function fetchGroupMessages(groupId: string, after?: string): Promise<GroupMessage[]> {
  const url = after
    ? `/messages/group/${groupId}?after=${encodeURIComponent(after)}`
    : `/messages/group/${groupId}`;
  const { data } = await apiClient.get(url);
  const rows: Record<string, unknown>[] = data.data ?? data.messages ?? [];
  return rows.map(mapGroupMessage);
}

async function sendGroupMessage(groupId: string, content: string, idempotencyKey?: string): Promise<GroupMessage> {
  const { data } = await apiClient.post(`/messages/group/${groupId}`, { content, idempotencyKey });
  return mapGroupMessage(data.data ?? data.message ?? {});
}

// ---------------------------------------------------------------------------
// Pending message counter
// ---------------------------------------------------------------------------

let pendingCounter = 0;

function makePendingMessage(content: string, userId: string): GroupMessage {
  return {
    id: `pending-${++pendingCounter}`,
    content,
    senderUserId: userId,
    senderDisplayName: 'You',
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ConvSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.skeletonBubble, i % 2 === 0 && styles.skeletonBubbleRight]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

interface GroupBubbleProps {
  message: GroupMessage;
  isOwn: boolean;
}

function GroupBubble({ message, isOwn }: GroupBubbleProps) {
  const { colors: themeColors } = useTheme();
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  if (message.blocked) {
    return (
      <View style={[styles.msgRow, styles.msgRowOther]}>
        <View style={styles.blockedBubble}>
          <Text style={styles.blockedText}>Message blocked by anti-spam filter.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
      {!isOwn && (
        <Text style={styles.senderName}>{message.senderDisplayName}</Text>
      )}
      <View
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
          { ...(isOwn ? {} : { backgroundColor: themeColors.surface }) },
        ]}
      >
        <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : { color: themeColors.text }]}>
          {message.content}
        </Text>
        <Text
          style={[
            styles.bubbleTime,
            { color: isOwn ? colors.neutral[200] : themeColors.textMuted },
          ]}
        >
          {time}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function GroupConversationScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors: themeColors, isDark } = useTheme();
  const { user: authUser } = useAuth();
  const myUserId = authUser?.id ?? 'me';

  const flatListRef = useRef<FlatList<GroupMessage>>(null);
  const isAtBottomRef = useRef(true);

  const [inputText, setInputText] = useState('');
  const [pendingMessages, setPendingMessages] = useState<GroupMessage[]>([]);
  const [spamBlocked, setSpamBlocked] = useState(false);

  const { data: groupMeta } = useQuery({
    queryKey: ['group-meta', groupId],
    queryFn: () => fetchGroupMeta(groupId!),
    enabled: !!groupId,
  });

  useEffect(() => {
    if (groupMeta) {
      navigation.setOptions({ title: groupMeta.name });
    }
  }, [groupMeta, navigation]);

  // Realtime push — merge new group messages into the cache instantly.
  const realtimeConnected = useRealtimeChannel(
    groupId ? `group:${groupId}:messages` : null,
    useCallback((event: string, data: unknown) => {
      if (event !== 'new_message') return;
      const raw = (data as { message?: Record<string, unknown> })?.message;
      if (!raw) return;
      const incoming = mapGroupMessage(raw);
      if (!incoming.id) return;
      queryClient.setQueryData<GroupMessage[]>(['group-messages', groupId], (prev: GroupMessage[] | undefined) => {
        const list = prev ?? [];
        if (list.some((m: GroupMessage) => m.id === incoming.id)) return list;
        return [incoming, ...list];
      });
    }, [groupId, queryClient]),
  );

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['group-messages', groupId],
    queryFn: async () => {
      const prev = queryClient.getQueryData<GroupMessage[]>(['group-messages', groupId]) ?? [];
      const after = newestCreatedAt(prev);
      const incoming = await fetchGroupMessages(groupId!, after);
      return after ? mergeNewestFirst(prev, incoming) : incoming;
    },
    enabled: !!groupId,
    refetchInterval: realtimeConnected ? 30_000 : 3_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    initialData: () => (groupId ? readCachedMessages<GroupMessage>(`group:${groupId}`) ?? undefined : undefined),
    initialDataUpdatedAt: 0,
  });

  // Persist latest group messages for instant first paint on reopen.
  useEffect(() => {
    if (groupId && messages.length) writeCachedMessages(`group:${groupId}`, messages);
  }, [messages, groupId]);

  const sendMutation = useMutation({
    mutationFn: ({ content, idempotencyKey }: { content: string; idempotencyKey: string }) =>
      sendGroupMessage(groupId!, content, idempotencyKey),
    onMutate: ({ content }) => {
      const optimistic = makePendingMessage(content, myUserId);
      setPendingMessages((prev) => [optimistic, ...prev]);
      setSpamBlocked(false);
      return { optimistic };
    },
    onSuccess: (result, _, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      if (result.blocked) setSpamBlocked(true);
      queryClient.invalidateQueries({ queryKey: ['group-messages', groupId] });
    },
    onError: (_, vars, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      queueMessage(groupId!, vars.content, 'text', 'group', vars.idempotencyKey).catch(() =>
        console.warn('[offline] queueMessage failed')
      );
      // FIX-46: Show user feedback when group message is queued offline
      Alert.alert('Message queued', 'Message queued — will send when back online.');
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    sendMutation.mutate({ content: text, idempotencyKey: randomUUID() });
  }, [inputText, sendMutation]);

  // Deduplicate pending messages against server messages: if the server already
  // has a matching message (same sender + content), hide the optimistic bubble.
  const serverMessageSet = new Set(
    messages.map((m) => `${m.senderUserId}|${m.content}`)
  );
  const filteredPending = pendingMessages.filter((p) => {
    const key = `${p.senderUserId}|${p.content}`;
    if (!serverMessageSet.has(key)) return true;
    const serverMatch = messages.find(
      (m) => m.senderUserId === p.senderUserId && m.content === p.content
    );
    if (!serverMatch) return true;
    return Math.abs(new Date(serverMatch.createdAt).getTime() - new Date(p.createdAt).getTime()) > 5000;
  });
  const combinedMessages = [...filteredPending, ...messages];

  // Scroll to newest message when the list grows, but only when already near
  // the bottom (offset 0 on an inverted FlatList = visual bottom = newest).
  useEffect(() => {
    if (combinedMessages.length > 0 && isAtBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [combinedMessages.length]);

  const renderItem = useCallback(
    ({ item }: { item: GroupMessage }) => (
      <GroupBubble message={item} isOwn={item.senderUserId === myUserId} />
    ),
    [myUserId],
  );

  return (
    <Screen hideOfflineBanner disableBottomInset>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={88}
      >
        {/* Message list */}
        {isLoading ? (
          <ConvSkeleton />
        ) : (
          <FlatList
            ref={flatListRef}
            data={combinedMessages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            inverted
            style={styles.flex}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={100}
            onScroll={({ nativeEvent }) => {
              isAtBottomRef.current = nativeEvent.contentOffset.y <= 100;
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                  No messages yet. Say hello!
                </Text>
              </View>
            }
          />
        )}

        {/* Anti-spam notice */}
        {spamBlocked && (
          <View style={[styles.spamBanner, { backgroundColor: `${colors.semantic.warning}18` }]}>
            <Text style={[styles.spamText, { color: colors.semantic.warning }]}>
              Your message was blocked by the anti-spam filter. Please keep content respectful.
            </Text>
          </View>
        )}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            { backgroundColor: themeColors.surface, borderTopColor: themeColors.border },
          ]}
        >
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                color: themeColors.text,
              },
            ]}
            placeholder="Message group…"
            placeholderTextColor={themeColors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[
              styles.sendBtn,
              {
                backgroundColor: inputText.trim() ? colors.brand.blue : colors.neutral[300],
              },
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sendMutation.isPending}
            accessibilityLabel="Send message"
            accessibilityRole="button"
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.neutral[0]} />
            ) : (
              <Text style={styles.sendBtnText}>↑</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },

  messageList: { paddingVertical: 12, paddingHorizontal: 12 },

  msgRow: { marginVertical: 3 },
  msgRowOwn: { alignItems: 'flex-end' },
  msgRowOther: { alignItems: 'flex-start' },

  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.neutral[500],
    marginBottom: 2,
    paddingHorizontal: 4,
  },

  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    gap: 2,
  },
  bubbleOwn: { backgroundColor: colors.brand.blue, borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.neutral[200] },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextOwn: { color: colors.neutral[0] },
  bubbleTime: { fontSize: 10, alignSelf: 'flex-end' },

  blockedBubble: {
    maxWidth: '78%',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: colors.neutral[100],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  blockedText: { fontSize: 13, color: colors.neutral[400], fontStyle: 'italic' },

  spamBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  spamText: { fontSize: 12, textAlign: 'center' },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  textInput: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 20, fontWeight: '800', color: colors.neutral[0] },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 14, textAlign: 'center' },

  skeletonContainer: { flex: 1, padding: 16, gap: 10 },
  skeletonBubble: {
    height: 44,
    width: '65%',
    borderRadius: 18,
    backgroundColor: colors.neutral[200],
    alignSelf: 'flex-start',
  },
  skeletonBubbleRight: { alignSelf: 'flex-end' },
});

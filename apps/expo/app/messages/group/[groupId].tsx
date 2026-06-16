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

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

async function fetchGroupMeta(groupId: string): Promise<GroupMeta> {
  const { data } = await apiClient.get(`/messages/group/${groupId}`);
  return data.group;
}

async function fetchGroupMessages(groupId: string): Promise<GroupMessage[]> {
  const { data } = await apiClient.get(`/messages/group/${groupId}`);
  return data.messages ?? [];
}

async function sendGroupMessage(groupId: string, content: string): Promise<GroupMessage> {
  const { data } = await apiClient.post(`/messages/group/${groupId}`, { content });
  return data.message;
}

// ---------------------------------------------------------------------------
// Pending message counter
// ---------------------------------------------------------------------------

let pendingCounter = 0;

function makePendingMessage(content: string): GroupMessage {
  return {
    id: `pending-${++pendingCounter}`,
    content,
    senderUserId: 'me',
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

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['group-messages', groupId],
    queryFn: () => fetchGroupMessages(groupId!),
    enabled: !!groupId,
    refetchInterval: 3_000,
    placeholderData: (prev) => prev,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendGroupMessage(groupId!, content),
    onMutate: (content) => {
      const optimistic = makePendingMessage(content);
      setPendingMessages((prev) => [optimistic, ...prev]);
      setSpamBlocked(false);
      return { optimistic };
    },
    onSuccess: (result, _, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      if (result.blocked) setSpamBlocked(true);
      queryClient.invalidateQueries({ queryKey: ['group-messages', groupId] });
    },
    onError: (_, content, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      queueMessage(groupId!, content, 'text').catch(() =>
        console.warn('[offline] queueMessage failed')
      );
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    sendMutation.mutate(text);
  }, [inputText, sendMutation]);

  const combinedMessages = [...pendingMessages, ...messages];

  const renderItem = useCallback(
    ({ item }: { item: GroupMessage }) => (
      <GroupBubble message={item} isOwn={item.senderUserId === 'me'} />
    ),
    [],
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
            data={combinedMessages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            inverted
            style={styles.flex}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
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

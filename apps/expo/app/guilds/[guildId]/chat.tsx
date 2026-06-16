/**
 * app/guilds/[guildId]/chat.tsx
 *
 * Guild Chat screen — PRD §13 (Bronze I+ feature).
 * Real-time chat channel for guild members.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';
import { useTheme } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string | null;
  sender_avatar_emoji: string | null;
  sender_rank_name: string | null;
  content: string;
  type: 'text' | 'sticker' | 'gif';
  created_at: string;
}

interface ChatPage {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// GuildChat Screen
// ---------------------------------------------------------------------------

export default function GuildChatScreen() {
  const { guildId } = useLocalSearchParams<{ guildId: string }>();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  // Fetch paginated chat history (oldest-first for display)
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<ChatPage>({
    queryKey: ['guild-chat', guildId],
    queryFn: async ({ pageParam }) => {
      const url = pageParam
        ? `/guilds/${guildId}/chat?cursor=${encodeURIComponent(pageParam as string)}&limit=30`
        : `/guilds/${guildId}/chat?limit=30`;
      const res = await apiClient.get(url);
      return res.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
  });

  const allMessages: ChatMessage[] = data?.pages.flatMap((p) => p.messages) ?? [];

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiClient.post(`/guilds/${guildId}/chat`, {
        content,
        type: 'text',
      });
      return res.data;
    },
    onSuccess: (result) => {
      // Optimistically append and invalidate
      queryClient.invalidateQueries({ queryKey: ['guild-chat', guildId] });
      setInputText('');
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    sendMutation.mutate(text, {
      onSettled: () => setSending(false),
    });
  }, [inputText, sending, sendMutation]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isOwn = item.sender_id === user?.id;
      return (
        <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
          {!isOwn && (
            <Text style={styles.avatar}>{item.sender_avatar_emoji ?? '🙂'}</Text>
          )}
          <View
            style={[
              styles.bubble,
              { backgroundColor: themeColors.surface },
              isOwn && { backgroundColor: themeColors.primary, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
            ]}
          >
            {!isOwn && (
              <Text style={[styles.senderName, { color: themeColors.primary }]}>
                {item.sender_display_name ?? item.sender_username}
                {item.sender_rank_name ? (
                  <Text style={[styles.rankBadge, { color: themeColors.textMuted }]}> · {item.sender_rank_name}</Text>
                ) : null}
              </Text>
            )}
            <Text style={[styles.messageText, { color: themeColors.text }, isOwn && styles.messageTextOwn]}>
              {item.content}
            </Text>
            <Text style={[styles.timestamp, { color: themeColors.textMuted }]}>
              {new Date(item.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>
      );
    },
    [user?.id, themeColors]
  );

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={themeColors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        {/* Load older messages button */}
        {hasNextPage && (
          <Pressable
            style={[
              styles.loadOlderBtn,
              { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border },
            ]}
            onPress={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            <Text style={[styles.loadOlderText, { color: themeColors.primary }]}>
              {isFetchingNextPage ? 'Loading...' : 'Load older messages'}
            </Text>
          </Pressable>
        )}

        <FlatList
          ref={flatListRef}
          data={allMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No messages yet. Say hi to your guild! 👋
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        <View style={[styles.inputBar, { borderTopColor: themeColors.border, backgroundColor: themeColors.background }]}>
          <TextInput
            style={[styles.input, { backgroundColor: themeColors.surface, color: themeColors.text }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Message your guild..."
            placeholderTextColor={themeColors.textMuted}
            multiline
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: themeColors.primary },
              (!inputText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>{sending ? '...' : '➤'}</Text>
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
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loadOlderBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  loadOlderText: {
    fontSize: 13,
    fontWeight: '600',
  },
  messageList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginBottom: 4,
  },
  messageRowOwn: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    fontSize: 22,
    width: 32,
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  rankBadge: {
    fontWeight: '400',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextOwn: {
    color: '#fff',
  },
  timestamp: {
    fontSize: 10,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

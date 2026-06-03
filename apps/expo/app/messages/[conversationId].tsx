/**
 * app/messages/[conversationId].tsx
 *
 * DM conversation screen.
 *
 * Features:
 *  - Inverted FlatList of messages
 *  - Text input + send button
 *  - For Free/Plus users: shows coin cost per reply
 *  - Insufficient coins notice with "Gift them coins" link
 *  - GIF picker (opens search sheet — placeholder)
 *  - Reactions on long-press
 *  - Offline: pending message visual (clock icon)
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { getPidginSuggestions } from '@/lib/i18n/pidgin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageStatus = 'sent' | 'pending' | 'failed';

interface DM {
  id: string;
  content: string | null;
  gifUrl: string | null;
  messageType: 'text' | 'gif';
  senderUserId: string;
  createdAt: string;
  status?: MessageStatus;
  reactions: { emoji: string; count: number; userReacted: boolean }[];
}

interface ConversationMeta {
  conversationId: string;
  otherUserId: string;
  otherDisplayName: string;
  otherAvatarEmoji: string;
  coinCostPerMessage: number;
  isUnlimited: boolean;
  userCoinBalance: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchConversation(id: string): Promise<ConversationMeta> {
  const { data } = await apiClient.get(`/messages/conversations/${id}`);
  return data.conversation;
}

async function fetchMessages(id: string): Promise<DM[]> {
  const { data } = await apiClient.get(`/messages/conversations/${id}/messages`);
  return data.messages ?? [];
}

async function sendDM(conversationId: string, content: string): Promise<DM> {
  const { data } = await apiClient.post(`/messages/conversations/${conversationId}/messages`, {
    content,
    messageType: 'text',
  });
  return data.message;
}

// ---------------------------------------------------------------------------
// Pending optimistic message
// ---------------------------------------------------------------------------

let pendingIdCounter = 0;
function makePendingMessage(content: string, myUserId: string): DM {
  return {
    id: `pending-${++pendingIdCounter}`,
    content,
    gifUrl: null,
    messageType: 'text',
    senderUserId: myUserId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    reactions: [],
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
// Message bubble (DM variant)
// ---------------------------------------------------------------------------

const MY_USER_ID = 'me'; // replaced by auth context in production

interface DMBubbleProps {
  dm: DM;
  isOwn: boolean;
  onLongPress: (id: string) => void;
}

function DMBubble({ dm, isOwn, onLongPress }: DMBubbleProps) {
  const { colors: themeColors } = useTheme();
  const time = new Date(dm.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const isPending = dm.status === 'pending';

  return (
    <Pressable
      onLongPress={() => onLongPress(dm.id)}
      style={[styles.dmRow, isOwn ? styles.dmRowOwn : styles.dmRowOther]}
      accessibilityRole="text"
    >
      <View
        style={[
          styles.dmBubble,
          isOwn ? styles.dmBubbleOwn : styles.dmBubbleOther,
        ]}
      >
        {dm.content && (
          <Text
            style={[
              styles.dmText,
              isOwn ? styles.dmTextOwn : { color: themeColors.text },
            ]}
          >
            {dm.content}
          </Text>
        )}
        <View style={styles.dmMeta}>
          {isPending && (
            <Text style={[styles.dmStatus, { color: isOwn ? colors.neutral[200] : themeColors.textMuted }]}>
              🕐
            </Text>
          )}
          <Text
            style={[
              styles.dmTime,
              { color: isOwn ? colors.neutral[200] : themeColors.textMuted },
            ]}
          >
            {time}
          </Text>
        </View>
      </View>
      {/* Reactions */}
      {dm.reactions.length > 0 && (
        <View style={styles.reactionStrip}>
          {dm.reactions.map((r) => (
            <View key={r.emoji} style={[styles.reactionPill, r.userReacted && styles.reactionPillActive]}>
              <Text style={styles.reactionEmoji}>{r.emoji}</Text>
              <Text style={styles.reactionCount}>{r.count}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * DMConversationScreen — 1-on-1 direct message conversation.
 */
export default function DMConversationScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors: themeColors, isDark } = useTheme();
  const { i18n } = useTranslation();

  const [inputText, setInputText] = useState('');
  const [pidginSuggestions, setPidginSuggestions] = useState<string[]>([]);
  const [pendingMessages, setPendingMessages] = useState<DM[]>([]);

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    const suggestions = getPidginSuggestions(text, i18n.language);
    setPidginSuggestions(suggestions);
  }, [i18n.language]);

  const { data: conversation } = useQuery({
    queryKey: ['dm-conversation', conversationId],
    queryFn: () => fetchConversation(conversationId!),
    enabled: !!conversationId,
    onSuccess: (data) => {
      navigation.setOptions({
        title: data.otherDisplayName,
      });
    },
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['dm-messages', conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
    refetchInterval: 3_000,
    placeholderData: (prev) => prev,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendDM(conversationId!, content),
    onMutate: (content) => {
      const optimistic = makePendingMessage(content, MY_USER_ID);
      setPendingMessages((prev) => [optimistic, ...prev]);
      return { optimistic };
    },
    onSuccess: (_, __, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      queryClient.invalidateQueries({ queryKey: ['dm-messages', conversationId] });
    },
    onError: (_, __, ctx) => {
      setPendingMessages((prev) =>
        prev.map((m) =>
          m.id === ctx?.optimistic.id ? { ...m, status: 'failed' as MessageStatus } : m,
        ),
      );
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    sendMutation.mutate(text);
  }, [inputText, sendMutation]);

  const handleLongPress = useCallback((messageId: string) => {
    // Reaction picker placeholder
    console.log('Long press on DM', messageId);
  }, []);

  const combinedMessages = [...pendingMessages, ...messages];
  const insufficientCoins =
    conversation &&
    !conversation.isUnlimited &&
    conversation.userCoinBalance < conversation.coinCostPerMessage;

  const renderItem = useCallback(
    ({ item }: { item: DM }) => (
      <DMBubble
        dm={item}
        isOwn={item.senderUserId === MY_USER_ID}
        onLongPress={handleLongPress}
      />
    ),
    [handleLongPress],
  );

  return (
    <Screen hideOfflineBanner disableBottomInset>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={88}
      >
        {/* Coin cost notice */}
        {conversation && !conversation.isUnlimited && (
          <View style={styles.costBanner}>
            <Text style={[styles.costBannerText, { color: themeColors.textMuted }]}>
              🪙 Each reply costs {conversation.coinCostPerMessage} coin
            </Text>
          </View>
        )}

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
          />
        )}

        {/* Insufficient coins notice */}
        {insufficientCoins && (
          <View style={[styles.insufficientBanner, { backgroundColor: `${colors.semantic.error}18` }]}>
            <Text style={[styles.insufficientText, { color: colors.semantic.error }]}>
              Not enough coins to reply.{' '}
            </Text>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/economy/gift-send',
                  params: { toUserId: conversation!.otherUserId },
                })
              }
              accessibilityRole="link"
            >
              <Text style={styles.giftLink}>Gift them coins →</Text>
            </Pressable>
          </View>
        )}

        {/* Pidgin suggestion chips */}
        {pidginSuggestions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pidginBar}
            contentContainerStyle={styles.pidginBarContent}
            keyboardShouldPersistTaps="handled"
          >
            {pidginSuggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => {
                  setInputText(s);
                  setPidginSuggestions([]);
                }}
                style={[styles.pidginChip, { backgroundColor: themeColors.surface, borderColor: colors.brand.blue }]}
                accessibilityRole="button"
                accessibilityLabel={`Use Pidgin suggestion: ${s}`}
              >
                <Text style={[styles.pidginChipText, { color: colors.brand.blue }]}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: themeColors.surface,
              borderTopColor: themeColors.border,
            },
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
            placeholder="Message…"
            placeholderTextColor={themeColors.textMuted}
            value={inputText}
            onChangeText={handleInputChange}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            editable={!insufficientCoins}
          />
          {/* GIF button */}
          <Pressable
            style={styles.iconBtn}
            onPress={() => console.log('GIF picker')}
            accessibilityLabel="Send GIF"
            accessibilityRole="button"
          >
            <Text style={styles.iconBtnText}>GIF</Text>
          </Pressable>
          {/* Send button */}
          <Pressable
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  inputText.trim() && !insufficientCoins
                    ? colors.brand.blue
                    : colors.neutral[300],
              },
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || insufficientCoins || sendMutation.isPending}
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

  costBanner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  costBannerText: { fontSize: 12, textAlign: 'center' },

  messageList: { paddingVertical: 12, paddingHorizontal: 12 },

  insufficientBanner: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  insufficientText: { fontSize: 13 },
  giftLink: { fontSize: 13, color: colors.brand.blue, fontWeight: '700' },

  pidginBar: { maxHeight: 44 },
  pidginBarContent: { paddingHorizontal: 12, paddingVertical: 6, gap: 8, flexDirection: 'row' },
  pidginChip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  pidginChipText: { fontSize: 13, fontWeight: '600' },

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
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  iconBtnText: { fontSize: 13, fontWeight: '700', color: colors.neutral[700] },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 20, fontWeight: '800', color: colors.neutral[0] },

  // DM bubbles
  dmRow: {
    marginVertical: 2,
    gap: 4,
  },
  dmRowOwn: { alignItems: 'flex-end' },
  dmRowOther: { alignItems: 'flex-start' },
  dmBubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    gap: 2,
  },
  dmBubbleOwn: {
    backgroundColor: colors.brand.blue,
    borderBottomRightRadius: 4,
  },
  dmBubbleOther: {
    backgroundColor: colors.neutral[100],
    borderBottomLeftRadius: 4,
  },
  dmText: { fontSize: 15, lineHeight: 20 },
  dmTextOwn: { color: colors.neutral[0] },
  dmMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  dmTime: { fontSize: 10 },
  dmStatus: { fontSize: 12 },

  reactionStrip: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 2,
  },
  reactionPillActive: {
    backgroundColor: `${colors.brand.blue}18`,
    borderColor: colors.brand.blue,
  },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 11, fontWeight: '600', color: colors.neutral[600] },

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

/**
 * app/messages/[conversationId].tsx
 *
 * DM conversation screen.
 *
 * Features:
 *  - Inverted FlatList of messages
 *  - Text input + send button
 *  - GIF picker (search modal with Giphy/Tenor results via /api/messages/gif proxy)
 *  - Sticker picker (pack tabs + emoji grid)
 *  - Gift button (routes to /economy/gift-send)
 *  - For Free/Plus users: shows coin cost per reply
 *  - Insufficient coins notice with "Gift them coins" link
 *  - Reactions on long-press
 *  - Offline: pending message visual (clock icon)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
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
type MessageType = 'text' | 'gif' | 'sticker' | 'gift';

interface DM {
  id: string;
  content: string | null;
  gifUrl: string | null;
  stickerEmoji: string | null;
  messageType: MessageType;
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
  otherUsername: string;
  coinCostPerMessage: number;
  isUnlimited: boolean;
  userCoinBalance: number;
}

interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
}

interface StickerPack {
  id: string;
  name: string;
  stickers: { id: string; emoji: string; label: string }[];
  unlocked: boolean;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConversation(id: string): Promise<ConversationMeta> {
  const { data } = await apiClient.get(`/messages/conversations/${id}`);
  return data.conversation;
}

async function fetchMessages(id: string): Promise<DM[]> {
  const { data } = await apiClient.get(`/messages/conversations/${id}/messages`);
  return data.messages ?? [];
}

async function sendDM(
  conversationId: string,
  content: string,
  messageType: MessageType = 'text',
): Promise<DM> {
  const { data } = await apiClient.post(`/messages/conversations/${conversationId}/messages`, {
    content,
    messageType,
  });
  return data.message;
}

async function searchGifs(query: string): Promise<GifResult[]> {
  const { data } = await apiClient.get('/messages/gif', { params: { q: query, limit: 15 } });
  return data.results ?? [];
}

async function fetchStickerPacks(): Promise<StickerPack[]> {
  const { data } = await apiClient.get('/stickers');
  return (data.packs ?? []).filter((p: StickerPack) => p.unlocked);
}

// ---------------------------------------------------------------------------
// Pending optimistic message
// ---------------------------------------------------------------------------

let pendingIdCounter = 0;
function makePendingMessage(
  content: string,
  myUserId: string,
  messageType: MessageType = 'text',
): DM {
  return {
    id: `pending-${++pendingIdCounter}`,
    content: messageType === 'text' ? content : null,
    gifUrl: messageType === 'gif' ? content : null,
    stickerEmoji: messageType === 'sticker' ? content : null,
    messageType,
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

const MY_USER_ID = 'me';

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
          dm.messageType === 'gif' && styles.dmBubbleMedia,
          dm.messageType === 'sticker' && styles.dmBubbleSticker,
        ]}
      >
        {dm.messageType === 'text' && dm.content && (
          <Text style={[styles.dmText, isOwn ? styles.dmTextOwn : { color: themeColors.text }]}>
            {dm.content}
          </Text>
        )}
        {dm.messageType === 'gif' && dm.gifUrl && (
          <Image
            source={{ uri: dm.gifUrl }}
            style={styles.gifImage}
            contentFit="cover"
            recyclingKey={dm.id}
          />
        )}
        {dm.messageType === 'sticker' && dm.stickerEmoji && (
          <Text style={styles.stickerEmoji}>{dm.stickerEmoji}</Text>
        )}
        {dm.messageType === 'gift' && dm.content && (
          <View style={styles.giftBubble}>
            <Text style={styles.giftEmoji}>🎁</Text>
            <Text style={styles.giftText}>{dm.content}</Text>
          </View>
        )}
        <View style={styles.dmMeta}>
          {isPending && (
            <Text style={[styles.dmStatus, { color: isOwn ? colors.neutral[200] : themeColors.textMuted }]}>
              🕐
            </Text>
          )}
          <Text style={[styles.dmTime, { color: isOwn ? colors.neutral[200] : themeColors.textMuted }]}>
            {time}
          </Text>
        </View>
      </View>
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
// GIF Picker Modal
// ---------------------------------------------------------------------------

interface GifPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
}

function GifPickerModal({ visible, onClose, onSelect }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colors: themeColors } = useTheme();

  useEffect(() => {
    if (!visible) return;
    // Load trending GIFs on open
    setLoading(true);
    searchGifs('trending')
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      searchGifs(text || 'trending')
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 400);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.pickerContainer, { backgroundColor: themeColors.background }]}>
        <View style={[styles.pickerHeader, { borderBottomColor: themeColors.border }]}>
          <Text style={[styles.pickerTitle, { color: themeColors.text }]}>GIFs</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close GIF picker">
            <Text style={[styles.pickerClose, { color: themeColors.textMuted }]}>✕</Text>
          </Pressable>
        </View>
        <View style={[styles.searchContainer, { backgroundColor: themeColors.surface }]}>
          <TextInput
            style={[styles.searchInput, { color: themeColors.text, backgroundColor: themeColors.background }]}
            placeholder="Search GIFs…"
            placeholderTextColor={themeColors.textMuted}
            value={query}
            onChangeText={handleSearch}
            autoFocus
            returnKeyType="search"
          />
        </View>
        {loading ? (
          <View style={styles.pickerLoader}>
            <ActivityIndicator color={colors.brand.blue} />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(g) => g.id}
            numColumns={2}
            contentContainerStyle={styles.gifGrid}
            renderItem={({ item }) => (
              <Pressable
                style={styles.gifCell}
                onPress={() => { onSelect(item.url); onClose(); }}
                accessibilityRole="button"
                accessibilityLabel={`Send GIF: ${item.title}`}
              >
                <Image
                  source={{ uri: item.previewUrl || item.url }}
                  style={styles.gifPreview}
                  contentFit="cover"
                  recyclingKey={item.id}
                />
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>No GIFs found</Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sticker Picker Modal
// ---------------------------------------------------------------------------

interface StickerPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

function StickerPickerModal({ visible, onClose, onSelect }: StickerPickerProps) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePackIdx, setActivePackIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const { colors: themeColors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchStickerPacks()
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const activePack = packs[activePackIdx];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.pickerContainer, { backgroundColor: themeColors.background }]}>
        <View style={[styles.pickerHeader, { borderBottomColor: themeColors.border }]}>
          <Text style={[styles.pickerTitle, { color: themeColors.text }]}>Stickers</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sticker picker">
            <Text style={[styles.pickerClose, { color: themeColors.textMuted }]}>✕</Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.pickerLoader}>
            <ActivityIndicator color={colors.brand.blue} />
          </View>
        ) : packs.length === 0 ? (
          <View style={styles.pickerLoader}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              No sticker packs unlocked yet.
            </Text>
            <Pressable
              onPress={() => { onClose(); router.push('/stickers'); }}
              style={styles.browseBtn}
              accessibilityRole="link"
            >
              <Text style={styles.browseBtnText}>Browse Sticker Packs</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[styles.packTabs, { borderBottomColor: themeColors.border }]}
              contentContainerStyle={styles.packTabsContent}
            >
              {packs.map((pack, idx) => (
                <Pressable
                  key={pack.id}
                  onPress={() => setActivePackIdx(idx)}
                  style={[
                    styles.packTab,
                    activePackIdx === idx && styles.packTabActive,
                    { borderBottomColor: colors.brand.blue },
                  ]}
                  accessibilityRole="tab"
                >
                  <Text style={[
                    styles.packTabText,
                    { color: activePackIdx === idx ? colors.brand.blue : themeColors.textMuted },
                  ]}>
                    {pack.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {activePack && (
              <FlatList
                data={activePack.stickers}
                keyExtractor={(s) => s.id}
                numColumns={4}
                contentContainerStyle={styles.stickerGrid}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.stickerCell}
                    onPress={() => { onSelect(item.emoji); onClose(); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Send sticker: ${item.label}`}
                  >
                    <Text style={styles.stickerCellEmoji}>{item.emoji}</Text>
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>
    </Modal>
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
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);

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
      navigation.setOptions({ title: data.otherDisplayName });
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
    mutationFn: ({ content, type }: { content: string; type: MessageType }) =>
      sendDM(conversationId!, content, type),
    onMutate: ({ content, type }) => {
      const optimistic = makePendingMessage(content, MY_USER_ID, type);
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
    sendMutation.mutate({ content: text, type: 'text' });
  }, [inputText, sendMutation]);

  const handleGifSelect = useCallback((gifUrl: string) => {
    sendMutation.mutate({ content: gifUrl, type: 'gif' });
  }, [sendMutation]);

  const handleStickerSelect = useCallback((emoji: string) => {
    sendMutation.mutate({ content: emoji, type: 'sticker' });
  }, [sendMutation]);

  const handleLongPress = useCallback((_messageId: string) => {
    // Reaction picker — future enhancement
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
                  pathname: '/economy/wallet',
                  params: { transfer: conversation!.otherUserId },
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
        <View style={[styles.inputBar, { backgroundColor: themeColors.surface, borderTopColor: themeColors.border }]}>
          {/* GIF button */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}
            onPress={() => setShowGifPicker(true)}
            accessibilityLabel="Send GIF"
            accessibilityRole="button"
          >
            <Text style={[styles.iconBtnText, { color: isDark ? colors.neutral[200] : colors.neutral[700] }]}>
              GIF
            </Text>
          </Pressable>
          {/* Sticker button */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}
            onPress={() => setShowStickerPicker(true)}
            accessibilityLabel="Send sticker"
            accessibilityRole="button"
          >
            <Text style={styles.iconBtnEmoji}>😊</Text>
          </Pressable>
          {/* Text input */}
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
          {/* Gift button */}
          {conversation && (
            <Pressable
              style={[styles.iconBtn, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}
              onPress={() =>
                router.push({
                  pathname: '/economy/gift-send',
                  params: {
                    toUserId: conversation.otherUserId,
                    recipientUsername: conversation.otherUsername ?? conversation.otherDisplayName,
                  },
                })
              }
              accessibilityLabel="Send gift"
              accessibilityRole="button"
            >
              <Text style={styles.iconBtnEmoji}>🎁</Text>
            </Pressable>
          )}
          {/* Send button */}
          <Pressable
            style={[
              styles.sendBtn,
              {
                backgroundColor:
                  inputText.trim() && !insufficientCoins ? colors.brand.blue : colors.neutral[300],
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

      {/* GIF Picker Modal */}
      <GifPickerModal
        visible={showGifPicker}
        onClose={() => setShowGifPicker(false)}
        onSelect={handleGifSelect}
      />

      {/* Sticker Picker Modal */}
      <StickerPickerModal
        visible={showStickerPicker}
        onClose={() => setShowStickerPicker(false)}
        onSelect={handleStickerSelect}
      />
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 12, fontWeight: '700' },
  iconBtnEmoji: { fontSize: 20 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { fontSize: 20, fontWeight: '800', color: colors.neutral[0] },

  // DM bubbles
  dmRow: { marginVertical: 2, gap: 4 },
  dmRowOwn: { alignItems: 'flex-end' },
  dmRowOther: { alignItems: 'flex-start' },
  dmBubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    gap: 2,
  },
  dmBubbleOwn: { backgroundColor: colors.brand.blue, borderBottomRightRadius: 4 },
  dmBubbleOther: { backgroundColor: colors.neutral[100], borderBottomLeftRadius: 4 },
  dmBubbleMedia: { padding: 2, overflow: 'hidden' },
  dmBubbleSticker: { backgroundColor: 'transparent', paddingHorizontal: 4 },
  dmText: { fontSize: 15, lineHeight: 20 },
  dmTextOwn: { color: colors.neutral[0] },
  dmMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  dmTime: { fontSize: 10 },
  dmStatus: { fontSize: 12 },

  gifImage: { width: 200, height: 150, borderRadius: 14 },
  stickerEmoji: { fontSize: 56, lineHeight: 64 },
  giftBubble: { alignItems: 'center', gap: 4, paddingVertical: 4 },
  giftEmoji: { fontSize: 32 },
  giftText: { fontSize: 13, color: colors.neutral[0], textAlign: 'center' },

  reactionStrip: { flexDirection: 'row', gap: 4, paddingHorizontal: 4, flexWrap: 'wrap' },
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
  reactionPillActive: { backgroundColor: `${colors.brand.blue}18`, borderColor: colors.brand.blue },
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

  // Picker modals
  pickerContainer: { flex: 1 },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerTitle: { fontSize: 17, fontWeight: '700' },
  pickerClose: { fontSize: 18, fontWeight: '600', paddingHorizontal: 8 },
  pickerLoader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },

  searchContainer: { paddingHorizontal: 12, paddingVertical: 8 },
  searchInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },

  gifGrid: { padding: 8 },
  gifCell: { flex: 1, margin: 4, borderRadius: 12, overflow: 'hidden', aspectRatio: 1.4 },
  gifPreview: { width: '100%', height: '100%' },

  packTabs: { borderBottomWidth: StyleSheet.hairlineWidth, maxHeight: 44 },
  packTabsContent: { paddingHorizontal: 12, flexDirection: 'row' },
  packTab: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  packTabActive: {},
  packTabText: { fontSize: 14, fontWeight: '600' },

  stickerGrid: { padding: 8 },
  stickerCell: {
    flex: 1,
    margin: 4,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.neutral[100],
  },
  stickerCellEmoji: { fontSize: 32 },

  emptyText: { fontSize: 14, textAlign: 'center' },
  browseBtn: {
    marginTop: 12,
    backgroundColor: colors.brand.blue,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  browseBtnText: { color: colors.neutral[0], fontWeight: '700', fontSize: 14 },
});

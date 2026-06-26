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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
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
import { isPidginEnabled } from '@/lib/i18n/pidginEnabled';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { useAuth } from '@/lib/auth/hooks';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { readCachedMessages, writeCachedMessages } from '@/lib/chat/messageCache';
import { newestCreatedAt, mergeNewestFirst } from '@/lib/chat/delta';
import { CHAT_THEMES } from '@/lib/theme/chatThemes';
import { queueMessage } from '@/lib/offline/sqlite';
import type { ChatTheme } from '@/lib/theme/chatThemes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageStatus = 'sent' | 'pending' | 'failed';
type MessageType = 'text' | 'gif' | 'sticker' | 'gift' | 'moment';

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
  const { data } = await apiClient.get(`/messages/dm/${id}`);
  return data.conversation;
}

async function fetchChatTheme(): Promise<ChatTheme> {
  try {
    const { data } = await apiClient.get('/users/me/theme');
    return (data.data?.theme ?? 'default') as ChatTheme;
  } catch {
    return 'default';
  }
}

/**
 * Map a raw DM row (snake_case from the API) into the screen's `DM` shape.
 * Without this the conversation never rendered — the API returns `items`
 * (not `messages`) and snake_case columns, so the list was always empty.
 */
function mapApiDM(raw: Record<string, unknown>, currentUserId?: string): DM {
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const messageType = (str(raw.message_type) ?? str(raw.messageType) ?? 'text') as MessageType;
  const content = str(raw.content);
  const media = str(raw.media_url) ?? str(raw.mediaUrl);
  // Aggregate raw reaction rows ({ emoji, userId }) into { emoji, count, userReacted }.
  const reactionRows = Array.isArray(raw.reactions) ? (raw.reactions as Record<string, unknown>[]) : [];
  const reactionMap = new Map<string, { emoji: string; count: number; userReacted: boolean }>();
  for (const r of reactionRows) {
    const emoji = typeof r.emoji === 'string' ? r.emoji : null;
    if (!emoji) continue;
    const entry = reactionMap.get(emoji) ?? { emoji, count: 0, userReacted: false };
    entry.count += 1;
    if (currentUserId && (r.userId === currentUserId || r.user_id === currentUserId)) {
      entry.userReacted = true;
    }
    reactionMap.set(emoji, entry);
  }
  return {
    id: str(raw.id) ?? '',
    content: messageType === 'text' ? content : null,
    gifUrl: messageType === 'gif' ? (media ?? content) : null,
    stickerEmoji: messageType === 'sticker' ? content : null,
    messageType,
    senderUserId: str(raw.sender_id) ?? str(raw.senderUserId) ?? '',
    createdAt: str(raw.created_at) ?? str(raw.createdAt) ?? new Date().toISOString(),
    status: 'sent',
    reactions: [...reactionMap.values()],
  };
}

async function fetchMessages(id: string, after?: string, currentUserId?: string): Promise<DM[]> {
  const url = after ? `/messages/dm/${id}?after=${encodeURIComponent(after)}` : `/messages/dm/${id}`;
  const { data } = await apiClient.get(url);
  const rows: Record<string, unknown>[] = data.items ?? data.messages ?? [];
  return rows.map((r) => mapApiDM(r, currentUserId));
}

async function sendDM(
  conversationId: string,
  content: string,
  messageType: MessageType = 'text',
  idempotencyKey?: string,
): Promise<DM> {
  const { data } = await apiClient.post(`/messages/dm/${conversationId}`, {
    content,
    messageType,
    idempotencyKey,
  });
  return mapApiDM(data.message ?? {});
}

async function searchGifs(query: string): Promise<GifResult[]> {
  const { data } = await apiClient.get('/messages/gif', { params: { q: query, limit: 15 } });
  return data.data ?? data.results ?? [];
}

async function fetchStickerPacks(): Promise<StickerPack[]> {
  const { data } = await apiClient.get('/stickers');
  return (data.packs ?? []).filter((p: StickerPack) => p.unlocked);
}

// ---------------------------------------------------------------------------
// Pending optimistic message
// ---------------------------------------------------------------------------

function makePendingMessage(
  content: string,
  myUserId: string,
  messageType: MessageType = 'text',
  id?: string,
): DM {
  return {
    id: id ?? `pending-${Date.now()}`,
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

interface DMBubbleProps {
  dm: DM;
  isOwn: boolean;
  onLongPress: (id: string) => void;
  bubbleOwnColor: string;
  bubbleOtherColor: string;
}

function DMBubble({ dm, isOwn, onLongPress, bubbleOwnColor, bubbleOtherColor }: DMBubbleProps) {
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
          isOwn
            ? [styles.dmBubbleOwn, { backgroundColor: bubbleOwnColor }]
            : [styles.dmBubbleOther, { backgroundColor: bubbleOtherColor }],
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
        {dm.messageType === 'moment' && (
          <View style={styles.momentBubble}>
            <Text style={styles.momentIcon}>⚡</Text>
            {dm.content && (
              <Text style={[styles.dmText, isOwn ? styles.dmTextOwn : { color: '#fff' }]}>
                {dm.content}
              </Text>
            )}
            <Text style={styles.momentLabel}>Moment · 24h</Text>
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
    let cancelled = false;
    setLoading(true);
    searchGifs('trending')
      .then((res) => { if (!cancelled) setResults(res); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, []);

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
  const [activePackIdx, setActivePackIdx] = useState(0);
  const { colors: themeColors } = useTheme();
  const router = useRouter();

  // FIX-23: Use React Query to cache sticker packs (staleTime = 5 min)
  const { data: packs = [], isLoading: loading } = useQuery({
    queryKey: ['sticker-packs'],
    queryFn: fetchStickerPacks,
    staleTime: 5 * 60 * 1000,
    enabled: visible,
  });

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
  const { user: authUser } = useAuth();
  const myUserId = authUser?.id ?? '';
  const currency = useCurrency();

  const flatListRef = useRef<FlatList<DM>>(null);
  const isAtBottomRef = useRef(true);

  const [inputText, setInputText] = useState('');
  const [pidginSuggestions, setPidginSuggestions] = useState<string[]>([]);
  const [pendingMessages, setPendingMessages] = useState<DM[]>([]);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showMomentConfirm, setShowMomentConfirm] = useState(false);

  const { data: chatThemeId = 'default' } = useQuery({
    queryKey: ['chat-theme'],
    queryFn: fetchChatTheme,
    staleTime: 5 * 60_000,
  });
  const chatTheme = CHAT_THEMES.find((t) => t.id === chatThemeId) ?? CHAT_THEMES[0]!;

  // Manifest + user settings for Pidgin gate
  const { data: pidginConfig } = useQuery({
    queryKey: ['pidgin-config'],
    queryFn: async () => {
      const [manifestRes, settingsRes] = await Promise.all([
        apiClient.get<{ features: { pidginAutocomplete: boolean } }>('/manifest'),
        apiClient.get<{ data: { pidginSuggestionsEnabled: boolean | null } }>('/users/me/settings'),
      ]);
      return {
        adminEnabled: manifestRes.data?.features?.pidginAutocomplete ?? false,
        userSetting: settingsRes.data?.data?.pidginSuggestionsEnabled ?? null,
      };
    },
    staleTime: 5 * 60_000,
  });

  const pidginActive = pidginConfig
    ? isPidginEnabled(pidginConfig.adminEnabled, pidginConfig.userSetting, i18n.language)
    : false;

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    if (pidginActive) {
      const suggestions = getPidginSuggestions(text, i18n.language);
      setPidginSuggestions(suggestions);
    } else {
      setPidginSuggestions([]);
    }
  }, [i18n.language, pidginActive]);

  const { data: conversation } = useQuery({
    queryKey: ['dm-conversation', conversationId],
    queryFn: () => fetchConversation(conversationId!),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (conversation) {
      navigation.setOptions({ title: conversation.otherDisplayName });
    }
  }, [conversation, navigation]);

  // Connection badge
  const { data: badgeData } = useQuery({
    queryKey: ['dm-connection-badge', conversationId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ data: { hasBadge: boolean; streakDays: number } }>(
        `/messages/dm/${conversationId}/connection-badge`
      );
      return data?.data ?? null;
    },
    enabled: !!conversationId,
    staleTime: 60_000,
  });

  // Realtime push — merge new DMs into the cache instantly when connected.
  const realtimeConnected = useRealtimeChannel(
    conversationId ? `dm:conversation:${conversationId}` : null,
    useCallback((event: string, data: unknown) => {
      if (event !== 'new_message') return;
      const raw = (data as { message?: Record<string, unknown> })?.message;
      if (!raw) return;
      const incoming = mapApiDM(raw, myUserId);
      if (!incoming.id) return;
      queryClient.setQueryData<DM[]>(['dm-messages', conversationId], (prev: DM[] | undefined) => {
        const list = prev ?? [];
        if (list.some((m: DM) => m.id === incoming.id)) return list;
        return [incoming, ...list];
      });
    }, [conversationId, queryClient]),
  );

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['dm-messages', conversationId],
    queryFn: async () => {
      const prev = queryClient.getQueryData<DM[]>(['dm-messages', conversationId]) ?? [];
      const after = newestCreatedAt(prev);
      const incoming = await fetchMessages(conversationId!, after, myUserId);
      return after ? mergeNewestFirst(prev, incoming) : incoming;
    },
    enabled: !!conversationId,
    refetchInterval: realtimeConnected ? 30_000 : 3_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    initialData: () => (conversationId ? readCachedMessages<DM>(`dm:${conversationId}`) ?? undefined : undefined),
    initialDataUpdatedAt: 0,
  });

  // Persist latest DMs for instant first paint on reopen.
  useEffect(() => {
    if (conversationId && messages.length) writeCachedMessages(`dm:${conversationId}`, messages);
  }, [messages, conversationId]);

  const sendMutation = useMutation({
    mutationFn: ({ content, type, idempotencyKey }: { content: string; type: MessageType; idempotencyKey: string }) =>
      sendDM(conversationId!, content, type, idempotencyKey),
    onMutate: ({ content, type }) => {
      const localId = `pending-${randomUUID()}`;
      const optimistic = makePendingMessage(content, myUserId, type, localId);
      setPendingMessages((prev) => [optimistic, ...prev]);
      return { optimistic };
    },
    onSuccess: (serverDm, _, ctx) => {
      setPendingMessages((prev) => prev.filter((m) => m.id !== ctx?.optimistic.id));
      // Merge confirmed server message into cache rather than refetching immediately,
      // avoiding a race where the query refetches before the server write is visible.
      queryClient.setQueryData<DM[]>(['dm-messages', conversationId], (prev = []) => {
        if (!serverDm?.id || prev.some((m) => m.id === serverDm.id)) return prev;
        return [serverDm, ...prev];
      });
    },
    onError: (_, values, ctx) => {
      setPendingMessages((prev) =>
        prev.map((m) =>
          m.id === ctx?.optimistic.id ? { ...m, status: 'failed' as MessageStatus } : m,
        ),
      );
      queueMessage(conversationId!, values.content, values.type, 'dm', values.idempotencyKey).catch(() =>
        console.warn('[offline] queueMessage failed')
      );
      Alert.alert('Message queued', 'Message queued — will send when back online.');
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    sendMutation.mutate({ content: text, type: 'text', idempotencyKey: randomUUID() });
  }, [inputText, sendMutation]);

  const handleGifSelect = useCallback((gifUrl: string) => {
    sendMutation.mutate({ content: gifUrl, type: 'gif', idempotencyKey: randomUUID() });
  }, [sendMutation]);

  const handleStickerSelect = useCallback((emoji: string) => {
    sendMutation.mutate({ content: emoji, type: 'sticker', idempotencyKey: randomUUID() });
  }, [sendMutation]);

  const handleLongPress = useCallback((messageId: string) => {
    // FIX-22: Minimal reaction picker — show common emojis as an action sheet
    const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    Alert.alert(
      'React to message',
      undefined,
      [
        ...EMOJI_REACTIONS.map((emoji) => ({
          text: emoji,
          onPress: () => {
            apiClient.post(`/messages/dm/${conversationId}/reactions`, { messageId, emoji })
              .catch(() => {});
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [conversationId]);

  const handleSendMoment = useCallback(() => {
    const text = inputText.trim();
    if (!text) {
      // Send a moment without text — prompt user
      setShowMomentConfirm(true);
      return;
    }
    setInputText('');
    sendMutation.mutate({ content: text, type: 'moment', idempotencyKey: randomUUID() });
  }, [inputText, sendMutation]);

  // Deduplicate pending messages against server messages using the message ID.
  // Pending messages use a local `pending-N` id; once the server confirms the
  // send they are removed from pendingMessages in onSuccess, so only truly
  // outstanding optimistic messages appear here.
  const combinedMessages = useMemo(() => {
    const serverMessageIds = new Set(messages.map((m) => m.id));
    const filteredPending = pendingMessages.filter((p) => !serverMessageIds.has(p.id));
    return [...filteredPending, ...messages];
  }, [messages, pendingMessages]);
  const insufficientCoins =
    conversation &&
    !conversation.isUnlimited &&
    conversation.userCoinBalance < conversation.coinCostPerMessage;

  // Scroll to newest message when the list grows, but only when already near
  // the bottom (offset 0 on an inverted FlatList = visual bottom = newest).
  useEffect(() => {
    if (combinedMessages.length > 0 && isAtBottomRef.current) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [combinedMessages.length]);

  const renderItem = useCallback(
    ({ item }: { item: DM }) => (
      <DMBubble
        dm={item}
        isOwn={item.senderUserId === myUserId}
        onLongPress={handleLongPress}
        bubbleOwnColor={chatTheme.bubbleOwn}
        bubbleOtherColor={chatTheme.bubbleOther}
      />
    ),
    [handleLongPress, chatTheme, myUserId],
  );

  return (
    <Screen hideOfflineBanner disableBottomInset>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 88}
      >
        {/* Connection badge */}
        {badgeData?.hasBadge && (
          <View style={[styles.connectionBadgeBanner, { backgroundColor: isDark ? '#0d3349' : '#eff6ff', borderBottomColor: isDark ? '#1e4d6b' : '#bfdbfe' }]}>
            <Text style={[styles.connectionBadgeText, { color: isDark ? '#7dd3fc' : '#1d4ed8' }]}>
              🔗 Connected · {badgeData.streakDays}-day streak
            </Text>
          </View>
        )}

        {/* Coin cost notice */}
        {conversation && !conversation.isUnlimited && (
          <View style={styles.costBanner}>
            <Text style={[styles.costBannerText, { color: themeColors.textMuted }]}>
              🪙 Each reply costs {conversation.coinCostPerMessage} {currency.softSingular.toLowerCase()}
            </Text>
          </View>
        )}

        {/* Message list */}
        {(isLoading || !authUser) ? (
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
          />
        )}

        {/* Insufficient coins notice */}
        {insufficientCoins && (
          <View style={[styles.insufficientBanner, { backgroundColor: `${colors.semantic.error}18` }]}>
            <Text style={[styles.insufficientText, { color: colors.semantic.error }]}>
              Not enough {currency.softPlural.toLowerCase()} to reply.{' '}
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
              <Text style={styles.giftLink}>Gift them {currency.softPlural.toLowerCase()} →</Text>
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
                  setInputText((prev) => {
                    const words = prev.trimEnd().split(' ');
                    words[words.length - 1] = s;
                    return words.join(' ') + ' ';
                  });
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
          {/* Zobia Moment button — ephemeral 24h message */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: isDark ? '#7c3aed22' : '#ede9fe' }]}
            onPress={handleSendMoment}
            accessibilityLabel="Send Zobia Moment (disappears in 24h)"
            accessibilityRole="button"
          >
            <Text style={styles.iconBtnEmoji}>⚡</Text>
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

      {/* Zobia Moment confirm dialog */}
      <Modal
        visible={showMomentConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMomentConfirm(false)}
      >
        <View style={styles.momentOverlay}>
          <View style={[styles.momentDialog, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.momentDialogIcon}>⚡</Text>
            <Text style={[styles.momentDialogTitle, { color: themeColors.text }]}>
              Send a Zobia Moment
            </Text>
            <Text style={[styles.momentDialogDesc, { color: themeColors.textMuted }]}>
              Moments disappear after 24 hours. Type a message above first, then tap ⚡ to send it as a Moment.
            </Text>
            <Pressable
              style={[styles.momentDialogBtn, { backgroundColor: '#7c3aed' }]}
              onPress={() => setShowMomentConfirm(false)}
              accessibilityRole="button"
            >
              <Text style={styles.momentDialogBtnText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },

  connectionBadgeBanner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  connectionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

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

  // Zobia Moment bubble
  momentBubble: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
    backgroundColor: '#7c3aed',
    borderRadius: 18,
  },
  momentIcon: { fontSize: 22 },
  momentLabel: { fontSize: 10, color: '#e9d5ff', fontWeight: '600' },

  // Moment confirm dialog
  momentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  momentDialog: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    maxWidth: 320,
    width: '100%',
  },
  momentDialogIcon: { fontSize: 40 },
  momentDialogTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  momentDialogDesc: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  momentDialogBtn: {
    marginTop: 8,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  momentDialogBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';

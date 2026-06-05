/**
 * app/rooms/[roomId].tsx
 *
 * Room chat screen.
 *
 * Features:
 *  - Stack header with room name and member count
 *  - Inverted FlatList of messages (MessageBubble component)
 *  - VIP rooms: subscribe prompt overlay for non-subscribers
 *  - Drop rooms: countdown timer + entry fee notice
 *  - TopGifters expandable panel
 *  - Input bar: text input + send button + gift button + GIF button
 *  - Real-time updates via 2-second polling
 *  - XP earned badge flash (+2 XP per message)
 *  - Offline: cached messages displayed
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { Button } from '@/components/ui/Button';
import { MessageBubble, type MessageBubbleProps, type MessageReaction } from '@/components/rooms/MessageBubble';
import { TopGifters, type GifterEntry } from '@/components/rooms/TopGifters';
import { GiftSpectacle, type GiftSpectacleData } from '@/components/rooms/GiftSpectacle';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Canonical room types per PRD §10
type RoomType = 'free_open' | 'vip' | 'drop' | 'tipping' | 'classroom' | 'guild';

interface Room {
  id: string;
  name: string;
  description: string | null;
  roomType: RoomType;
  memberCount: number;
  entryFeeCoin: number | null;
  isSubscribed: boolean;
  isCreator: boolean;
  hostDisplayName: string;
  dropEndsAt?: string | null;
  minGiftSpectacleCoin?: number; // gifts above this value trigger room-wide spectacle
}

interface Message {
  id: string;
  content: string | null;
  messageType: MessageBubbleProps['messageType'] | 'moment';
  senderUserId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarEmoji: string;
  senderIsCreator: boolean;
  reactions: MessageReaction[];
  createdAt: string;
  giftCoinValue?: number;
  giftName?: string;
  giftEmoji?: string;
}

type RoomMessageType = 'text' | 'moment';

interface SendMessagePayload {
  roomId: string;
  content: string;
  message_type?: RoomMessageType;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchRoom(roomId: string): Promise<Room> {
  const { data } = await apiClient.get(`/rooms/${roomId}`);
  return data;
}

async function fetchMessages(roomId: string): Promise<Message[]> {
  const { data } = await apiClient.get(`/rooms/${roomId}/messages`);
  return data.messages ?? [];
}

async function fetchTopGifters(roomId: string): Promise<GifterEntry[]> {
  const { data } = await apiClient.get(`/rooms/${roomId}/top-gifters`);
  return data.gifters ?? [];
}

async function sendMessage(payload: SendMessagePayload): Promise<Message> {
  const { data } = await apiClient.post(`/rooms/${payload.roomId}/messages`, {
    content: payload.content,
    message_type: payload.message_type ?? 'text',
  });
  return data.message;
}

// ---------------------------------------------------------------------------
// XP Badge flash
// ---------------------------------------------------------------------------

function XPBadge({ visible }: { visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(800),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity]);

  return (
    <Animated.View style={[styles.xpBadge, { opacity }]}>
      <Text style={styles.xpBadgeText}>+2 XP</Text>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Countdown timer (Drop rooms)
// ---------------------------------------------------------------------------

function CountdownTimer({ endsAt }: { endsAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('Ended');
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  return (
    <View style={styles.dropBanner}>
      <Text style={styles.dropBannerText}>⏳ Drop ends in {remaining}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// VIP Subscribe overlay
// ---------------------------------------------------------------------------

function VIPSubscribeOverlay({ onSubscribe }: { onSubscribe: () => void }) {
  return (
    <View style={styles.vipOverlay}>
      <Text style={styles.vipOverlayEmoji}>👑</Text>
      <Text style={styles.vipOverlayTitle}>VIP Room</Text>
      <Text style={styles.vipOverlayBody}>
        Subscribe to read and send messages in this room.
      </Text>
      <Button label="Subscribe to VIP" onPress={onSubscribe} style={styles.vipBtn} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.skeletonRow, i % 2 === 0 && styles.skeletonRowRight]}>
          <View style={styles.skeletonAvatar} />
          <View style={[styles.skeletonBubble, { width: `${40 + i * 8}%` }]} />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = 'me'; // replaced by auth context in production

/**
 * RoomScreen — live chat room with messages, gifts, and XP.
 */
export default function RoomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors: themeColors, isDark } = useTheme();

  const [inputText, setInputText] = useState('');
  const [showGifters, setShowGifters] = useState(false);
  const [xpFlash, setXpFlash] = useState(false);
  const [isMoment, setIsMoment] = useState(false);
  // Gift spectacle state: holds the active spectacle data (null = not showing)
  const [spectacle, setSpectacle] = useState<GiftSpectacleData | null>(null);

  // Fetch room meta
  const { data: room, isLoading: roomLoading } = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => fetchRoom(roomId!),
    enabled: !!roomId,
  });

  // Poll messages every 2 seconds; detect new high-value gift messages for spectacle
  const prevMessageIdsRef = useRef<Set<string>>(new Set());
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['room-messages', roomId],
    queryFn: () => fetchMessages(roomId!),
    enabled: !!roomId,
    refetchInterval: 2_000,
    placeholderData: (prev) => prev,
    select: (data) => {
      // Detect newly arrived gift messages above spectacle threshold
      const minThreshold = room?.minGiftSpectacleCoin ?? 50;
      for (const msg of data) {
        if (!prevMessageIdsRef.current.has(msg.id)) {
          if (
            msg.messageType === 'gift' &&
            typeof msg.giftCoinValue === 'number' &&
            msg.giftCoinValue >= minThreshold &&
            !spectacle
          ) {
            setSpectacle({
              senderDisplayName: msg.senderDisplayName,
              senderAvatarEmoji: msg.senderAvatarEmoji,
              giftName: msg.giftName ?? 'Gift',
              giftEmoji: msg.giftEmoji ?? '🎁',
              coinValue: msg.giftCoinValue,
            });
          }
          prevMessageIdsRef.current.add(msg.id);
        }
      }
      return data;
    },
  });

  // Top gifters (refresh every 30s)
  const { data: gifters = [] } = useQuery({
    queryKey: ['room-gifters', roomId],
    queryFn: () => fetchTopGifters(roomId!),
    enabled: !!roomId,
    refetchInterval: 30_000,
  });

  // Update navigation header
  useEffect(() => {
    if (room) {
      const topGifter = gifters[0] ?? null;
      navigation.setOptions({
        title: room.name,
        headerRight: () => (
          <View style={styles.headerRightRow}>
            {topGifter ? (
              <Text style={styles.topGifterHeader} numberOfLines={1}>
                👑 {topGifter.username}
              </Text>
            ) : null}
            <Text style={styles.memberCountHeader}>
              👥 {room.memberCount.toLocaleString()}
            </Text>
          </View>
        ),
      });
    }
  }, [room, gifters, navigation]);

  const sendMutation = useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-messages', roomId] });
      setInputText('');
      setIsMoment(false);
      setXpFlash(true);
      setTimeout(() => setXpFlash(false), 1_200);
    },
  });

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !roomId) return;
    sendMutation.mutate({ roomId, content: text, message_type: isMoment ? 'moment' : 'text' });
  }, [inputText, roomId, isMoment, sendMutation]);

  const handleLongPress = useCallback((messageId: string) => {
    // Opens reaction picker — placeholder
    console.log('Long press', messageId);
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMomentMsg = item.messageType === 'moment';
      return (
        <View style={isMomentMsg ? styles.momentWrapper : undefined}>
          <MessageBubble
            id={item.id}
            content={item.content}
            messageType={isMomentMsg ? 'text' : (item.messageType as MessageBubbleProps['messageType'])}
            senderUsername={item.senderUsername}
            senderDisplayName={item.senderDisplayName}
            senderAvatarEmoji={item.senderAvatarEmoji}
            senderIsCreator={item.senderIsCreator}
            isOwnMessage={item.senderUserId === CURRENT_USER_ID}
            reactions={item.reactions}
            createdAt={item.createdAt}
            giftCoinValue={item.giftCoinValue}
            giftName={item.giftName}
            giftEmoji={item.giftEmoji}
            onLongPress={handleLongPress}
          />
          {isMomentMsg && (
            <Text style={styles.momentBadge}>⚡ Moment · 24h</Text>
          )}
        </View>
      );
    },
    [handleLongPress],
  );

  const isVIPLocked =
    room?.roomType === 'vip' && !room.isSubscribed;
  const isTippingRoom = room?.roomType === 'tipping';
  const isGuildRoom = room?.roomType === 'guild';

  return (
    <Screen hideOfflineBanner disableBottomInset>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={88}
      >
        {/* Drop banner */}
        {room?.roomType === 'drop' && (
          <View>
            <CountdownTimer endsAt={room.dropEndsAt ?? new Date(Date.now() + 3_600_000).toISOString()} />
            {room.entryFeeCoin !== null && (
              <View style={styles.entryFee}>
                <Text style={styles.entryFeeText}>
                  🪙 Entry fee: {room.entryFeeCoin} coins
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Top Gifters panel */}
        <Pressable
          onPress={() => setShowGifters((v) => !v)}
          style={[
            styles.gifterToggle,
            { borderBottomColor: themeColors.border },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Toggle top gifters panel"
        >
          <Text style={[styles.gifterToggleText, { color: themeColors.text }]}>
            🎁 Top Gifters {showGifters ? '▲' : '▼'}
          </Text>
        </Pressable>

        {showGifters && (
          <View style={styles.gifterPanel}>
            <TopGifters gifters={gifters} />
          </View>
        )}

        {/* Message list */}
        {roomLoading || messagesLoading ? (
          <Skeleton />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            inverted
            style={styles.flex}
            contentContainerStyle={styles.messageList}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Tipping room banner */}
        {isTippingRoom && (
          <View style={styles.tippingBanner}>
            <Text style={styles.tippingBannerText}>🎤 Tipping Room — show love with gifts!</Text>
          </View>
        )}

        {/* VIP overlay */}
        {isVIPLocked && (
          <VIPSubscribeOverlay onSubscribe={() => console.log('Subscribe')} />
        )}

        {/* Gift spectacle overlay — dims feed, shows gift animation for 3s */}
        <GiftSpectacle
          data={spectacle}
          onDismiss={() => setSpectacle(null)}
          displayDurationMs={3_000}
        />

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
          <XPBadge visible={xpFlash} />
          {/* Moment label above input */}
          {isMoment && (
            <View style={styles.momentActiveLabel}>
              <Text style={styles.momentActiveLabelText}>⚡ Moment (24h)</Text>
            </View>
          )}
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
                color: themeColors.text,
              },
              isMoment && styles.textInputMoment,
            ]}
            placeholder="Say something…"
            placeholderTextColor={themeColors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            editable={!isVIPLocked}
          />
          {/* Zobia Moment button */}
          <Pressable
            style={[styles.iconBtn, { backgroundColor: isMoment ? '#7c3aed' : (isDark ? '#7c3aed22' : '#ede9fe') }]}
            onPress={() => setIsMoment((v) => !v)}
            accessibilityLabel="Toggle Zobia Moment (disappears in 24h)"
            accessibilityRole="button"
          >
            <Text style={[styles.iconBtnText, { color: isMoment ? '#fff' : '#7c3aed' }]}>⚡</Text>
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => console.log('GIF')}
            accessibilityLabel="Send GIF"
            accessibilityRole="button"
          >
            <Text style={styles.iconBtnText}>GIF</Text>
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => console.log('Gift')}
            accessibilityLabel="Send gift"
            accessibilityRole="button"
          >
            <Text style={styles.iconBtnText}>🎁</Text>
          </Pressable>
          {/* Room Powers button — only for room creator */}
          {room?.isCreator && (
            <Pressable
              style={[styles.iconBtn, { backgroundColor: isDark ? colors.neutral[700] : '#f3f0ff' }]}
              onPress={() => {
                Alert.alert(
                  'Room Powers',
                  'Choose a power to activate:',
                  [
                    {
                      text: '⚡ Spotlight Room (500 🪙)',
                      onPress: () => {
                        apiClient
                          .post(`/api/rooms/${roomId}/powers`, { power: 'room_spotlight', durationHours: 24 })
                          .then(() => Alert.alert('Activated!', 'Your room is now spotlighted on discovery for 24 hours.'))
                          .catch((e: Error) => Alert.alert('Error', e.message));
                      },
                    },
                    {
                      text: '👑 Highlight Member (200 🪙)',
                      onPress: () => Alert.alert('Coming soon', 'Enter a username to highlight.'),
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                );
              }}
              accessibilityLabel="Room powers"
              accessibilityRole="button"
            >
              <Text style={styles.iconBtnText}>🔮</Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.sendBtn,
              { backgroundColor: inputText.trim() ? colors.brand.blue : colors.neutral[300] },
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

  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  topGifterHeader: {
    fontSize: 13,
    color: colors.brand.gold,
    fontWeight: '700',
    maxWidth: 120,
  },
  memberCountHeader: {
    fontSize: 13,
    color: colors.neutral[500],
  },

  dropBanner: {
    backgroundColor: colors.semantic.warning,
    paddingVertical: 6,
    alignItems: 'center',
  },
  dropBannerText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '700',
  },

  tippingBanner: {
    backgroundColor: `${colors.brand.blue}18`,
    paddingVertical: 6,
    alignItems: 'center' as const,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.brand.blue,
  },
  tippingBannerText: {
    fontSize: 12,
    color: colors.brand.blue,
    fontWeight: '600' as const,
  },

  entryFee: {
    backgroundColor: `${colors.brand.gold}22`,
    paddingVertical: 4,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.brand.gold,
  },
  entryFeeText: {
    fontSize: 12,
    color: colors.brand.goldDark,
    fontWeight: '600',
  },

  gifterToggle: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gifterToggleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  gifterPanel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  messageList: {
    paddingVertical: 8,
  },

  vipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  vipOverlayEmoji: { fontSize: 48 },
  vipOverlayTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[0],
  },
  vipOverlayBody: {
    fontSize: 15,
    color: colors.neutral[300],
    textAlign: 'center',
  },
  vipBtn: { marginTop: 8, width: '100%' },

  // Input bar
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
  iconBtnText: { fontSize: 15, fontWeight: '700', color: colors.neutral[700] },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[0],
  },

  // XP badge
  xpBadge: {
    position: 'absolute',
    top: -36,
    right: 60,
    backgroundColor: colors.semantic.success,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 10,
  },
  xpBadgeText: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '800',
  },

  // Moment message wrapper
  momentWrapper: {
    borderWidth: 2,
    borderColor: '#7c3aed',
    borderRadius: 18,
    marginHorizontal: 8,
    marginVertical: 2,
    overflow: 'hidden',
  },
  momentBadge: {
    fontSize: 10,
    color: '#7c3aed',
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 3,
    backgroundColor: '#ede9fe',
  },

  // Moment label above input
  momentActiveLabel: {
    position: 'absolute',
    top: -28,
    left: 12,
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
    zIndex: 10,
  },
  momentActiveLabelText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },

  textInputMoment: {
    borderWidth: 2,
    borderColor: '#7c3aed',
  },

  // Skeleton
  skeletonContainer: { flex: 1, padding: 16, gap: 12 },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  skeletonRowRight: { flexDirection: 'row-reverse' },
  skeletonAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.neutral[200],
  },
  skeletonBubble: {
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.neutral[200],
  },
});

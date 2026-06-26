/**
 * components/rooms/MessageBubble.tsx
 *
 * Chat message bubble for the room message feed.
 *
 * Variants:
 *  - text        : standard text bubble
 *  - gift        : special styling with coin icon and coin value
 *  - sticker/gif : media display
 *  - system      : centred neutral system announcement
 *
 * Features:
 *  - Reaction strip (emoji reaction bar)
 *  - Long-press for reaction picker callback
 *  - Timestamp display
 *  - NO purple. NO gradients.
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/lib/theme/colors';
import { useTheme } from '@/lib/theme';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType = 'text' | 'sticker' | 'gif' | 'gift' | 'system' | 'broadcast';

export interface MessageReaction {
  emoji: string;
  count: number;
  /** Whether the current user has applied this reaction. */
  userReacted: boolean;
}

export interface MessageBubbleProps {
  id: string;
  content: string | null;
  messageType: MessageType;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarEmoji: string;
  senderIsCreator?: boolean;
  /** Whether this message belongs to the authenticated user. */
  isOwnMessage: boolean;
  reactions?: MessageReaction[];
  createdAt: string;
  /** Coin value for gift messages. */
  giftCoinValue?: number;
  /** Gift item name for gift messages. */
  giftName?: string;
  /** Gift emoji for gift messages. */
  giftEmoji?: string;
  /** GIF URL for gif-type messages. */
  gifUrl?: string | null;
  /** Called when the user long-presses the bubble (to open reaction picker). */
  onLongPress?: (messageId: string) => void;
  /** Called when the user taps an existing reaction to toggle it. */
  onReactionPress?: (messageId: string, emoji: string) => void;
  style?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp to a short display time string (HH:MM).
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ReactionStripProps {
  messageId: string;
  reactions: MessageReaction[];
  onReactionPress?: (messageId: string, emoji: string) => void;
}

function ReactionStrip({ messageId, reactions, onReactionPress }: ReactionStripProps) {
  if (reactions.length === 0) return null;

  return (
    <View style={styles.reactionStrip}>
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          style={[
            styles.reactionPill,
            r.userReacted && styles.reactionPillActive,
          ]}
          onPress={() => onReactionPress?.(messageId, r.emoji)}
          accessibilityLabel={`${r.emoji} reaction, ${r.count} times`}
          accessibilityRole="button"
        >
          <Text style={styles.reactionEmoji}>{r.emoji}</Text>
          <Text
            style={[
              styles.reactionCount,
              r.userReacted && styles.reactionCountActive,
            ]}
          >
            {r.count}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * MessageBubble — renders a single room chat message.
 *
 * @param props - Message data and interaction callbacks
 */
export const MessageBubble = memo(function MessageBubble({
  id,
  content,
  messageType,
  senderDisplayName,
  senderAvatarEmoji,
  senderIsCreator = false,
  isOwnMessage,
  reactions = [],
  createdAt,
  giftCoinValue,
  giftName,
  giftEmoji,
  gifUrl,
  onLongPress,
  onReactionPress,
  style,
}: MessageBubbleProps) {
  const { isDark } = useTheme();
  const currency = useCurrency();
  const handleLongPress = useCallback(() => {
    onLongPress?.(id);
  }, [id, onLongPress]);

  // System / broadcast messages: centred, no avatar
  if (messageType === 'system' || messageType === 'broadcast') {
    return (
      <View style={[styles.systemRow, style]}>
        <Text style={styles.systemText}>{content ?? ''}</Text>
      </View>
    );
  }

  // Gift messages
  if (messageType === 'gift') {
    return (
      <View style={[styles.giftRow, style]}>
        <View style={styles.giftBubble}>
          <Text style={styles.giftEmoji}>{giftEmoji ?? '🎁'}</Text>
          <View style={styles.giftBody}>
            <Text style={styles.giftSender}>
              <Text style={styles.giftSenderBold}>{senderDisplayName}</Text>
              {' sent '}
              <Text style={styles.giftName}>{giftName ?? 'a gift'}</Text>
            </Text>
            {giftCoinValue !== undefined && (
              <View style={styles.coinRow}>
                <Text style={styles.coinIcon}>🪙</Text>
                <Text style={styles.coinValue}>
                  {giftCoinValue.toLocaleString()} {currency.softPlural.toLowerCase()}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.timestamp}>{formatTime(createdAt)}</Text>
        </View>
      </View>
    );
  }

  // GIF messages — render the image inline
  if (messageType === 'gif') {
    return (
      <Pressable
        onLongPress={handleLongPress}
        style={[styles.row, isOwnMessage ? styles.rowOwn : styles.rowOther, style]}
      >
        {!isOwnMessage && (
          <View style={styles.avatar}>
            <Text style={styles.avatarEmoji}>{senderAvatarEmoji}</Text>
          </View>
        )}
        <View style={[styles.bubbleWrapper, isOwnMessage && styles.bubbleWrapperOwn]}>
          {!isOwnMessage && (
            <Text style={styles.senderName}>{senderDisplayName}</Text>
          )}
          {gifUrl ? (
            <Image
              source={{ uri: gifUrl }}
              style={styles.gifImage}
              contentFit="cover"
              transition={200}
              accessibilityLabel="GIF"
            />
          ) : (
            <View style={[styles.bubble, isOwnMessage ? styles.bubbleOwn : styles.bubbleOther]}>
              <Text style={[styles.messageText, isOwnMessage ? styles.messageTextOwn : styles.messageTextOther]}>
                {content ?? '[GIF]'}
              </Text>
            </View>
          )}
          <Text style={[styles.timestamp, isOwnMessage ? styles.timestampOwn : styles.timestampOther]}>
            {formatTime(createdAt)}
          </Text>
          <ReactionStrip
            messageId={id}
            reactions={reactions}
            onReactionPress={onReactionPress}
          />
        </View>
      </Pressable>
    );
  }

  // Standard text message
  return (
    <Pressable
      onLongPress={handleLongPress}
      style={[
        styles.row,
        isOwnMessage ? styles.rowOwn : styles.rowOther,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${senderDisplayName}: ${content}`}
    >
      {/* Avatar (other user only) */}
      {!isOwnMessage && (
        <View style={styles.avatar}>
          <Text style={styles.avatarEmoji}>{senderAvatarEmoji}</Text>
        </View>
      )}

      <View style={[styles.bubbleWrapper, isOwnMessage && styles.bubbleWrapperOwn]}>
        {/* Sender name (other user only) */}
        {!isOwnMessage && (
          <View style={styles.senderRow}>
            <Text style={styles.senderName}>
              {senderDisplayName}
            </Text>
            {senderIsCreator && (
              <View style={styles.creatorBadge}>
                <Text style={styles.creatorBadgeText}>Creator</Text>
              </View>
            )}
          </View>
        )}

        {/* Bubble */}
        <View
          style={[
            styles.bubble,
            isOwnMessage
              ? styles.bubbleOwn
              : [styles.bubbleOther, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }],
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isOwnMessage
                ? styles.messageTextOwn
                : [styles.messageTextOther, { color: isDark ? colors.neutral[50] : colors.neutral[900] }],
            ]}
          >
            {content}
          </Text>
          <Text
            style={[
              styles.timestamp,
              isOwnMessage ? styles.timestampOwn : styles.timestampOther,
            ]}
          >
            {formatTime(createdAt)}
          </Text>
        </View>

        {/* Reactions */}
        <ReactionStrip
          messageId={id}
          reactions={reactions}
          onReactionPress={onReactionPress}
        />
      </View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Row layout
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 3,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowOwn: {
    flexDirection: 'row-reverse',
  },
  rowOther: {
    flexDirection: 'row',
  },

  // Avatar
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarEmoji: {
    fontSize: 18,
  },

  // Bubble wrapper
  bubbleWrapper: {
    maxWidth: '75%',
    alignItems: 'flex-start',
    gap: 4,
  },
  bubbleWrapperOwn: {
    alignItems: 'flex-end',
  },

  // Sender row
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  creatorBadge: {
    backgroundColor: colors.brand.blue,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  creatorBadgeText: {
    color: colors.neutral[0],
    fontSize: 9,
    fontWeight: '700',
  },

  // Bubble
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  bubbleOwn: {
    backgroundColor: colors.brand.blue,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.neutral[100],
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  messageTextOwn: {
    color: colors.neutral[0],
  },
  messageTextOther: {
    color: colors.neutral[900],
  },
  timestamp: {
    fontSize: 10,
    alignSelf: 'flex-end',
  },
  timestampOwn: {
    color: colors.neutral[200],
  },
  timestampOther: {
    color: colors.neutral[400],
  },

  // Reactions
  reactionStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[100],
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    gap: 3,
  },
  reactionPillActive: {
    backgroundColor: `${colors.brand.blue}18`,
    borderColor: colors.brand.blue,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  reactionCountActive: {
    color: colors.brand.blue,
  },

  // System message
  systemRow: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  systemText: {
    fontSize: 12,
    color: colors.neutral[500],
    textAlign: 'center',
    fontStyle: 'italic',
  },

  gifImage: {
    width: 220,
    height: 160,
    borderRadius: 12,
  },

  // Gift message
  giftRow: {
    paddingHorizontal: 12,
    marginVertical: 6,
  },
  giftBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.brand.gold}18`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand.gold,
    padding: 12,
    gap: 10,
  },
  giftEmoji: {
    fontSize: 28,
  },
  giftBody: {
    flex: 1,
    gap: 2,
  },
  giftSender: {
    fontSize: 13,
    color: colors.neutral[700],
  },
  giftSenderBold: {
    fontWeight: '700',
    color: colors.neutral[900],
  },
  giftName: {
    fontWeight: '600',
    color: colors.brand.goldDark,
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  coinIcon: {
    fontSize: 12,
  },
  coinValue: {
    fontSize: 12,
    color: colors.brand.gold,
    fontWeight: '700',
  },
});

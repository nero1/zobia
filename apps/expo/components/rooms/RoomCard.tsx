/**
 * components/rooms/RoomCard.tsx
 *
 * Reusable room card for the discovery feed.
 *
 * Displays:
 *  - Cover image or emoji placeholder
 *  - Room type badge (color-coded per design system)
 *  - Member count + activity pulse bar
 *  - Creator avatar and name
 *  - Join/Enter button
 *
 * Room type badge colors:
 *  - free_open : brand blue  (#2563EB)
 *  - vip       : brand gold  (#D97706)
 *  - drop      : semantic error / red (#DC2626)
 *  - tipping   : brand green (#16A34A)
 *  - classroom : teal       (#0D9488) — NO purple
 *  - guild     : neutral    (#374151)
 *
 * NO purple. NO gradients.
 */

import React, { memo, useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/lib/theme/colors';
import type { RoomType } from '@zobia/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomCardData {
  id: string;
  name: string;
  roomType: RoomType;
  category?: string;
  city?: string;
  coverEmoji?: string;
  coverImageUrl?: string | null;
  memberCount: number;
  maxMembers?: number | null;
  trendingScore?: number;
  creatorId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  creatorAvatarEmoji: string;
  subscriptionPriceNgn?: number | null;
  entryFeeNgn?: number | null;
  isActive: boolean;
  isFeatured?: boolean;
  /** Live presence has reached the room's soft cap. */
  isFull?: boolean;
  /** PRD §10: Drop Rooms close at this timestamp; null = no expiry. */
  dropEndsAt?: string | null;
}

export interface RoomCardProps {
  room: RoomCardData;
  onPress: (room: RoomCardData) => void;
  style?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Room type display config
// ---------------------------------------------------------------------------

const ROOM_TYPE_CONFIG: Record<
  RoomType,
  { label: string; badgeColor: string; textColor: string }
> = {
  free_open: {
    label: 'Free',
    badgeColor: colors.brand.blue,
    textColor: colors.neutral[0],
  },
  vip: {
    label: 'VIP',
    badgeColor: colors.brand.gold,
    textColor: colors.neutral[0],
  },
  drop: {
    label: 'Drop',
    badgeColor: colors.semantic.error,
    textColor: colors.neutral[0],
  },
  tipping: {
    label: 'Tipping',
    badgeColor: colors.brand.green,
    textColor: colors.neutral[0],
  },
  classroom: {
    label: 'Class',
    badgeColor: '#0D9488', // teal — no purple
    textColor: colors.neutral[0],
  },
  guild: {
    label: 'Guild',
    badgeColor: colors.neutral[700],
    textColor: colors.neutral[0],
  },
};

// ---------------------------------------------------------------------------
// DropRoomTimer — countdown or "Closed" badge for Drop Rooms (PRD §10)
// ---------------------------------------------------------------------------

/**
 * Formats remaining seconds into "Xh Ym" or "Xs" string.
 */
function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Closed';
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface DropRoomTimerProps {
  dropEndsAt: string;
}

function DropRoomTimer({ dropEndsAt }: DropRoomTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(dropEndsAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const isClosed = secondsLeft <= 0;

  return (
    <View
      style={[
        styles.dropTimer,
        isClosed ? styles.dropTimerClosed : styles.dropTimerActive,
      ]}
    >
      <Text style={[styles.dropTimerText, isClosed && styles.dropTimerTextClosed]}>
        {isClosed ? '🔒 Closed' : `⏱ ${formatCountdown(secondsLeft)}`}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TypeBadgeProps {
  type: RoomType;
}

function TypeBadge({ type }: TypeBadgeProps) {
  const config = ROOM_TYPE_CONFIG[type];
  return (
    <View style={[styles.badge, { backgroundColor: config.badgeColor }]}>
      <Text style={[styles.badgeText, { color: config.textColor }]}>
        {config.label}
      </Text>
    </View>
  );
}

interface ActivityPulseProps {
  trendingScore: number;
}

/**
 * Horizontal bar indicating room activity level (0 = none, 100 = max).
 */
function ActivityPulse({ trendingScore }: ActivityPulseProps) {
  // Normalize score to 0–100 range (capped)
  const normalised = Math.min(trendingScore, 100);
  const fillPercent = Math.max(normalised, 3); // always show a sliver

  return (
    <View style={styles.pulseTrack}>
      <View
        style={[
          styles.pulseFill,
          {
            width: `${fillPercent}%` as `${number}%`,
            backgroundColor:
              fillPercent > 60
                ? colors.brand.green
                : fillPercent > 30
                ? colors.brand.gold
                : colors.neutral[400],
          },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * RoomCard — displays a single room in the discovery feed.
 *
 * @param room    - Room data to display
 * @param onPress - Callback invoked when the card is pressed
 * @param style   - Optional outer container override
 */
export const RoomCard = memo(function RoomCard({
  room,
  onPress,
  style,
}: RoomCardProps) {
  const {
    name,
    roomType,
    city,
    coverEmoji,
    memberCount,
    maxMembers,
    trendingScore = 0,
    creatorDisplayName,
    creatorAvatarEmoji,
    subscriptionPriceNgn,
    entryFeeNgn,
    isFeatured,
    isFull,
    dropEndsAt,
  } = room;
  const { t } = useTranslation();

  // PRD §10: Drop Rooms that have passed their end time are permanently closed.
  const isDropClosed =
    roomType === 'drop' && dropEndsAt != null && new Date(dropEndsAt) <= new Date();

  const priceLabel =
    roomType === 'vip' && subscriptionPriceNgn
      ? `₦${subscriptionPriceNgn.toLocaleString()}/mo`
      : roomType === 'drop' && entryFeeNgn
      ? `₦${entryFeeNgn.toLocaleString()} entry`
      : roomType === 'free_open' || roomType === 'tipping'
      ? 'Free'
      : null;

  const memberLabel =
    maxMembers
      ? `${(memberCount ?? 0).toLocaleString()}/${maxMembers.toLocaleString()}`
      : `${(memberCount ?? 0).toLocaleString()} members`;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && styles.pressed,
        isDropClosed && styles.cardClosed,
        style,
      ]}
      onPress={() => !isDropClosed && onPress(room)}
      disabled={isDropClosed}
      accessibilityRole="button"
      accessibilityLabel={
        isDropClosed
          ? `Drop Room: ${name}. Closed.`
          : `Room: ${name}. ${memberLabel}. ${priceLabel ?? ''}`
      }
    >
      {/* Cover / Emoji area */}
      <View style={styles.coverArea}>
        <Text style={styles.coverEmoji}>{coverEmoji ?? '💬'}</Text>
        {isFeatured && (
          <View style={styles.featuredBadge}>
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
        {isFull && (
          <View style={styles.fullBadge}>
            <Text style={styles.fullBadgeText}>{t('room.fullBadge')}</Text>
          </View>
        )}
        <TypeBadge type={roomType} />
        {/* PRD §10: Drop Room countdown / closed state */}
        {roomType === 'drop' && dropEndsAt && (
          <DropRoomTimer dropEndsAt={dropEndsAt} />
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Room name */}
        <Text style={styles.roomName} numberOfLines={1}>
          {name}
        </Text>

        {/* City */}
        {city ? (
          <Text style={styles.cityText} numberOfLines={1}>
            📍 {city}
          </Text>
        ) : null}

        {/* Activity pulse */}
        <ActivityPulse trendingScore={trendingScore} />

        {/* Footer row */}
        <View style={styles.footer}>
          {/* Creator info */}
          <View style={styles.creatorRow}>
            <View style={styles.creatorAvatar}>
              <Text style={styles.creatorAvatarEmoji}>{creatorAvatarEmoji}</Text>
            </View>
            <Text style={styles.creatorName} numberOfLines={1}>
              {creatorDisplayName}
            </Text>
          </View>

          {/* Member count + price */}
          <View style={styles.metaCol}>
            <Text style={styles.memberCount}>{memberLabel}</Text>
            {priceLabel ? (
              <Text style={styles.priceLabel}>{priceLabel}</Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    marginBottom: 12,
  },
  pressed: {
    opacity: 0.85,
  },

  // Cover
  coverArea: {
    height: 72,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    position: 'relative',
  },
  coverEmoji: {
    fontSize: 36,
  },
  featuredBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.brand.gold,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  featuredText: {
    color: colors.neutral[0],
    fontSize: 10,
    fontWeight: '700',
  },
  fullBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.semantic.warning,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fullBadgeText: {
    color: colors.neutral[0],
    fontSize: 10,
    fontWeight: '700',
  },

  // Badge
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Body
  body: {
    padding: 12,
    gap: 6,
  },
  roomName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cityText: {
    fontSize: 12,
    color: colors.neutral[500],
  },

  // Pulse
  pulseTrack: {
    height: 4,
    backgroundColor: colors.neutral[100],
    borderRadius: 2,
    overflow: 'hidden',
  },
  pulseFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  creatorAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarEmoji: {
    fontSize: 14,
  },
  creatorName: {
    fontSize: 12,
    color: colors.neutral[600],
    fontWeight: '500',
    flexShrink: 1,
  },
  metaCol: {
    alignItems: 'flex-end',
  },
  memberCount: {
    fontSize: 12,
    color: colors.neutral[500],
  },
  priceLabel: {
    fontSize: 12,
    color: colors.brand.blue,
    fontWeight: '600',
  },

  // Drop Room countdown / closed state (PRD §10)
  cardClosed: {
    opacity: 0.55,
  },
  dropTimer: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dropTimerActive: {
    backgroundColor: 'rgba(220,38,38,0.85)', // red — matches drop badge
  },
  dropTimerClosed: {
    backgroundColor: colors.neutral[600],
  },
  dropTimerText: {
    color: colors.neutral[0],
    fontSize: 10,
    fontWeight: '700',
  },
  dropTimerTextClosed: {
    color: colors.neutral[200],
  },
});

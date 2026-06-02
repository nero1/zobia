/**
 * components/rooms/GiftSpectacle.tsx
 *
 * Full-screen gift animation overlay for high-value gifts in rooms.
 *
 * Behaviour:
 *  - Renders a semi-transparent dim over the message feed
 *  - Displays the gift emoji large, sender name, gift name, and coin value
 *  - Auto-dismisses after 3 seconds (configurable via displayDurationMs)
 *  - Can also be dismissed by tapping the overlay
 *
 * Triggering:
 *  The parent screen subscribes to Supabase Realtime channel `room:{roomId}`
 *  and passes spectacle data when a gift event is received.
 *
 * NO purple. NO gradients.
 */

import React, { memo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GiftSpectacleData {
  senderDisplayName: string;
  senderAvatarEmoji: string;
  giftName: string;
  giftEmoji: string;
  coinValue: number;
}

export interface GiftSpectacleProps {
  data: GiftSpectacleData | null;
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss. Default 3000. */
  displayDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GiftSpectacle — full-screen animated overlay for high-value room gifts.
 *
 * Renders nothing when `data` is null (unmounted state).
 *
 * @param data             - Gift spectacle data (null when not active)
 * @param onDismiss        - Called when the overlay auto-dismisses or is tapped
 * @param displayDurationMs - How long to show the spectacle before dismissing
 */
export const GiftSpectacle = memo(function GiftSpectacle({
  data,
  onDismiss,
  displayDurationMs = 3000,
}: GiftSpectacleProps) {
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data) return;

    // Reset
    scaleAnim.setValue(0.5);
    opacityAnim.setValue(0);

    // Animate in
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 80,
        friction: 6,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
    ]).start();

    // Auto-dismiss timer
    dismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, displayDurationMs);

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }

    // Animate out
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
      easing: Easing.in(Easing.ease),
    }).start(() => {
      onDismiss();
    });
  };

  if (!data) return null;

  return (
    <Pressable
      style={styles.overlay}
      onPress={handleDismiss}
      accessibilityRole="button"
      accessibilityLabel={`Gift spectacle: ${data.senderDisplayName} sent ${data.giftName}. Tap to dismiss.`}
    >
      {/* Dim background */}
      <Animated.View style={[styles.dim, { opacity: opacityAnim }]} />

      {/* Card */}
      <Animated.View
        style={[
          styles.card,
          {
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Gift emoji */}
        <Text style={styles.giftEmoji}>{data.giftEmoji}</Text>

        {/* Gift name */}
        <Text style={styles.giftName}>{data.giftName}</Text>

        {/* Sender row */}
        <View style={styles.senderRow}>
          <Text style={styles.senderAvatar}>{data.senderAvatarEmoji}</Text>
          <Text style={styles.senderText}>
            <Text style={styles.senderName}>{data.senderDisplayName}</Text>
            {' sent this gift!'}
          </Text>
        </View>

        {/* Coin value */}
        <View style={styles.coinRow}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.coinValue}>
            {data.coinValue.toLocaleString()} coins
          </Text>
        </View>

        {/* Dismiss hint */}
        <Text style={styles.dismissHint}>Tap to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 32,
    borderWidth: 2,
    borderColor: colors.brand.gold,
    // Shadow (iOS)
    shadowColor: colors.brand.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    // Elevation (Android)
    elevation: 12,
  },
  giftEmoji: {
    fontSize: 72,
    lineHeight: 80,
  },
  giftName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.neutral[900],
    textAlign: 'center',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  senderAvatar: {
    fontSize: 24,
  },
  senderText: {
    fontSize: 15,
    color: colors.neutral[600],
  },
  senderName: {
    fontWeight: '700',
    color: colors.neutral[900],
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${colors.brand.gold}18`,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 4,
  },
  coinIcon: {
    fontSize: 18,
  },
  coinValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.brand.goldDark,
  },
  dismissHint: {
    fontSize: 12,
    color: colors.neutral[400],
    marginTop: 8,
  },
});

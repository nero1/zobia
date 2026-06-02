/**
 * GiftAnimation
 *
 * Full-screen overlay animation shown when a gift is sent or received in a Room.
 *
 * For high-value gifts (tier >= 4) the animation holds for the full 3-second
 * spectacle duration before auto-dismissing. Lower-tier gifts use a shorter
 * 1.5-second duration.
 *
 * Animation uses React Native's built-in Animated API (no external dependency)
 * with a scale + fade in/out sequence.
 *
 * @module components/economy/GiftAnimation
 */

import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Modal,
  Platform,
} from 'react-native';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Spectacle duration in ms by gift tier. */
const SPECTACLE_DURATION: Record<number, number> = {
  1: 1_200,
  2: 1_500,
  3: 2_000,
  4: 3_000,
  5: 3_000,
};

const DEFAULT_DURATION = 1_500;

// Tier-based ring colors
const TIER_COLORS: Record<number, string> = {
  1: colors.neutral[300],
  2: colors.brand.green,
  3: colors.brand.gold,
  4: colors.brand.blue,
  5: colors.semantic.warning,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GiftAnimationProps {
  /** Whether the animation overlay is currently visible. */
  visible: boolean;
  /** The emoji of the gift being animated. */
  giftEmoji: string;
  /** Human-readable gift name. */
  giftName: string;
  /** Gift tier (1–5). Determines duration and visual intensity. */
  tier?: number;
  /** Username of the gift sender. */
  senderUsername?: string;
  /** Username of the gift recipient. */
  recipientUsername?: string;
  /** Called when the animation finishes or the user taps to dismiss. */
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GiftAnimation — spectacle overlay for Room gift events.
 *
 * @example
 * <GiftAnimation
 *   visible={showGift}
 *   giftEmoji="💎"
 *   giftName="Diamond Ring"
 *   tier={5}
 *   senderUsername="zobiafan"
 *   recipientUsername="creator"
 *   onDismiss={() => setShowGift(false)}
 * />
 */
export function GiftAnimation({
  visible,
  giftEmoji,
  giftName,
  tier = 1,
  senderUsername,
  recipientUsername,
  onDismiss,
}: GiftAnimationProps) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const duration = SPECTACLE_DURATION[tier] ?? DEFAULT_DURATION;
  const ringColor = TIER_COLORS[tier] ?? colors.neutral[400];

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.6, duration: 250, useNativeDriver: true }),
    ]).start(() => onDismiss?.());
  }, [opacity, scale, onDismiss]);

  useEffect(() => {
    if (!visible) return;

    // Reset values
    scale.setValue(0);
    opacity.setValue(0);
    bounce.setValue(0);

    // Animate in
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        tension: 80,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Bounce animation for high-tier gifts
      if (tier >= 3) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(bounce, { toValue: -8, duration: 350, useNativeDriver: true }),
            Animated.timing(bounce, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]),
          { iterations: Math.floor(duration / 700) }
        ).start();
      }

      // Auto-dismiss after duration
      timerRef.current = setTimeout(dismiss, duration);
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, tier, duration, scale, opacity, bounce, dismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={dismiss}
    >
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Animated.View
          style={[
            styles.container,
            {
              opacity,
              transform: [
                { scale },
                { translateY: bounce },
              ],
            },
          ]}
        >
          {/* Ring indicator for tier */}
          <View style={[styles.ring, { borderColor: ringColor }]}>
            <Text style={styles.emoji}>{giftEmoji}</Text>
          </View>

          <Text style={styles.giftName}>{giftName}</Text>

          {tier >= 4 && (
            <View style={[styles.spectacleBadge, { backgroundColor: ringColor }]}>
              <Text style={styles.spectacleText}>
                {tier === 5 ? '✨ LEGENDARY GIFT ✨' : '🔥 EPIC GIFT'}
              </Text>
            </View>
          )}

          {senderUsername && (
            <Text style={styles.attribution}>
              <Text style={styles.username}>@{senderUsername}</Text>
              {recipientUsername ? (
                <>
                  {' sent to '}
                  <Text style={styles.username}>@{recipientUsername}</Text>
                </>
              ) : null}
            </Text>
          )}

          <Text style={styles.tapToDismiss}>Tap to dismiss</Text>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  ring: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  emoji: {
    fontSize: 72,
    lineHeight: 80,
  },
  giftName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.neutral[0],
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  spectacleBadge: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  spectacleText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.neutral[0],
    letterSpacing: 0.5,
  },
  attribution: {
    fontSize: 14,
    color: colors.neutral[300],
    textAlign: 'center',
  },
  username: {
    fontWeight: '700',
    color: colors.neutral[0],
  },
  tapToDismiss: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 8,
  },
});

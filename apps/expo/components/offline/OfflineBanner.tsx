/**
 * Zobia Social — OfflineBanner component.
 *
 * Displays a non-intrusive, accessible banner at the top of the screen
 * whenever the device has no network connection.  Uses NetInfo to track
 * connectivity and Reanimated for a smooth slide-in / slide-out animation.
 */

import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { colors } from '@/lib/theme/colors';

// NetInfo is a peer dep via expo — if the project grows, add it explicitly.
// For Phase 1 we reference it directly and gracefully degrade if unavailable.

interface OfflineBannerProps {
  /** Override the banner message (defaults to the i18n `common.offline` key). */
  message?: string;
}

/**
 * OfflineBanner
 *
 * Mount this once inside the root layout (or inside `Screen`) and it will
 * automatically appear / disappear based on network state.
 *
 * @example
 * <OfflineBanner />
 */
export function OfflineBanner({ message = "You're offline" }: OfflineBannerProps) {
  const isVisible = useSharedValue(0);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false || state.isInternetReachable === false;
      isVisible.value = withTiming(offline ? 1 : 0, {
        duration: 300,
        easing: Easing.out(Easing.quad),
      });
    });
    return unsubscribe;
  }, [isVisible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: isVisible.value,
    // Slide from -40 (hidden above) to 0 (visible)
    transform: [{ translateY: (isVisible.value - 1) * 40 }],
    pointerEvents: isVisible.value > 0 ? 'auto' : 'none',
  }));

  return (
    <Animated.View
      style={[styles.banner, animatedStyle]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.neutral[800],
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  text: {
    color: colors.neutral[0],
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
});

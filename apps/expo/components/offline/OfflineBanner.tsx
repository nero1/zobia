/**
 * Zobia Social — OfflineBanner component.
 *
 * Displays a small, grey, closeable, accessible banner at the top of the screen
 * whenever the device has no network connection. The app stays usable behind it
 * (offline-first): cached data keeps rendering and refreshes once connectivity
 * returns. Uses NetInfo to track connectivity and Reanimated for a smooth
 * slide-in / slide-out animation.
 */

import React, { useEffect, useState } from 'react';
import { Text, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
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
 * automatically appear / disappear based on network state. The user can close
 * it for the current outage; it reappears on the next offline transition.
 *
 * @example
 * <OfflineBanner />
 */
export function OfflineBanner({ message }: OfflineBannerProps) {
  const { t } = useTranslation();
  const isVisible = useSharedValue(0);
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // BUG-44 FIX: check current connectivity immediately on mount so the banner
    // reflects the real state rather than always assuming "online" at startup.
    NetInfo.fetch().then((state) => {
      // BUG-50: isInternetReachable is null during the initial connectivity probe —
      // we treat null as "connected" (optimistic) to avoid false-positive offline
      // banners on cold start. The sync queue uses a stricter policy. This is intentional.
      setOffline(state.isInternetReachable === false);
    }).catch(() => {});

    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null during initial connectivity probe — we treat null
      // as "connected" (optimistic) to avoid false-positive offline banners on cold
      // start. The sync queue uses a stricter policy. This is intentional.
      setOffline(state.isInternetReachable === false);
      if (state.isInternetReachable === false) setDismissed(false); // a fresh outage re-shows the banner
    });
    return unsubscribe;
  }, []);

  const shown = offline && !dismissed;

  useEffect(() => {
    isVisible.value = withTiming(shown ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.quad),
    });
  }, [shown, isVisible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: isVisible.value,
    // Slide from -40 (hidden above) to 0 (visible)
    transform: [{ translateY: (isVisible.value - 1) * 40 }],
  }));

  return (
    <Animated.View
      style={[styles.banner, animatedStyle]}
      pointerEvents={shown ? 'auto' : 'none'}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Text style={styles.dot} accessibilityElementsHidden>
          ●
        </Text>
        <Text style={styles.text}>{message ?? t('common.offline')}</Text>
        <Pressable
          onPress={() => setDismissed(true)}
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.closeBtn}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.neutral[200],
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    color: colors.neutral[700],
    fontSize: 9,
  },
  text: {
    color: colors.neutral[700],
    fontSize: 12,
    fontWeight: '500',
  },
  closeBtn: {
    marginLeft: 4,
    paddingHorizontal: 2,
  },
  closeText: {
    color: colors.neutral[700],
    fontSize: 12,
    fontWeight: '600',
  },
});

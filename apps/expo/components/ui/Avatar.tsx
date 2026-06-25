/**
 * Zobia Social — Avatar component.
 *
 * Renders a user avatar that can display:
 *  - An emoji character (Phase 1 onboarding style)
 *  - A remote image URL via `expo-image`
 *
 * A coloured rank ring is drawn around the avatar using a border, mapping
 * rank tiers to the palette defined in `lib/theme/colors.ts`.
 *
 * No purple, no gradients.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { rankColors, type RankTier } from '@/lib/theme/colors';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  /** Emoji string shown when no `imageUri` is provided. */
  emoji?: string;
  /** Remote image URI. When provided, takes precedence over `emoji`. */
  imageUri?: string;
  /** Rank tier that controls the ring colour. Omit to hide the ring. */
  rankTier?: RankTier;
  /** Size preset. Default: 'md'. */
  size?: AvatarSize;
  /** Outer container style override. */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label (e.g. "{username}'s avatar"). */
  accessibilityLabel?: string;
  /** Active cosmetic frame ID — rendered as an overlay on the avatar. */
  activeFrameId?: string | null;
}

// ---------------------------------------------------------------------------
// Size presets
// ---------------------------------------------------------------------------

const SIZE_MAP: Record<AvatarSize, { container: number; fontSize: number; ring: number }> = {
  xs: { container: 32, fontSize: 16, ring: 2 },
  sm: { container: 40, fontSize: 20, ring: 2 },
  md: { container: 52, fontSize: 26, ring: 3 },
  lg: { container: 64, fontSize: 32, ring: 3 },
  xl: { container: 88, fontSize: 44, ring: 4 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Avatar — displays user photo or emoji with an optional rank ring.
 *
 * @example
 * // Emoji avatar with gold rank ring
 * <Avatar emoji="🦁" rankTier="gold" size="lg" />
 *
 * // Remote image avatar, no ring
 * <Avatar imageUri={user.photoUrl} size="md" accessibilityLabel="Alice's avatar" />
 */
export function Avatar({
  emoji = '🙂',
  imageUri,
  rankTier,
  size = 'md',
  style,
  accessibilityLabel,
  activeFrameId,
}: AvatarProps) {
  const { container: containerSize, fontSize, ring } = SIZE_MAP[size];
  const ringColor = rankTier ? rankColors[rankTier] : 'transparent';
  const ringWidth = rankTier ? ring : 0;
  const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  const frameUri =
    activeFrameId && SAFE_ID_RE.test(activeFrameId)
      ? `${env.API_BASE_URL}/cosmetics/frames/${activeFrameId}.png`
      : null;

  return (
    <View
      style={[
        styles.ring,
        {
          width: containerSize + ringWidth * 2 + 4,
          height: containerSize + ringWidth * 2 + 4,
          borderRadius: (containerSize + ringWidth * 2 + 4) / 2,
          borderWidth: ringWidth,
          borderColor: ringColor,
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    >
      <View
        style={[
          styles.avatar,
          {
            width: containerSize,
            height: containerSize,
            borderRadius: containerSize / 2,
          },
        ]}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <Text style={[styles.emoji, { fontSize }]}>{emoji}</Text>
        )}
        {/* Cosmetic frame overlay */}
        {frameUri && (
          <Image
            source={{ uri: frameUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityLabel=""
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  avatar: {
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    textAlign: 'center',
    lineHeight: undefined,
  },
});

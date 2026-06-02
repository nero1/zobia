/**
 * Zobia Social — Button component.
 *
 * Design constraints:
 *  - Minimum touch target: 44 × 44 dp (WCAG 2.5.5)
 *  - No purple, no gradients
 *  - Variants: primary (blue), secondary (outlined), ghost, danger
 *  - Sizes: sm | md | lg
 *  - Full dark-mode support via theme hook
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  /** Button label text. */
  label: string;
  /** Visual style variant. Default: 'primary'. */
  variant?: ButtonVariant;
  /** Size preset. Default: 'md'. */
  size?: ButtonSize;
  /** When true, shows an activity spinner and disables the button. */
  loading?: boolean;
  /** Override styles for the outer Pressable container. */
  style?: StyleProp<ViewStyle>;
  /** Override styles for the label text. */
  labelStyle?: StyleProp<TextStyle>;
  /** Icon rendered before the label. */
  leftIcon?: React.ReactNode;
  /** Icon rendered after the label. */
  rightIcon?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Size presets
// ---------------------------------------------------------------------------

const SIZE_STYLES: Record<ButtonSize, { height: number; paddingH: number; fontSize: number }> = {
  sm: { height: 44, paddingH: 16, fontSize: 14 },
  md: { height: 50, paddingH: 20, fontSize: 16 },
  lg: { height: 56, paddingH: 24, fontSize: 18 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Button — accessible, theme-aware pressable.
 *
 * @example
 * <Button label="Sign In" onPress={handleSignIn} loading={isPending} />
 * <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  style,
  labelStyle,
  leftIcon,
  rightIcon,
  ...pressableProps
}: ButtonProps) {
  const { isDark } = useTheme();
  const isDisabled = disabled || loading;
  const { height, paddingH, fontSize } = SIZE_STYLES[size];

  // Build variant-dependent styles dynamically so we can factor in dark mode.
  const variantContainer = getVariantContainerStyle(variant, isDark, isDisabled);
  const variantLabel = getVariantLabelStyle(variant, isDark, isDisabled);
  const spinnerColor = variant === 'primary' || variant === 'danger'
    ? colors.neutral[0]
    : colors.brand.blue;

  return (
    <Pressable
      {...pressableProps}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        { height, paddingHorizontal: paddingH },
        variantContainer,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {leftIcon}
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Text style={[styles.label, { fontSize }, variantLabel, labelStyle]}>
          {label}
        </Text>
      )}
      {rightIcon}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function getVariantContainerStyle(
  variant: ButtonVariant,
  isDark: boolean,
  disabled: boolean | undefined,
): ViewStyle {
  const opacity = disabled ? 0.5 : 1;

  switch (variant) {
    case 'primary':
      return { backgroundColor: colors.brand.blue, opacity };
    case 'danger':
      return { backgroundColor: colors.semantic.error, opacity };
    case 'secondary':
      return {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.brand.blue,
        opacity,
      };
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        opacity,
      };
  }
}

function getVariantLabelStyle(
  variant: ButtonVariant,
  isDark: boolean,
  disabled: boolean | undefined,
): TextStyle {
  switch (variant) {
    case 'primary':
    case 'danger':
      return { color: colors.neutral[0] };
    case 'secondary':
      return { color: colors.brand.blue };
    case 'ghost':
      return { color: isDark ? colors.neutral[200] : colors.neutral[700] };
  }
}

// ---------------------------------------------------------------------------
// Base styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    gap: 8,
    // Ensure at least 44dp tall for touch targets (overridden by size presets).
    minHeight: 44,
    minWidth: 44,
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
});

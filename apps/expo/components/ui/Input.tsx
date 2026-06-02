/**
 * Zobia Social — Input component.
 *
 * A styled, accessible text input that:
 *  - Respects light / dark mode via the theme hook
 *  - Shows a label and optional error message
 *  - Highlights the border on focus (brand blue) and on error (red)
 *  - Maintains a minimum touch target of 44 dp
 *  - Supports left/right icon slots
 */

import React, { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InputProps extends TextInputProps {
  /** Visible label rendered above the input. */
  label?: string;
  /** Error message rendered below the input (also sets error border colour). */
  error?: string;
  /** Optional icon rendered inside the left edge of the input. */
  leftIcon?: React.ReactNode;
  /** Optional icon rendered inside the right edge of the input. */
  rightIcon?: React.ReactNode;
  /** Outer container style override. */
  containerStyle?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Input — labelled text field with error state and icon slots.
 *
 * @example
 * <Input
 *   label="Username"
 *   placeholder="your_handle"
 *   value={value}
 *   onChangeText={setValue}
 *   error={errors.username}
 * />
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    leftIcon,
    rightIcon,
    containerStyle,
    style,
    ...textInputProps
  },
  ref,
) {
  const { colors: themeColors, isDark } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? colors.semantic.error
    : isFocused
    ? colors.brand.blue
    : isDark
    ? colors.neutral[700]
    : colors.neutral[300];

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text
          style={[
            styles.label,
            { color: isDark ? colors.neutral[300] : colors.neutral[700] },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputRow,
          {
            borderColor,
            backgroundColor: isDark ? colors.neutral[800] : colors.neutral[0],
          },
        ]}
      >
        {leftIcon ? <View style={styles.iconLeft}>{leftIcon}</View> : null}

        <TextInput
          ref={ref}
          style={[
            styles.input,
            { color: themeColors.text },
            leftIcon ? styles.inputWithLeft : undefined,
            rightIcon ? styles.inputWithRight : undefined,
            style,
          ]}
          placeholderTextColor={isDark ? colors.neutral[500] : colors.neutral[400]}
          onFocus={(e) => {
            setIsFocused(true);
            textInputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            textInputProps.onBlur?.(e);
          }}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          {...textInputProps}
        />

        {rightIcon ? <View style={styles.iconRight}>{rightIcon}</View> : null}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  inputWithLeft: {
    marginLeft: 8,
  },
  inputWithRight: {
    marginRight: 8,
  },
  iconLeft: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconRight: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    fontSize: 12,
    color: colors.semantic.error,
    marginTop: 2,
  },
});

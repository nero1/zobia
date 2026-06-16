/**
 * Zobia Social — theme provider and useTheme hook.
 *
 * Wraps React Native's `useColorScheme` and exposes a typed theme object
 * so components never hard-code color values.
 */

import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { colors } from './colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeColors {
  /** Primary background (white / near-black) */
  background: string;
  /** Secondary / card background */
  surface: string;
  /** Primary text */
  text: string;
  /** Secondary / muted text */
  textMuted: string;
  /** Divider / border */
  border: string;
  /** Active / brand blue */
  primary: string;
  /** Success / brand green */
  success: string;
  /** Warning / brand gold */
  warning: string;
  /** Destructive / error red */
  error: string;
  /** Tab bar background */
  tabBar: string;
}

export interface Theme {
  isDark: boolean;
  colors: ThemeColors;
}

// ---------------------------------------------------------------------------
// Light / dark token maps
// ---------------------------------------------------------------------------

const lightColors: ThemeColors = {
  background: colors.neutral[50],
  surface: colors.neutral[0],
  text: colors.neutral[900],
  textMuted: colors.neutral[500],
  border: colors.neutral[200],
  primary: colors.brand.blue,
  success: colors.brand.green,
  warning: colors.brand.gold,
  error: colors.semantic.error,
  tabBar: colors.neutral[0],
};

const darkColors: ThemeColors = {
  background: colors.neutral[950],
  surface: colors.neutral[900],
  text: colors.neutral[50],
  textMuted: colors.neutral[400],
  border: colors.neutral[800],
  primary: colors.brand.blueLight,
  success: colors.brand.greenLight,
  warning: colors.brand.goldLight,
  error: '#F87171',
  tabBar: colors.neutral[900],
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<Theme>({
  isDark: false,
  colors: lightColors,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ThemeProvider — place at the root of the app.
 *
 * Automatically mirrors the device color scheme and re-renders children
 * whenever the system appearance changes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const value = useMemo<Theme>(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
    }),
    [isDark],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the current theme object including `isDark` flag and typed colors.
 *
 * @example
 * const { isDark, colors } = useTheme();
 */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

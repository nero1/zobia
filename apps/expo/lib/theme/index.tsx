/**
 * Zobia Social — theme provider and useTheme hook.
 *
 * Wraps React Native's `useColorScheme` and exposes a typed theme object
 * so components never hard-code color values.
 *
 * Theme resolution order:
 *  1. User-selected preference ('light' | 'dark' | 'system') persisted in a
 *     separate, unencrypted MMKV instance (synchronous — avoids the async init
 *     race of the main encrypted store).
 *  2. If preference is 'system' (or absent), mirror the device color scheme.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { colors } from './colors';

// ---------------------------------------------------------------------------
// Theme preference store (unencrypted — theme pref is not sensitive)
// ---------------------------------------------------------------------------

const THEME_PREF_KEY = 'user_theme';

/**
 * Minimal subset of the MMKV surface this module uses. Lets us swap in an
 * in-memory fallback when the native store is unavailable without changing
 * any call sites.
 */
interface ThemePrefStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

/**
 * WHITE-SCREEN ROOT CAUSE FIX
 * ---------------------------------------------------------------------------
 * This module is imported at the very top of `app/_layout.tsx`, so it is
 * evaluated before React mounts anything. Constructing `new MMKV()` here at
 * module scope means that if the native MMKV instance fails to initialise on a
 * given device (the encrypted offline store already anticipates exactly this —
 * see lib/offline/store.ts), the THROW happens during module evaluation, not
 * inside a component. A module-evaluation throw aborts the entire bundle's
 * startup and can NEVER be caught by a React error boundary, so the app is left
 * stuck on a blank white screen after the splash with no way to recover.
 *
 * We therefore (1) construct the store inside a try/catch and (2) fall back to a
 * volatile in-memory store if construction fails. The theme preference is not
 * sensitive and losing it across launches is acceptable; keeping the app alive
 * is not. Every read/write is additionally guarded so a later native failure
 * can't crash a render either.
 */
function createThemeStore(): ThemePrefStore {
  try {
    const mmkv = new MMKV({ id: 'zobia-theme-pref' });
    // Touch the instance once so a lazily-thrown native error surfaces here,
    // inside the try/catch, rather than on first read during render.
    mmkv.getString(THEME_PREF_KEY);
    return mmkv;
  } catch (err) {
    console.warn('[theme] MMKV unavailable — using in-memory theme store', err);
    const mem = new Map<string, string>();
    return {
      getString: (key) => mem.get(key),
      set: (key, value) => {
        mem.set(key, value);
      },
    };
  }
}

const themeStore: ThemePrefStore = createThemeStore();

type UserTheme = 'light' | 'dark' | 'system';

function readStoredTheme(): UserTheme {
  try {
    const v = themeStore.getString(THEME_PREF_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch (err) {
    console.warn('[theme] Failed to read stored theme; defaulting to system', err);
  }
  return 'system';
}

function writeStoredTheme(theme: UserTheme): void {
  try {
    themeStore.set(THEME_PREF_KEY, theme);
  } catch (err) {
    console.warn('[theme] Failed to persist theme preference', err);
  }
}

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
  /** The user's explicit theme preference ('light' | 'dark' | 'system'). */
  userTheme: UserTheme;
  /** Persist a new theme preference and immediately re-render the app. */
  setUserTheme: (theme: UserTheme) => void;
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
  userTheme: 'system',
  setUserTheme: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ThemeProvider — place at the root of the app.
 *
 * Reads the user's saved theme preference from MMKV on mount (synchronous).
 * When the preference is 'system', mirrors the device color scheme.
 * Exposes `setUserTheme` so settings can write a new preference.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [userTheme, setUserThemeState] = useState<UserTheme>(readStoredTheme);

  const setUserTheme = useCallback((theme: UserTheme) => {
    writeStoredTheme(theme);
    setUserThemeState(theme);
  }, []);

  const isDark = useMemo(() => {
    if (userTheme === 'light') return false;
    if (userTheme === 'dark') return true;
    return systemScheme === 'dark';
  }, [userTheme, systemScheme]);

  const value = useMemo<Theme>(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
      userTheme,
      setUserTheme,
    }),
    [isDark, userTheme, setUserTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the current theme object including `isDark` flag, typed colors,
 * the active `userTheme` preference, and `setUserTheme` to change it.
 *
 * @example
 * const { isDark, colors, setUserTheme } = useTheme();
 */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

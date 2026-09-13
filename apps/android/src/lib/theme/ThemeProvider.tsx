/**
 * apps/android/src/lib/theme/ThemeProvider.tsx
 *
 * React context wiring for lib/theme/store.ts. Applies the theme class to
 * <html> synchronously on mount (from the localStorage mirror, so there's
 * no flash of the wrong theme) and then reconciles with the durable
 * Capacitor Preferences value. Also re-resolves 'system' when the OS theme
 * changes while the app is open.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  getStoredTheme,
  getStoredThemeSync,
  resolveTheme,
  setStoredTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './store';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Applied once at module scope too, so the very first render (before React
// even mounts this provider) already has the right class — matches the
// no-flash intent of web's next-themes.
applyTheme(getStoredThemeSync());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredThemeSync());

  // Reconcile with the authoritative (native) store once on mount.
  useEffect(() => {
    let cancelled = false;
    getStoredTheme().then((stored) => {
      if (cancelled) return;
      setThemeState(stored);
      applyTheme(stored);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Re-resolve 'system' if the OS theme flips while the app is open.
  useEffect(() => {
    if (theme !== 'system') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => applyTheme('system');
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [theme]);

  const setTheme = (pref: ThemePreference) => {
    setThemeState(pref);
    applyTheme(pref);
    void setStoredTheme(pref);
  };

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme: resolveTheme(theme),
    setTheme,
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

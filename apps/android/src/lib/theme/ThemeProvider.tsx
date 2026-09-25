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
import type { SiteThemeId, IconSetId } from '@zobia/shared/utils';
import { useUiManifest } from '@/lib/hooks/useManifest';
import {
  applyTheme,
  getStoredTheme,
  getStoredThemeSync,
  resolveTheme,
  setStoredTheme,
  applySiteTheme,
  getStoredSiteTheme,
  getStoredSiteThemeSync,
  setStoredSiteTheme,
  getStoredIconSet,
  getStoredIconSetSync,
  setStoredIconSet,
  applyFontZoomPercent,
  getStoredFontZoom,
  getStoredFontZoomSync,
  setStoredFontZoom,
  type ResolvedTheme,
  type ThemePreference,
} from './store';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
  /** Resolved site theme actually applied right now (device override, or the admin default). */
  siteTheme: SiteThemeId;
  /** The device's own override, or null when following the admin default. */
  siteThemeOverride: SiteThemeId | null;
  setSiteThemeOverride: (theme: SiteThemeId | null) => void;
  /** Resolved icon set actually applied right now (device override, or the admin default). */
  iconSet: IconSetId;
  /** The device's own override, or null when following the admin default. */
  iconSetOverride: IconSetId | null;
  setIconSetOverride: (iconSet: IconSetId | null) => void;
  fontZoomPercent: number;
  setFontZoomPercent: (percent: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Applied once at module scope too, so the very first render (before React
// even mounts this provider) already has the right class — matches the
// no-flash intent of web's next-themes.
applyTheme(getStoredThemeSync());
applySiteTheme(getStoredSiteThemeSync());
applyFontZoomPercent(getStoredFontZoomSync());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(getStoredThemeSync());
  const [siteThemeOverride, setSiteThemeOverrideState] = useState<SiteThemeId | null>(getStoredSiteThemeSync());
  const [iconSetOverride, setIconSetOverrideState] = useState<IconSetId | null>(getStoredIconSetSync());
  const [fontZoomPercent, setFontZoomState] = useState<number>(getStoredFontZoomSync());
  const uiManifest = useUiManifest();
  const adminDefaultSiteTheme = (uiManifest.siteTheme as SiteThemeId | undefined) ?? 'default';
  const adminDefaultIconSet = (uiManifest.iconSet as IconSetId | undefined) ?? 'emoji';

  // Reconcile with the authoritative (native) store once on mount.
  useEffect(() => {
    let cancelled = false;
    getStoredTheme().then((stored) => {
      if (cancelled) return;
      setThemeState(stored);
      applyTheme(stored);
    }).catch(() => {});
    getStoredSiteTheme().then((stored) => {
      if (cancelled) return;
      setSiteThemeOverrideState(stored);
    }).catch(() => {});
    getStoredIconSet().then((stored) => {
      if (cancelled) return;
      setIconSetOverrideState(stored);
    }).catch(() => {});
    getStoredFontZoom().then((stored) => {
      if (cancelled) return;
      setFontZoomState(stored);
      applyFontZoomPercent(stored);
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

  // Re-apply the resolved site theme whenever the device override or the
  // admin default (from /api/manifest, react-query cached) changes.
  const resolvedSiteTheme = siteThemeOverride ?? adminDefaultSiteTheme;
  useEffect(() => {
    applySiteTheme(resolvedSiteTheme);
  }, [resolvedSiteTheme]);

  const setTheme = (pref: ThemePreference) => {
    setThemeState(pref);
    applyTheme(pref);
    void setStoredTheme(pref);
  };

  const setSiteThemeOverride = (next: SiteThemeId | null) => {
    setSiteThemeOverrideState(next);
    void setStoredSiteTheme(next);
  };

  const setIconSetOverride = (next: IconSetId | null) => {
    setIconSetOverrideState(next);
    void setStoredIconSet(next);
  };

  const setFontZoomPercent = (percent: number) => {
    setFontZoomState(percent);
    applyFontZoomPercent(percent);
    void setStoredFontZoom(percent);
  };

  const resolvedIconSet = iconSetOverride ?? adminDefaultIconSet;

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme: resolveTheme(theme),
    setTheme,
    siteTheme: resolvedSiteTheme,
    siteThemeOverride,
    setSiteThemeOverride,
    iconSet: resolvedIconSet,
    iconSetOverride,
    setIconSetOverride,
    fontZoomPercent,
    setFontZoomPercent,
  }), [theme, resolvedSiteTheme, siteThemeOverride, resolvedIconSet, iconSetOverride, fontZoomPercent]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

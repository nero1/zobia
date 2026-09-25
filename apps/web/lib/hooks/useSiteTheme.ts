"use client";

/**
 * lib/hooks/useSiteTheme.ts
 *
 * Client-side control for the sitewide UI theme, icon set and font-zoom
 * preferences (Settings > Appearance). Device-scoped only (matches the
 * existing next-themes light/dark preference right next to it in Settings —
 * neither is per-account), stored in localStorage under the
 * `zobia:*:device` keys from shared/utils/uiThemes.ts, and applied directly
 * to `document.documentElement` so a change takes effect instantly without
 * a reload. The very first paint is instead handled by the blocking inline
 * script in app/layout.tsx (same FOUC-prevention technique next-themes
 * uses for dark/light), which this hook's initial state simply mirrors.
 *
 * The admin-set default (manifest.ui.siteTheme / .iconSet, from
 * /gate44/config "Theming") is read via the same cached /api/manifest fetch
 * useFeatureFlags already uses — no extra network or Redis cost.
 */

import { useCallback, useEffect, useState } from "react";
import {
  SITE_THEME_IDS,
  ICON_SET_IDS,
  isSiteThemeId,
  isIconSetId,
  clampFontZoomPercent,
  nextFontZoomStep,
  FONT_ZOOM_DEFAULT_PERCENT,
  siteThemeStorageKey,
  iconSetStorageKey,
  fontZoomStorageKey,
  type SiteThemeId,
  type IconSetId,
} from "@zobia/shared/utils";
import { useUiManifest } from "@/lib/hooks/useFeatureFlags";

const SITE_THEME_KEY = siteThemeStorageKey();
const ICON_SET_KEY = iconSetStorageKey();
const FONT_ZOOM_KEY = fontZoomStorageKey();

function readOverride<T extends string>(key: string, isValid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    return isValid(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function useSiteTheme() {
  const manifestUi = useUiManifest();
  const adminDefault = {
    siteTheme: (isSiteThemeId(manifestUi.siteTheme) ? manifestUi.siteTheme : "default") as SiteThemeId,
    iconSet: (isIconSetId(manifestUi.iconSet) ? manifestUi.iconSet : "emoji") as IconSetId,
  };
  const [siteThemeOverride, setSiteThemeOverrideState] = useState<SiteThemeId | null>(null);
  const [iconSetOverride, setIconSetOverrideState] = useState<IconSetId | null>(null);
  const [fontZoomPercent, setFontZoomPercentState] = useState<number>(FONT_ZOOM_DEFAULT_PERCENT);

  useEffect(() => {
    setSiteThemeOverrideState(readOverride(SITE_THEME_KEY, isSiteThemeId));
    setIconSetOverrideState(readOverride(ICON_SET_KEY, isIconSetId));
    try {
      const raw = localStorage.getItem(FONT_ZOOM_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      setFontZoomPercentState(Number.isFinite(n) ? clampFontZoomPercent(n) : FONT_ZOOM_DEFAULT_PERCENT);
    } catch {
      setFontZoomPercentState(FONT_ZOOM_DEFAULT_PERCENT);
    }
  }, []);

  const applySiteTheme = useCallback((theme: SiteThemeId) => {
    if (theme === "default") document.documentElement.removeAttribute("data-site-theme");
    else document.documentElement.setAttribute("data-site-theme", theme);
  }, []);

  const setSiteTheme = useCallback((theme: SiteThemeId) => {
    setSiteThemeOverrideState(theme);
    applySiteTheme(theme);
    try { localStorage.setItem(SITE_THEME_KEY, theme); } catch { /* best-effort */ }
  }, [applySiteTheme]);

  const setIconSet = useCallback((set: IconSetId) => {
    setIconSetOverrideState(set);
    try { localStorage.setItem(ICON_SET_KEY, set); } catch { /* best-effort */ }
  }, []);

  const applyFontZoom = useCallback((percent: number) => {
    document.documentElement.style.setProperty("--font-zoom", String(percent / 100));
  }, []);

  const setFontZoomPercent = useCallback((percent: number) => {
    const clamped = clampFontZoomPercent(percent);
    setFontZoomPercentState(clamped);
    applyFontZoom(clamped);
    try { localStorage.setItem(FONT_ZOOM_KEY, String(clamped)); } catch { /* best-effort */ }
  }, [applyFontZoom]);

  const stepFontZoom = useCallback((direction: 1 | -1) => {
    setFontZoomPercent(nextFontZoomStep(fontZoomPercent, direction));
  }, [fontZoomPercent, setFontZoomPercent]);

  return {
    /** Actually-applied theme right now (device override, or the admin default). */
    siteTheme: siteThemeOverride ?? adminDefault.siteTheme,
    siteThemeOverride,
    setSiteTheme,
    iconSet: iconSetOverride ?? adminDefault.iconSet,
    iconSetOverride,
    setIconSet,
    fontZoomPercent,
    setFontZoomPercent,
    stepFontZoom,
    availableThemes: SITE_THEME_IDS,
    availableIconSets: ICON_SET_IDS,
  };
}

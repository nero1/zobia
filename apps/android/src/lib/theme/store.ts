/**
 * apps/android/src/lib/theme/store.ts
 *
 * Light/dark/system theme preference — the Android counterpart to
 * apps/web's `next-themes` usage in app/(app)/settings/page.tsx.
 *
 * Mirrors web's choice exactly: the UI theme is a *client-only* preference,
 * never sent to the server (web keeps it out of `/api/users/me/theme`,
 * which is reserved for the separate DB-backed Pro/Max chat-theme cosmetic —
 * see that file's comment). So this needs no new API call and works fully
 * offline, per this project's policy of minimising server round-trips.
 *
 * Persistence follows the same two-tier pattern as lib/i18n (language) and
 * lib/auth/secureTokenStore (tokens): a synchronous localStorage mirror so
 * the theme can be applied before first paint (no flash), with
 * @capacitor/preferences as the durable, native-backed store that survives
 * a WebView storage clear.
 */

import { Preferences } from '@capacitor/preferences';
import { SITE_THEME_IDS, ICON_SET_IDS, FONT_ZOOM_STEPS, type SiteThemeId, type IconSetId } from '@zobia/shared/utils';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'zobia_theme';
const VALID: ThemePreference[] = ['light', 'dark', 'system'];

// ---------------------------------------------------------------------------
// Site theme (Reddit/Facebook/Christmas re-skins) — separate axis from
// light/dark above. "site" means "follow the admin default from /api/manifest"
// (see lib/manifest/useUiManifest.ts); anything else is a per-device override.
// ---------------------------------------------------------------------------

const SITE_THEME_STORAGE_KEY = 'zobia_site_theme';
const FONT_ZOOM_STORAGE_KEY = 'zobia_font_zoom';

function isValidSiteTheme(v: unknown): v is SiteThemeId {
  return typeof v === 'string' && (SITE_THEME_IDS as readonly string[]).includes(v);
}

/** Applies (or clears, for "default") the `data-site-theme` attribute. Distinct from `data-theme` above, which carries the resolved light/dark value. */
export function applySiteTheme(theme: SiteThemeId | null): void {
  const root = document.documentElement;
  if (theme && theme !== 'default') {
    root.setAttribute('data-site-theme', theme);
  } else {
    root.removeAttribute('data-site-theme');
  }
}

export function getStoredSiteThemeSync(): SiteThemeId | null {
  try {
    const v = localStorage.getItem(SITE_THEME_STORAGE_KEY);
    return isValidSiteTheme(v) ? v : null;
  } catch {
    return null;
  }
}

export async function getStoredSiteTheme(): Promise<SiteThemeId | null> {
  try {
    const { value } = await Preferences.get({ key: SITE_THEME_STORAGE_KEY });
    if (isValidSiteTheme(value)) return value;
  } catch {
    // fall through
  }
  return getStoredSiteThemeSync();
}

/** `null` clears the per-device override, reverting to the admin default. */
export async function setStoredSiteTheme(theme: SiteThemeId | null): Promise<void> {
  try {
    if (theme) localStorage.setItem(SITE_THEME_STORAGE_KEY, theme);
    else localStorage.removeItem(SITE_THEME_STORAGE_KEY);
  } catch { /* private mode etc — non-fatal */ }
  try {
    if (theme) await Preferences.set({ key: SITE_THEME_STORAGE_KEY, value: theme });
    else await Preferences.remove({ key: SITE_THEME_STORAGE_KEY });
  } catch { /* non-fatal, offline-friendly */ }
}

// ---------------------------------------------------------------------------
// Icon set (emoji vs. mono/pro vector nav icons) — separate axis from
// light/dark and site theme above. "emoji" is the historical default;
// "mono" is the black-and-white lucide-react vector set (see
// components/ui/Icon.tsx). Admin-set default comes from /api/manifest
// (see lib/hooks/useManifest.ts useUiManifest); anything stored here is a
// per-device override, following the exact same pattern as site theme.
// ---------------------------------------------------------------------------

const ICON_SET_STORAGE_KEY = 'zobia_icon_set';

function isValidIconSet(v: unknown): v is IconSetId {
  return typeof v === 'string' && (ICON_SET_IDS as readonly string[]).includes(v);
}

export function getStoredIconSetSync(): IconSetId | null {
  try {
    const v = localStorage.getItem(ICON_SET_STORAGE_KEY);
    return isValidIconSet(v) ? v : null;
  } catch {
    return null;
  }
}

export async function getStoredIconSet(): Promise<IconSetId | null> {
  try {
    const { value } = await Preferences.get({ key: ICON_SET_STORAGE_KEY });
    if (isValidIconSet(value)) return value;
  } catch {
    // fall through
  }
  return getStoredIconSetSync();
}

/** `null` clears the per-device override, reverting to the admin default. */
export async function setStoredIconSet(iconSet: IconSetId | null): Promise<void> {
  try {
    if (iconSet) localStorage.setItem(ICON_SET_STORAGE_KEY, iconSet);
    else localStorage.removeItem(ICON_SET_STORAGE_KEY);
  } catch { /* private mode etc — non-fatal */ }
  try {
    if (iconSet) await Preferences.set({ key: ICON_SET_STORAGE_KEY, value: iconSet });
    else await Preferences.remove({ key: ICON_SET_STORAGE_KEY });
  } catch { /* non-fatal, offline-friendly */ }
}

// ---------------------------------------------------------------------------
// Font zoom (accessibility text scaling) — see shared/utils/uiThemes.ts.
// ---------------------------------------------------------------------------

function isValidFontZoom(v: unknown): v is number {
  return typeof v === 'number' && (FONT_ZOOM_STEPS as readonly number[]).includes(v);
}

/** Sets `--font-zoom` (a 1.0-based multiplier) on <html> from a whole percent (100 = 1.0). */
export function applyFontZoomPercent(percent: number): void {
  document.documentElement.style.setProperty('--font-zoom', String(percent / 100));
}

export function getStoredFontZoomSync(): number {
  try {
    const raw = localStorage.getItem(FONT_ZOOM_STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return isValidFontZoom(n) ? n : 100;
  } catch {
    return 100;
  }
}

export async function getStoredFontZoom(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: FONT_ZOOM_STORAGE_KEY });
    const n = value ? parseInt(value, 10) : NaN;
    if (isValidFontZoom(n)) return n;
  } catch {
    // fall through
  }
  return getStoredFontZoomSync();
}

export async function setStoredFontZoom(percent: number): Promise<void> {
  try { localStorage.setItem(FONT_ZOOM_STORAGE_KEY, String(percent)); } catch { /* non-fatal */ }
  try { await Preferences.set({ key: FONT_ZOOM_STORAGE_KEY, value: String(percent) }); } catch { /* non-fatal */ }
}

function isValidTheme(v: unknown): v is ThemePreference {
  return typeof v === 'string' && (VALID as string[]).includes(v);
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

/** Applies the resolved theme to <html> so Tailwind's `dark:` variant (darkMode: "class") picks it up. */
export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.setAttribute('data-theme', resolved);
}

/** Synchronous best-effort read for applying a theme before the first paint. */
export function getStoredThemeSync(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isValidTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Authoritative read from Capacitor Preferences (native storage), falling back to the localStorage mirror. */
export async function getStoredTheme(): Promise<ThemePreference> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (isValidTheme(value)) return value;
  } catch {
    // fall through to localStorage mirror
  }
  return getStoredThemeSync();
}

export async function setStoredTheme(pref: ThemePreference): Promise<void> {
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* private mode etc — non-fatal */ }
  try { await Preferences.set({ key: STORAGE_KEY, value: pref }); } catch { /* non-fatal, offline-friendly */ }
}

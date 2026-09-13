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

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'zobia_theme';
const VALID: ThemePreference[] = ['light', 'dark', 'system'];

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

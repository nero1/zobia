/**
 * shared/utils/uiThemes.ts
 *
 * Sitewide UI theme, icon-set and font-zoom vocabulary shared by the web
 * app/PWA (apps/web) and the Capacitor Android app (apps/android). This is a
 * DIFFERENT layer from `lib/profile/themes.ts` / `lib/blogs/themes.ts` (those
 * are per-user purchasable cosmetic color skins for one page each). A "site
 * theme" here is an admin-set-by-default, optionally per-device-overridden
 * skin for the WHOLE app shell — applied as `data-theme="<id>"` on
 * `<html>`, consumed by CSS variable overrides in globals.css. It rides the
 * existing neutral/primary Tailwind scale (see shared/tailwind-tokens.js),
 * which is itself CSS-variable-backed, so switching a theme id re-colors
 * every `bg-neutral-*` / `text-neutral-*` / `border-neutral-*` utility class
 * already used across the codebase — no per-component changes needed.
 *
 * Font zoom is a separate, orthogonal user preference (accessibility text
 * scaling), applied as the `--font-zoom` CSS variable on `<html>`.
 */

export const SITE_THEME_IDS = ["default", "reddit", "facebook", "christmas"] as const;
export type SiteThemeId = (typeof SITE_THEME_IDS)[number];

export interface SiteThemeMeta {
  id: SiteThemeId;
  labelKey: string;
  descriptionKey: string;
}

export const SITE_THEMES: SiteThemeMeta[] = [
  { id: "default", labelKey: "settings.siteTheme.default.label", descriptionKey: "settings.siteTheme.default.description" },
  { id: "reddit", labelKey: "settings.siteTheme.reddit.label", descriptionKey: "settings.siteTheme.reddit.description" },
  { id: "facebook", labelKey: "settings.siteTheme.facebook.label", descriptionKey: "settings.siteTheme.facebook.description" },
  { id: "christmas", labelKey: "settings.siteTheme.christmas.label", descriptionKey: "settings.siteTheme.christmas.description" },
];

export function isSiteThemeId(value: unknown): value is SiteThemeId {
  return typeof value === "string" && (SITE_THEME_IDS as readonly string[]).includes(value);
}

/** "site" = follow the admin-set platform default; anything else is a per-device override. */
export const SITE_THEME_FOLLOW_DEFAULT = "site" as const;

// ---------------------------------------------------------------------------
// Icon sets
// ---------------------------------------------------------------------------

export const ICON_SET_IDS = ["emoji", "mono"] as const;
export type IconSetId = (typeof ICON_SET_IDS)[number];

export interface IconSetMeta {
  id: IconSetId;
  labelKey: string;
  descriptionKey: string;
}

export const ICON_SETS: IconSetMeta[] = [
  { id: "emoji", labelKey: "settings.iconSet.emoji.label", descriptionKey: "settings.iconSet.emoji.description" },
  { id: "mono", labelKey: "settings.iconSet.mono.label", descriptionKey: "settings.iconSet.mono.description" },
];

export function isIconSetId(value: unknown): value is IconSetId {
  return typeof value === "string" && (ICON_SET_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Font zoom
// ---------------------------------------------------------------------------

/** Percent values the +/- stepper cycles through. 100% is the (already +30%-bumped) baseline. */
export const FONT_ZOOM_STEPS = [70, 80, 90, 100, 110, 125, 140, 160, 180, 200] as const;
export const FONT_ZOOM_DEFAULT_PERCENT = 100;

export function clampFontZoomPercent(percent: number): number {
  let closest = FONT_ZOOM_STEPS[0];
  let closestDiff = Math.abs(percent - closest);
  for (const step of FONT_ZOOM_STEPS) {
    const diff = Math.abs(percent - step);
    if (diff < closestDiff) {
      closest = step;
      closestDiff = diff;
    }
  }
  return closest;
}

export function nextFontZoomStep(currentPercent: number, direction: 1 | -1): number {
  const idx = FONT_ZOOM_STEPS.indexOf(clampFontZoomPercent(currentPercent) as (typeof FONT_ZOOM_STEPS)[number]);
  const nextIdx = Math.min(FONT_ZOOM_STEPS.length - 1, Math.max(0, idx + direction));
  return FONT_ZOOM_STEPS[nextIdx];
}

// ---------------------------------------------------------------------------
// Per-device localStorage scoping (mirrors lib/hooks/useNewMemberQuestDismissal
// on web: `zobia:<feature>:<userId>`, best-effort, never leaks across users of
// a shared device).
// ---------------------------------------------------------------------------

const DEVICE_SCOPE = "device";

/** `userId` may be omitted for guests — falls back to a shared "device" bucket. */
export function siteThemeStorageKey(userId?: string | null): string {
  return `zobia:site-theme:${userId ?? DEVICE_SCOPE}`;
}

export function iconSetStorageKey(userId?: string | null): string {
  return `zobia:icon-set:${userId ?? DEVICE_SCOPE}`;
}

export function fontZoomStorageKey(userId?: string | null): string {
  return `zobia:font-zoom:${userId ?? DEVICE_SCOPE}`;
}

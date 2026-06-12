/**
 * lib/i18n/rtl.ts
 *
 * RTL (Right-to-Left) utilities for the Zobia Social web app.
 *
 * Arabic is the only RTL language currently supported.
 * Add additional RTL locales to RTL_LOCALES as needed.
 *
 * Usage:
 *   import { isRTL, getTextAlign, getFlexDirection } from '@/lib/i18n/rtl';
 *
 *   const dir = isRTL('ar') ? 'rtl' : 'ltr';
 *   <div dir={dir} style={{ textAlign: getTextAlign('ar') }}>…</div>
 */

import type { SupportedLocale } from "./locales";

/** Set of locales that render right-to-left. */
const RTL_LOCALES: ReadonlySet<string> = new Set(["ar"]);

/**
 * Returns true when the given locale is a right-to-left language.
 *
 * @param locale - BCP-47 locale code (e.g. "ar", "en", "fr")
 * @returns `true` for RTL locales, `false` otherwise
 *
 * @example
 * isRTL("ar"); // true
 * isRTL("en"); // false
 */
export function isRTL(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}

/**
 * Returns the CSS `text-align` value appropriate for the locale.
 *
 * @param locale - BCP-47 locale code
 * @returns `"right"` for RTL locales, `"left"` for LTR locales
 *
 * @example
 * getTextAlign("ar"); // "right"
 * getTextAlign("fr"); // "left"
 */
export function getTextAlign(locale: string): "right" | "left" {
  return isRTL(locale) ? "right" : "left";
}

/**
 * Returns the CSS `flex-direction` value appropriate for the locale.
 * Use this for horizontal flex containers whose children should reverse
 * in RTL layouts (e.g. icon + label pairs).
 *
 * @param locale - BCP-47 locale code
 * @returns `"row-reverse"` for RTL locales, `"row"` for LTR locales
 *
 * @example
 * getFlexDirection("ar"); // "row-reverse"
 * getFlexDirection("sw"); // "row"
 */
export function getFlexDirection(locale: string): "row-reverse" | "row" {
  return isRTL(locale) ? "row-reverse" : "row";
}

/**
 * Returns the HTML `dir` attribute value for the locale.
 * Apply this to the root `<html>` or container element.
 *
 * @param locale - BCP-47 locale code
 * @returns `"rtl"` for RTL locales, `"ltr"` for LTR locales
 *
 * @example
 * <html dir={getDir(locale)} lang={locale}>
 */
export function getDir(locale: string): "rtl" | "ltr" {
  return isRTL(locale) ? "rtl" : "ltr";
}

/**
 * Returns a style object suitable for spreading onto a React element.
 * Includes `direction`, `textAlign`, and for flex containers `flexDirection`.
 *
 * @param locale        - BCP-47 locale code
 * @param isFlex        - Set to `true` for elements that use `display: flex`
 * @returns Partial CSS properties object
 *
 * @example
 * <div style={getLocaleStyle("ar", true)}>…</div>
 */
export function getLocaleStyle(
  locale: string,
  isFlex = false
): React.CSSProperties {
  const rtl = isRTL(locale);
  return {
    direction: rtl ? "rtl" : "ltr",
    textAlign: rtl ? "right" : "left",
    ...(isFlex && { flexDirection: rtl ? "row-reverse" : "row" }),
  };
}

// Re-export for convenience
export type { SupportedLocale };

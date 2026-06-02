/**
 * apps/expo/lib/i18n/rtl.ts
 *
 * React Native RTL utilities for Zobia Social.
 *
 * Arabic requires the app to be laid out right-to-left.
 * Call `setupRTL(locale)` once during app startup (before the first render)
 * whenever you change language, then restart/reload the app or use
 * React Native's `RCTReloadCommand` to apply the change.
 *
 * Usage:
 *   import { setupRTL, isRTL } from '@/lib/i18n/rtl';
 *
 *   // In your root component or i18n init:
 *   setupRTL(currentLocale);
 */

import { I18nManager } from "react-native";

/** Locales that require right-to-left layout. */
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
 * Configures React Native's global RTL setting for the given locale.
 *
 * - Calls `I18nManager.forceRTL(true)` for Arabic.
 * - Calls `I18nManager.forceRTL(false)` for all other locales.
 *
 * NOTE: React Native requires an app reload for the RTL change to take full
 * effect (including native-side mirroring of icons, navigators, etc.).
 * You may call `Updates.reloadAsync()` (Expo Updates) after this if the
 * locale changes at runtime.
 *
 * @param locale - BCP-47 locale code of the language being activated
 *
 * @example
 * // During app startup, after resolving the user's preferred locale:
 * setupRTL("ar"); // enables RTL globally
 * setupRTL("en"); // disables RTL globally
 */
export function setupRTL(locale: string): void {
  const shouldBeRTL = isRTL(locale);
  // Only update if the current setting differs to avoid unnecessary reloads.
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.forceRTL(shouldBeRTL);
  }
}

/**
 * Returns a React Native `StyleSheet`-compatible style snippet for text
 * alignment based on the locale.
 *
 * @param locale - BCP-47 locale code
 * @returns Object with `textAlign` property
 *
 * @example
 * <Text style={[styles.label, getTextAlignStyle("ar")]}>…</Text>
 */
export function getTextAlignStyle(locale: string): { textAlign: "right" | "left" } {
  return { textAlign: isRTL(locale) ? "right" : "left" };
}

/**
 * Returns a React Native flex-direction value for row containers.
 * Use when you want icon+label pairs to mirror in RTL.
 *
 * @param locale - BCP-47 locale code
 * @returns `"row-reverse"` for RTL, `"row"` for LTR
 *
 * @example
 * <View style={{ flexDirection: getFlexDirection("ar") }}>
 *   <Icon /><Text>Label</Text>
 * </View>
 */
export function getFlexDirection(locale: string): "row-reverse" | "row" {
  return isRTL(locale) ? "row-reverse" : "row";
}

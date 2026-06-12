/**
 * lib/i18n/index.ts
 *
 * i18next initialisation for the web app.
 *
 * Supports:
 *   - Browser language detection
 *   - Lazy-loaded locale JSON files
 *   - Fallback to English
 *
 * Usage (in client components):
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *
 * Usage (in server contexts):
 *   import { getServerTranslation } from '@/lib/i18n';
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";

// ---------------------------------------------------------------------------
// Supported locales — re-exported from the server-safe constants module
// ---------------------------------------------------------------------------

export { SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_LOCALE } from "./locales";
export type { SupportedLocale } from "./locales";

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise i18next.
 * Called once at app startup (in the root layout / providers).
 * Safe to call multiple times – subsequent calls are no-ops.
 */
export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return;

  await i18n
    .use(LanguageDetector)
    .use(resourcesToBackend(
      (language: string, namespace: string) =>
        import(`./locales/${language}.json`).catch(() =>
          import(`./locales/en.json`)
        )
    ))
    .use(initReactI18next)
    .init({
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: SUPPORTED_LOCALES,
      defaultNS: "translation",
      ns: ["translation"],
      detection: {
        order: ["querystring", "cookie", "localStorage", "navigator"],
        caches: ["localStorage", "cookie"],
        lookupQuerystring: "lang",
        lookupCookie: "zobia_lang",
        lookupLocalStorage: "zobia_lang",
      },
      interpolation: {
        // React already handles XSS
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });
}

export default i18n;

// ---------------------------------------------------------------------------
// Server-side helper
// ---------------------------------------------------------------------------

/**
 * Minimal server-side translation helper for RSC / Route Handlers.
 * Loads the given locale's JSON directly (no browser detection).
 *
 * @param locale - Target locale (defaults to 'en')
 * @returns A `t(key)` function
 */
export async function getServerTranslation(
  locale: SupportedLocale = DEFAULT_LOCALE
): Promise<(key: string, options?: Record<string, unknown>) => string> {
  let messages: Record<string, string>;
  try {
    messages = (await import(`./locales/${locale}.json`)) as unknown as Record<string, string>;
  } catch {
    messages = (await import(`./locales/en.json`)) as unknown as Record<string, string>;
  }

  return (key: string) => messages[key] ?? key;
}

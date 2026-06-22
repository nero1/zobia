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

import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type SupportedLocale } from "./locales";
export { SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_LOCALE } from "./locales";
export type { SupportedLocale } from "./locales";

// The default-locale (English) bundle is imported statically so it is available
// synchronously at module-evaluation time. This guarantees i18next is fully
// initialised on the very FIRST render — on both the server and the client —
// which is essential for two reasons:
//   1. No raw translation keys flash before the async JSON finishes loading.
//   2. `i18n.isInitialized` is identical (true) on the server and the client,
//      so the React tree renders the same thing on both sides. A value that
//      differed between SSR (warm server → true) and the client (fresh → false)
//      previously produced a hydration mismatch directly under <main>, which
//      React recovered from by appending a second copy of the whole app —
//      the "duplicate screen on scroll" bug.
import enTranslation from "./locales/en.json";

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Configure and initialise the shared i18next singleton.
 *
 * Initialisation is SYNCHRONOUS (`initImmediate: false`) with English bundled
 * inline; every other locale is lazy-loaded on demand via resourcesToBackend
 * (`partialBundledLanguages: true`). Idempotent — safe to call repeatedly.
 */
function setupI18n(): void {
  if (i18n.isInitialized) return;

  i18n
    .use(LanguageDetector)
    .use(resourcesToBackend(
      (language: string, namespace: string) =>
        import(`./locales/${language}.json`).catch(() =>
          import(`./locales/en.json`)
        )
    ))
    .use(initReactI18next)
    .init({
      // English is available immediately; other locales load lazily.
      resources: { [DEFAULT_LOCALE]: { translation: enTranslation } },
      partialBundledLanguages: true,
      // Synchronous init so i18n.isInitialized is true on the first render.
      initImmediate: false,
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

// Initialise eagerly at module load.
setupI18n();

/**
 * Initialise i18next.
 * Retained for backwards compatibility — initialisation now happens eagerly at
 * module load, so this simply ensures setup has run and resolves immediately.
 */
export async function initI18n(): Promise<void> {
  setupI18n();
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
  let messages: Record<string, unknown>;
  try {
    messages = (await import(`./locales/${locale}.json`)) as unknown as Record<string, unknown>;
  } catch {
    messages = (await import(`./locales/en.json`)) as unknown as Record<string, unknown>;
  }

  // BUG-I18N-02: support dot-notation nested keys (e.g. "errors.network")
  // Falls back to flat lookup first so existing flat keys still work.
  function resolve(key: string): string {
    if (key in messages) return messages[key] as string;
    const parts = key.split(".");
    let node: unknown = messages;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return key;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : key;
  }

  return (key: string, options?: Record<string, unknown>) => {
    let value = resolve(key);
    if (options) {
      for (const [k, v] of Object.entries(options)) {
        value = value.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return value;
  };
}

/**
 * lib/i18n/server.ts
 *
 * Server-safe translation helper for RSC / Route Handlers — deliberately has
 * NO dependency on 'react-i18next' or its `initReactI18next` plugin.
 *
 * Root cause this avoids: lib/i18n/index.ts calls `i18n.use(initReactI18next)`
 * as a top-level module side effect (so the client-side singleton is ready on
 * first render). `initReactI18next` internally calls `React.createContext(...)`
 * to build its I18nContext. React Server Components are bundled against
 * React's "react-server" condition, which does not provide `createContext` —
 * Context is fundamentally a client-rendering concept. Any Server Component
 * that imported `getServerTranslation` from `@/lib/i18n` therefore pulled in
 * that context-creation code and crashed at build time with
 * "(0, d.createContext) is not a function" while Next collected page data
 * for /help and /help/[category].
 *
 * This module loads the target locale's JSON directly and does plain
 * key lookup — no i18next singleton, no React, safe to import from any
 * Server Component.
 */

import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type SupportedLocale } from "./locales";

export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./locales";
export type { SupportedLocale } from "./locales";

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

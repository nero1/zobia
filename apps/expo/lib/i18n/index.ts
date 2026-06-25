/**
 * Zobia Social — i18n initialisation.
 *
 * Import this module once (side-effect) in the root layout:
 *   import '@/lib/i18n';
 *
 * Uses i18next + react-i18next with a local English resource bundle.
 * Falls back to English when the device locale is not supported.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { MMKV } from 'react-native-mmkv';

import { setupRTL } from './rtl';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import ha from './locales/ha.json';
import sw from './locales/sw.json';
import am from './locales/am.json';
import zu from './locales/zu.json';
import pt from './locales/pt.json';
import pidgin from './locales/pidgin.json';

/** Supported locale codes. */
export type SupportedLocale = 'en' | 'fr' | 'ar' | 'ha' | 'sw' | 'am' | 'zu' | 'pt' | 'pidgin';

const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'fr', 'ar', 'ha', 'sw', 'am', 'zu', 'pt', 'pidgin'];

/** Derive the best supported locale: user preference → device locale → English. */
function resolveLocale(): SupportedLocale {
  // Check user's saved language preference (needed for locales with no OS equivalent, e.g. Pidgin)
  try {
    const prefStore = new MMKV({ id: 'zobia_prefs' });
    const saved = prefStore.getString('user_language') as SupportedLocale | undefined;
    if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  } catch {
    // MMKV unavailable during first launch — fall through to device locale
  }
  const deviceLocales = Localization.getLocales();
  for (const locale of deviceLocales) {
    const lang = locale.languageCode as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(lang)) {
      return lang;
    }
  }
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      ar: { translation: ar },
      ha: { translation: ha },
      sw: { translation: sw },
      am: { translation: am },
      zu: { translation: zu },
      pt: { translation: pt },
      pidgin: { translation: pidgin },
    },
    lng: resolveLocale(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    compatibilityJSON: 'v4',
  });

// Apply RTL layout for Arabic immediately after init, before first render.
setupRTL(i18n.language);

// Keep RTL in sync if the language changes at runtime.
i18n.on('languageChanged', (lng) => {
  setupRTL(lng);
});

export default i18n;

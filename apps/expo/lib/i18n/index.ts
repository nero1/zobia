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

import { setupRTL } from './rtl';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import ha from './locales/ha.json';
import sw from './locales/sw.json';
import am from './locales/am.json';
import zu from './locales/zu.json';
import pt from './locales/pt.json';

/** Supported locale codes. */
export type SupportedLocale = 'en' | 'fr' | 'ar' | 'ha' | 'sw' | 'am' | 'zu' | 'pt';

const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'fr', 'ar', 'ha', 'sw', 'am', 'zu', 'pt'];

/** Derive the best supported locale from the device's preferred locales. */
function resolveLocale(): SupportedLocale {
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
    },
    lng: resolveLocale(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
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

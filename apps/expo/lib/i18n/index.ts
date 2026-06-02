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

import en from './locales/en.json';

/** Supported locale codes. Extend as new translations are added. */
export type SupportedLocale = 'en';

const SUPPORTED_LOCALES: SupportedLocale[] = ['en'];

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
    },
    lng: resolveLocale(),
    fallbackLng: 'en',
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },
    compatibilityJSON: 'v4',
  });

export default i18n;

/**
 * apps/android/src/lib/i18n/index.ts
 *
 * Adapted from apps/expo/lib/i18n/index.ts.
 * Changes:
 *  - expo-localization → navigator.language / navigator.languages (browser API)
 *  - MMKV → @capacitor/preferences (key: 'zobia_lang')
 *  - I18nManager (React Native RTL) → document.dir (web RTL)
 *  - Loads locale files from shared/i18n/locales/
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { Preferences } from '@capacitor/preferences';

// Import locale JSONs from shared package
import en from '../../../shared/i18n/locales/en.json';
import fr from '../../../shared/i18n/locales/fr.json';
import ar from '../../../shared/i18n/locales/ar.json';
import ha from '../../../shared/i18n/locales/ha.json';
import sw from '../../../shared/i18n/locales/sw.json';
import am from '../../../shared/i18n/locales/am.json';
import zu from '../../../shared/i18n/locales/zu.json';
import pt from '../../../shared/i18n/locales/pt.json';
import pidgin from '../../../shared/i18n/locales/pidgin.json';

export type SupportedLocale = 'en' | 'fr' | 'ar' | 'ha' | 'sw' | 'am' | 'zu' | 'pt' | 'pidgin';
const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'fr', 'ar', 'ha', 'sw', 'am', 'zu', 'pt', 'pidgin'];

function applyRTL(lng: string): void {
  if (typeof document !== 'undefined') {
    document.dir = lng === 'ar' ? 'rtl' : 'ltr';
  }
}

try {
  i18n
    .use(LanguageDetector)
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
      // Detection order: localStorage ('zobia_lang') → navigator → 'en'
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'zobia_lang',
        caches: ['localStorage'],
      },
      supportedLngs: SUPPORTED_LOCALES,
      fallbackLng: 'en',
      initImmediate: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });

  applyRTL(i18n.language);
} catch (err) {
  console.warn('[i18n] initialisation failed; continuing with fallback', err);
}

i18n.on('languageChanged', (lng) => {
  applyRTL(lng);
  // Persist to Capacitor Preferences so it survives app restarts
  Preferences.set({ key: 'zobia_lang', value: lng }).catch(() => {});
  // Also persist to localStorage for LanguageDetector
  try { localStorage.setItem('zobia_lang', lng); } catch {}
});

/**
 * Load and apply the user's stored language preference.
 * Call once after app boot to overlay the device-locale default.
 */
export async function applyStoredLanguagePref(): Promise<void> {
  try {
    const { value: saved } = await Preferences.get({ key: 'zobia_lang' });
    if (saved && SUPPORTED_LOCALES.includes(saved as SupportedLocale) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // Key absent or Preferences not ready — keep current language.
  }
}

export default i18n;

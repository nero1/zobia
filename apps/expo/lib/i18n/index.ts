/**
 * Zobia Social — i18n initialisation.
 *
 * Import this module once (side-effect) in the root layout:
 *   import '@/lib/i18n';
 *
 * Two-phase language resolution (L-2 fix):
 *  Phase 1 (module init, synchronous): use device locale only, so this module
 *    never touches MMKV before initStore() has run.
 *  Phase 2 (after initStore() completes): call applyStoredLanguagePref() from
 *    _layout.tsx to overlay the user's saved preference from the encrypted store.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';

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

/**
 * Phase 1: derive best locale from device settings only.
 * Must not touch MMKV — initStore() has not run yet at module evaluation time.
 */
function resolveDeviceLocale(): SupportedLocale {
  const deviceLocales = Localization.getLocales();
  for (const locale of deviceLocales) {
    const lang = locale.languageCode as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(lang)) return lang;
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
    lng: resolveDeviceLocale(),
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
// When the new language requires a different text direction, update I18nManager
// and reload the JS bundle so the layout engine picks up the new direction.
i18n.on('languageChanged', (lng) => {
  setupRTL(lng);
  const isRTL = lng === 'ar';
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.forceRTL(isRTL);
    // Reload the app so React Native rebuilds the native layout tree in the
    // correct direction. In development expo-updates is a no-op, so this only
    // fires in production/preview builds.
    Updates.reloadAsync().catch(() => {});
  }
});

/**
 * Phase 2: read the user's saved language preference from the encrypted MMKV
 * store and switch i18n to it if it differs from the device-locale default.
 *
 * Must be called AFTER initStore() has completed (e.g. in the useEffect inside
 * RootLayoutNav that awaits initStore()).  Safe to call multiple times.
 */
export function applyStoredLanguagePref(): void {
  try {
    // Lazy import so the store module is not evaluated at i18n module init time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getStorage, STORE_KEYS } = require('@/lib/offline/store') as typeof import('@/lib/offline/store');
    const storage = getStorage();
    const saved = storage.getString(STORE_KEYS.LANGUAGE_PREF) as SupportedLocale | undefined;
    if (saved && SUPPORTED_LOCALES.includes(saved) && saved !== i18n.language) {
      void i18n.changeLanguage(saved);
    }
  } catch {
    // initStore() not complete or key absent; keep current language.
  }
}

export default i18n;

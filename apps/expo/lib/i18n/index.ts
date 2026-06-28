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
import { Alert, I18nManager } from 'react-native';
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
  // WHITE-SCREEN GUARD: this runs at MODULE EVALUATION time (i18n is imported at
  // the top of app/_layout.tsx). expo-localization is a native module; if it is
  // not yet ready / throws on this device, an unguarded throw here aborts the
  // entire bundle's evaluation and strands the app on a blank screen before
  // React can mount. Default to English instead of crashing.
  try {
    const deviceLocales = Localization.getLocales();
    for (const locale of deviceLocales) {
      const lang = locale.languageCode as SupportedLocale;
      if (SUPPORTED_LOCALES.includes(lang)) return lang;
    }
  } catch (err) {
    console.warn('[i18n] Localization.getLocales() failed; defaulting to en', err);
  }
  return 'en';
}

// WHITE-SCREEN GUARD: wrap the whole init so a failure in i18next/RTL setup at
// module-evaluation time degrades to "untranslated keys" rather than a blank
// screen. The app must always boot.
try {
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
      compatibilityJSON: 'v3',
    });

  // Apply RTL layout for Arabic immediately after init, before first render.
  setupRTL(i18n.language);
} catch (err) {
  console.warn('[i18n] initialisation failed; continuing with fallback', err);
}

// Keep RTL in sync if the language changes at runtime.
// When the new language requires a different text direction, update I18nManager
// and reload the JS bundle so the layout engine picks up the new direction.
i18n.on('languageChanged', (lng) => {
  setupRTL(lng);
  const isRTL = lng === 'ar';
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.forceRTL(isRTL);
    // Reload the app so React Native rebuilds the native layout tree in the
    // correct direction. In Expo Go / dev client, Updates.isAvailable is false,
    // so we surface an Alert instead of calling the no-op reloadAsync.
    // Lazy require so expo-updates is not evaluated at module-init time.
    // isEnabled is the correct SDK ~0.25.0 (SDK 51) API; isAvailable does not exist.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require('expo-updates') as typeof import('expo-updates');
    if (Updates.isEnabled) {
      Updates.reloadAsync().catch(() => {});
    } else if (__DEV__) {
      Alert.alert(
        'RTL Change Pending',
        'Restart the dev server to apply the RTL layout change.',
      );
    }
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

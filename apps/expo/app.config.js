// Google test App IDs — safe to commit; they produce no real ads.
const ADMOB_TEST_ANDROID = 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_TEST_IOS = 'ca-app-pub-3940256099942544~1458002511';

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...((config.extra) ?? {}),
    APP_ENV: process.env.APP_ENV ?? 'development',
    API_BASE_URL: process.env.API_BASE_URL ?? 'https://zobia.vercel.app',
    WEB_BASE_URL: process.env.WEB_BASE_URL ?? 'https://zobia.vercel.app',
    REALTIME_PROVIDER: process.env.REALTIME_PROVIDER ?? 'ably',
  },
  android: {
    ...((config.android) ?? {}),
    // NOTE: Android SDK levels (compile/target/min) are NOT valid Expo config
    // keys — Expo silently ignores them here. They are set the only supported
    // way, via the `expo-build-properties` config plugin in app.json (currently
    // pinned to API 35). Do not re-add them here; it only creates confusion.
    softwareKeyboardLayoutMode: 'resize',
  },
  'react-native-google-mobile-ads': {
    android_app_id: process.env.ADMOB_APP_ID_ANDROID ?? ADMOB_TEST_ANDROID,
    ios_app_id: process.env.ADMOB_APP_ID_IOS ?? ADMOB_TEST_IOS,
  },
});

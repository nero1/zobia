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
});

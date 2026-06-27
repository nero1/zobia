// Google test App IDs — safe to commit; they produce no real ads.
const ADMOB_TEST_ANDROID = 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_TEST_IOS = 'ca-app-pub-3940256099942544~1458002511';

const easProjectId = process.env.EAS_PROJECT_ID;
if (!easProjectId && process.env.APP_VARIANT === 'production') {
  throw new Error('EAS_PROJECT_ID environment variable is required for production builds');
}

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) => {
  const projectId = easProjectId ?? config?.extra?.eas?.projectId ?? 'dev-placeholder';
  return {
  ...config,
  extra: {
    ...((config.extra) ?? {}),
    APP_ENV: process.env.APP_ENV ?? 'development',
    API_BASE_URL: process.env.API_BASE_URL ?? 'https://zobia.vercel.app',
    WEB_BASE_URL: process.env.WEB_BASE_URL ?? 'https://zobia.vercel.app',
    REALTIME_PROVIDER: process.env.REALTIME_PROVIDER ?? 'ably',
    eas: {
      projectId,
    },
  },
  android: {
    ...((config.android) ?? {}),
    targetSdkVersion: 36,
    compileSdkVersion: 36,
    minSdkVersion: 24,
    softwareKeyboardLayoutMode: 'resize',
  },
  'react-native-google-mobile-ads': {
    android_app_id: process.env.ADMOB_APP_ID_ANDROID ?? ADMOB_TEST_ANDROID,
    ios_app_id: process.env.ADMOB_APP_ID_IOS ?? ADMOB_TEST_IOS,
  },
  };
};

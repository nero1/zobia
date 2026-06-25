import type { ExpoConfig, ConfigContext } from 'expo/config';

// Google test App IDs — safe to commit; they produce no real ads.
const ADMOB_TEST_ANDROID = 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_TEST_IOS = 'ca-app-pub-3940256099942544~1458002511';

export default ({ config }: ConfigContext): ExpoConfig & {
  'react-native-google-mobile-ads'?: { android_app_id: string; ios_app_id: string };
} => ({
  ...config,
  'react-native-google-mobile-ads': {
    android_app_id: process.env.ADMOB_APP_ID_ANDROID || ADMOB_TEST_ANDROID,
    ios_app_id: process.env.ADMOB_APP_ID_IOS || ADMOB_TEST_IOS,
  },
});

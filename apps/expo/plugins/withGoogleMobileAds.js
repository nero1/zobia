const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const ADMOB_META_KEY = 'com.google.android.gms.ads.APPLICATION_ID';

const withGoogleMobileAds = (config, props) => {
  const options = props || config['react-native-google-mobile-ads'] || {};
  const { android_app_id, ios_app_id } = options;

  config = withAndroidManifest(config, (mod) => {
    const mainApp = mod.modResults.manifest.application[0];
    if (!mainApp['meta-data']) mainApp['meta-data'] = [];
    mainApp['meta-data'] = mainApp['meta-data'].filter(
      (m) => m.$?.['android:name'] !== ADMOB_META_KEY
    );
    if (android_app_id) {
      mainApp['meta-data'].push({
        $: { 'android:name': ADMOB_META_KEY, 'android:value': android_app_id },
      });
    }
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    if (ios_app_id) mod.modResults.GADApplicationIdentifier = ios_app_id;
    return mod;
  });

  return config;
};

module.exports = withGoogleMobileAds;

const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

const ADMOB_META_KEY = 'com.google.android.gms.ads.APPLICATION_ID';

const withGoogleMobileAds = (config, props) => {
  const options = props || config['react-native-google-mobile-ads'] || {};
  const { android_app_id, ios_app_id } = options;

  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    // Declare the `tools` namespace so we can use tools:replace below.
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const mainApp = manifest.application[0];
    if (!mainApp['meta-data']) mainApp['meta-data'] = [];
    mainApp['meta-data'] = mainApp['meta-data'].filter(
      (m) => m.$?.['android:name'] !== ADMOB_META_KEY
    );
    if (android_app_id) {
      mainApp['meta-data'].push({
        // react-native-google-mobile-ads' own AndroidManifest also declares
        // this meta-data (its value comes from the app.json config block).
        // tools:replace lets our env-aware value win the manifest merge so the
        // build doesn't fail when the two differ — e.g. the real AdMob app id
        // (from env) in production vs the app.json test id.
        $: {
          'android:name': ADMOB_META_KEY,
          'android:value': android_app_id,
          'tools:replace': 'android:value',
        },
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

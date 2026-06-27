const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * DISABLED — do not re-register this plugin in app.json.
 *
 * This plugin attempted to inject `android:windowOptOutEdgeToEdgeEnforcement=true`
 * into AppTheme to opt Android 16 (API 36) builds out of forced edge-to-edge.
 *
 * Two reasons it cannot be used:
 *
 * 1. BUILD FAILURE: AAPT2 rejects the attribute with
 *    "style attribute 'android:attr/windowOptOutEdgeToEdgeEnforcement' not found"
 *    because the EAS build image's android.jar does not include it (the attribute
 *    was finalised very late in the Android 16 SDK release cycle).
 *
 * 2. NO EFFECT: Per Android 16 docs, `windowOptOutEdgeToEdgeEnforcement` is only
 *    available to apps targeting API < 36. This app targets targetSdkVersion 36,
 *    so the opt-out is ignored by the OS even if the build succeeds.
 *
 * The correct long-term fix for Android 16 edge-to-edge is to fully embrace it:
 * - Keep react-native-safe-area-context wrapping all screens (already done).
 * - Use useSafeAreaInsets() for any UI that must avoid system bars.
 * - Once EAS provides a stable Expo SDK 52+ image, migrate to the
 *   expo-edge-to-edge package which handles this correctly.
 */
const withAndroidEdgeToEdge = (config) => {
  return withAndroidStyles(config, (mod) => {
    const styles = mod.modResults;

    if (!styles.resources || !Array.isArray(styles.resources.style)) {
      return mod;
    }

    const ATTR_NAME = 'android:windowOptOutEdgeToEdgeEnforcement';

    for (const style of styles.resources.style) {
      if (!style.$ || !style.$.name) continue;
      const name = style.$.name;
      if (
        name === 'AppTheme' ||
        name === 'AppTheme.NoActionBar' ||
        name === 'Theme.App' ||
        name === 'Theme.App.NoActionBar'
      ) {
        if (!Array.isArray(style.item)) style.item = [];
        const alreadySet = style.item.some(
          (item) => item.$ && item.$.name === ATTR_NAME
        );
        if (!alreadySet) {
          style.item.push({ $: { name: ATTR_NAME }, _: 'true' });
        }
      }
    }

    return mod;
  });
};

module.exports = withAndroidEdgeToEdge;

const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * Opts Android API 35+ builds out of the forced edge-to-edge window enforcement
 * (android:windowOptOutEdgeToEdgeEnforcement). Without this, Android 16 (API 36)
 * forces every app into full-screen edge-to-edge mode regardless of whether the
 * app handles window insets. Apps that are not adapted for this (or whose
 * frameworks — React Native, splash screen library — do not yet handle it
 * correctly) end up with a permanently blank white screen after launch because
 * the root view is sized or positioned incorrectly by the platform.
 *
 * The attribute is silently ignored on API < 35, so it is safe to include in the
 * base res/values/styles.xml without a version qualifier.
 *
 * Reference: https://developer.android.com/about/versions/16/behavior-changes-16#edge-to-edge
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
      // Target the generated AppTheme and any common variants Expo might produce.
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

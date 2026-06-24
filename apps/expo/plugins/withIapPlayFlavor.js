const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Fixes react-native-iap variant ambiguity (amazon vs play) by telling Gradle
 * to use the 'play' store flavor when the consumer doesn't specify one.
 */
const withIapPlayFlavor = (config) => {
  return withAppBuildGradle(config, (mod) => {
    const contents = mod.modResults.contents;

    const strategy = "missingDimensionStrategy 'store', 'play'";

    if (contents.includes(strategy)) {
      return mod;
    }

    mod.modResults.contents = contents.replace(
      /defaultConfig\s*\{/,
      `defaultConfig {\n        ${strategy}`
    );

    return mod;
  });
};

module.exports = withIapPlayFlavor;

const { withGradleProperties } = require('@expo/config-plugins');

const withKotlinFix = (config) => {
  return withGradleProperties(config, (mod) => {
    const props = mod.modResults;

    const setOrReplace = (key, value) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    // Suppress JVM target mismatch errors between modules compiled with different targets
    setOrReplace('kotlin.jvm.target.validation.mode', 'warning');

    return mod;
  });
};

module.exports = withKotlinFix;

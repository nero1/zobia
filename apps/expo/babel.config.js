/** @type {import('@babel/core').ConfigFunction} */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // NativeWind must come before reanimated
      'nativewind/babel',
      // Reanimated must be last
      'react-native-reanimated/plugin',
    ],
  };
};

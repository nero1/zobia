/** @type {import('@babel/core').ConfigFunction} */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      // --- Monorepo workaround (Expo SDK 51) ---------------------------------
      // babel-preset-expo only applies the expo-router transform when it can
      // resolve `expo-router` via require.resolve() *relative to its own install
      // location*. In this workspace, babel-preset-expo is hoisted to the repo
      // root (pulled in by `expo`), but `expo-router` is kept nested under
      // apps/expo/node_modules — it cannot hoist because react-native@0.74
      // strictly requires react@18.2.0 while the web app (Next.js 15) pins
      // react@18.3.1, so the Expo app gets its own react/expo-router subtree.
      //
      // Because the hoisted preset can't see the nested expo-router, its
      // detection fails silently and `process.env.EXPO_ROUTER_APP_ROOT` is left
      // un-inlined in expo-router/_ctx.*.js. Metro's `require.context` transform
      // then rejects the non-string argument and the release bundle fails with:
      //   "First argument of `require.context` should be a string"
      //
      // Applying the router transform explicitly fixes this. It is resolved from
      // this config's directory (apps/expo), so it loads the correct, version-
      // matched expo-router copy and inlines the app root (./app) itself. Running
      // it here is idempotent if the preset ever also adds it.
      require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
      // Reanimated must be last
      'react-native-reanimated/plugin',
    ],
  };
};

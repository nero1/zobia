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
      // DEFENSIVE GUARD: validate the plugin is a real function before inserting
      // it. If babel-preset-expo is upgraded and renames / moves this export, an
      // undefined entry would be silently ignored by Babel — EXPO_ROUTER_APP_ROOT
      // would not be inlined, require.context(undefined) would fail at runtime,
      // and AppRegistry.runApplication() would crash with n=0 (white screen, no
      // chip). Throwing here makes the build fail fast with a clear message
      // instead of shipping a broken APK.
      (() => {
        try {
          const mod = require('babel-preset-expo/build/expo-router-plugin');
          if (typeof mod.expoRouterBabelPlugin === 'function') return mod.expoRouterBabelPlugin;
          // Fallback: try expo-router's own babel entry (SDK 52+ may ship it there).
          try {
            const p = require('expo-router/babel');
            if (typeof p === 'function') return p;
            if (typeof p?.default === 'function') return p.default;
          } catch { /* not available */ }
          throw new Error(
            '[babel.config.js] expo-router Babel plugin not found in ' +
            'babel-preset-expo/build/expo-router-plugin — ' +
            'EXPO_ROUTER_APP_ROOT will not be inlined, causing n=0 at runtime.'
          );
        } catch (e) { throw e; }
      })(),
      // Reanimated must be last
      'react-native-reanimated/plugin',
    ],
  };
};

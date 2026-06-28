const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

// Monorepo roots: this app lives at apps/expo; shared code lives at <root>/shared.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Watch the workspace root so Metro picks up changes in `shared/` (imported via
// the `@zobia/shared/*` alias, e.g. @zobia/shared/utils for slug + referral helpers).
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

// Resolve modules from both the app's and the workspace root's node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The Expo app consumes the shared workspace package via plain directory
// subpaths only: `@zobia/shared/types` and `@zobia/shared/utils`, which map to
// shared/types/index.ts and shared/utils/index.ts. Those resolve fine under
// Metro's standard resolution, so we deliberately DO NOT enable
// `unstable_enablePackageExports`. On Expo SDK 51 that flag is opt-in and
// "unstable": turning it on globally changes resolution for every package and
// is a known cause of broken release bundles with native libs (a mis-resolved
// module throws at init → AppRegistry n=0 → white screen). The remapped
// exports (e.g. `@zobia/shared/schemas/auth` → schemas/api/auth.ts) are used
// only by the web app, which has its own bundler — so nothing here needs them.

// Apply NativeWind BEFORE attaching our resolveRequest hook so that if
// withNativeWind sets its own resolveRequest (for CSS module handling) we can
// compose with it rather than silently overwriting it.
const finalConfig = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});

// Force a single React instance across the entire monorepo bundle.
//
// WHY THIS IS NEEDED:
// The root package.json has `overrides: { "react": "18.3.1" }` (for the web
// app) while apps/expo/package.json declares `"react": "18.2.0"`. npm may
// install react@18.2.0 in apps/expo/node_modules AND react@18.3.1 at the
// workspace root. With nodeModulesPaths listing both, Metro resolves 'react'
// from apps/expo/node_modules for some modules and from the workspace root for
// others — bundling two separate React objects. The second copy is null/
// uninitialized when first accessed, causing the startup crash:
//   "TypeError: Cannot read property 'useMemo' of null"
//
// WHY WE ALSO COVER react/jsx-runtime AND react/jsx-dev-runtime:
// React 18 uses the automatic JSX transform: files with JSX import from
// 'react/jsx-runtime' (prod) or 'react/jsx-dev-runtime' (dev) rather than
// calling React.createElement directly. These are separate module strings that
// bypass the 'react' intercept. If Metro resolves them from a DIFFERENT react
// copy than the one pinned by the 'react' intercept, you get two React internal
// registries in the same bundle — hooks cross the registry boundary and the
// app crashes. Pinning both variants here ensures they come from the same
// physical package.
//
// WHY AFTER withNativeWind:
// withNativeWind may install its own resolveRequest hook for CSS module
// handling. Setting our hook last lets us compose with theirs: we intercept
// only 'react' and 'react-native' and delegate everything else to the hook
// withNativeWind installed (or to Metro's default resolver if withNativeWind
// didn't add one). If we set our hook first and withNativeWind overwrites it,
// React deduplication silently disappears and the bundle crashes with n=0
// (AppRegistry never registered) or "useMemo of null".
const REACT_PATH = path.dirname(require.resolve('react/package.json'));
const REACT_NATIVE_PATH = path.dirname(require.resolve('react-native/package.json'));

// FAIL-LOUD GUARD: react-native@0.74.5's renderer is built against React
// 18.2.x internals. If a future `npm install` ever hoists a different React
// (e.g. 18.3.1 from the web app) into the path this bundle resolves, the
// renderer reads mismatched React internals and the bundle throws during the
// earliest init — RN registers n=0 callable JS modules and
// AppRegistry.runApplication() fails with a silent white screen (no redbox).
// That failure mode is nearly impossible to diagnose from a release APK, so we
// convert it into an obvious build-time error here.
const RESOLVED_REACT_VERSION = require(path.join(REACT_PATH, 'package.json')).version;
if (!/^18\.2\./.test(RESOLVED_REACT_VERSION)) {
  throw new Error(
    `[metro.config.js] This Expo bundle resolved react@${RESOLVED_REACT_VERSION}, ` +
    `but react-native@0.74.5 requires react@18.2.x. A mismatched React causes a ` +
    `top-level init crash (AppRegistry n=0 / white screen). Keep apps/expo on ` +
    `react 18.2.0 and ensure the root package.json does NOT override "react".`
  );
}

const _prevResolveRequest = finalConfig.resolver?.resolveRequest;

finalConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') {
    return { filePath: path.join(REACT_PATH, 'index.js'), type: 'sourceFile' };
  }
  // Pin JSX runtime to the same React package to prevent a dual-instance split
  // when some files use the new automatic JSX transform (react/jsx-runtime).
  if (moduleName === 'react/jsx-runtime') {
    return { filePath: path.join(REACT_PATH, 'jsx-runtime.js'), type: 'sourceFile' };
  }
  if (moduleName === 'react/jsx-dev-runtime') {
    return { filePath: path.join(REACT_PATH, 'jsx-dev-runtime.js'), type: 'sourceFile' };
  }
  if (moduleName === 'react-native') {
    return { filePath: path.join(REACT_NATIVE_PATH, 'index.js'), type: 'sourceFile' };
  }
  if (_prevResolveRequest) {
    return _prevResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = finalConfig;

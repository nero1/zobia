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

// Force a SINGLE physical copy of both `react` and `react-native` into the
// monorepo bundle. This is the core defense against the recurring n=0
// white-screen crash.
//
// WHY THIS IS NEEDED:
// This is an npm workspace. `apps/expo` declares react@18.2.0 / react-native@
// 0.74.5, but the workspace root tree also resolves its own react@18.3.1 (web /
// Next.js) and a transitive react-native@0.74.0 (pulled by RN CLI tooling).
// With `nodeModulesPaths` listing both the app's and the root's node_modules,
// Metro can resolve these packages from two different physical locations within
// one bundle. Two copies of `react` → "Cannot read property 'useMemo' of null";
// two copies of `react-native` → two BatchedBridge instances, so the native
// side calls into one bridge while the app registers AppRegistry on the other
// and the launch crashes with "AppRegistry.runApplication() ... Registered
// callable JavaScript modules (n = 0)" — a silent white screen, no red box.
//
// The resolveRequest hook below pins `react`, `react-native`, AND ALL of their
// subpaths (e.g. react/jsx-runtime, react-native/Libraries/...) to the single
// canonical copy inside apps/expo. Covering subpaths is essential: deep imports
// from hoisted RN libraries bypass a bare-specifier intercept and are the path
// through which the second copy sneaks into the bundle.
//
// WHY AFTER withNativeWind:
// withNativeWind may install its own resolveRequest hook for CSS module
// handling. Setting our hook last lets us compose with theirs: we intercept
// react/react-native (+ subpaths) and delegate everything else to the hook
// withNativeWind installed (or to Metro's default resolver if it didn't add
// one). If we set our hook first and withNativeWind overwrote it, dedup would
// silently disappear and the bundle would crash with n=0 or "useMemo of null".
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

// Pin a package AND ALL of its subpaths to one physical copy.
//
// WHY SUBPATHS MATTER (this is the actual n=0 cause):
// Intercepting only the bare specifier ('react' / 'react-native') is not
// enough. This is an npm workspace and the lockfile can carry a second copy of
// react-native at the workspace root (a stale phantom + hoisted RN libs that
// import `react-native/Libraries/...`). Those deep subpath imports bypass a
// bare-specifier intercept and resolve from whichever node_modules comes first
// in `nodeModulesPaths`. The result is TWO react-native copies in one bundle =
// TWO BatchedBridge instances: native calls into bridge A while the app
// registers AppRegistry on bridge B, so native sees zero callable modules and
// crashes with "AppRegistry.runApplication() ... Registered callable
// JavaScript modules (n = 0)" — a silent white screen, no red box. The same
// split can happen to React via its deep imports. Forcing every `react/*` and
// `react-native/*` request to the single canonical package directory makes a
// dual-instance bundle impossible regardless of how npm hoists things.
//
// HOW: we rewrite the request to an absolute path inside the canonical package
// and delegate to the default resolver, so Metro still applies platform
// extensions (.android.js / .native.js), Haste, and asset handling correctly —
// which hard-coding `index.js` would silently skip.
const pinToCanonical = (context, moduleName, platform, pkg, baseDir) => {
  const subpath = moduleName === pkg ? '' : moduleName.slice(pkg.length); // '' or '/Libraries/...'
  return context.resolveRequest(context, baseDir + subpath, platform);
};

finalConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  // `react` and `react/<subpath>` (e.g. react/jsx-runtime, react/jsx-dev-runtime).
  // Guard against matching `react-native`, `react-dom`, etc. — only exact `react`
  // or a `react/` prefix qualifies.
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return pinToCanonical(context, moduleName, platform, 'react', REACT_PATH);
  }
  // `react-native` and `react-native/<subpath>`. `react-native-*` packages and
  // the scoped `@react-native/*` packages do NOT start with `react-native/`, so
  // they are correctly left alone.
  if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    return pinToCanonical(context, moduleName, platform, 'react-native', REACT_NATIVE_PATH);
  }
  if (_prevResolveRequest) {
    return _prevResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = finalConfig;

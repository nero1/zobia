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

// The shared workspace package is consumed via its package.json `exports` map
// (`@zobia/shared/utils`). Ensure Metro honours subpath exports.
// TODO: rename to enablePackageExports once Metro stabilises the API.
config.resolver.unstable_enablePackageExports = true;

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

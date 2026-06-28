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
// require.resolve() from this file's location (apps/expo/) follows Node's
// standard resolution and finds whichever copy npm actually installed first,
// then extraNodeModules pins ALL require('react') calls in the bundle to that
// single physical path so duplicates can never sneak in via nodeModulesPaths.
config.resolver.extraNodeModules = {
  react: path.dirname(require.resolve('react/package.json')),
  'react-native': path.dirname(require.resolve('react-native/package.json')),
};

// The shared workspace package is consumed via its package.json `exports` map
// (`@zobia/shared/utils`). Ensure Metro honours subpath exports.
// TODO: rename to enablePackageExports once Metro stabilises the API.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});

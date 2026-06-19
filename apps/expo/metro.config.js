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
config.watchFolders = [workspaceRoot];

// Resolve modules from both the app's and the workspace root's node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The shared workspace package is consumed via its package.json `exports` map
// (`@zobia/shared/utils`). Ensure Metro honours subpath exports.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});

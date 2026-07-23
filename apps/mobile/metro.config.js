// Metro config, monorepo-aware. Lets the app resolve the hoisted root
// node_modules and the local `@nook/core` workspace package.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so edits to packages/core hot-reload.
config.watchFolders = [workspaceRoot];

// Resolve modules from the app first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Avoid walking up past our two node_modules roots.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

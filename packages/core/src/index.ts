// Keep this entry Electron-free so format and deployment tools can also use it.
export const supportedLoaders = ['fabric', 'neoforge'] as const;

export type LoaderKind = (typeof supportedLoaders)[number];

export * as diagnostics from './diagnostics/index.js';
export * as testInstance from './instance/test-instance/index.js';

export * as releases from './releases/index.js';

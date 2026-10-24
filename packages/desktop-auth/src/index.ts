// Main-process API only. Never forward authentication results wholesale to a renderer.
export { LoopbackAuthenticationBrowser, type LoopbackBrowserOptions } from './browser';
export {
  createDesktopPublicJavaAuthenticator,
  type DesktopPublicJavaOptions,
} from './desktop';
export {
  DEVICE_CODE_LINK_URL,
  DeviceCodePresenter,
  type DeviceCodePresenterOptions,
} from './device-code';
export type { EncryptedAuthStoreOptions, SafeStorageBoundary } from './encrypted-store';
export { type HostAuthErrorCode, HostAuthenticationError } from './errors';
export { PublicJavaAuthenticator, type PublicJavaOptions } from './public-java';
export { EncryptedPublicJavaCache, type JavaCacheStore } from './public-java-cache';
export type { JavaCacheSnapshot } from './public-java-protocol';
export { EncryptedMicrosoftTokenStorage, type EncryptedTokenStorageOptions } from './storage';

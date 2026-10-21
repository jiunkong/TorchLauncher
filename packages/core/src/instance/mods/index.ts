export { USER_MOD_LIMITS, UserModError, type UserModErrorCode } from './errors.js';
export type { JarInfo, JarWarningCode } from './jar.js';
export { readJarInfo } from './jar.js';
export type { UserModRecord, UserModRegistry } from './registry.js';
export type {
  ModConflict,
  ModListEntry,
  ModListing,
  ModSource,
  ModState,
  RecoveryOutcome,
  RegisterUserModOptions,
  RemoveUnregisteredOptions,
  RemoveUserModOptions,
  UserModOptions,
  UserModPathOptions,
  UserModProgress,
  UserModRecovery,
  UserModRegistration,
  UserModRemoval,
  UserModWarning,
} from './service.js';
export {
  adoptUnregistered,
  listMods,
  recoverUserMods,
  registerUserMod,
  removeUnregistered,
  removeUserMod,
} from './service.js';

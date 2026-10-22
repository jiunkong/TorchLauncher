import type { DesktopApi } from '@torchlauncher/core/desktop';

export const productChannel = 'torchlauncher:product';
export const productStateChannel = 'torchlauncher:product-state';
export type ProductCommand =
  | {
      type:
        | 'status'
        | 'login'
        | 'refresh'
        | 'logout'
        | 'launch'
        | 'cancel'
        | 'stop'
        | 'inspect'
        | 'mods'
        | 'add-mod'
        | 'packs'
        | 'usage'
        | 'preview-delete';
    }
  | { type: 'remove-mod' | 'adopt-mod'; path: string }
  | { type: 'set-packs'; packs: string[] }
  | { type: 'set-close-on-launch'; value: boolean }
  | { type: 'set-game-memory'; maxMemoryMiB: number; initialMemoryMiB?: number }
  | { type: 'delete'; confirmation: string }
  | { type: 'recover'; acceptUncertain: boolean };
/** Structured activity only; totals stay unknown until measured, paths are relative. */
export interface ProductActivity {
  phase:
    | 'planning'
    | 'checking'
    | 'downloading'
    | 'staging'
    | 'publishing'
    | 'installing'
    | 'applying'
    | 'recovering';
  component:
    | 'metadata'
    | 'game'
    | 'java'
    | 'library'
    | 'asset'
    | 'logging'
    | 'loader'
    | 'server-mod'
    | 'resource-pack'
    | 'server-config'
    | 'server-file';
  path?: string;
  active: number;
  completed: number | null;
  total: number | null;
}
/** `launcher`: launcher events (codes only); `game`: sanitized game process output. */
export interface ProductLogEntry {
  source: 'launcher' | 'game';
  text: string;
}
export interface ProductState {
  preferences: {
    closeOnLaunch: boolean;
    maxMemoryMiB?: number;
    initialMemoryMiB?: number;
    error?: 'preferences-failed';
  };
  physicalMemoryMiB: number;
  server: { serverId: string; name: string; address: string } | null;
  configuration: 'ready' | 'unavailable';
  supported: boolean;
  account: { name: string; expiresAt: number } | null;
  status: {
    state: 'unknown' | 'online' | 'unavailable';
    online?: number;
    maximum?: number;
    latencyMs?: number;
    version?: string;
  };
  operation: string | null;
  phase: string;
  progress: { completed: number; total: number } | null;
  activity: ProductActivity | null;
  /** From the verified deployment index once a launch has read it; never carries addresses. */
  game?: { minecraftVersion: string; loader: 'fabric' | 'neoforge'; loaderVersion: string };
  running: boolean;
  /** Epoch ms when the game process started; present only while `running`. */
  runningSince?: number;
  outcome: string | null;
  error: string | null;
  mods: {
    path: string;
    source: 'operator' | 'user' | 'unregistered';
    state: string;
    conflicts: number;
    modIds: string[];
  }[];
  modsRecovery: boolean;
  packs: { id: string; required: boolean }[];
  missingPacks: string[];
  usage: { bytes: number; files: number; directories: number } | null;
  deletion: {
    root: string;
    deletable: boolean;
    blockers: string[];
    incomplete: boolean;
    bytes: number | null;
    confirmation: string | null;
  } | null;
  recovery: { needed: boolean; lock: string; confirmable: boolean; issues: string[] } | null;
  logs: ProductLogEntry[];
}
export type ProductResult =
  | { ok: true; state: ProductState }
  | { ok: false; error: string; state: ProductState };
export interface LauncherApi extends DesktopApi {
  getState(): Promise<ProductState>;
  command(command: ProductCommand): Promise<ProductResult>;
  onState(listener: (state: ProductState) => void): () => void;
}
/** Runtime validation: closed union and exact fields; privileged paths/URLs/commands have no input slot. */
export function parseProductCommand(input: unknown): ProductCommand {
  const fail = (): never => {
    throw new Error('invalid-request');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const value = input as Record<string, unknown>;
  const exact = (...keys: string[]) =>
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  const simple = [
    'status',
    'login',
    'refresh',
    'logout',
    'launch',
    'cancel',
    'stop',
    'inspect',
    'mods',
    'add-mod',
    'packs',
    'usage',
    'preview-delete',
  ];
  if (typeof value.type !== 'string') return fail();
  if (
    value.type === 'set-close-on-launch' &&
    exact('type', 'value') &&
    typeof value.value === 'boolean'
  )
    return value as ProductCommand;
  if (
    value.type === 'set-game-memory' &&
    (exact('type', 'maxMemoryMiB', 'initialMemoryMiB') || exact('type', 'maxMemoryMiB')) &&
    Number.isSafeInteger(value.maxMemoryMiB) &&
    (value.initialMemoryMiB === undefined || Number.isSafeInteger(value.initialMemoryMiB))
  )
    return value as ProductCommand;
  if (simple.includes(value.type) && exact('type')) return value as ProductCommand;
  if (
    (value.type === 'remove-mod' || value.type === 'adopt-mod') &&
    exact('type', 'path') &&
    typeof value.path === 'string' &&
    /^mods\/(?:[^/\\:]+\/)*[^/\\:]+\.jar$/i.test(value.path) &&
    value.path.length <= 512 &&
    !value.path.includes('..') &&
    !/[\p{Cc}\p{Cf}]/u.test(value.path)
  )
    return value as ProductCommand;
  if (
    value.type === 'set-packs' &&
    exact('type', 'packs') &&
    Array.isArray(value.packs) &&
    value.packs.length <= 256 &&
    value.packs.every(
      (id) =>
        typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(id),
    )
  )
    return value as ProductCommand;
  if (
    value.type === 'delete' &&
    exact('type', 'confirmation') &&
    typeof value.confirmation === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.confirmation)
  )
    return value as ProductCommand;
  if (
    value.type === 'recover' &&
    exact('type', 'acceptUncertain') &&
    typeof value.acceptUncertain === 'boolean'
  )
    return value as ProductCommand;
  return fail();
}

import type { ProductState } from '../../shared/product';

/** Product state fixture for renderer tests; override only what a case needs. */
export function productState(overrides: Partial<ProductState> = {}): ProductState {
  return {
    preferences: { closeOnLaunch: false },
    server: { serverId: 'id', name: 'Fixture Server', address: 'play.example.invalid:25565' },
    configuration: 'ready',
    supported: true,
    account: { name: 'Player', expiresAt: 1 },
    status: { state: 'online', online: 12, maximum: 50, latencyMs: 31 },
    operation: null,
    phase: 'idle',
    progress: null,
    activity: null,
    running: false,
    outcome: null,
    error: null,
    mods: [],
    modsRecovery: false,
    packs: [],
    missingPacks: [],
    usage: null,
    deletion: null,
    recovery: null,
    logs: [],
    ...overrides,
  };
}

import { vi } from 'vitest';
import type { StudioProject, StudioState, StudioTestRun } from '../../../../shared/studio.js';
import type { StudioController } from '../../hooks/useStudio';

export const project: StudioProject = {
  format: 'torchlauncher-project',
  version: 1,
  serverId: '44444444-4444-4444-8444-444444444444',
  name: 'Fixture server',
  address: 'play.example.org:25565',
  sourceUrl: '',
  game: { minecraftVersion: '1.21.1', loader: { kind: 'fabric', version: '0.19.5' } },
  files: [],
};

export const idleRun: StudioTestRun = {
  phase: 'idle',
  serverId: null,
  exit: null,
  progress: null,
  logs: [],
  truncated: false,
  report: null,
  mods: [],
  metadataErrors: [],
  extracted: null,
  configFiles: null,
  configPreview: null,
  configError: null,
  extractionError: null,
  error: null,
};

export interface FakeOptions {
  run?: Partial<StudioTestRun>;
  signedIn?: boolean;
  available?: boolean;
  sourceName?: string | null;
  project?: StudioProject;
  preset?: StudioState['preset'];
  busy?: boolean;
}

/** A controller with the parts the pages read; commands are spies so tests can prove none was sent. */
export function fakeStudio(options: FakeOptions = {}) {
  const current = options.project ?? project;
  const state = {
    account: {
      signedIn: options.signedIn ?? false,
      name: options.signedIn ? 'Player_Name' : null,
      available: options.available ?? true,
      error: null,
    },
    testRun: { ...idleRun, ...options.run },
    project: current,
    projectName: null,
    sourceName: options.sourceName === undefined ? 'source' : options.sourceName,
    dirty: false,
    busy: null,
    progress: 0,
    result: null,
    signing: null,
    files: {
      scannedAt: 0,
      entries: [],
      counts: {
        total: 40,
        totalBytes: 130 * 1024 * 1024,
        added: 0,
        modified: 0,
        removed: 0,
        excluded: 0,
        managed: 0,
        missing: 0,
      },
      truncated: false,
      skipped: 0,
    },
    deploy: null,
    urlCheck: null,
    export: null,
    preset: options.preset ?? null,
    policy: null,
  } as unknown as StudioState;
  const command = vi.fn(async () => true);
  const testCommand = vi.fn(async () => true);
  const studio = {
    state,
    draft: current,
    busy: options.busy ?? false,
    command,
    testCommand,
    run: vi.fn(async () => true),
    edit: vi.fn(),
    lastRun: null,
    message: '',
  } as unknown as StudioController;
  return { studio, command, testCommand, state };
}

/** Korean UI for rendering: the locale store reads this preference from localStorage. */
export function useKoreanLocale() {
  const stored = JSON.stringify({ mode: 'explicit', locale: 'ko' });
  const storage = { getItem: () => stored, setItem: () => undefined };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
}

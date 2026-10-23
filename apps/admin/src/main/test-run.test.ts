import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MinecraftAuthResult } from '@torchlauncher/core/auth';
import { AuthenticationError } from '@torchlauncher/core/auth';
import { HostAuthenticationError } from '@torchlauncher/desktop-auth';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { zip } from '../../../../packages/core/src/diagnostics/fixtures/zip.js';
import type { Installation } from '../../../../packages/core/src/minecraft/installer.js';
import type { GameExit, RunningGame } from '../../../../packages/core/src/minecraft/process.js';
import { testAuthText } from '../shared/test-auth-text.js';
import { emptySettings } from './game-settings.js';
import { handleStudioRequest } from './ipc.js';
import { type StudioDialogs, StudioService } from './studio.js';
import { StudioTestRunner, TEST_LOG_LIMIT, type TestRunHost } from './test-run.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const account: MinecraftAuthResult = {
  accessToken: 'synthetic-access-secret',
  expiresAt: Date.now() + 3_600_000,
  profile: { id: '0123456789abcdef0123456789abcdef', name: 'TestOperator' },
  userType: 'msa',
  clientId: 'synthetic-client',
};
async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'studio-test-run-'));
  roots.push(base);
  const source = join(base, 'source');
  await mkdir(source);
  await mkdir(join(source, 'mods'));
  await writeFile(
    join(source, 'mods/example.jar'),
    zip([
      { name: 'fabric.mod.json', data: '{"id":"example","version":"1.0","environment":"client"}' },
    ]),
  );
  await writeFile(join(source, 'options.txt'), 'version:3955\ngamma:0.5\n');
  const auth = {
    login: vi.fn<TestRunHost['auth']['login']>(async () => account),
    refresh: vi.fn<TestRunHost['auth']['refresh']>(async () => account),
    logout: vi.fn(async () => {}),
  };
  let finish: (exit: GameExit) => void = () => {};
  const finished = new Promise<GameExit>((resolve) => {
    finish = resolve;
  });
  const logs = {
    entries: [
      { stream: 'stdout' as const, text: 'Starting minecraft 1.21.1' },
      { stream: 'stdout' as const, text: `Setting user: ${account.profile.name}` },
    ],
    bytes: 100,
    droppedEntries: 0,
    discardedLines: 0,
  };
  const stop = vi.fn(async () => {
    const result: GameExit = { reason: 'stopped', code: 0, signal: null, logs };
    finish(result);
    return result;
  });
  const running: RunningGame = { pid: 123, finished, stop, getLogs: () => logs };
  const install = vi.fn<NonNullable<TestRunHost['install']>>(async (options) => {
    options.onActivity?.({
      phase: 'checking',
      component: 'game',
      active: 1,
      completed: 0,
      total: 2,
    });
    return { root: options.root } as Installation;
  });
  const launch = vi.fn<NonNullable<TestRunHost['launch']>>(async () => running);
  const host: TestRunHost = {
    userData: join(base, 'studio-data'),
    available: () => true,
    launcherVersion: '0.1.0',
    auth,
    install,
    launch,
  };
  const runner = new StudioTestRunner(host);
  const dialogs = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue(null),
    save: vi.fn<StudioDialogs['save']>().mockResolvedValue(null),
  };
  const service = new StudioService(dialogs, undefined, undefined, null, runner);
  await service.request({ action: 'new' });
  dialogs.open.mockResolvedValueOnce([source]);
  await service.request({ action: 'source' });
  await service.request({ action: 'filesPolicy', paths: ['mods/example.jar'], policy: 'always' });
  const project = service.snapshot().project;
  if (!project) throw new Error('Missing test project');
  const root = join(host.userData, 'test-instances', project.serverId);
  return {
    base,
    source,
    root,
    host,
    runner,
    service,
    install,
    launch,
    stop,
    auth,
    logs,
    finish,
    project,
  };
}
it('runs preparation, installation, sync, process, analysis and shared settings extraction without writing source', async () => {
  const h = await setup();
  const phases: string[] = [];
  h.install.mockImplementationOnce(async (options) => {
    phases.push(h.runner.state.phase);
    expect(options.version).toBe('1.21.1');
    await expect(h.service.request({ action: 'new', discard: true })).resolves.toEqual({
      ok: false,
      code: 'BUSY',
    });
    return { root: options.root } as Installation;
  });
  h.launch.mockImplementationOnce(async (_installed, options, control) => {
    expect(h.runner.state.phase).toBe('syncing');
    expect(options).not.toHaveProperty('quickPlayServer');
    expect(control?.terminationGraceMs).toBe(5000);
    await mkdir(join(h.root, 'config/nested'), { recursive: true });
    await mkdir(join(h.root, 'shaderpacks'), { recursive: true });
    await writeFile(
      join(h.root, 'options.txt'),
      'version:3955\ngamma:0.9\nkey_key.jump:key.keyboard.space\n',
    );
    await writeFile(join(h.root, 'config/example.properties'), 'quality=high\n');
    await writeFile(join(h.root, 'config/nested/detail.properties'), 'detail=true\n');
    await writeFile(
      join(h.root, 'config/iris.properties'),
      'enableShaders=true\nshaderPack=example.zip\n',
    );
    await writeFile(join(h.root, 'shaderpacks/example.zip.txt'), 'bloom=true\n');
    return {
      pid: 123,
      stop: h.stop,
      finished: new Promise<GameExit>((resolve) => {
        setTimeout(() => resolve({ reason: 'exited', code: 0, signal: null, logs: h.logs }), 20);
      }),
      getLogs: () => h.logs,
    };
  });
  expect(await h.service.request({ action: 'testStart' })).toMatchObject({
    ok: true,
    state: {
      testRun: {
        phase: 'done',
        error: null,
        extractionError: null,
        mods: [{ file: 'example.jar' }],
      },
    },
  });
  expect(phases).toEqual(['installing']);
  expect(h.service.snapshot().project?.gameSettings).toMatchObject({
    options: expect.arrayContaining([expect.objectContaining({ key: 'gamma', value: '0.9' })]),
    configFiles: expect.arrayContaining([
      expect.objectContaining({ path: 'config/example.properties' }),
      expect.objectContaining({ path: 'config/nested/detail.properties' }),
    ]),
    shader: { pack: { value: 'example.zip' } },
  });
  expect(h.runner.state.extracted?.optionCount).toBeGreaterThan(0);
  expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toBe('version:3955\ngamma:0.5\n');
  expect(JSON.stringify(h.service.snapshot())).not.toContain(account.accessToken);
  expect(JSON.stringify(h.runner.state)).not.toContain(account.profile.name);
});
it('preserves chosen settings policies when importing test-run files', async () => {
  const h = await setup();
  const settings = emptySettings();
  settings.options.push({ key: 'gamma', value: '0.5', policy: 'required' });
  h.project.gameSettings = settings;
  // Use the existing external import and command path to create a policy, then test-run extraction.
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue([h.source]),
    save: vi.fn<StudioDialogs['save']>(),
  };
  const service = new StudioService(d, undefined, undefined, null, h.runner);
  await service.request({ action: 'new' });
  await service.request({ action: 'source' });
  await service.request({ action: 'settingsImport', source: 'folder' });
  await service.request({
    action: 'settingsOptions',
    changes: [{ key: 'gamma', policy: 'required' }],
  });
  const root = join(h.host.userData, 'test-instances', service.snapshot().project?.serverId ?? '');
  h.launch.mockImplementationOnce(async () => {
    await writeFile(join(root, 'options.txt'), 'version:3955\ngamma:0.8\n');
    await h.stop();
    return {
      pid: 123,
      finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: h.logs }),
      stop: h.stop,
      getLogs: () => h.logs,
    };
  });
  expect(await service.request({ action: 'testStart' })).toMatchObject({ ok: true });
  expect(
    service.snapshot().project?.gameSettings?.options.find((o) => o.key === 'gamma'),
  ).toMatchObject({ value: '0.8', policy: 'required' });
});
it('cancels installation and forbids process spawn or reset while preparation is active', async () => {
  const h = await setup();
  h.install.mockImplementationOnce(
    (options) =>
      new Promise((_resolve, reject) =>
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      ),
  );
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.install).toHaveBeenCalledOnce());
  expect(await h.service.request({ action: 'testReset', confirmed: true })).toEqual({
    ok: false,
    code: 'BUSY',
  });
  await h.service.request({ action: 'testStop' });
  expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
  expect(h.launch).not.toHaveBeenCalled();
  expect(h.runner.state.error).toBe('cancelled');
});
it('stops and awaits the managed child on close, and bounds sanitized live logs', async () => {
  const h = await setup();
  h.logs.entries = Array.from({ length: TEST_LOG_LIMIT + 20 }, (_, i) => ({
    stream: 'stdout',
    text: `${i} ${account.accessToken} ${account.profile.name}`,
  }));
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.runner.state.phase).toBe('running'));
  await vi.waitFor(() => expect(h.runner.state.logs).toHaveLength(TEST_LOG_LIMIT));
  expect(JSON.stringify(h.runner.state.logs)).not.toContain(account.accessToken);
  await h.service.close();
  expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
  expect(h.stop).toHaveBeenCalled();
  expect(h.runner.state.truncated).toBe(true);
});
it('logs out during an interactive attempt, waits cancellation, and keeps renderer errors sanitized', async () => {
  const h = await setup();
  h.auth.login.mockImplementationOnce(
    (signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener(
          'abort',
          () => reject(new AuthenticationError('cancelled', 'browser')),
          { once: true },
        ),
      ),
  );
  const pending = h.service.request({ action: 'testLogin' });
  await vi.waitFor(() => expect(h.auth.login).toHaveBeenCalledOnce());
  expect(await h.service.request({ action: 'testLogout' })).toMatchObject({
    ok: true,
    state: { account: { signedIn: false } },
  });
  expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
  expect(h.auth.logout).toHaveBeenCalledOnce();
  h.host.available = () => false;
  h.auth.login.mockRejectedValueOnce(new HostAuthenticationError('secure_storage_unavailable'));
  expect(await h.service.request({ action: 'testLogin' })).toEqual({
    ok: false,
    code: 'ENCRYPTION_UNAVAILABLE',
  });
  expect(h.service.snapshot().account).toMatchObject({
    available: false,
    error: 'secure_storage_unavailable',
  });
});
it('requires exact IPC fields and trusted main frame before auth, reset or native selection', async () => {
  const h = await setup();
  for (const action of ['testLogin', 'testLogout', 'testStart', 'testStop']) {
    expect(await h.service.request({ action, path: h.source })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  }
  for (const confirmed of [false, 'true', 1, undefined])
    expect(await h.service.request({ action: 'testReset', confirmed })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  const frame = { url: 'file:///studio/index.html' };
  const contents = { mainFrame: frame } as unknown as WebContents;
  for (const input of [{ action: 'testLogin' }, { action: 'testReset', confirmed: true }]) {
    for (const [sender, senderFrame] of [
      [{}, frame],
      [contents, { ...frame }],
    ]) {
      expect(
        await handleStudioRequest(
          { sender, senderFrame } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
          contents,
          frame.url,
          h.service,
          input,
        ),
      ).toEqual({ ok: false, code: 'UNTRUSTED' });
    }
  }
  expect(h.auth.login).not.toHaveBeenCalled();
});
it('resets only the selected instance while preserving source, accounts and other projects', async () => {
  const h = await setup();
  await mkdir(h.root, { recursive: true });
  await writeFile(join(h.root, 'owned.txt'), 'delete');
  const other = join(h.host.userData, 'test-instances', 'other-instance');
  await mkdir(other);
  await writeFile(join(other, 'keep.txt'), 'keep');
  await mkdir(join(h.host.userData, 'public-java'));
  await writeFile(join(h.host.userData, 'public-java/cache'), 'synthetic-encrypted-cache');
  expect(await h.service.request({ action: 'testReset', confirmed: true })).toMatchObject({
    ok: true,
  });
  await expect(readFile(join(h.root, 'owned.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(other, 'keep.txt'), 'utf8')).toBe('keep');
  expect(await readFile(join(h.host.userData, 'public-java/cache'), 'utf8')).toBe(
    'synthetic-encrypted-cache',
  );
  expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toContain('gamma:0.5');
});
it.skipIf(process.platform === 'win32')('refuses reset through an instance symlink', async () => {
  const h = await setup();
  await mkdir(join(h.host.userData, 'test-instances'), { recursive: true });
  await symlink(h.source, h.root);
  expect(await h.service.request({ action: 'testReset', confirmed: true })).toMatchObject({
    ok: false,
  });
  expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toContain('gamma:0.5');
});
it('keeps main authentication text keys in parity', () => {
  expect(Object.keys(testAuthText.ko).sort()).toEqual(Object.keys(testAuthText.en).sort());
});

it('finishes analysis after a requested normal stop and clears old results on project replacement', async () => {
  const h = await setup();
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.runner.state.phase).toBe('running'));
  expect(await h.service.request({ action: 'testStop' })).toMatchObject({ ok: true });
  expect(await pending).toMatchObject({ ok: true });
  expect(h.runner.state).toMatchObject({ phase: 'done', exit: { reason: 'stopped' }, error: null });
  expect(h.runner.state.report?.items).toEqual([]);
  await h.service.request({ action: 'new', discard: true });
  expect(h.runner.state).toMatchObject({ phase: 'idle', report: null, serverId: null });
});
it('fails before installation on refresh failure and never publishes the provider exception', async () => {
  const h = await setup();
  h.auth.refresh.mockRejectedValueOnce(new Error('synthetic-private-provider-data'));
  expect(await h.service.request({ action: 'testStart' })).toEqual({ ok: false, code: 'IO' });
  expect(h.install).not.toHaveBeenCalled();
  expect(h.launch).not.toHaveBeenCalled();
  expect(h.runner.account.signedIn).toBe(false);
  expect(JSON.stringify(h.service.snapshot())).not.toContain('synthetic-private-provider-data');
});
it('rejects a candidate changed before the core pre-spawn guard', async () => {
  const h = await setup();
  h.launch.mockImplementationOnce(async (_installed, _options, control) => {
    await writeFile(join(h.root, 'mods/example.jar'), 'changed');
    await control?.preSpawn?.({ root: h.root, signal: new AbortController().signal });
    throw new Error('The guard should reject before spawn');
  });
  expect(await h.service.request({ action: 'testStart' })).toEqual({ ok: false, code: 'MISMATCH' });
  expect(h.runner.state.phase).toBe('failed');
});
it('redacts token fields even when the account name is itself a token-field name', async () => {
  const h = await setup();
  const identity = { ...account, profile: { ...account.profile, name: 'access_token' } };
  h.auth.refresh.mockResolvedValue(identity);
  h.logs.entries = [{ stream: 'stdout', text: 'access_token=synthetic-other-secret' }];
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.runner.state.phase).toBe('running'));
  await h.service.request({ action: 'testStop' });
  await pending;
  expect(JSON.stringify(h.runner.state)).not.toContain('synthetic-other-secret');
});

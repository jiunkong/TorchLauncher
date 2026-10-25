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
import { createProjectAt } from './fixtures/projects.js';
import { StudioService } from './fixtures/signing.js';
import { handleStudioRequest } from './ipc.js';
import { PROJECT_DATA_DIR } from './project-folder.js';
import type { StudioDialogs } from './studio.js';
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
  const projDir = join(base, 'proj');
  await mkdir(projDir);
  const source = join(projDir, PROJECT_DATA_DIR);
  const mod = join(base, 'example.jar');
  await writeFile(
    mod,
    zip([
      { name: 'fabric.mod.json', data: '{"id":"example","version":"1.0","environment":"client"}' },
    ]),
  );
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
    copy: vi.fn<NonNullable<StudioDialogs['copy']>>(),
  };
  const service = new StudioService(dialogs, undefined, undefined, undefined, runner);
  await createProjectAt(service, dialogs, projDir, {});
  await writeFile(join(source, 'options.txt'), 'version:3955\ngamma:0.5\n');
  dialogs.open.mockResolvedValueOnce([mod]);
  expect(await service.request({ action: 'settingsPackAdd', kind: 'mod' })).toMatchObject({
    ok: true,
  });
  const project = service.snapshot().project;
  if (!project) throw new Error('Missing test project');
  const root = join(host.userData, 'test-instances', project.serverId);
  return {
    base,
    dialogs,
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
it('keeps completed test extraction read-only until options are explicitly imported', async () => {
  const h = await setup();
  expect(await h.service.request({ action: 'save' })).toMatchObject({ ok: true });
  const before = h.service.snapshot();
  expect(before.dirty).toBe(false);
  const phases: string[] = [];
  h.install.mockImplementationOnce(async (options) => {
    phases.push(h.runner.state.phase);
    expect(options.version).toBe('1.21.1');
    await expect(h.service.request({ action: 'new', name: 'n', discard: true })).resolves.toEqual({
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
  expect(h.service.snapshot().project).toEqual(before.project);
  expect(h.service.snapshot().dirty).toBe(false);
  expect(h.service.snapshot().preset).toEqual(before.preset);
  expect(h.runner.state.extracted).toMatchObject({
    source: 'test',
    optionCount: 2,
    keybindCount: 1,
    otherOptionCount: 1,
    newConfigCount: 2,
  });
  expect(h.runner.state.configFiles?.map((file) => file.path)).toEqual([
    'config/example.properties',
    'config/nested/detail.properties',
  ]);
  expect(
    await h.service.request({ action: 'settingsImportOptions', source: 'test' }),
  ).toMatchObject({ ok: true, state: { dirty: true, preset: { source: 'test' } } });
  expect(h.service.snapshot().project?.gameSettings).toMatchObject({
    options: expect.arrayContaining([expect.objectContaining({ key: 'gamma', value: '0.9' })]),
  });
  expect(h.service.snapshot().project?.gameSettings?.configFiles).toBeUndefined();
  expect(h.service.snapshot().project?.gameSettings?.shader).toBeUndefined();
  expect(h.runner.state.extracted?.optionCount).toBeGreaterThan(0);
  expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toBe('version:3955\ngamma:0.5\n');
  expect(JSON.stringify(h.service.snapshot())).not.toContain(account.accessToken);
  expect(JSON.stringify(h.runner.state)).not.toContain(account.profile.name);
});
it('preserves chosen settings policies when importing test-run files', async () => {
  const h = await setup();
  await mkdir(join(h.source, 'config'));
  await writeFile(join(h.source, 'config/example.properties'), 'quality=high\n');
  await writeFile(join(h.source, 'config/iris.properties'), 'enableShaders=false\n');
  // Use the existing external import and command path to create a policy, then test-run extraction.
  const projDir2 = join(h.base, 'proj2');
  await mkdir(projDir2);
  const d = {
    open: vi.fn<StudioDialogs['open']>().mockResolvedValue([h.source]),
    save: vi.fn<StudioDialogs['save']>(),
  };
  const service = new StudioService(d, undefined, undefined, undefined, h.runner);
  await createProjectAt(service, d, projDir2, {});
  d.open.mockResolvedValueOnce([h.source]);
  await service.request({ action: 'settingsImport', source: 'folder' });
  await service.request({
    action: 'settingsOptions',
    changes: [{ key: 'gamma', policy: 'required' }],
  });
  expect(
    await service.request({
      action: 'settingsConfigItems',
      path: 'config/example.properties',
      changes: [{ key: 'quality', policy: 'required' }],
    }),
  ).toMatchObject({ ok: true });
  expect(
    await service.request({
      action: 'settingsShader',
      enabled: { policy: 'required', value: false },
    }),
  ).toMatchObject({ ok: true });
  const root = join(h.host.userData, 'test-instances', service.snapshot().project?.serverId ?? '');
  h.launch.mockImplementationOnce(async () => {
    await writeFile(join(root, 'options.txt'), 'version:3955\ngamma:0.8\n');
    await writeFile(join(root, 'config/example.properties'), 'quality=low\n');
    await writeFile(join(root, 'config/iris.properties'), 'enableShaders=true\n');
    await h.stop();
    return {
      pid: 123,
      finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: h.logs }),
      stop: h.stop,
      getLogs: () => h.logs,
    };
  });
  const before = service.snapshot().project;
  expect(await service.request({ action: 'testStart' })).toMatchObject({ ok: true });
  expect(service.snapshot().project).toEqual(before);
  expect(await service.request({ action: 'settingsImportOptions', source: 'test' })).toMatchObject({
    ok: true,
  });
  expect(
    service.snapshot().project?.gameSettings?.options.find((o) => o.key === 'gamma'),
  ).toMatchObject({ value: '0.8', policy: 'required' });
  expect(service.snapshot().project?.gameSettings?.configFiles).toEqual(
    before?.gameSettings?.configFiles,
  );
  expect(service.snapshot().project?.gameSettings?.shader).toEqual(before?.gameSettings?.shader);
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
  for (const input of [
    { action: 'testLogin' },
    { action: 'testReset', confirmed: true },
    { action: 'settingsImportOptions', source: 'test' },
    { action: 'settingsImportOptions', source: 'file' },
    { action: 'settingsTestConfigs' },
  ]) {
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

it('finishes analysis after a requested normal stop and clears old results on project replacement', async () => {
  const h = await setup();
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.runner.state.phase).toBe('running'));
  expect(await h.service.request({ action: 'testStop' })).toMatchObject({ ok: true });
  expect(await pending).toMatchObject({ ok: true });
  expect(h.runner.state).toMatchObject({ phase: 'done', exit: { reason: 'stopped' }, error: null });
  expect(h.runner.state.report?.items).toEqual([]);
  const newDir = join(h.base, 'new-proj');
  await mkdir(newDir);
  await createProjectAt(h.service, h.dialogs, newDir);
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

async function completeTest(
  h: Awaited<ReturnType<typeof setup>>,
  options: string | null = 'gamma:0.8\n',
) {
  h.launch.mockImplementationOnce(async () => {
    if (options !== null) await writeFile(join(h.root, 'options.txt'), options);
    await mkdir(join(h.root, 'config/nested'), { recursive: true });
    await writeFile(join(h.root, 'config/nested/example.properties'), 'quality=high\n');
    await writeFile(join(h.root, 'config/unsupported.json'), '{"quality":"high"}');
    return {
      pid: 123,
      finished: Promise.resolve({ reason: 'exited', code: 0, signal: null, logs: h.logs }),
      stop: h.stop,
      getLogs: () => h.logs,
    };
  });
  expect(await h.service.request({ action: 'testStart' })).toMatchObject({ ok: true });
}
it('returns explicit errors without a last result and after clearing/resetting the result', async () => {
  const h = await setup();
  const before = h.service.snapshot().project;
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
    ok: false,
    code: 'INVALID',
    detail: { code: 'NO_TEST_RESULT' },
  });
  expect(h.service.snapshot().project).toEqual(before);
  expect(await h.service.request({ action: 'settingsTestConfigs' })).toEqual({
    ok: false,
    code: 'INVALID',
    detail: { code: 'NO_TEST_RESULT' },
  });
  await completeTest(h);
  await h.service.request({ action: 'testReset', confirmed: true });
  expect(h.runner.state).toMatchObject({ extracted: null, configFiles: null, configPreview: null });
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
    ok: false,
    code: 'INVALID',
    detail: { code: 'NO_TEST_RESULT' },
  });
  const newDir = join(h.base, 'new-proj');
  await mkdir(newDir);
  await createProjectAt(h.service, h.dialogs, newDir);
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
    ok: false,
    code: 'INVALID',
    detail: { code: 'NO_TEST_RESULT' },
  });
});
it('imports the current last-instance options only and retains policies for present and missing keys', async () => {
  const h = await setup();
  await writeFile(join(h.source, 'options.txt'), 'gamma:0.5\nrenderDistance:12\n');
  h.dialogs.open.mockResolvedValueOnce([join(h.source, 'options.txt')]);
  expect(await h.service.request({ action: 'settingsImport', source: 'file' })).toMatchObject({
    ok: true,
  });
  await h.service.request({
    action: 'settingsOptions',
    changes: [
      { key: 'gamma', policy: 'required', value: '0.5' },
      { key: 'renderDistance', policy: 'initial', value: '12' },
    ],
  });
  const before = h.service.snapshot().project?.gameSettings;
  await completeTest(h);
  expect(h.service.snapshot().project?.gameSettings).toEqual(before);
  // Re-read the fixed instance path on import, not a cached preset or the source options.txt.
  await writeFile(join(h.root, 'options.txt'), 'gamma:0.95\nfov:0.7\n');
  expect(
    await h.service.request({ action: 'settingsImportOptions', source: 'test' }),
  ).toMatchObject({ ok: true, state: { dirty: true } });
  expect(h.service.snapshot().project?.gameSettings?.options).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'gamma', value: '0.95', policy: 'required' }),
      expect.objectContaining({ key: 'renderDistance', value: '12', policy: 'initial' }),
      expect.objectContaining({ key: 'fov', value: '0.7', policy: 'none' }),
    ]),
  );
  expect(h.service.snapshot().project?.gameSettings?.configFiles).toBeUndefined();
});
it('routes file options import through the existing picker and merge path', async () => {
  const h = await setup();
  h.dialogs.open.mockResolvedValueOnce([join(h.source, 'options.txt')]);
  expect(await h.service.request({ action: 'settingsImport', source: 'file' })).toMatchObject({
    ok: true,
  });
  await h.service.request({
    action: 'settingsOptions',
    changes: [{ key: 'gamma', policy: 'required', value: '0.1' }],
  });
  h.dialogs.open.mockResolvedValueOnce([join(h.source, 'options.txt')]);
  expect(
    await h.service.request({ action: 'settingsImportOptions', source: 'file' }),
  ).toMatchObject({ ok: true, state: { dirty: true, preset: { source: 'file' } } });
  expect(h.dialogs.open).toHaveBeenLastCalledWith('optionsfile', undefined);
  expect(h.service.snapshot().project?.gameSettings?.options).toContainEqual(
    expect.objectContaining({ key: 'gamma', value: '0.5', policy: 'required' }),
  );
  h.dialogs.open.mockResolvedValueOnce(null);
  const before = h.service.snapshot().project;
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'file' })).toEqual({
    ok: false,
    code: 'CANCELLED',
  });
  expect(h.service.snapshot().project).toEqual(before);
});
it('refreshes config candidates without importing, including when options.txt is invalid', async () => {
  const h = await setup();
  await h.service.request({ action: 'save' });
  const before = h.service.snapshot();
  await completeTest(h, 'invalid\u0000options');
  expect(h.runner.state).toMatchObject({
    phase: 'done',
    extracted: null,
    extractionError: 'INVALID',
    configError: null,
  });
  await writeFile(join(h.root, 'config/nested/example.properties'), 'quality=ultra\n');
  const reply = await h.service.request({ action: 'settingsTestConfigs' });
  expect(reply).toMatchObject({
    ok: true,
    state: {
      dirty: false,
      testRun: {
        configFiles: [
          {
            path: 'config/nested/example.properties',
            items: [expect.objectContaining({ key: 'quality', value: 'ultra', policy: 'none' })],
          },
        ],
        configPreview: {
          source: 'test',
          skippedConfigs: [{ path: 'config/unsupported.json', reason: 'unsupported' }],
        },
      },
    },
  });
  expect(h.service.snapshot().project).toEqual(before.project);
  expect(h.service.snapshot().preset).toEqual(before.preset);
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
    ok: false,
    code: 'INVALID',
  });
  expect(h.service.snapshot().project).toEqual(before.project);
});
it('reports missing test options separately and preserves config-only crash results', async () => {
  const h = await setup();
  await completeTest(h, null);
  expect(h.runner.state).toMatchObject({
    extracted: { optionCount: 0, newConfigCount: 2 },
    configError: null,
  });
  expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
    ok: false,
    code: 'INVALID',
    detail: { code: 'TEST_OPTIONS_MISSING' },
  });
  expect(await h.service.request({ action: 'settingsTestConfigs' })).toMatchObject({ ok: true });
});
it('rejects unexpected options/config command fields and sources before reading files or selecting', async () => {
  const h = await setup();
  const before = h.service.snapshot();
  for (const input of [
    { action: 'settingsImportOptions' },
    { action: 'settingsImportOptions', source: 'folder' },
    { action: 'settingsImportOptions', source: 'test', path: h.source },
    { action: 'settingsImportOptions', source: 'file', root: h.source },
    { action: 'settingsTestConfigs', path: h.source },
    { action: 'settingsTestConfigs', source: 'test' },
    Object.assign(Object.create({ action: 'settingsTestConfigs' }), { path: h.source }),
    Object.assign(Object.create({ action: 'settingsImportOptions' }), {
      source: 'test',
      path: h.source,
    }),
  ])
    expect(await h.service.request(input)).toEqual({ ok: false, code: 'INVALID' });
  expect(h.service.snapshot()).toEqual(before);
});
it.skipIf(process.platform === 'win32')(
  'does not follow linked instance options or config paths',
  async () => {
    const h = await setup();
    await completeTest(h);
    const project = h.service.snapshot().project;
    await rm(join(h.root, 'options.txt'));
    await symlink(join(h.source, 'options.txt'), join(h.root, 'options.txt'));
    expect(await h.service.request({ action: 'settingsImportOptions', source: 'test' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    await symlink(h.source, join(h.root, 'config/linked'), 'dir');
    expect(await h.service.request({ action: 'settingsTestConfigs' })).toMatchObject({ ok: true });
    expect(h.runner.state.configPreview?.detected.modConfigs).not.toContain('linked/options.txt');
    expect(h.service.snapshot().project).toEqual(project);
  },
);

const loginCode = 'ABCD-1234';
/** A login that publishes its device code like the real host and ends when told to. */
function pendingLogin(h: Awaited<ReturnType<typeof setup>>, end: 'abort' | 'success' | 'fail') {
  h.auth.login.mockImplementationOnce(async (signal) => {
    const release = h.runner.publishLoginCode(loginCode);
    try {
      if (end === 'success') return account;
      if (end === 'fail') throw new HostAuthenticationError('browser_failed');
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new AuthenticationError('cancelled', 'browser');
    } finally {
      if (end !== 'success') release();
    }
  });
}

it('publishes the device code in state only while the login waits', async () => {
  const h = await setup();
  expect(h.service.snapshot().account.login).toBeNull();
  pendingLogin(h, 'abort');
  const pending = h.service.request({ action: 'testLogin' });
  await vi.waitFor(() => expect(h.service.snapshot().account.login).toEqual({ code: loginCode }));
  expect(await h.service.request({ action: 'cancel' })).toMatchObject({ ok: true });
  expect(await pending).toEqual({ ok: false, code: 'CANCELLED' });
  expect(h.service.snapshot().account.login).toBeNull();
});

it('clears the published code after success, failure and logout', async () => {
  const h = await setup();
  pendingLogin(h, 'success');
  expect(await h.service.request({ action: 'testLogin' })).toMatchObject({ ok: true });
  // Even a host that forgets to release leaves nothing behind.
  expect(h.service.snapshot().account.login).toBeNull();
  pendingLogin(h, 'fail');
  expect(await h.service.request({ action: 'testLogin' })).toEqual({ ok: false, code: 'IO' });
  expect(h.service.snapshot().account.login).toBeNull();
  pendingLogin(h, 'abort');
  const pending = h.service.request({ action: 'testLogin' });
  await vi.waitFor(() => expect(h.service.snapshot().account.login).not.toBeNull());
  await h.service.request({ action: 'testLogout' });
  await pending;
  expect(h.service.snapshot().account.login).toBeNull();
});

it('copies the pending code through main and rejects when none is waiting', async () => {
  const h = await setup();
  expect(await h.service.request({ action: 'testLoginCopyCode' })).toEqual({
    ok: false,
    code: 'INVALID',
  });
  expect(h.dialogs.copy).not.toHaveBeenCalled();
  pendingLogin(h, 'abort');
  const pending = h.service.request({ action: 'testLogin' });
  await vi.waitFor(() => expect(h.service.snapshot().account.login).not.toBeNull());
  for (const extra of [{ code: loginCode }, { text: 'x' }])
    expect(await h.service.request({ action: 'testLoginCopyCode', ...extra })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  expect(await h.service.request({ action: 'testLoginCopyCode' })).toMatchObject({ ok: true });
  expect(h.dialogs.copy).toHaveBeenCalledExactlyOnceWith(loginCode);
  await h.service.request({ action: 'cancel' });
  await pending;
  expect(await h.service.request({ action: 'testLoginCopyCode' })).toEqual({
    ok: false,
    code: 'INVALID',
  });
  expect(h.dialogs.copy).toHaveBeenCalledOnce();
});

it('only answers the copy command for the trusted main frame', async () => {
  const h = await setup();
  const frame = { url: 'file:///studio/index.html' };
  const contents = { mainFrame: frame } as unknown as WebContents;
  for (const [sender, senderFrame] of [
    [{}, frame],
    [contents, { ...frame }],
  ])
    expect(
      await handleStudioRequest(
        { sender, senderFrame } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
        contents,
        frame.url,
        h.service,
        { action: 'testLoginCopyCode' },
      ),
    ).toEqual({ ok: false, code: 'UNTRUSTED' });
});

it('closes the project for real: UNSAVED rule, full reset, no file or instance changes', async () => {
  const h = await setup();
  // A finished test run leaves results behind.
  const pending = h.service.request({ action: 'testStart' });
  await vi.waitFor(() => expect(h.runner.state.phase).toBe('running'));
  await h.service.request({ action: 'testStop' });
  await pending;
  expect(h.runner.state.phase).toBe('done');
  // Adding the mod saved the project; an unsaved edit makes the close ask first.
  await h.service.request({ action: 'touch' });
  expect(await h.service.request({ action: 'closeProject' })).toEqual({
    ok: false,
    code: 'UNSAVED',
  });
  expect(h.service.snapshot().project).not.toBeNull();
  const reply = await h.service.request({ action: 'closeProject', discard: true });
  expect(reply).toMatchObject({ ok: true });
  const state = h.service.snapshot();
  expect(state).toMatchObject({
    project: null,
    projectName: null,
    dirty: false,
    files: null,
    deploy: null,
    urlCheck: null,
    export: null,
    preset: null,
    policy: null,
    signing: null,
  });
  expect(state.testRun).toMatchObject({ phase: 'idle', report: null, logs: [], mods: [] });
  expect(state.account.signedIn).toBe(true);
  // Nothing on disk was touched.
  expect(await readFile(join(h.source, 'options.txt'), 'utf8')).toContain('gamma:0.5');
  await expect(readFile(join(h.source, 'mods/example.jar'))).resolves.toBeDefined();
  // Closing again is a harmless no-op.
  expect(await h.service.request({ action: 'closeProject' })).toMatchObject({ ok: true });
});

it('closes a clean project without discard and refuses while busy or malformed', async () => {
  const h = await setup();
  const newDir = join(h.base, 'new-proj');
  await mkdir(newDir);
  await createProjectAt(h.service, h.dialogs, newDir);
  h.dialogs.save.mockResolvedValueOnce(join(h.base, 'clean.torchproj'));
  expect((await h.service.request({ action: 'save' })).ok).toBe(true);
  expect(h.service.snapshot().dirty).toBe(false);
  for (const extra of [{ force: true }, { discard: 'yes' }, { path: '/tmp' }])
    expect(await h.service.request({ action: 'closeProject', ...extra })).toEqual({
      ok: false,
      code: 'INVALID',
    });
  await h.service.close();
  expect(await h.service.request({ action: 'closeProject' })).toEqual({ ok: false, code: 'BUSY' });
  h.service.resume();
  expect(await h.service.request({ action: 'closeProject' })).toMatchObject({ ok: true });
  expect(h.service.snapshot().project).toBeNull();
});

it('only accepts closeProject from the trusted main frame', async () => {
  const h = await setup();
  const frame = { url: 'file:///studio/index.html' };
  const contents = { mainFrame: frame } as unknown as WebContents;
  for (const [sender, senderFrame] of [
    [{}, frame],
    [contents, { ...frame }],
  ])
    expect(
      await handleStudioRequest(
        { sender, senderFrame } as Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
        contents,
        frame.url,
        h.service,
        { action: 'closeProject', discard: true },
      ),
    ).toEqual({ ok: false, code: 'UNTRUSTED' });
  expect(h.service.snapshot().project).not.toBeNull();
});

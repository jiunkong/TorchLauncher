import { fork, spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { build } from 'vite';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage: node scripts/auth-smoke.mjs <mode> --data-dir <absolute-private-directory>
  [--provider public-java|own-app]
  [--client-id <your-own-public-client-id>] [--redirect-uri http://localhost:48127/callback]

Modes:
  worker-check   Build/start the pinned-library worker; no network, login or token cache.
  window-cycle   Close a sole Electron window, then finish async cleanup/report; no login.
  probe          Check real Electron secure storage, with no login or credential write.
  reject-basic   Linux only: verify that --password-store=basic is rejected. No login.
  storage-cycle  Write synthetic data, restart/read, clear, restart/check empty. No login.
  cycle          Live login, restart/refresh, logout, restart/check empty.
  login          Live login through the system browser; persist encrypted refresh token.
  refresh        New Electron process: refresh and verify Java entitlement/profile.
  logout         Remove this client's saved session. Does not revoke browser consent.
  assert-empty   Verify no session remains for this client.

Default provider: public-java (temporary Java Title device-code/SISU flow).
Only --provider own-app requires YOUR registered client ID and loopback redirect.
Data must be outside this repository. Never paste credentials, codes or tokens in chat.
If a live cycle fails, run logout using the same client ID/data directory to clean up.
`;

function argumentsFor(argv) {
  if (argv.length === 0 || argv.includes('--help')) return null;
  const [mode, ...args] = argv;
  if (
    ![
      'probe',
      'worker-check',
      'window-cycle',
      'reject-basic',
      'storage-cycle',
      'cycle',
      'login',
      'refresh',
      'logout',
      'assert-empty',
    ].includes(mode)
  ) {
    throw new Error('Unknown mode. Use --help.');
  }
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !['--data-dir', '--client-id', '--redirect-uri', '--provider'].includes(flag) ||
      !value ||
      options.has(flag)
    ) {
      throw new Error('Invalid or repeated option. Use --help.');
    }
    options.set(flag, value);
  }
  const dataDirectory = options.get('--data-dir');
  if (!dataDirectory || !isAbsolute(dataDirectory))
    throw new Error('--data-dir must be an absolute private path outside the repository.');
  const live = !['probe', 'reject-basic', 'storage-cycle', 'worker-check', 'window-cycle'].includes(
    mode,
  );
  const clientId = options.get('--client-id');
  const redirectUri = options.get('--redirect-uri');
  const provider = options.get('--provider') ?? 'public-java';
  if (!['public-java', 'own-app'].includes(provider))
    throw new Error('Unknown authentication provider.');
  if (provider === 'public-java' && (clientId || redirectUri))
    throw new Error('Client ID/redirect options require --provider own-app.');
  if (
    live &&
    provider === 'own-app' &&
    (!clientId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId) || !redirectUri)
  ) {
    throw new Error('Live modes require --client-id (your registered ID) and --redirect-uri.');
  }
  return { mode, dataDirectory, clientId, redirectUri, provider };
}

function inside(path, root) {
  const child = relative(root, path);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function workerCheck(entry) {
  const env = { ...process.env, DEBUG: '' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  const worker = fork(entry, [], {
    env,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const closed = new Promise((resolve) => worker.once('close', resolve));
  const timer = setTimeout(() => worker.kill('SIGKILL'), 10_000);
  try {
    await new Promise((resolve, reject) => {
      worker.once('error', () => reject(new Error('Worker check failed.')));
      worker.once('close', () => reject(new Error('Worker check failed.')));
      worker.once('message', (message) => {
        if (
          message?.type === 'self-check' &&
          message.ok === true &&
          message.libraryVersion === '3.1.1'
        )
          resolve();
        else reject(new Error('Worker check failed.'));
      });
      worker.send({ type: 'self-check' });
    });
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'worker-check',
        libraryVersion: '3.1.1',
        liveAuthentication: false,
      }),
    );
  } finally {
    worker.kill('SIGKILL');
    await closed;
    clearTimeout(timer);
  }
}

async function child(entry, config, mode) {
  const env = { ...process.env, TORCH_AUTH_SMOKE_CONFIG: JSON.stringify({ ...config, mode }) };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [entry, ...(mode === 'reject-basic' ? ['--password-store=basic'] : [])];
  const processHandle = spawn(electronPath, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  let interrupted = false;
  let killTimer;
  const interrupt = () => {
    interrupted = true;
    processHandle.kill('SIGTERM');
    if (!killTimer) {
      killTimer = setTimeout(() => processHandle.kill('SIGKILL'), 5000);
      killTimer.unref();
    }
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timer = setTimeout(interrupt, 330_000);
  processHandle.once('spawn', () => {
    if (interrupted) interrupt();
  });
  processHandle.stdout.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-16_384);
  });
  try {
    const code = await new Promise((resolveExit, reject) => {
      processHandle.once('error', () =>
        reject(new Error('Could not start Electron. Check the local Electron installation.')),
      );
      processHandle.once('close', resolveExit);
    });
    const line = output
      .split(/\r?\n/)
      .findLast((value) => value.startsWith('TORCH_AUTH_SMOKE_RESULT '));
    if (!line)
      throw new Error(
        'Electron exited without a harness result. Check display, runtime libraries and OS credential service.',
      );
    const result = JSON.parse(line.slice('TORCH_AUTH_SMOKE_RESULT '.length));
    console.log(JSON.stringify(result));
    if (code !== 0 || result.ok !== true)
      throw new Error('Authentication smoke step failed; see the redacted result above.');
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function main() {
  const config = argumentsFor(process.argv.slice(2));
  if (!config) {
    console.log(usage);
    return;
  }
  // Reject repository paths both before and after resolving symlinks.
  if (inside(resolve(config.dataDirectory), repository))
    throw new Error('Use a data directory outside this repository.');
  await mkdir(config.dataDirectory, { recursive: true, mode: 0o700 });
  const stat = await lstat(config.dataDirectory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
  ) {
    throw new Error(
      'Use a dedicated private directory owned by the current user (mode 0700 on Unix).',
    );
  }
  config.dataDirectory = await realpath(config.dataDirectory);
  if (inside(config.dataDirectory, await realpath(repository)))
    throw new Error('Use a data directory outside this repository.');
  const temp = await mkdtemp(join(tmpdir(), 'torchlauncher-auth-bundle-'));
  try {
    await build({
      root: repository,
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true, external: ['electron'] },
      build: {
        ssr: true,
        outDir: temp,
        emptyOutDir: false,
        rollupOptions: {
          input: {
            'auth-smoke': resolve(repository, 'apps/launcher/src/main/auth/smoke-entry.ts'),
            'public-java-worker': resolve(
              repository,
              'packages/desktop-auth/src/public-java-worker.ts',
            ),
          },
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    });
    const steps =
      config.mode === 'cycle'
        ? ['login', 'refresh', 'logout', 'assert-empty']
        : config.mode === 'storage-cycle'
          ? ['storage-write', 'storage-read', 'storage-clear', 'storage-empty']
          : [config.mode];
    if (config.mode === 'worker-check') await workerCheck(join(temp, 'public-java-worker.cjs'));
    else for (const mode of steps) await child(join(temp, 'auth-smoke.cjs'), config, mode);
    console.log(
      JSON.stringify({
        ok: true,
        mode: config.mode,
        provider: config.provider,
        liveAuthentication: config.mode === 'cycle' ? 'verified' : 'not-asserted',
      }),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let scriptPhase = 'configuration';
const usage =
  'node scripts/game-smoke.mjs install|launch --data-dir <absolute-private-directory> --game-dir <absolute-game-directory> --loader neoforge|fabric --loader-version <exact-version> --server-id <expected-uuid> [--source-file <absolute-private-url-file> --server <address:port>] [--duration-seconds 300]';
const inside = (path, root) => {
  const child = relative(root, path);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!mode || mode === '--help') {
    console.log(usage);
    return;
  }
  if (!['install', 'launch'].includes(mode)) throw new Error('Invalid mode; use --help.');
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];
    if (
      ![
        '--data-dir',
        '--game-dir',
        '--loader',
        '--loader-version',
        '--source-file',
        '--server-id',
        '--server',
        '--duration-seconds',
      ].includes(flag) ||
      !value ||
      options.has(flag)
    )
      throw new Error('Invalid options; use --help.');
    options.set(flag, value);
  }
  for (const flag of ['--data-dir', '--game-dir']) {
    const path = options.get(flag);
    if (!path || !isAbsolute(path) || inside(resolve(path), repository))
      throw new Error('Use dedicated absolute data/game directories outside the repository.');
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe harness directory.');
    if (
      flag === '--data-dir' &&
      process.platform !== 'win32' &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    )
      throw new Error('Use a private current-user directory (0700 on Unix).');
    const canonical = await realpath(path);
    if (inside(canonical, await realpath(repository)))
      throw new Error('Directory resolves inside repository.');
    options.set(flag, canonical);
  }
  const dataDirectory = options.get('--data-dir'),
    gameDirectory = options.get('--game-dir');
  if (inside(dataDirectory, gameDirectory) || inside(gameDirectory, dataDirectory))
    throw new Error('Data and game directories must be separate.');
  const serverId = options.get('--server-id');
  if (
    !serverId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(serverId) ||
    basename(gameDirectory) !== serverId
  )
    throw new Error('Game directory basename must be the expected server UUID (--server-id).');
  const marker = join(gameDirectory, '.torchlauncher-game-smoke.json');
  const identity = JSON.stringify({ version: 1, serverId });
  const existing = await readdir(gameDirectory);
  if (existing.length) {
    const info = await lstat(marker);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 1024 ||
      (await readFile(marker, 'utf8')) !== identity
    )
      throw new Error('Unrecognized nonempty game directory.');
  } else await writeFile(marker, identity, { flag: 'wx', mode: 0o600 });
  const kind = options.get('--loader'),
    version = options.get('--loader-version');
  if (
    !['neoforge', 'fabric'].includes(kind) ||
    !version ||
    !/^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(version)
  )
    throw new Error('Exact loader/version required.');
  const durationSeconds = Number(options.get('--duration-seconds') ?? 300);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 1800)
    throw new Error('Invalid duration.');
  if (
    mode === 'launch' &&
    (!isAbsolute(options.get('--source-file') ?? '') ||
      !options.get('--server-id') ||
      !options.get('--server'))
  )
    throw new Error('Launch requires source file, expected server ID and server address.');
  const config = {
    mode,
    dataDirectory,
    gameDirectory,
    loader: { kind, version },
    durationSeconds,
    sourceFile: options.get('--source-file'),
    serverId: options.get('--server-id'),
    server: options.get('--server'),
  };
  const harnessLock = join(dataDirectory, '.game-smoke-lock');
  await mkdir(harnessLock);
  const temporary = await mkdtemp(join(await realpath(tmpdir()), 'torch-game-smoke-'));
  try {
    scriptPhase = 'bundle';
    await build({
      root: repository,
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true, external: ['electron'] },
      build: {
        ssr: true,
        outDir: temporary,
        emptyOutDir: false,
        rollupOptions: {
          input: {
            'game-smoke': join(repository, 'apps/launcher/src/main/game-smoke/entry.ts'),
            'public-java-worker': join(
              repository,
              'apps/launcher/src/main/auth/public-java-worker.ts',
            ),
          },
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    });
    scriptPhase = 'electron-runtime';
    const electronPath = (await import('electron')).default;
    const env = {
      ...process.env,
      TORCH_GAME_SMOKE_CONFIG: JSON.stringify({ ...config, cancelFile: join(temporary, 'cancel') }),
      DEBUG: '',
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawn(electronPath, [join(temporary, 'game-smoke.cjs')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let nativeDiagnostics = '';
    child.stderr.on('data', (chunk) => {
      nativeDiagnostics = (nativeDiagnostics + chunk.toString()).slice(-4096);
    });
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-16384);
    });
    // Ask Electron to cancel and reap its child; do not terminate the owner while Java is active.
    const interrupt = () => {
      void writeFile(join(temporary, 'cancel'), 'cancel', { flag: 'wx' }).catch(() => {});
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
      const code = await new Promise((resolveExit, reject) => {
        child.once('error', () => reject(new Error('Electron could not start.')));
        child.once('close', resolveExit);
      });
      const line = output
        .split(/\r?\n/)
        .findLast((line) => line.startsWith('TORCH_GAME_SMOKE_RESULT '));
      if (!line) {
        const code = /SUID sandbox|No usable sandbox/.test(nativeDiagnostics)
          ? 'host_sandbox_unavailable'
          : /Missing X server|cannot open display|DISPLAY/.test(nativeDiagnostics)
            ? 'host_display_unavailable'
            : /error while loading shared libraries/.test(nativeDiagnostics)
              ? 'host_library_missing'
              : 'host_no_result';
        console.log(
          JSON.stringify({
            ok: false,
            phase: 'electron-runtime',
            code,
            authenticatedConnection: false,
          }),
        );
        process.exitCode = 1;
        return;
      }
      const result = JSON.parse(line.slice('TORCH_GAME_SMOKE_RESULT '.length));
      console.log(JSON.stringify(result));
      if (code !== 0 || !result.ok) process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(harnessLock, { recursive: true, force: true });
  }
}
await main().catch(() => {
  console.error(
    JSON.stringify({
      ok: false,
      phase: scriptPhase,
      code:
        scriptPhase === 'configuration'
          ? 'invalid_configuration'
          : scriptPhase === 'bundle'
            ? 'bundle_failed'
            : 'host_start_failed',
      authenticatedConnection: false,
    }),
  );
  process.exitCode = 1;
});

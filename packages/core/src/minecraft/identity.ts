import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Process/host identity used to decide whether a cooperative lock owner is still alive.
 * Start identifiers are opaque strings compared for equality only; they never contain
 * arguments, environment, account data or paths.
 */
export type ProcessState =
  | { state: 'running'; start: string }
  | { state: 'absent' }
  | { state: 'unknown' };
export interface HostIdentity {
  /** SHA-256 of the OS machine identifier, or null when it cannot be determined. */
  machine: string | null;
}
export interface ProcessProbe {
  host(): Promise<HostIdentity>;
  process(pid: number): Promise<ProcessState>;
}
export interface CommandResult {
  code: number | null;
  stdout: string;
}
/** Runs a fixed executable with fixed arguments (no shell). Must not throw for non-zero exits. */
export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;
export interface SystemProbeOptions {
  platform?: NodeJS.Platform;
  readText?: (path: string) => Promise<string>;
  run?: CommandRunner;
}

const COMMAND_TIMEOUT_MS = 15_000;
const UNKNOWN: ProcessState = { state: 'unknown' };

function hashMachine(id: string): string {
  return createHash('sha256').update(`torchlauncher-machine:${id}`).digest('hex');
}
export function isValidPid(pid: unknown): pid is number {
  return Number.isSafeInteger(pid) && (pid as number) > 0 && (pid as number) <= 0x7fffffff;
}
const defaultRun: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        shell: false,
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
      },
      (error, stdout) => {
        const code =
          error === null
            ? 0
            : typeof error.code === 'number'
              ? error.code
              : (null as number | null);
        resolve({ code, stdout: typeof stdout === 'string' ? stdout : '' });
      },
    );
  });
const defaultReadText = (path: string) => readFile(path, 'utf8');

/** Parse `/proc/<pid>/stat`; the command name may contain spaces and parentheses. */
export function parseLinuxStat(text: string, bootId: string): ProcessState {
  const close = text.lastIndexOf(')');
  if (close < 0) return UNKNOWN;
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const state = fields[0];
  const start = fields[19];
  if (!state || !start || !/^\d{1,20}$/.test(start)) return UNKNOWN;
  // Zombie/dead entries can no longer touch files; they only await reaping.
  if (state === 'Z' || state === 'X' || state === 'x') return { state: 'absent' };
  return { state: 'running', start: `linux:${bootId}:${start}` };
}
function windowsSystemRoot(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return /^[A-Za-z]:\\[^"<>|?*]{1,200}$/.test(root) ? root : 'C:\\Windows';
}
export function windowsProcessScript(pid: number): string {
  if (!isValidPid(pid)) throw new Error('Invalid process id');
  return (
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $p) { 'absent' } elseif ($p.HasExited) { 'absent' } ` +
    `else { 'start=' + $p.StartTime.ToUniversalTime().Ticks }`
  );
}
export function parseWindowsProcess(result: CommandResult): ProcessState {
  if (result.code !== 0) return UNKNOWN;
  const text = result.stdout.trim();
  if (text === 'absent') return { state: 'absent' };
  const match = /^start=(\d{1,20})$/.exec(text);
  return match ? { state: 'running', start: `windows:${match[1]}` } : UNKNOWN;
}
export function parseWindowsMachineGuid(result: CommandResult): string | null {
  if (result.code !== 0) return null;
  const match = /MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{36})/.exec(result.stdout);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * Production probe. Linux reads procfs (start = boot ID + start ticks); Windows invokes
 * `reg.exe`/`powershell.exe` from System32 with fixed arguments (start = UTC creation ticks).
 * macOS and other platforms are intentionally unsupported and report `unknown`.
 */
export function createSystemProcessProbe(options: SystemProbeOptions = {}): ProcessProbe {
  const platform = options.platform ?? process.platform;
  const readText = options.readText ?? defaultReadText;
  const run = options.run ?? defaultRun;
  let machine: Promise<string | null> | undefined;
  let boot: Promise<string | null> | undefined;
  const linuxBoot = () => {
    boot ??= readText('/proc/sys/kernel/random/boot_id')
      .then((text) => {
        const id = text.trim().toLowerCase();
        return /^[0-9a-f-]{36}$/.test(id) ? id : null;
      })
      .catch(() => null);
    return boot;
  };
  const machineId = () => {
    machine ??= (async () => {
      if (platform === 'linux') {
        for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
          try {
            const id = (await readText(path)).trim().toLowerCase();
            if (/^[0-9a-f]{32}$/.test(id)) return hashMachine(id);
          } catch {
            // Try the next location.
          }
        }
        return null;
      }
      if (platform === 'win32') {
        try {
          const id = parseWindowsMachineGuid(
            await run(join(windowsSystemRoot(), 'System32', 'reg.exe'), [
              'query',
              'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
              '/v',
              'MachineGuid',
            ]),
          );
          return id ? hashMachine(id) : null;
        } catch {
          return null;
        }
      }
      return null;
    })();
    return machine;
  };
  return {
    async host() {
      return { machine: await machineId() };
    },
    async process(pid) {
      if (!isValidPid(pid)) return UNKNOWN;
      try {
        if (platform === 'linux') {
          const bootId = await linuxBoot();
          if (!bootId) return UNKNOWN;
          let text: string;
          try {
            text = await readText(`/proc/${pid}/stat`);
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? { state: 'absent' }
              : UNKNOWN;
          }
          return parseLinuxStat(text, bootId);
        }
        if (platform === 'win32') {
          return parseWindowsProcess(
            await run(
              join(windowsSystemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
              ['-NoProfile', '-NonInteractive', '-Command', windowsProcessScript(pid)],
            ),
          );
        }
      } catch {
        return UNKNOWN;
      }
      return UNKNOWN;
    },
  };
}

let defaultProbe: ProcessProbe | undefined;
export function systemProcessProbe(): ProcessProbe {
  defaultProbe ??= createSystemProcessProbe();
  return defaultProbe;
}

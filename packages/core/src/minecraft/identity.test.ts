import { describe, expect, it } from 'vitest';
import {
  type CommandRunner,
  createSystemProcessProbe,
  parseLinuxStat,
  parseWindowsMachineGuid,
  parseWindowsProcess,
  windowsProcessScript,
} from './identity';

const BOOT = '0c9a1b52-4f6c-4f39-9d1e-7a1f0a6b2c3d';
const MACHINE = '0123456789abcdef0123456789abcdef';

describe('process identity parsing', () => {
  it('parses Linux stat with hostile command names and treats zombies as exited', () => {
    const tail = ' 1 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10';
    expect(parseLinuxStat(`42 (we ird) ) S${tail}`, BOOT)).toEqual({
      state: 'running',
      start: `linux:${BOOT}:987654`,
    });
    expect(parseLinuxStat(`42 (java) Z${tail}`, BOOT)).toEqual({ state: 'absent' });
    expect(parseLinuxStat('garbage', BOOT)).toEqual({ state: 'unknown' });
    expect(parseLinuxStat('42 (java) S 1 2', BOOT)).toEqual({ state: 'unknown' });
  });

  it('parses Windows tool output strictly', () => {
    expect(parseWindowsProcess({ code: 0, stdout: 'start=638000000000000000\r\n' })).toEqual({
      state: 'running',
      start: 'windows:638000000000000000',
    });
    expect(parseWindowsProcess({ code: 0, stdout: 'absent\r\n' })).toEqual({ state: 'absent' });
    expect(parseWindowsProcess({ code: 0, stdout: '' })).toEqual({ state: 'unknown' });
    expect(parseWindowsProcess({ code: 1, stdout: 'absent' })).toEqual({ state: 'unknown' });
    expect(
      parseWindowsMachineGuid({
        code: 0,
        stdout:
          '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    0F8E1D2C-3B4A-5968-7A6B-5C4D3E2F1A0B\r\n',
      }),
    ).toBe('0f8e1d2c-3b4a-5968-7a6b-5c4d3e2f1a0b');
    expect(parseWindowsMachineGuid({ code: 1, stdout: '' })).toBeNull();
    expect(() => windowsProcessScript(-1)).toThrow();
    expect(windowsProcessScript(1234)).toContain('Get-Process -Id 1234 ');
  });
});

describe('createSystemProcessProbe', () => {
  it('uses procfs on Linux and caches host identity', async () => {
    const reads: string[] = [];
    const probe = createSystemProcessProbe({
      platform: 'linux',
      readText: async (path) => {
        reads.push(path);
        if (path === '/etc/machine-id') return `${MACHINE}\n`;
        if (path === '/proc/sys/kernel/random/boot_id') return `${BOOT}\n`;
        if (path === '/proc/7/stat')
          return '7 (node) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 555 0 0';
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });
    const host = await probe.host();
    expect(host.machine).toMatch(/^[0-9a-f]{64}$/);
    expect(await probe.host()).toEqual(host);
    expect(await probe.process(7)).toEqual({ state: 'running', start: `linux:${BOOT}:555` });
    expect(await probe.process(8)).toEqual({ state: 'absent' });
    expect(await probe.process(0)).toEqual({ state: 'unknown' });
    expect(reads.filter((path) => path === '/etc/machine-id')).toHaveLength(1);
  });

  it('reports unknown when Linux procfs is unreadable for other reasons', async () => {
    const probe = createSystemProcessProbe({
      platform: 'linux',
      readText: async (path) => {
        if (path === '/proc/sys/kernel/random/boot_id') return BOOT;
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });
    expect(await probe.process(9)).toEqual({ state: 'unknown' });
    expect(await probe.host()).toEqual({ machine: null });
  });

  it('calls only fixed System32 tools on Windows', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const run: CommandRunner = async (file, args) => {
      calls.push({ file, args });
      if (file.endsWith('reg.exe'))
        return { code: 0, stdout: 'MachineGuid    REG_SZ    0F8E1D2C-3B4A-5968-7A6B-5C4D3E2F1A0B' };
      return { code: 0, stdout: args.at(-1)?.includes(' 11 ') ? 'start=123' : 'absent' };
    };
    const probe = createSystemProcessProbe({ platform: 'win32', run });
    expect((await probe.host()).machine).toMatch(/^[0-9a-f]{64}$/);
    expect(await probe.process(11)).toEqual({ state: 'running', start: 'windows:123' });
    expect(await probe.process(12)).toEqual({ state: 'absent' });
    expect(calls.every((call) => /System32/.test(call.file))).toBe(true);
    expect(calls.find((call) => call.file.endsWith('powershell.exe'))?.args.slice(0, 3)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
    ]);
  });

  it('treats a failing Windows tool as unknown', async () => {
    const probe = createSystemProcessProbe({
      platform: 'win32',
      run: async () => {
        throw new Error('spawn failed');
      },
    });
    expect(await probe.process(5)).toEqual({ state: 'unknown' });
    expect(await probe.host()).toEqual({ machine: null });
  });

  it('does not support macOS (user decision): identity is unknown', async () => {
    const probe = createSystemProcessProbe({
      platform: 'darwin',
      readText: async () => 'x',
      run: async () => ({ code: 0, stdout: 'x' }),
    });
    expect(await probe.process(1)).toEqual({ state: 'unknown' });
    expect(await probe.host()).toEqual({ machine: null });
  });

  it.runIf(process.platform === 'linux')('identifies real Linux processes', async () => {
    const probe = createSystemProcessProbe();
    const self = await probe.process(process.pid);
    expect(self.state).toBe('running');
    expect(await probe.process(process.pid)).toEqual(self);
    expect(await probe.process(0x7ffffffe)).toEqual({ state: 'absent' });
  });
});

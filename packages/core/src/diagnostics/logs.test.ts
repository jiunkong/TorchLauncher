import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeGameLog } from './logs.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.log`, import.meta.url), 'utf8');
const analyze = (text: string) =>
  analyzeGameLog({ loader: 'fabric', minecraftVersion: '1.21.1', text });

describe('compatibility analysis', () => {
  it.each(['fabric', 'neoforge'] as const)('classifies %s resolution fixtures', (loader) => {
    const result = analyzeGameLog({
      loader,
      minecraftVersion: '1.21.1',
      text: fixture(`${loader}-failure`),
    });
    expect(result.status).toBe('problems');
    expect(result.items.length).toBe(loader === 'fabric' ? 6 : 3);
    expect(result.items.every((item) => item.category === 'loader-resolution')).toBe(true);
    expect(result.items[0]?.evidence[0]?.line).toBe(2);
  });
  it.each([
    ['Mixin apply failed example.mixins.json', 'mixin'],
    ['Mixin application failed', 'mixin'],
    ['java.lang.ClassNotFoundException: example.Clazz', 'class-loading'],
    ['java.lang.NoClassDefFoundError: example.Clazz', 'class-loading'],
    ['java.lang.OutOfMemoryError: Java heap space', 'out-of-memory'],
    ['java.lang.UnsupportedClassVersionError', 'java-version'],
    ['compiled by a more recent version of the Java Runtime', 'java-version'],
    ['ERROR unknown failure', 'unclassified'],
  ])('classifies %s', (text, category) => {
    expect(analyze(text).items[0]?.category).toBe(category);
  });
  it('only reports no known problems after startup, meaningful output and clean exit', () => {
    expect(
      analyzeGameLog({
        loader: 'fabric',
        minecraftVersion: '1.21.1',
        text: fixture('normal'),
        exit: { code: 0, signal: null },
      }).status,
    ).toBe('no-problems-found');
    expect(analyze(fixture('normal')).status).toBe('incomplete');
    expect(
      analyzeGameLog({
        loader: 'fabric',
        minecraftVersion: '1.21.1',
        lines: ['fine', 'done'],
        exit: { code: 0, signal: null },
      }).status,
    ).toBe('incomplete');
    expect(analyze('').status).toBe('incomplete');
    expect(analyze('Loading Minecraft').status).toBe('incomplete');
  });
  it('reports abnormal exit and crash report with separate evidence coordinates', () => {
    const report = analyzeGameLog({
      loader: 'neoforge',
      minecraftVersion: '1.21.1',
      text: 'hello',
      exit: { code: null, signal: 'SIGTERM' },
      crashReport: 'OutOfMemoryError',
    });
    expect(report.items.map((item) => item.category)).toEqual(['out-of-memory', 'crash', 'crash']);
    expect(report.items[0]?.evidence[0]).toMatchObject({ source: 'crash-report', line: 1 });
    expect(
      analyzeGameLog({
        loader: 'fabric',
        minecraftVersion: '1.21.1',
        text: '',
        exit: { code: 1, signal: null },
      }).status,
    ).toBe('problems');
  });
  it('redacts tokens, identities, home directories and controls before producing evidence', () => {
    const result = analyzeGameLog({
      loader: 'fabric',
      minecraftVersion: '1.21.1',
      secretsToHide: ['secret-name'],
      lines: [
        'Setting user: PlayerExample',
        'ERROR PlayerExample secret-name access_token=private-value refresh_token="other-value" authorization=Bearer private-bearer C:\\Users\\PrivateUser\\game /home/PrivateLinux/game \u001b[31maccess_\u0000token=split-value \u0007',
      ],
    });
    const json = JSON.stringify(result);
    for (const secret of [
      'PlayerExample',
      'secret-name',
      'private-value',
      'other-value',
      'private-bearer',
      'PrivateUser',
      'PrivateLinux',
      'split-value',
      '\\u0007',
      '\\u001b',
    ])
      expect(json).not.toContain(secret);
    expect(json).toContain('[REDACTED]');
  });
  it('redacts tokens before identities which resemble token keys', () => {
    const result = analyzeGameLog({
      loader: 'fabric',
      minecraftVersion: '1.21.1',
      secretsToHide: ['token'],
      lines: [
        'Setting user: access_token',
        'ERROR access_token=private-token --accessToken command-secret',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(JSON.stringify(result)).not.toContain('command-secret');
  });
  it('maps known mod IDs and file names, and caps evidence length', () => {
    const result = analyzeGameLog({
      loader: 'fabric',
      minecraftVersion: '1.21.1',
      text: `ERROR example example.jar ${'x'.repeat(1000)}`,
      mods: [
        {
          loader: 'fabric',
          file: 'example.jar',
          mods: [{ id: 'example', version: '1', dependencies: [] }],
        },
      ],
    });
    expect(result.items[0]).toMatchObject({ modIds: ['example'], files: ['example.jar'] });
    expect(result.items[0]?.evidence[0]?.text).toHaveLength(400);
  });
  it('bounds items, bytes, line count, Unicode and crash input', () => {
    expect(analyze('ERROR failure\n'.repeat(201))).toMatchObject({
      truncated: true,
      items: expect.any(Array),
    });
    expect(analyze('ERROR failure\n'.repeat(201)).items).toHaveLength(200);
    expect(analyze('x'.repeat(8193))).toMatchObject({ truncated: true, status: 'incomplete' });
    expect(analyze('가'.repeat(3000)).truncated).toBe(true);
    expect(analyze(`${'x'.repeat(8000)}\n`.repeat(600)).truncated).toBe(true);
    expect(analyze('\n'.repeat(70000)).truncated).toBe(true);
    expect(
      analyzeGameLog({
        loader: 'fabric',
        minecraftVersion: '1.21.1',
        crashReport: 'x'.repeat(5 * 1024 * 1024),
      }).truncated,
    ).toBe(true);
  });
  it('handles adversarial repetitive regex inputs within a bounded budget', () => {
    const start = performance.now();
    const result = analyzeGameLog({
      loader: 'fabric',
      minecraftVersion: '1.21.1',
      lines: Array.from({ length: 200 }, () => `${'authorization '.repeat(500)}!`),
    });
    expect(result.items).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

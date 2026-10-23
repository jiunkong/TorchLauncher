import { describe, expect, it } from 'vitest';

const modules = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Studio renderer', () => {
  it('uses in-app modals only: no window.confirm, alert or prompt', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10);
    const offenders = Object.entries(modules)
      .filter(([, text]) =>
        /(?<![\w.])(window\.|globalThis\.)?(confirm|alert|prompt)\s*\(/.test(text),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

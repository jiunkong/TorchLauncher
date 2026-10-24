import { describe, expect, it } from 'vitest';
import { sameContent } from './canonical';

describe('sameContent', () => {
  it('ignores key order at every depth', () => {
    expect(
      sameContent(
        { a: 1, b: { c: [1, { x: 1, y: 2 }], d: 'z' } },
        { b: { d: 'z', c: [1, { y: 2, x: 1 }] }, a: 1 },
      ),
    ).toBe(true);
  });
  it('detects different content, including nested values and array order', () => {
    expect(sameContent({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameContent({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameContent({ a: [{ k: 1 }] }, { a: [{ k: 1 }, { k: 2 }] })).toBe(false);
    expect(sameContent({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameContent({ a: null }, { a: 0 })).toBe(false);
  });
  it('treats a missing optional field like undefined', () => {
    expect(sameContent({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameContent({ a: 1, b: { c: undefined } }, { a: 1, b: {} })).toBe(true);
    expect(sameContent({ a: 1, b: undefined }, { a: 1, b: null })).toBe(false);
    expect(sameContent(undefined, undefined)).toBe(true);
    expect(sameContent(undefined, {})).toBe(false);
  });
});

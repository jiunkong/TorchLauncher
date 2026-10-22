import { describe, expect, it } from 'vitest';
import {
  defaultMaxMemoryMiB,
  exceedsRecommendedPhysicalMemory,
  memoryLimitMiB,
  parseMemoryGiB,
  scrubMemoryMiB,
  validGameMemory,
} from './memory';

it('converts GB fields exactly and rejects empty, fractional-MiB, and non-finite values', () => {
  expect(defaultMaxMemoryMiB).toBe(2048);
  expect(parseMemoryGiB('2')).toBe(2048);
  expect(parseMemoryGiB('0.25')).toBe(256);
  expect(parseMemoryGiB('')).toBeNull();
  expect(parseMemoryGiB('0.0001')).toBeNull();
  expect(parseMemoryGiB('Infinity')).toBeNull();
});

describe('memory scrubbing', () => {
  it('adjusts in MiB steps and clamps to the current legal bounds', () => {
    expect(scrubMemoryMiB(1024, 40, 512, 8192)).toBe(1536);
    expect(scrubMemoryMiB(1024, -40, 512, 8192)).toBe(512);
    expect(scrubMemoryMiB(1024, -60, 512, 8192)).toBe(512);
    expect(scrubMemoryMiB(2048, 2000, 512, 3072)).toBe(3072);
    expect(scrubMemoryMiB(256, -100, 256, 1024)).toBe(256);
  });
});

it('validates physical and JVM bounds, including the optional initial memory', () => {
  expect(memoryLimitMiB(70000)).toBe(65536);
  expect(validGameMemory(4096, 256, 8192)).toBe(true);
  expect(validGameMemory(4096, 4097, 8192)).toBe(false);
  expect(validGameMemory(4096, 256, 2048)).toBe(false);
  expect(validGameMemory(512, undefined, 512)).toBe(true);
  expect(validGameMemory(2048, undefined, 384)).toBe(false);
});

it('flags values above three quarters of physical RAM', () => {
  expect(exceedsRecommendedPhysicalMemory(6144, 8192)).toBe(false);
  expect(exceedsRecommendedPhysicalMemory(6145, 8192)).toBe(true);
});

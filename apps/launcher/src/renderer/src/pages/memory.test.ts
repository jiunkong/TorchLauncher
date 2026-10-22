import { expect, it } from 'vitest';
import {
  defaultMaxMemoryMiB,
  exceedsRecommendedPhysicalMemory,
  memoryLimitMiB,
  parseMemoryGiB,
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

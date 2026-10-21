import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    // Windows file locking/fsync/rename are slow under parallel load, so allow longer per-test and hook timeouts.
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
    hookTimeout: process.platform === 'win32' ? 60_000 : 10_000,
    clearMocks: true,
    restoreMocks: true,
  },
});

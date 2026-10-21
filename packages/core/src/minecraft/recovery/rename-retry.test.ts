import { describe, expect, it } from 'vitest';
import { renameWithRetry } from '../lock';

const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });

describe('renameWithRetry (Windows transient sharing violations)', () => {
  it('retries EPERM/EACCES/EBUSY on win32 and then succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    await renameWithRetry('a', 'b', {
      platform: 'win32',
      rename: async () => {
        if (++calls < 3) throw busy();
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(calls).toBe(3);
    expect(waits).toHaveLength(2);
  });

  it('gives up after the attempt limit and rethrows the last error', async () => {
    let calls = 0;
    await expect(
      renameWithRetry('a', 'b', {
        platform: 'win32',
        attempts: 3,
        rename: async () => {
          calls++;
          throw busy();
        },
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
    expect(calls).toBe(3);
  });

  it('never retries ENOENT, and never retries on Linux', async () => {
    let calls = 0;
    const fail = (code: string) => async () => {
      calls++;
      throw Object.assign(new Error(code), { code });
    };
    await expect(
      renameWithRetry('a', 'b', { platform: 'win32', rename: fail('ENOENT') }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      renameWithRetry('a', 'b', { platform: 'linux', rename: fail('EBUSY') }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
    expect(calls).toBe(2);
  });
});

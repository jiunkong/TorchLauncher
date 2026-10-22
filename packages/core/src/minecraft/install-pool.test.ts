import { describe, expect, it } from 'vitest';
import { runInstallPool } from './install-pool';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('install worker admission and draining', () => {
  it('overlaps work, bounds active tasks and admits new work only as slots free', async () => {
    const gates = Array.from({ length: 8 }, gate);
    const started: number[] = [];
    let active = 0;
    let maximum = 0;
    const full = gate();
    const next = gate();
    const pending = runInstallPool(
      gates,
      3,
      () => 1,
      async (item, index) => {
        started.push(index);
        active++;
        maximum = Math.max(maximum, active);
        if (started.length === 3) full.resolve();
        if (started.length === 4) next.resolve();
        await item.promise;
        active--;
      },
    );
    await full.promise;
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve();
    await next.promise;
    expect(started).toEqual([0, 1, 2, 3]);
    for (const item of gates) item.resolve();
    await pending;
    expect(maximum).toBe(3);
    expect(active).toBe(0);
  });

  it('limits expected buffered bytes and runs an oversized item alone', async () => {
    const gates = Array.from({ length: 4 }, gate);
    const started: number[] = [];
    const entered = gates.map(() => gate());
    const sizes = [80, 80, 160, 1].map((size) => size * 1024 * 1024);
    const pending = runInstallPool(
      sizes,
      6,
      (size) => size,
      async (_, index) => {
        started.push(index);
        entered[index]?.resolve();
        await gates[index]?.promise;
      },
    );
    await entered[0]?.promise;
    expect(started).toEqual([0]);
    gates[0]?.resolve();
    await entered[1]?.promise;
    expect(started).toEqual([0, 1]);
    gates[1]?.resolve();
    await entered[2]?.promise;
    expect(started).toEqual([0, 1, 2]);
    gates[2]?.resolve();
    await entered[3]?.promise;
    gates[3]?.resolve();
    await pending;
  });

  it('keeps the first failure, aborts siblings and waits for signal-ignoring work', async () => {
    const release = gate();
    const failed = gate();
    const error = new Error('integrity failure');
    const started: number[] = [];
    let siblingSignal: AbortSignal | undefined;
    let settled = false;
    const pending = runInstallPool(
      [0, 1, 2],
      2,
      () => 1,
      async (_, index, signal) => {
        started.push(index);
        if (index === 0) {
          await failed.promise;
          throw error;
        }
        siblingSignal = signal;
        await release.promise;
        signal.throwIfAborted();
      },
    );
    const outcome = pending.catch((cause: unknown) => {
      settled = true;
      return cause;
    });
    failed.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(started).toEqual([0, 1]);
    expect(siblingSignal?.aborted).toBe(true);
    expect(settled).toBe(false);
    release.resolve();
    expect(await outcome).toBe(error);
  });

  it('drains on external cancellation and never admits remaining work', async () => {
    const controller = new AbortController();
    const release = gate();
    const started: number[] = [];
    let drained = false;
    const pending = runInstallPool(
      [0, 1, 2],
      2,
      () => 1,
      async (_, index) => {
        started.push(index);
        await release.promise;
        drained = true;
      },
      controller.signal,
    );
    const outcome = pending.catch((error: unknown) => error);
    controller.abort();
    expect(drained).toBe(false);
    expect(started).toEqual([0, 1]);
    release.resolve();
    expect(await outcome).toBe(controller.signal.reason);
    expect(drained).toBe(true);
  });
});

import { expect, it } from 'vitest';
import { Operations } from './operations';

it('holds exclusive ownership through cancellation cleanup and rejects new work after close', async () => {
  const operations = new Operations();
  let release: () => void = () => {};
  let signal: AbortSignal | undefined;
  const work = operations.run(async (next) => {
    signal = next;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await Promise.resolve();
  operations.cancel();
  expect(signal?.aborted).toBe(true);
  await expect(operations.run(async () => {})).rejects.toThrow('busy');
  let closed = false;
  const close = operations.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(operations.busy).toBe(true);
  release();
  await work;
  await close;
  expect(closed).toBe(true);
  await expect(operations.run(async () => {})).rejects.toThrow('busy');
});

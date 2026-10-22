/** Buffered downloads share this expected-byte budget; an oversized file runs alone. */
const IN_FLIGHT_BYTES = 128 * 1024 * 1024;

/** Stop admission on failure and drain every started operation before rejecting. */
export async function runInstallPool<T>(
  items: readonly T[],
  concurrency: number,
  size: (item: T) => number,
  run: (item: T, index: number, signal: AbortSignal) => Promise<void>,
  parent?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const signal = controller.signal;
  let failed = false;
  let failure: unknown;
  let next = 0;
  let active = 0;
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      failure = error;
      controller.abort(error);
    };
    const onAbort = () => {
      fail(parent?.reason);
      pump();
    };
    const pump = () => {
      if (failed || next === items.length) {
        if (active === 0) {
          parent?.removeEventListener('abort', onAbort);
          if (failed) reject(failure);
          else resolve();
        }
        return;
      }
      while (!failed && active < concurrency && next < items.length) {
        const index = next;
        const item = items[index] as T;
        const weight = size(item);
        if (active > 0 && bytes + weight > IN_FLIGHT_BYTES) break;
        next++;
        active++;
        bytes += weight;
        // The rejection handler is attached immediately, including synchronous adapter failures.
        void (async () => {
          try {
            signal.throwIfAborted();
            await run(item, index, signal);
          } catch (error) {
            fail(error);
          } finally {
            active--;
            bytes -= weight;
            pump();
          }
        })();
      }
    };
    parent?.addEventListener('abort', onAbort, { once: true });
    if (parent?.aborted) onAbort();
    else pump();
  });
}

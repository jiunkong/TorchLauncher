import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
/** Private per-bundle control file: parent must not use TerminateProcess on the Java-owning host. */
export function watchCancellation(path: string, cancel: () => void, intervalMs = 200): () => void {
  let busy = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (busy || stopped) return;
    busy = true;
    void (async () => {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 6) return;
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const bytes = Buffer.alloc(7);
        const read = await handle.read(bytes, 0, 7, 0);
        if (read.bytesRead === 6 && bytes.subarray(0, 6).toString() === 'cancel') {
          stopped = true;
          clearInterval(timer);
          cancel();
        }
      } finally {
        await handle.close();
      }
    })()
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

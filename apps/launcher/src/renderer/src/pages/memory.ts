export const defaultMaxMemoryMiB = 2048;
export const minimumMaxMemoryMiB = 512;
export const minimumInitialMemoryMiB = 256;
export const maximumMemoryMiB = 65536;

export function parseMemoryGiB(value: string): number | null {
  if (!value.trim()) return null;
  const gib = Number(value);
  if (!Number.isFinite(gib) || gib <= 0) return null;
  const mib = gib * 1024;
  return Number.isSafeInteger(mib) ? mib : null;
}

export function memoryLimitMiB(physicalMemoryMiB: number): number {
  if (!Number.isSafeInteger(physicalMemoryMiB) || physicalMemoryMiB < 0) return 0;
  return Math.min(maximumMemoryMiB, physicalMemoryMiB);
}

export function validGameMemory(
  maxMemoryMiB: number,
  initialMemoryMiB: number | undefined,
  physicalMemoryMiB: number,
): boolean {
  const limit = memoryLimitMiB(physicalMemoryMiB);
  return (
    limit >= minimumMaxMemoryMiB &&
    Number.isSafeInteger(maxMemoryMiB) &&
    maxMemoryMiB >= minimumMaxMemoryMiB &&
    maxMemoryMiB <= limit &&
    (initialMemoryMiB === undefined ||
      (Number.isSafeInteger(initialMemoryMiB) &&
        initialMemoryMiB >= minimumInitialMemoryMiB &&
        initialMemoryMiB <= maxMemoryMiB))
  );
}

export function exceedsRecommendedPhysicalMemory(maxMemoryMiB: number, physicalMemoryMiB: number) {
  return maxMemoryMiB > physicalMemoryMiB * 0.75;
}

export interface EffectiveMemory {
  maxMemoryMiB: number;
  initialMemoryMiB?: number;
}

/** Mirrors the launch-time rule: player value, else server default, else built-in; no Xms above Xmx. */
export function effectiveGameMemory(
  player: { maxMemoryMiB?: number; initialMemoryMiB?: number },
  server?: { maxMiB: number; initialMiB?: number },
): EffectiveMemory {
  const maxMemoryMiB = player.maxMemoryMiB ?? server?.maxMiB ?? defaultMaxMemoryMiB;
  const initial = player.initialMemoryMiB ?? server?.initialMiB;
  return initial !== undefined && initial >= minimumInitialMemoryMiB && initial <= maxMemoryMiB
    ? { maxMemoryMiB, initialMemoryMiB: initial }
    : { maxMemoryMiB };
}

export function formatGiB(mib: number): string {
  return String(Number((mib / 1024).toFixed(2)));
}

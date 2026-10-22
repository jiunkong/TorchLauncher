import { describe, expect, it } from 'vitest';
import { installDragGuard } from './dragGuard';

describe('drag guard', () => {
  it('cancels dragover, drop and dragstart defaults', () => {
    const handlers = new Map<string, (event: { type: string; preventDefault(): void }) => void>();
    installDragGuard({ addEventListener: (type, listener) => handlers.set(type, listener) });
    for (const type of ['dragover', 'drop', 'dragstart']) {
      let prevented = false;
      handlers.get(type)?.({ type, preventDefault: () => (prevented = true) });
      expect(prevented, type).toBe(true);
    }
  });
});

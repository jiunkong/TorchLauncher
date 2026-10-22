import { describe, expect, it } from 'vitest';
import { homePrimaryCommand, homePrimaryDisabled, operationControl } from './flow';

describe('home primary action', () => {
  it('offers login before play when no account has been restored', () => {
    const command = homePrimaryCommand({ configuration: 'ready', supported: true, account: null });
    expect(command).toEqual({
      type: 'login',
    });
    expect(homePrimaryDisabled(command, false)).toBe(false);
    expect(homePrimaryDisabled(command, true)).toBe(true);
  });

  it('offers play for a restored account', () => {
    expect(
      homePrimaryCommand({
        configuration: 'ready',
        supported: true,
        account: { name: 'Player', expiresAt: 1 },
      }),
    ).toEqual({ type: 'launch' });
  });

  it('disables the primary action for unavailable configuration or unsupported systems', () => {
    expect(
      homePrimaryCommand({ configuration: 'unavailable', supported: true, account: null }),
    ).toBeNull();
    expect(
      homePrimaryCommand({ configuration: 'ready', supported: false, account: null }),
    ).toBeNull();
    expect(homePrimaryDisabled(null, false)).toBe(true);
  });

  it('offers cancel for an active operation and stop for a running game', () => {
    expect(operationControl({ running: false, operation: 'launch' })).toBe('cancel');
    expect(operationControl({ running: true, operation: 'launch' })).toBe('stop');
    expect(operationControl({ running: false, operation: null })).toBeNull();
  });
});

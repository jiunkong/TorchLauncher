import { describe, expect, it, vi } from 'vitest';
import { type JavaFlowFactory, runPublicJavaFlow } from './public-java-flow';
import type { JavaCacheSnapshot } from './public-java-protocol';
import { verifyJavaAccount } from './public-java-validation';

const profile = { id: '0123456789abcdef0123456789abcdef', name: 'TorchPlayer' };

function setup() {
  const initial: JavaCacheSnapshot = {
    version: 1,
    caches: {
      sisu: { token: { refresh_token: 'synthetic-refresh' } },
      xbl: { oldProofToken: true },
      mca: { oldMinecraftToken: true },
    },
  };
  const persist = vi.fn(async () => {});
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ name: 'game_minecraft' }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify(profile)));
  const onCode = vi.fn();
  const createFlow: JavaFlowFactory = (factory) => {
    const mca = factory({ cacheName: 'mca', username: 'internal' });
    const xbl = factory({ cacheName: 'xbl', username: 'internal' });
    const sisu = factory({ cacheName: 'sisu', username: 'internal' });
    return {
      async getMinecraftJavaToken() {
        expect(await mca.getCached()).toEqual({});
        expect(await xbl.getCached()).toEqual({});
        expect(await sisu.getCached()).toEqual(initial.caches.sisu);
        // Model upstream's deliberately unawaited cache calls.
        void mca.setCached({
          mca: { obtainedOn: Date.now(), expires_in: 3600, access_token: 'synthetic-token' },
        });
        void sisu.setCachedPartial({ refreshed: true });
        return { token: 'synthetic-token' };
      },
    };
  };
  return { initial, persist, request, onCode, createFlow, mode: 'login' as const };
}

describe('public Java library boundary', () => {
  it('provides only memory caches, replaces old proof/token caches and independently validates ownership/profile', async () => {
    const ctx = setup();
    const result = await runPublicJavaFlow(ctx);
    expect(result).toMatchObject({
      profile,
      accessToken: 'synthetic-token',
      clientId: '00000000402b5328',
    });
    expect(ctx.request).toHaveBeenCalledTimes(2);
    expect(ctx.persist).toHaveBeenCalledTimes(2);
    expect(ctx.initial.caches.xbl).toEqual({ oldProofToken: true });
  });

  it('waits for the unawaited library cache writes before success', async () => {
    const ctx = setup();
    let finish: () => void = () => {};
    const write = new Promise<void>((resolve) => {
      finish = resolve;
    });
    ctx.persist.mockImplementation(async () => write);
    let done = false;
    const task = runPublicJavaFlow(ctx).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(ctx.request).toHaveBeenCalledTimes(2));
    expect(done).toBe(false);
    finish();
    await task;
    expect(done).toBe(true);
  });

  it('does not report success if an unawaited cache write fails', async () => {
    const ctx = setup();
    ctx.persist.mockRejectedValue(new Error('synthetic-write-failure'));
    await expect(runPublicJavaFlow(ctx)).rejects.toThrow();
  });

  it('rejects a missing Java entitlement even when the library returns a token', async () => {
    const ctx = setup();
    ctx.request.mockReset().mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    await expect(runPublicJavaFlow(ctx)).rejects.toMatchObject({
      code: 'game_not_owned',
      stage: 'entitlements',
    });
    expect(ctx.request).toHaveBeenCalledOnce();
  });

  it('rejects an absent profile after ownership succeeds', async () => {
    const ctx = setup();
    ctx.request
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ name: 'game_minecraft' }] })))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(runPublicJavaFlow(ctx)).rejects.toMatchObject({
      code: 'profile_required',
      stage: 'profile',
    });
  });

  it('does not allow refresh to silently become interactive login', async () => {
    const ctx = setup();
    const createFlow: JavaFlowFactory = (_factory, callback) => ({
      async getMinecraftJavaToken() {
        callback({ user_code: '', expires_in: 300 });
        return { token: '' };
      },
    });
    await expect(runPublicJavaFlow({ ...ctx, createFlow, mode: 'refresh' })).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    expect(ctx.onCode).not.toHaveBeenCalled();
  });

  it('rejects an expired or malformed Minecraft credential before any entitlement request', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(verifyJavaAccount('synthetic', Date.now() - 1, request)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(
      verifyJavaAccount('synthetic\ninvalid', Date.now() + 60_000, request),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(request).not.toHaveBeenCalled();
  });
});

import { createServer, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { pingServer } from './index';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
function integer(value: number) {
  const bytes = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}
const packet = (body: Buffer) => Buffer.concat([integer(body.length), body]);
async function server(onConnection: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        listener.close(() => resolve());
      }),
  );
  return `127.0.0.1:${(listener.address() as { port: number }).port}`;
}
it('accepts fragmented frames and returns bounded counts/version plus nonce-matched latency only', async () => {
  const address = await server((socket) => {
    let asked = false;
    socket.on('data', (bytes) => {
      if (!asked) {
        asked = true;
        const json = Buffer.from(
          JSON.stringify({
            players: { online: 2, max: 20 },
            version: { name: '§a1.21.1' },
            description: '<script>evil</script>',
            favicon: 'untrusted',
          }),
        );
        const response = packet(Buffer.concat([Buffer.from([0]), integer(json.length), json]));
        socket.write(response.subarray(0, 1));
        setTimeout(() => socket.write(response.subarray(1)), 5);
      } else socket.write(bytes);
    });
  });
  const status = await pingServer(address);
  expect(status).toEqual({
    online: 2,
    maximum: 20,
    version: '1.21.1',
    latencyMs: expect.any(Number),
  });
});
it('rejects unbounded lengths, overlong VarInts, malformed JSON and mismatched pong', async () => {
  for (const payload of [
    integer(131073),
    Buffer.from([255, 255, 255, 255, 255, 0]),
    packet(Buffer.from([0, 1, 123])),
  ]) {
    const address = await server((socket) => {
      socket.once('data', () => socket.write(payload));
    });
    await expect(pingServer(address)).rejects.toMatchObject({ code: 'invalid-response' });
  }
  const address = await server((socket) => {
    const json = Buffer.from('{"players":{"online":1,"max":10},"version":{"name":"test"}}');
    socket.once('data', () =>
      socket.write(packet(Buffer.concat([Buffer.from([0]), integer(json.length), json]))),
    );
    socket.on('data', (bytes) => {
      if (bytes.length === 10) socket.write(packet(Buffer.alloc(9)));
    });
  });
  await expect(pingServer(address)).rejects.toMatchObject({ code: 'invalid-response' });
});
it('times out or cancels silent peers and closes the socket', async () => {
  const address = await server(() => {});
  await expect(pingServer(address, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  const abort = new AbortController();
  const pending = pingServer(address, { signal: abort.signal });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
});

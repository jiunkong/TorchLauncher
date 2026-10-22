import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

// Protocol reference: https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping
const MAX_PACKET = 128 * 1024;
export interface ServerStatus {
  online: number;
  maximum: number;
  latencyMs: number;
  version: string;
}
export class ServerStatusError extends Error {
  constructor(
    readonly code: 'invalid-address' | 'invalid-response' | 'unavailable' | 'timeout' | 'cancelled',
  ) {
    super(code);
  }
}
function fail(): never {
  throw new ServerStatusError('invalid-response');
}
function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}
function readInt(bytes: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined) return null;
    if (i === 4 && byte > 7) fail();
    value += (byte & 127) * 2 ** (i * 7);
    if (!(byte & 128)) return { value, size: i + 1 };
  }
  return fail();
}
const packet = (bytes: Buffer) => Buffer.concat([varint(bytes.length), bytes]);
export function parseServerAddress(address: string): { host: string; port: number } {
  if (typeof address !== 'string' || address.length > 260)
    throw new ServerStatusError('invalid-address');
  const match = /^(?:\[([0-9a-fA-F:]+)\]|([a-zA-Z0-9.-]+))(?::([0-9]{1,5}))?$/.exec(address);
  const host = match?.[1] ?? match?.[2];
  const port = Number(match?.[3] ?? 25565);
  if (!host || port < 1 || port > 65535) throw new ServerStatusError('invalid-address');
  return { host, port };
}
/** Bounded status + nonce-matched pong. No MOTD, favicon, sample names or markup cross this API. */
export async function pingServer(
  address: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ServerStatus> {
  const { host, port } = parseServerAddress(address);
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new ServerStatusError('invalid-address');
  if (options.signal?.aborted) throw new ServerStatusError('cancelled');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let received = 0;
    let status: Omit<ServerStatus, 'latencyMs'> | undefined;
    const nonce = randomBytes(8);
    let sent = 0;
    let done = false;
    const finish = (error?: ServerStatusError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error);
      else if (status)
        resolve({ ...status, latencyMs: Math.max(0, Math.round(performance.now() - sent)) });
    };
    const abort = () => finish(new ServerStatusError('cancelled'));
    const timer = setTimeout(() => finish(new ServerStatusError('timeout')), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    socket.once('error', () => finish(new ServerStatusError('unavailable')));
    socket.once('close', () => finish(new ServerStatusError('unavailable')));
    socket.once('connect', () => {
      const hostname = Buffer.from(host);
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      socket.write(
        Buffer.concat([
          packet(
            Buffer.concat([
              varint(0),
              varint(767),
              varint(hostname.length),
              hostname,
              portBytes,
              varint(1),
            ]),
          ),
          packet(Buffer.from([0])),
        ]),
      );
    });
    socket.on('data', (chunk: Buffer) => {
      if (done) return;
      try {
        received += chunk.length;
        if (received > MAX_PACKET + 32) fail();
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length) {
          const length = readInt(buffer);
          if (!length) return;
          if (length.value < 1 || length.value > MAX_PACKET) fail();
          if (buffer.length < length.size + length.value) return;
          const body = buffer.subarray(length.size, length.size + length.value);
          buffer = buffer.subarray(length.size + length.value);
          if (!status) {
            if (body[0] !== 0) fail();
            const size = readInt(body, 1);
            if (!size || size.value !== body.length - 1 - size.size) fail();
            const raw = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(1 + size.size)),
            );
            if (!raw || typeof raw !== 'object' || !raw.players || !raw.version) fail();
            const { online, max } = raw.players;
            const name: unknown = raw.version.name;
            if (
              !Number.isSafeInteger(online) ||
              !Number.isSafeInteger(max) ||
              online < 0 ||
              max < 0 ||
              online > 1000000 ||
              max > 1000000 ||
              typeof name !== 'string' ||
              name.length > 128
            )
              fail();
            status = { online, maximum: max, version: name.replace(/[\p{Cc}\p{Cf}]|§./gu, '') };
            sent = performance.now();
            socket.write(packet(Buffer.concat([Buffer.from([1]), nonce])));
          } else {
            if (
              body.length !== 9 ||
              body[0] !== 1 ||
              !body.subarray(1).equals(nonce) ||
              buffer.length
            )
              fail();
            finish();
            return;
          }
        }
      } catch {
        finish(new ServerStatusError('invalid-response'));
      }
    });
    if (options.signal?.aborted) abort();
  });
}

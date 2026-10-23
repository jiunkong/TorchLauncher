import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, lstat, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { noLinks } from './filesystem.js';
import { StudioFailure } from './project.js';

/**
 * Minimal ZIP writer (no ZIP64): UTF-8 names, deflate for in-memory entries, stored for files.
 * Every size and offset must fit 32 bits; larger input is refused with TOO_LARGE.
 */
export const ZIP_LIMITS = { entries: 64, nameBytes: 255, total: 0xffff_fff0 } as const;
export interface ZipBufferEntry {
  name: string;
  mode: number;
  data: Buffer;
}
export interface ZipFileEntry {
  name: string;
  mode: number;
  /** Absolute path; opened without following links and re-read to catch changes while writing. */
  path: string;
  /** Largest accepted size. */
  maxSize: number;
}
export type ZipEntry = ZipBufferEntry | ZipFileEntry;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected on purpose.
const BAD_CHARS = /[\u0000-\u001f\u007f\\]/;
export function validateZipName(name: string): void {
  if (
    !name ||
    Buffer.byteLength(name) > ZIP_LIMITS.nameBytes ||
    BAD_CHARS.test(name) ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.normalize('NFC') !== name ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new StudioFailure('INVALID');
}
function dosTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
function localHeader(
  name: Buffer,
  method: number,
  crc: number,
  csize: number,
  usize: number,
  stamp: { time: number; date: number },
): Buffer {
  const h = Buffer.alloc(30 + name.length);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6);
  h.writeUInt16LE(method, 8);
  h.writeUInt16LE(stamp.time, 10);
  h.writeUInt16LE(stamp.date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(csize, 18);
  h.writeUInt32LE(usize, 22);
  h.writeUInt16LE(name.length, 26);
  name.copy(h, 30);
  return h;
}
interface Written {
  name: Buffer;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  mode: number;
  offset: number;
}
async function writeAll(handle: FileHandle, data: Buffer, position: number): Promise<void> {
  let done = 0;
  while (done < data.length) {
    const { bytesWritten } = await handle.write(data, done, data.length - done, position + done);
    if (!bytesWritten) throw new StudioFailure('IO');
    done += bytesWritten;
  }
}
async function fileCrc(
  handle: FileHandle,
  size: number,
  signal: AbortSignal,
  sink?: (chunk: Buffer) => Promise<void>,
): Promise<number> {
  const buffer = Buffer.alloc(1024 * 1024);
  let crc = 0;
  let position = 0;
  while (position < size) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (!bytesRead) throw new StudioFailure('IO');
    const chunk = buffer.subarray(0, bytesRead);
    crc = crc32(chunk, crc);
    if (sink) await sink(chunk);
    position += bytesRead;
  }
  return crc >>> 0;
}
/**
 * Writes `entries` to `destination` through a temporary file in the same directory and renames it
 * into place. On any failure or abort the temporary file is removed and `destination` is untouched.
 */
export async function writeZip(
  destination: string,
  entries: readonly ZipEntry[],
  signal: AbortSignal,
  progress: (bytes: number) => void = () => {},
): Promise<number> {
  if (!/\.zip$/i.test(destination) || !entries.length || entries.length > ZIP_LIMITS.entries)
    throw new StudioFailure('INVALID');
  const seen = new Set<string>();
  for (const entry of entries) {
    validateZipName(entry.name);
    const folded = entry.name.toLowerCase();
    if (seen.has(folded)) throw new StudioFailure('INVALID');
    seen.add(folded);
  }
  const directory = dirname(destination);
  await noLinks(directory);
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new StudioFailure('INVALID');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stamp = dosTime(new Date());
  const temporary = join(directory, `.torchstudio-${randomUUID()}.tmp`);
  const out = await open(temporary, 'wx', 0o600);
  let finished = false;
  try {
    let offset = 0;
    const written: Written[] = [];
    const append = async (data: Buffer) => {
      if (offset + data.length > ZIP_LIMITS.total) throw new StudioFailure('TOO_LARGE');
      await writeAll(out, data, offset);
      offset += data.length;
      progress(offset);
    };
    for (const entry of entries) {
      signal.throwIfAborted();
      const name = Buffer.from(entry.name, 'utf8');
      const start = offset;
      if ('data' in entry) {
        const raw = entry.data;
        if (raw.length > ZIP_LIMITS.total) throw new StudioFailure('TOO_LARGE');
        const packed = deflateRawSync(raw);
        const useDeflate = packed.length < raw.length;
        const body = useDeflate ? packed : raw;
        const crc = crc32(raw) >>> 0;
        await append(localHeader(name, useDeflate ? 8 : 0, crc, body.length, raw.length, stamp));
        await append(body);
        written.push({
          name,
          method: useDeflate ? 8 : 0,
          crc,
          csize: body.length,
          usize: raw.length,
          mode: entry.mode,
          offset: start,
        });
        continue;
      }
      await noLinks(entry.path);
      const before = await lstat(entry.path);
      const input = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await input.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.dev !== before.dev ||
          info.ino !== before.ino
        )
          throw new StudioFailure('INVALID');
        if (info.size > entry.maxSize || info.size > ZIP_LIMITS.total)
          throw new StudioFailure('TOO_LARGE');
        // Pass 1 computes the CRC for the header; pass 2 copies and must see the same bytes.
        const crc = await fileCrc(input, info.size, signal);
        await append(localHeader(name, 0, crc, info.size, info.size, stamp));
        let copied = 0;
        const second = await fileCrc(input, info.size, signal, async (chunk) => {
          copied += chunk.length;
          await append(Buffer.from(chunk));
        });
        const after = await input.stat();
        if (
          second !== crc ||
          copied !== info.size ||
          after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs
        )
          throw new StudioFailure('IO');
        written.push({
          name,
          method: 0,
          crc,
          csize: info.size,
          usize: info.size,
          mode: entry.mode,
          offset: start,
        });
      } finally {
        await input.close();
      }
    }
    const central = offset;
    for (const w of written) {
      const c = Buffer.alloc(46 + w.name.length);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE((3 << 8) | 63, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(w.method, 10);
      c.writeUInt16LE(stamp.time, 12);
      c.writeUInt16LE(stamp.date, 14);
      c.writeUInt32LE(w.crc, 16);
      c.writeUInt32LE(w.csize, 20);
      c.writeUInt32LE(w.usize, 24);
      c.writeUInt16LE(w.name.length, 28);
      c.writeUInt32LE(((0o100000 | (w.mode & 0o777)) << 16) >>> 0, 38);
      c.writeUInt32LE(w.offset, 42);
      w.name.copy(c, 46);
      await append(c);
    }
    const size = offset - central;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(central, 16);
    await append(end);
    signal.throwIfAborted();
    await out.sync();
    await out.chmod(0o644);
    await out.close();
    finished = true;
    await noLinks(directory);
    await rename(temporary, destination);
    return offset;
  } finally {
    if (!finished) await out.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}

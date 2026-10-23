import { crc32, inflateRawSync } from 'node:zlib';

export interface ReadZipEntry {
  data: Buffer;
  mode: number;
  method: number;
}
/** Strict reader for the ZIPs Studio writes (no ZIP64, no data descriptors). Throws on any inconsistency. */
export function readZip(zip: Buffer): Map<string, ReadZipEntry> {
  const end = zip.length - 22;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0)
    throw new Error('missing end of central directory');
  const count = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const start = zip.readUInt32LE(end + 16);
  if (start + size !== end) throw new Error('central directory does not end at EOCD');
  const entries = new Map<string, ReadZipEntry>();
  let p = start;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28);
    const attr = zip.readUInt32LE(p + 38);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nlen).toString('utf8');
    if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error('bad local header');
    if (zip.readUInt16LE(offset + 26) !== nlen) throw new Error('name length differs');
    const body = offset + 30 + nlen;
    const raw = zip.subarray(body, body + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (method !== 0 && method !== 8) throw new Error('unsupported method');
    if (data.length !== usize || crc32(data) >>> 0 !== crc) throw new Error(`bad entry ${name}`);
    if (entries.has(name)) throw new Error('duplicate entry');
    entries.set(name, { data, mode: (attr >>> 16) & 0o777, method });
    p += 46 + nlen;
  }
  if (p !== end) throw new Error('trailing central directory data');
  return entries;
}

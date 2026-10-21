import { crc32, inflateRawSync } from 'node:zlib';
/** Read a single bounded JSON entry; never extract archive paths to disk. ZIP64/encryption unsupported. */
export function jarJson(
  bytes: Uint8Array,
  wanted: 'install_profile.json' | 'version.json',
): unknown {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let position = data.length - 22; position >= Math.max(0, data.length - 65557); position--) {
    if (
      data.readUInt32LE(position) === 0x06054b50 &&
      position + 22 + data.readUInt16LE(position + 20) === data.length
    ) {
      end = position;
      break;
    }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6))
    throw new Error('Invalid installer archive');
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  if (count > 10000 || offset + data.readUInt32LE(end + 12) !== end)
    throw new Error('Invalid archive directory');
  let result: unknown;
  let found = false;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('Invalid archive entry');
    const nameLength = data.readUInt16LE(offset + 28),
      extra = data.readUInt16LE(offset + 30),
      comment = data.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > end) throw new Error('Invalid archive entry length');
    if (data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8') === wanted) {
      if (found) throw new Error('Duplicate installer profile');
      found = true;
      const flags = data.readUInt16LE(offset + 8),
        method = data.readUInt16LE(offset + 10),
        crc = data.readUInt32LE(offset + 16),
        compressed = data.readUInt32LE(offset + 20),
        size = data.readUInt32LE(offset + 24),
        local = data.readUInt32LE(offset + 42);
      if (
        flags & 1 ||
        size > 4 * 1024 * 1024 ||
        compressed > 8 * 1024 * 1024 ||
        local + 30 > offset ||
        data.readUInt32LE(local) !== 0x04034b50
      )
        throw new Error('Unsafe archive profile');
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      if (start + compressed > offset) throw new Error('Invalid archive payload');
      const input = data.subarray(start, start + compressed);
      const output =
        method === 0
          ? input
          : method === 8
            ? inflateRawSync(input, { maxOutputLength: 4 * 1024 * 1024 })
            : undefined;
      if (!output || output.length !== size || crc32(output) !== crc)
        throw new Error('Archive integrity mismatch');
      result = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(output));
    }
    offset = next;
  }
  if (!found || offset !== end) throw new Error('Missing installer profile');
  return result;
}

import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { jarJson } from './archive';

function jar() {
  const name = Buffer.from('install_profile.json'),
    data = Buffer.from('{"minecraft":"1.21.1"}');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt32LE(crc32(data), 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  const start = 30 + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(start, 16);
  return Buffer.concat([local, name, data, directory, name, end]);
}
it('reads a bounded JSON entry without extracting paths', () => {
  expect(jarJson(jar(), 'install_profile.json')).toEqual({ minecraft: '1.21.1' });
});
it('rejects truncated directories and absent profiles', () => {
  expect(() => jarJson(jar().subarray(0, 30), 'install_profile.json')).toThrow();
  expect(() => jarJson(jar(), 'version.json')).toThrow();
});
it('rejects CRC and uncompressed-size corruption', () => {
  let bytes = jar();
  bytes[30 + 'install_profile.json'.length] = 0;
  expect(() => jarJson(bytes, 'install_profile.json')).toThrow('integrity');
  bytes = jar();
  const directory = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt32LE(5 * 1024 * 1024, directory + 24);
  expect(() => jarJson(bytes, 'install_profile.json')).toThrow('Unsafe');
});

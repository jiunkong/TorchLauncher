import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { maybeStat } from '../sync/safety.js';
import { USER_MOD_LIMITS as L, UserModError } from './errors.js';

export type JarWarningCode =
  | 'mod-id-unavailable'
  | 'metadata-unreadable'
  | 'zip64-unsupported'
  | 'unsupported-compression';

export interface JarInfo {
  readonly modIds: readonly string[];
  readonly loaders: readonly ('fabric' | 'neoforge')[];
  readonly warnings: readonly JarWarningCode[];
}

const FABRIC = 'fabric.mod.json';
const NEOFORGE = 'META-INF/neoforge.mods.toml';
const MOD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u;

export function isValidModId(id: unknown): id is string {
  return typeof id === 'string' && MOD_ID.test(id);
}

function invalid(): never {
  throw new UserModError('invalid-jar');
}

/** Extracts [[mods]] modId values; other tables (e.g. dependencies) also carry modId and are ignored. */
export function parseNeoForgeModIds(text: string): string[] {
  const ids: string[] = [];
  let inMods = false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/u.exec(line);
    if (header) {
      inMods = line.startsWith('[[') && header[1] === 'mods';
      continue;
    }
    if (!inMods) continue;
    const match = /^modId\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(#.*)?$/u.exec(line);
    const id = match?.[1] ?? match?.[2];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function parseFabricModIds(text: string): string[] {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') return [];
  const entry = value as { id?: unknown; provides?: unknown };
  const ids: string[] = [];
  if (typeof entry.id === 'string') ids.push(entry.id);
  if (Array.isArray(entry.provides))
    for (const provided of entry.provides) if (typeof provided === 'string') ids.push(provided);
  return ids;
}

interface CentralEntry {
  readonly method: number;
  readonly flags: number;
  readonly compressed: number;
  readonly uncompressed: number;
  readonly offset: number;
}

async function readAt(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(bytes, done, length - done, position + done);
    if (bytesRead === 0) invalid();
    done += bytesRead;
  }
  return bytes;
}

/**
 * Minimal, bounded ZIP reader that only extracts two metadata entries. Structural corruption and
 * resource-limit violations throw invalid-jar; metadata that merely cannot be understood yields a
 * warning so registration may continue.
 */
export async function readJarInfo(path: string): Promise<JarInfo> {
  const before = await maybeStat(path);
  if (!before?.isFile() || before.isSymbolicLink()) throw new UserModError('unsafe-path');
  if (before.size > BigInt(L.jarBytes)) throw new UserModError('limit-exceeded');
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const size = Number(before.size);
    if (size < 22) invalid();
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let at = tail.length - 22; at >= 0; at -= 1) {
      if (
        tail.readUInt32LE(at) === 0x06054b50 &&
        at + 22 + tail.readUInt16LE(at + 20) === tail.length
      ) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) invalid();
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
      return { modIds: [], loaders: [], warnings: ['zip64-unsupported', 'mod-id-unavailable'] };
    if (total > L.zipEntries || cdSize > L.zipCentralDirectoryBytes)
      throw new UserModError('limit-exceeded');
    if (cdOffset + cdSize > size) invalid();
    const central = await readAt(handle, cdOffset, cdSize);

    const found = new Map<string, CentralEntry>();
    let position = 0;
    let declared = 0;
    for (let index = 0; index < total; index += 1) {
      if (position + 46 > central.length || central.readUInt32LE(position) !== 0x02014b50)
        invalid();
      const nameLength = central.readUInt16LE(position + 28);
      const next =
        position +
        46 +
        nameLength +
        central.readUInt16LE(position + 30) +
        central.readUInt16LE(position + 32);
      if (next > central.length) invalid();
      const compressed = central.readUInt32LE(position + 20);
      const uncompressed = central.readUInt32LE(position + 24);
      declared += uncompressed;
      if (declared > L.zipDeclaredBytes) throw new UserModError('limit-exceeded');
      const name = central.toString('utf8', position + 46, position + 46 + nameLength);
      if (name === FABRIC || name === NEOFORGE) {
        if (found.has(name)) invalid();
        found.set(name, {
          flags: central.readUInt16LE(position + 8),
          method: central.readUInt16LE(position + 10),
          compressed,
          uncompressed,
          offset: central.readUInt32LE(position + 42),
        });
      }
      position = next;
    }

    const warnings: JarWarningCode[] = [];
    const ids = new Set<string>();
    const loaders: ('fabric' | 'neoforge')[] = [];
    for (const [name, entry] of found) {
      const text = await readEntry(handle, size, entry, warnings);
      if (text === undefined) continue;
      try {
        const names = name === FABRIC ? parseFabricModIds(text) : parseNeoForgeModIds(text);
        const valid = names.filter(isValidModId);
        if (valid.length === 0 || valid.length !== names.length)
          warnings.push('metadata-unreadable');
        if (valid.length === 0) continue;
        for (const id of valid) ids.add(id);
        loaders.push(name === FABRIC ? 'fabric' : 'neoforge');
      } catch {
        warnings.push('metadata-unreadable');
      }
    }
    if (ids.size > L.modIdsPerJar) throw new UserModError('limit-exceeded');
    if (ids.size === 0) warnings.push('mod-id-unavailable');
    return { modIds: [...ids].sort(), loaders, warnings: [...new Set(warnings)] };
  } finally {
    await handle.close();
  }
}

async function readEntry(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  entry: CentralEntry,
  warnings: JarWarningCode[],
): Promise<string | undefined> {
  if (entry.flags & 1 || (entry.method !== 0 && entry.method !== 8)) {
    warnings.push('unsupported-compression');
    return undefined;
  }
  if (entry.compressed > L.metadataBytes || entry.uncompressed > L.metadataBytes)
    throw new UserModError('limit-exceeded');
  if (entry.offset + 30 > size) invalid();
  const local = await readAt(handle, entry.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) invalid();
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  if (start + entry.compressed > size) invalid();
  const data = await readAt(handle, start, entry.compressed);
  let bytes: Buffer;
  if (entry.method === 0) {
    if (entry.compressed !== entry.uncompressed) invalid();
    bytes = data;
  } else {
    try {
      bytes = inflateRawSync(data, { maxOutputLength: L.metadataBytes });
    } catch {
      throw new UserModError('invalid-jar');
    }
    if (bytes.length !== entry.uncompressed) invalid();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/u, '');
  } catch {
    warnings.push('metadata-unreadable');
    return undefined;
  }
}

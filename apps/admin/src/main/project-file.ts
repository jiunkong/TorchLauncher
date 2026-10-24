import { createHash, timingSafeEqual } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  BRANDING_LIMITS,
  BRANDING_ROLES,
  type BrandingRole,
} from '../../../../packages/core/src/branding/index.js';
import type { StudioProject } from '../shared/studio.js';
import { type BrandingSnapshots, type ImageDecoder, validateImage } from './branding.js';
import { canonical } from './canonical.js';
import { parseProject, StudioFailure } from './project.js';

/** The TorchLauncher Studio file (`.torchproj`) container, format 1. See docs/studio-project-format.md. */
export const PROJECT_FILE_MAGIC = Buffer.from([0x89, 0x54, 0x4c, 0x53, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PROJECT_FILE_FORMAT = 1;
export const PROJECT_FILE_LIMIT = 32 * 1024 ** 2;
export const PROJECT_META_LIMIT = 8 * 1024 ** 2;
const IMAGES_LIMIT = 20 * 1024 ** 2;
const HEADER = 16;
const TRAILER = 32;
const ENTRY_HEADER = 4 + 4 + 32;
const IMAGE_SECTION: Record<BrandingRole, string> = { icon: 'ICON', background: 'BGND' };
const SECTION_IDS = ['META', 'ICON', 'BGND'];

const sha = (data: Uint8Array): Buffer => createHash('sha256').update(data).digest();

export function encodeProjectFile(project: StudioProject, snapshots: BrandingSnapshots): Buffer {
  const meta = deflateSync(Buffer.from(JSON.stringify(canonical(project)), 'utf8'), {
    level: 9,
    memLevel: 9,
  });
  const sections: { id: string; data: Buffer }[] = [{ id: 'META', data: meta }];
  for (const role of BRANDING_ROLES) {
    const asset = project.branding?.[role];
    const bytes = snapshots[role];
    if (asset) {
      if (!bytes) throw new StudioFailure('INVALID');
      sections.push({ id: IMAGE_SECTION[role], data: bytes });
    }
  }
  const header = Buffer.alloc(HEADER);
  PROJECT_FILE_MAGIC.copy(header);
  header.writeUInt16LE(PROJECT_FILE_FORMAT, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(sections.length, 12);
  const parts: Buffer[] = [header];
  for (const { id, data } of sections) {
    const entry = Buffer.alloc(8);
    entry.write(id, 0, 'ascii');
    entry.writeUInt32LE(data.length, 4);
    parts.push(entry, sha(data), data);
  }
  const body = Buffer.concat(parts);
  const file = Buffer.concat([body, sha(body)]);
  if (file.length > PROJECT_FILE_LIMIT) throw new StudioFailure('TOO_LARGE');
  return file;
}

export function decodeProjectFile(
  bytes: Uint8Array,
  decode: ImageDecoder,
): { project: StudioProject; snapshots: BrandingSnapshots } {
  const fail = (): never => {
    throw new StudioFailure('INVALID');
  };
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (file.length > PROJECT_FILE_LIMIT) throw new StudioFailure('TOO_LARGE');
  if (file.length < HEADER + TRAILER || !file.subarray(0, 8).equals(PROJECT_FILE_MAGIC))
    return fail();
  if (file.readUInt16LE(8) !== PROJECT_FILE_FORMAT || file.readUInt16LE(10) !== 0) return fail();
  const count = file.readUInt32LE(12);
  if (count < 1 || count > 8) return fail();
  const end = file.length - TRAILER;
  if (!timingSafeEqual(sha(file.subarray(0, end)), file.subarray(end))) return fail();
  const sections = new Map<string, Buffer>();
  let offset = HEADER;
  for (let i = 0; i < count; i++) {
    if (offset + ENTRY_HEADER > end) return fail();
    const id = file.subarray(offset, offset + 4).toString('latin1');
    const length = file.readUInt32LE(offset + 4);
    const hash = file.subarray(offset + 8, offset + ENTRY_HEADER);
    offset += ENTRY_HEADER;
    if (!SECTION_IDS.includes(id) || sections.has(id) || length > end - offset) return fail();
    const data = file.subarray(offset, offset + length);
    if (!sha(data).equals(hash)) return fail();
    sections.set(id, data);
    offset += length;
  }
  if (offset !== end) return fail();
  const metaData = sections.get('META');
  if (!metaData) return fail();
  let raw: unknown;
  try {
    raw = JSON.parse(
      inflateSync(metaData, { maxOutputLength: PROJECT_META_LIMIT }).toString('utf8'),
    );
  } catch {
    return fail();
  }
  const project = parseProject(raw);
  const snapshots: BrandingSnapshots = {};
  let total = 0;
  const expected = new Set<string>(['META']);
  for (const role of BRANDING_ROLES) {
    const asset = project.branding?.[role];
    if (!asset) continue;
    const id = IMAGE_SECTION[role];
    expected.add(id);
    const data = sections.get(id);
    if (!data || data.length > BRANDING_LIMITS[role].length) return fail();
    total += data.length;
    validateImage(role, data, decode, asset);
    snapshots[role] = Buffer.from(data);
  }
  if (total > IMAGES_LIMIT || sections.size !== expected.size) return fail();
  return { project, snapshots };
}

import {
  DEPLOYMENT_FORMAT_VERSION,
  DEPLOYMENT_HEADER_LENGTH,
  DEPLOYMENT_LIMITS,
  DEPLOYMENT_MAGIC,
  type DeploymentByteRange,
  type DeploymentFile,
  type DeploymentHeader,
  type DeploymentIndex,
  type DeploymentValidationContext,
  EMPTY_FILE_SHA256,
} from './types.js';

export type DeploymentValidationErrorCode =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'invalid-number'
  | 'limit-exceeded'
  | 'invalid-hash'
  | 'invalid-id'
  | 'invalid-value'
  | 'invalid-path'
  | 'path-conflict'
  | 'invalid-layout'
  | 'server-mismatch';

export class DeploymentValidationError extends Error {
  constructor(
    public readonly code: DeploymentValidationErrorCode,
    public readonly field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = 'DeploymentValidationError';
  }
}

function fail(code: DeploymentValidationErrorCode, field: string): never {
  throw new DeploymentValidationError(code, field);
}

function object(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-shape', field);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('invalid-shape', field);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail('invalid-shape', field);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, maximum: number, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail('invalid-number', field);
  }
  if (value > maximum) fail('limit-exceeded', field);
  return value;
}

function version(value: unknown, field: string): void {
  const entry = object(value, ['major', 'minor'], field);
  if (
    entry.major !== DEPLOYMENT_FORMAT_VERSION.major ||
    entry.minor !== DEPLOYMENT_FORMAT_VERSION.minor
  ) {
    fail('unsupported-version', field);
  }
}

function hash(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length !== 64 || /[^a-f0-9]/u.test(value)) {
    fail('invalid-hash', field);
  }
}

function id(value: unknown, field: string): void {
  if (
    typeof value !== 'string' ||
    value.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)
  ) {
    fail('invalid-id', field);
  }
}

function versionToken(value: unknown, field: string): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    !/^[A-Za-z0-9]/u.test(value) ||
    /[^A-Za-z0-9._+-]/u.test(value)
  ) {
    fail('invalid-value', field);
  }
}

const utf8 = new TextEncoder();

/** Conservative, locale-independent alias key; NFC also follows case expansion. */
function pathCollisionKey(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

function path(value: unknown, field: string): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > DEPLOYMENT_LIMITS.pathLength ||
    utf8.encode(value).byteLength > DEPLOYMENT_LIMITS.pathLength ||
    value.normalize('NFC') !== value
  ) {
    fail('invalid-path', field);
  }
  const components = value.split('/');
  for (const component of components) {
    const stem = component.split('.')[0]?.trimEnd().toUpperCase();
    if (
      component.length < 1 ||
      utf8.encode(component).byteLength > DEPLOYMENT_LIMITS.pathComponentLength ||
      /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/u.test(component) ||
      /[<>:"\\|?*%]/u.test(component) ||
      component.trim() !== component ||
      component.endsWith('.') ||
      /^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³]|CONIN\$|CONOUT\$)$/u.test(stem ?? '')
    ) {
      fail('invalid-path', field);
    }
  }
  const normalized = pathCollisionKey(value);
  if (normalized.startsWith('.torchlauncher')) fail('invalid-path', field);
}

function file(value: unknown, field: string): DeploymentFile {
  const entry = object(
    value,
    ['path', 'sha256', 'offset', 'storedLength', 'originalLength', 'compression', 'policy'],
    field,
  );
  path(entry.path, `${field}.path`);
  hash(entry.sha256, `${field}.sha256`);
  integer(entry.offset, DEPLOYMENT_LIMITS.containerLength, `${field}.offset`);
  const stored = integer(entry.storedLength, DEPLOYMENT_LIMITS.fileLength, `${field}.storedLength`);
  const original = integer(
    entry.originalLength,
    DEPLOYMENT_LIMITS.fileLength,
    `${field}.originalLength`,
  );
  if (entry.compression !== 'none' && entry.compression !== 'gzip') {
    fail('invalid-value', `${field}.compression`);
  }
  if (entry.policy !== 'initial-only' && entry.policy !== 'always') {
    fail('invalid-value', `${field}.policy`);
  }
  if (entry.compression === 'none' && stored !== original) fail('invalid-layout', field);
  if (
    entry.compression === 'gzip' &&
    (stored === 0 || original === 0 || original > stored * DEPLOYMENT_LIMITS.compressionRatio)
  ) {
    fail('invalid-layout', field);
  }
  if (original === 0 && entry.sha256 !== EMPTY_FILE_SHA256) fail('invalid-hash', `${field}.sha256`);
  return value as DeploymentFile;
}

export function validateDeploymentHeader(value: unknown): DeploymentHeader {
  const entry = object(
    value,
    ['magic', 'formatVersion', 'flags', 'indexLength', 'totalLength', 'indexSha256'],
    'header',
  );
  if (entry.magic !== DEPLOYMENT_MAGIC) fail('invalid-value', 'header.magic');
  version(entry.formatVersion, 'header.formatVersion');
  if (entry.flags !== 0) fail('unsupported-version', 'header.flags');
  const indexLength = integer(
    entry.indexLength,
    DEPLOYMENT_LIMITS.indexLength,
    'header.indexLength',
    1,
  );
  const totalLength = integer(
    entry.totalLength,
    DEPLOYMENT_LIMITS.containerLength,
    'header.totalLength',
  );
  if (totalLength < DEPLOYMENT_HEADER_LENGTH + indexLength) {
    fail('invalid-layout', 'header.totalLength');
  }
  hash(entry.indexSha256, 'header.indexSha256');
  return value as DeploymentHeader;
}

export function validateDeploymentIndex(
  value: unknown,
  header: DeploymentHeader,
  context: DeploymentValidationContext,
): DeploymentIndex {
  validateDeploymentHeader(header);
  id(context.expectedServerId, 'context.expectedServerId');
  const entry = object(
    value,
    ['formatVersion', 'serverId', 'deploymentId', 'game', 'files'],
    'index',
  );
  version(entry.formatVersion, 'index.formatVersion');
  id(entry.serverId, 'index.serverId');
  id(entry.deploymentId, 'index.deploymentId');
  if (entry.serverId !== context.expectedServerId) fail('server-mismatch', 'index.serverId');
  const game = object(entry.game, ['minecraftVersion', 'loader'], 'index.game');
  versionToken(game.minecraftVersion, 'index.game.minecraftVersion');
  const loader = object(game.loader, ['kind', 'version'], 'index.game.loader');
  if (loader.kind !== 'fabric' && loader.kind !== 'neoforge') {
    fail('invalid-value', 'index.game.loader.kind');
  }
  versionToken(loader.version, 'index.game.loader.version');
  if (!Array.isArray(entry.files)) fail('invalid-shape', 'index.files');
  if (entry.files.length > DEPLOYMENT_LIMITS.fileCount) fail('limit-exceeded', 'index.files');

  const filePaths = new Set<string>();
  const directories = new Set<string>();
  const payloadLength = header.totalLength - DEPLOYMENT_HEADER_LENGTH - header.indexLength;
  let cursor = 0;
  let totalOriginalLength = 0;
  for (const [position, candidate] of entry.files.entries()) {
    const field = `index.files[${position}]`;
    const current = file(candidate, field);
    const normalized = pathCollisionKey(current.path);
    if (filePaths.has(normalized) || directories.has(normalized))
      fail('path-conflict', `${field}.path`);
    const components = normalized.split('/');
    for (let i = 1; i < components.length; i++) {
      const parent = components.slice(0, i).join('/');
      if (filePaths.has(parent)) fail('path-conflict', `${field}.path`);
      directories.add(parent);
    }
    filePaths.add(normalized);
    if (current.offset !== cursor) fail('invalid-layout', `${field}.offset`);
    cursor += current.storedLength;
    if (cursor > payloadLength) fail('invalid-layout', `${field}.storedLength`);
    totalOriginalLength += current.originalLength;
    if (totalOriginalLength > DEPLOYMENT_LIMITS.totalOriginalLength) {
      fail('limit-exceeded', 'index.files.originalLength');
    }
  }
  if (cursor !== payloadLength) fail('invalid-layout', 'index.files');
  return value as DeploymentIndex;
}

/** Call only after validating the entire index against the same header. */
export function getDeploymentFileRange(
  header: DeploymentHeader,
  entry: DeploymentFile,
): DeploymentByteRange | null {
  validateDeploymentHeader(header);
  file(entry, 'file');
  const start = DEPLOYMENT_HEADER_LENGTH + header.indexLength + entry.offset;
  if (start + entry.storedLength > header.totalLength) fail('invalid-layout', 'file.storedLength');
  return entry.storedLength === 0 ? null : { start, endInclusive: start + entry.storedLength - 1 };
}

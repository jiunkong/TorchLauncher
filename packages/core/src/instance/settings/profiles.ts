import type { OptionsDocument } from './options.js';
import { SettingsError } from './types.js';

/**
 * Options.txt format profiles. A profile is chosen from the file's `version:` line (the world/data
 * version of the client that last saved it) or from a caller-supplied Minecraft version.
 *
 * Evidence levels:
 * - `verified`: exercised against a real client-written file (fixtures/options-1.21.1.txt, data
 *   version 3955, Minecraft 1.21.1).
 * - `researched`: implemented only from documentation, NOT tested against real files. Callers must
 *   opt in with `versionPolicy: 'allow-researched'`.
 *
 * Sources (fetched 2026-10):
 * - https://minecraft.wiki/w/Options.txt_(Java_Edition): `version:` stores the data version of the
 *   client that last saved the file (added 1.10-pre1, "used to update old settings");
 *   `resourcePacks` (13w36a) and `incompatibleResourcePacks` (1.8.8) are string lists with default
 *   `[]`; keybinds are `key_key.*` with values such as `key.keyboard.w` / `key.mouse.left`.
 * - https://minecraft.wiki/w/Key_codes: LWJGL 3 update redid key codes in 17w43a; `key.keyboard.`
 *   names arrived in 17w45a (1.13). Earlier files used numeric codes.
 * - https://minecraft.wiki/w/Data_version: 1.13 = 1519, 1.21 = 3953, 1.21.1 = 3955, 1.21.2 = 4080.
 *
 * - Post-3955 research (2026-10-22; see docs/settings-policy.md): the wiki's options table lists no
 *   change to `version`, `resourcePacks`, `incompatibleResourcePacks` or the `key:value` line
 *   structure for any release from 1.21.2 through 26.3 (data versions 4080-5023); only keys were
 *   added/removed. 26.3-snapshot4 changed undefined key codes from `scancode.###` to
 *   `key.keyboard.###` (still non-numeric).
 *
 * Not established by any source found: how pack ids (`vanilla`, `file/` prefix, built-in mod packs)
 * changed between versions. Profiles therefore only reject provably malformed entries.
 */
export interface OptionsFormatProfile {
  readonly id: string;
  readonly evidence: 'verified' | 'researched';
  /** Inclusive data-version range handled by this profile. */
  readonly dataVersions: readonly [number, number];
  /** Active pack list assumed when `resourcePacks` is absent (wiki and real 1.21.1 file: `[]`). */
  readonly defaultPacks: readonly string[];
  /** Keybind values must use `key.*` names rather than legacy numeric key codes. */
  readonly namedKeyCodes: boolean;
  readonly minecraftVersions: readonly string[];
}

/** Data version of Minecraft 26.3, the newest release covered by the research. */
export const LATEST_RESEARCHED_DATA_VERSION = 5023;

export const OPTIONS_PROFILES: readonly OptionsFormatProfile[] = [
  {
    id: 'java-1.21.1',
    evidence: 'verified',
    dataVersions: [3955, 3955],
    defaultPacks: [],
    namedKeyCodes: true,
    minecraftVersions: ['1.21.1'],
  },
  {
    // 1.13 (1519) through just before 1.21.1: same `key_key.*` / `key.keyboard.*` scheme per the
    // sources above. Pack id notation is unconfirmed, hence "researched".
    id: 'java-1.13-1.21',
    evidence: 'researched',
    dataVersions: [1519, 3954],
    defaultPacks: [],
    namedKeyCodes: true,
    minecraftVersions: ['1.13', '1.14', '1.16', '1.17', '1.18', '1.19', '1.20', '1.20.5', '1.21'],
  },
  {
    // 1.21.2 (4080) .. 26.3 (5023). Same layout as 1.21.1 per the wiki option table (no documented
    // change to the lines this module touches). Documentation-only, hence "researched". Pack id
    // notation after 1.21.1 is undocumented. 1.21.2 starts at 3956 because no release lies between.
    id: 'java-1.21.2+',
    evidence: 'researched',
    dataVersions: [3956, LATEST_RESEARCHED_DATA_VERSION],
    defaultPacks: [],
    namedKeyCodes: true,
    minecraftVersions: [
      '1.21.2',
      '1.21.3',
      '1.21.4',
      '1.21.5',
      '1.21.6',
      '1.21.7',
      '1.21.8',
      '1.21.9',
      '1.21.10',
      '1.21.11',
      '26.1',
      '26.1.1',
      '26.1.2',
      '26.2',
      '26.3',
    ],
  },
];

/** Used when neither a `version:` line nor a Minecraft version is available (legacy behavior). */
export const FALLBACK_PROFILE: OptionsFormatProfile = OPTIONS_PROFILES[0] as OptionsFormatProfile;

export type VersionPolicy = 'verified-only' | 'allow-researched' | 'allow-any';

export interface ProfileSelection {
  profile: OptionsFormatProfile;
  source: 'options-version' | 'minecraft-version' | 'default';
  dataVersion?: number | undefined;
  warnings: string[];
}

function unsupported(message: string): never {
  throw new SettingsError('unsupported-options-version', message);
}

export function selectProfile(
  doc: OptionsDocument,
  minecraftVersion: string | undefined,
  policy: VersionPolicy = 'verified-only',
): ProfileSelection {
  const raw = doc.get('version');
  let found: OptionsFormatProfile | undefined;
  let source: ProfileSelection['source'] = 'default';
  let dataVersion: number | undefined;
  const warnings: string[] = [];
  if (raw !== undefined) {
    if (!/^[0-9]{1,9}$/.test(raw)) unsupported(`unrecognized options.txt version: ${raw}`);
    dataVersion = Number(raw);
    source = 'options-version';
    const dv = dataVersion;
    found = OPTIONS_PROFILES.find((p) => dv >= p.dataVersions[0] && dv <= p.dataVersions[1]);
    if (!found) {
      if (policy !== 'allow-any') unsupported(`unsupported options.txt data version ${raw}`);
      // Newer than every researched release: assume the newest layout, only when explicitly allowed.
      if (dataVersion > LATEST_RESEARCHED_DATA_VERSION) {
        found = OPTIONS_PROFILES[OPTIONS_PROFILES.length - 1] as OptionsFormatProfile;
        warnings.push(`unknown data version ${raw}: using profile ${found.id}`);
      } else unsupported(`options.txt data version ${raw} predates the supported formats`);
    }
  } else if (minecraftVersion !== undefined) {
    source = 'minecraft-version';
    found = OPTIONS_PROFILES.find((p) => p.minecraftVersions.includes(minecraftVersion));
    if (!found) {
      if (policy !== 'allow-any') unsupported(`unsupported Minecraft version ${minecraftVersion}`);
      found = FALLBACK_PROFILE;
      warnings.push(`unknown Minecraft version ${minecraftVersion}: using profile ${found.id}`);
    }
  } else {
    found = FALLBACK_PROFILE;
  }
  if (found.evidence === 'researched' && policy === 'verified-only')
    unsupported(
      `format profile ${found.id} is research-based and unverified; opt in with versionPolicy`,
    );
  if (found.evidence === 'researched')
    warnings.push(`profile ${found.id} is unverified (documentation only)`);
  // A caller-supplied version that disagrees with the file is surfaced, never silently trusted.
  if (raw !== undefined && minecraftVersion !== undefined) {
    const byCaller = OPTIONS_PROFILES.find((p) => p.minecraftVersions.includes(minecraftVersion));
    if (byCaller && byCaller.id !== found.id)
      unsupported(`options.txt version ${raw} does not match Minecraft ${minecraftVersion}`);
  }
  return { profile: found, source, dataVersion, warnings };
}

/** Rejects pack ids that are malformed under every known notation. */
export function profileAcceptsPackId(_profile: OptionsFormatProfile, id: string): boolean {
  if (id.startsWith('file/')) {
    const name = id.slice(5);
    return (
      name.length > 0 &&
      !name.includes('\\') &&
      !name.split('/').some((s) => s === '' || s === '.' || s === '..')
    );
  }
  return true;
}

/** Legacy numeric key codes are not valid for profiles that use named key codes. */
export function profileAcceptsKeyValue(
  profile: OptionsFormatProfile,
  key: string,
  value: string,
): boolean {
  if (profile.namedKeyCodes && key.startsWith('key_')) return !/^-?[0-9]+$/.test(value);
  return true;
}

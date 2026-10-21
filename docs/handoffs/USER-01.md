# USER-01 handoff: user-added mod registration, removal and preservation (core only)

- Session: `launcher develop #1`
- Branch: `feat/user-01-mods`; baseline commit `72af685` (final commit hash is reported in the session's final reply)
- Scope: core only. No UI, IPC, renderer, package export, manifest or lockfile changes. No new dependencies.

## Changed files (all new)

- `packages/core/src/instance/mods/`: `index.ts`, `service.ts`, `registry.ts`, `jar.ts`, `errors.ts`, `fixtures.ts` (test helpers incl. a real writer->reader->`synchronizeDeployment` helper), `jar.test.ts`, `mods.test.ts`
- `packages/core/src/instance/sync/ownership.ts`, `ownership.test.ts`
- `docs/handoffs/USER-01.md`

Existing sync files are untouched; `state.ts`, `safety.ts`, `types.ts` and `minecraft/lock.ts` are only imported.

## Layout and ordering

- Registry: `<root>/.torchlauncher-user/mods.json` (canonical JSON, v1: `{version, serverId, mods:[{path, sha256, length, modIds, addedAt}]}`). Written to `mods.json.pending`, then renamed.
- Intent record `.torchlauncher-user/mods-intent.json` and temp copies in `.torchlauncher-user/tmp/` support crash recovery.
- Register: lock -> recover -> checks -> copy to tmp (hash while copying; source stat verified unchanged) -> parse jar -> checks -> write intent -> rename into `mods/<name>` (never overwrites) -> write registry -> clear intent.
- Remove: lock -> recover -> write intent -> delete file -> write registry -> clear intent.
- Recovery (`recoverUserMods`, also run first by every mutating call): deletes tmp copies; a `register` intent is completed only if the file at the path matches the intended hash/length and the operator ledger does not own the path, else discarded; a `remove` intent deletes the file only if it still matches the registered hash, then drops the registry entry. Files that do not match are never deleted.

## Public API (`packages/core/src/instance/mods/index.ts`)

All take `{ root, serverId, signal?, onProgress? }` plus the fields below. Mutations hold `acquireServerDataLock(root, 'maintenance')`; `listMods` is read-only and needs no lock.

| Function | Extra input | Result |
| --- | --- | --- |
| `registerUserMod` | `sourcePath` (external .jar) | `{ mod: UserModRecord, warnings, copied }` |
| `removeUserMod` | `path` (`mods/x.jar`), `force?` | `{ path, fileDeleted }` |
| `listMods` | none | `{ entries: ModListEntry[], recoveryRequired, warnings }` |
| `adoptUnregistered` | `path` | `{ mod, warnings, copied: false }` |
| `removeUnregistered` | `path`, `expectedSha256?` | `{ path, fileDeleted: true }` |
| `recoverUserMods` | none | `{ outcome: 'none'|'registered'|'removed'|'discarded', temporaryRemoved }` |
| `readSyncOwnership(root, serverId)` (`sync/ownership.ts`) | none | `{ serverId, deploymentId, initialized, files:[{path, policy, sha256, length}] } | null` |

`ModListEntry`: `{ path, source: 'operator'|'user'|'unregistered', state: 'ok'|'missing'|'modified'|'unsafe', length?, sha256?, modIds, conflicts: [{kind:'path'|'mod-id', modId?, with}] }`. Notes: operator and user entries can both appear for the same path (path conflict, both flagged); `modified` means the registered file's content changed; unregistered files are never classified, hashed or parsed. Warnings are `mod-id-unavailable`, `metadata-unreadable`, `zip64-unsupported`, `unsupported-compression`.

`onProgress` phases: `recovering`, `copying` (`bytes`/`total`), `verifying`, `registering`, `removing`. Aborting is honoured until the intent is written; after that the operation completes or is repaired by recovery. Abort errors propagate as the platform `AbortError`.

### Errors (`UserModError`, `.code`, optional `.detail.path` / `.detail.conflictsWith`)

| Code | Meaning |
| --- | --- |
| `invalid-server-id` | serverId is not a UUID v4 |
| `invalid-source` | source missing, not a regular file, or a symlink |
| `invalid-extension` | not `.jar` |
| `invalid-path` | not a portable `mods/...` path (traversal, absolute, reserved, bad characters) |
| `unsafe-path` | symlink/junction, hard link, or non-regular file in the way |
| `limit-exceeded` | any limit below, including oversized/compressed-bomb jar metadata |
| `invalid-jar` | not a readable ZIP, or structurally inconsistent (duplicate metadata entries, wrong sizes) |
| `path-conflict` | operator-owned path, or an existing file with different content / case-colliding name |
| `mod-id-conflict` | mod ID equals an operator or another user mod (`detail.conflictsWith`) |
| `already-registered` / `not-registered` | registry state mismatch |
| `not-unregistered` | `removeUnregistered` targeted an operator or user file |
| `not-found` | file does not exist |
| `local-changed` | file changed while reading, or differs from the registered hash / `expectedSha256` (remove needs `force`) |
| `locked` | server data lock held (game, install or other maintenance) |
| `sync-recovery-required` | an interrupted synchronization exists; run `recoverSynchronization` first |
| `invalid-state` | corrupt/oversized/duplicate-key registry, intent or ledger; nothing is modified |

## Limits

Jar 256 MiB; registry 2 MiB; intent 64 KiB; 1000 registered mods; 64 mod IDs per jar (ID pattern `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`); ZIP: 50,000 entries, 16 MiB central directory, 4 GiB total declared size, 1 MiB per metadata entry (inflate output capped, so bombs fail without large allocation); listing: 10,000 files, depth 8; at most 1000 operator jars parsed per operation. No ZIP64 support (warning, registration allowed).

## Policy decisions (conservative choices)

- Only `fabric.mod.json` (`id` + `provides`) and `META-INF/neoforge.mods.toml` (`[[mods]]` `modId`, other tables ignored) are read. An unreadable ID gives a warning and registration proceeds; a structurally invalid ZIP is rejected (`invalid-jar`) even though the written policy only mentions unreadable IDs.
- A pre-existing unregistered file with identical content is registered in place (`copied: false`); different content is `path-conflict`.
- Registered paths are matched case/Unicode-insensitively (sync's `collisionKey`).
- `removeUserMod` never deletes a file the operator ledger now owns (only drops the registry entry), and refuses to delete a modified file without `force`.
- Source hard links are allowed (the file is copied); a hard-linked or symlinked target/existing file is rejected.
- `readSyncOwnership` throws `recovery-required` if sync journal/transaction files exist because the ledger may be stale. The caller holds the lock.
- When the operator later deploys a user's path, `synchronizeDeployment` already fails with `conflict` before changing anything (verified); the user file stays and `listMods` shows it.

## Validation

Run in the worktree with the host Node and the shared toolchain:

- `vitest run packages/core/src/instance/mods packages/core/src/instance/sync/ownership.test.ts`: 39 tests passed (jar parsing, register/remove/list, conflicts, unregistered handling, lock rejection, registry hardening, interrupted-operation recovery, abort, ownership, and real-sync integration across server updates and an operator path collision).
- `tsc -p packages/core/tsconfig.json --noEmit` and Biome clean on `packages/core/src/instance`.
- Full `pnpm test`: 590 passed, 6 skipped (existing skips). `pnpm check`: Biome passed and `packages/core`/admin typecheck passed, but it stopped at `apps/launcher` typecheck with `Cannot find module 'prismarine-auth'` (`src/main/auth/public-java-worker.ts`), an environment issue (dependency not installed in the shared toolchain) in files this task does not touch; the test and build stages after typecheck were therefore not run via `pnpm check`.

## Not verified / limitations

- Only run on Linux (WSL); Windows/macOS behaviour (rename onto existing, hard-link checks, case-insensitive disks) is untested. Symlink tests are skipped silently if the host cannot create symlinks.
- Process kill mid-write was simulated by writing intent records by hand, not by killing a process.
- No disk-space precheck. No Forge/legacy `mods.toml`. No UI wiring.
- Operator jar mod IDs are read from the files currently on disk, not verified against the ledger hash.

## Requests for #0

- Export from `packages/core/src/instance/mods/index.ts` and `sync/ownership.ts` (`readSyncOwnership`, `SyncOwnership`, `SyncOwnedFile`) via the instance/core index when integrating; USER-02 may use the `SyncOwnership` shape.
- UI/IPC callers should surface `recoveryRequired` and call `recoverUserMods` (or just run any mutation, which repairs first).

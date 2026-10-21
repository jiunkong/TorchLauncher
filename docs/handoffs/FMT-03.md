# FMT-03 deployment reader

## API

The reader is internal to `packages/core/src/deployment/reader/`; this change does not add a package or shared root export.

```ts
const reader = await openDeploymentReader(source, {
  expectedServerId,
  signal,
  rangeChunkBytes: 256 * 1024,
  maxFileBytes: 1024 ** 3,
});

const staged = await reader.stageFile(file.path, newScratchPath, { signal });
reader.assertCurrent(); // call immediately before the staging transaction commits
```

Opening eagerly reads the 64-byte header and bounded index ranges. The header u64 values are checked as BigInts before conversion; the total length must match the download source snapshot. The exact original index bytes are SHA-256 checked before strict UTF-8 decoding, duplicate-key rejection, JSON parsing, and the existing contract validator's server ID and layout checks.

The returned header, index, nested values, and source snapshot are frozen. The reader pins source ID, generation, and the complete resource snapshot; every later range and `assertCurrent()` checks that pin. It never resets or retries automatically. A reset, source replacement, cancellation, or mismatched range aborts staging.

`stageFile` selects one exact indexed path, requires an exclusive new scratch file (`open` with `wx`), and writes bounded payload ranges without materializing the full stored or decoded file. `none` bytes are checked against length and SHA-256. Gzip uses a raw deflate stream with a bounded header parser, then checks one member only, trailer CRC32, ISIZE, exact output length, and SHA-256. Trailing data or concatenated members fail. On failure, it closes and removes only the scratch file it created; it never overwrites an existing destination.

## Operational limits

- Reader range chunks default to 256 KiB and can be configured up to 4 MiB.
- The default decoded-file budget is 1 GiB. A caller can set a lower or higher budget up to the format limit of 4 GiB.
- Stored payload defaults to the format's 4 GiB file limit and supports a lower caller budget.
- Gzip optional header data is capped at 64 KiB locally. The deployment format's hard limits remain enforced by the shared validator.

The caller owns scratch-path selection and the later staging transaction. The reader does not apply files to the game directory and does not replace synchronization ownership, rollback, or recovery logic.

## Validation

- `biome check packages/core/src/deployment/reader` — passed.
- `pnpm --filter @torchlauncher/core typecheck` — passed.
- `pnpm exec vitest run packages/core/src/deployment/reader/reader.test.ts packages/core/src/deployment/writer/writer.test.ts` — passed, 58 tests.

Behavior tests cover writer-to-reader roundtrip for none, gzip, and empty payloads; arbitrary contract-valid paths; bounded range selection; immutable metadata; duplicate keys, excessive JSON nesting, BOM and malformed UTF-8; invalid header, unsafe u64 and oversized index; index and payload hash mismatches; gzip CRC, truncation, oversized optional filename, trailing bytes, and output verification; reset and cancellation including cancellation during inflation; operational limits; scratch cleanup; and destination collision safety.

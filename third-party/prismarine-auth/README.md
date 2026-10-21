# prismarine-auth

TorchLauncher temporarily uses the public Java Title device-code/SISU route with explicit user
authorization. The separate own-app route remains available; there is no fallback between them.

- Package: `prismarine-auth`, pinned to **3.1.1**, MIT, copyright 2020 PrismarineJS.
- Upstream repository: `PrismarineJS/prismarine-auth`.
- npm release source commit: `b795199dc5fa26059655bb1bc91c7f7f2733b232`.
- npm distribution integrity:
  `sha512-NuNrMGZdoigFKsvi1ZZgAEvNYNuE5qe6lo/tw+bqeNbkhpjHC0u1JNxLEujnfqduXI18e19PvUtWNMDl/gH7yw==`.
- All resolved dependency versions/integrities are pinned by `pnpm-lock.yaml`.
- `dependencies.json` records the installed runtime dependency graph (24 distinct packages) and
  declared licenses. `NOTICE.txt` contains their shipped license/notice files; it is emitted into the
  launcher main build output and included by the existing `out/**/*` packaging rule.
- `LICENSE` is the unmodified upstream MIT license. No upstream implementation files were copied
  into application source; the package is bundled as a dependency.

The library always receives a custom cache factory. Its default file cache and default title/flow
are not used. Its console/debug streams are discarded in the isolated child. Electron main encrypts
all cache payloads, and controls local device-code display, cancellation and logout.

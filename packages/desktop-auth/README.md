# Desktop authentication (main process only)

Electron-free Microsoft host adapters and temporary public Java authentication, extracted from
the launcher without changing its on-disk formats, core contracts or worker protocol. The package
owns the exact `prismarine-auth@3.1.1` dependency. Import the main API from
`@torchlauncher/desktop-auth`; `@torchlauncher/desktop-auth/worker` is a **build entry only** and
must never be imported into an app's main process or renderer.

## Host wiring

`createDesktopPublicJavaAuthenticator({ cacheDirectory, safeStorage, workerPath, showCode,
timeoutMs? })` returns `PublicJavaAuthenticator` with `login(signal?)`, `refresh(signal?)` and
`logout()`. It does not import Electron or discover application paths. `spawn?` remains an optional
test boundary. There are no implicit shared stores or application singleton objects.

The host must acquire its own single-instance lock, await Electron readiness, then inject:

- `cacheDirectory`: that app's absolute `userData/public-java` path, outside deletable game data.
  Launcher and Studio must supply different app userData roots. The existing key and encrypted
  filename derivation stay unchanged; separation comes from the app-owned directory.
- `safeStorage`: Electron's safeStorage object. Linux `basic_text`, unknown/unavailable backends
  fail with `secure_storage_unavailable`. No plaintext or memory-only fallback is added. Deleting
  ciphertext through `logout()` remains possible when a keyring becomes unavailable.
- `workerPath`: an absolute path to that app's built `public-java-worker.cjs`.
- `showCode(code, signal)`: an app-owned sandboxed code window and browser adapter. Inject the
  app name and translated text there. Follow the launcher's existing adapter: validate the code,
  open only `https://www.microsoft.com/link`, reject user closure as `HostAuthenticationError(
  'cancelled')`, and destroy the window when the signal aborts. Never open provider-supplied URLs.

Authentication results follow `MinecraftAuthResult` from `@torchlauncher/core/auth` and remain in
main/game-launch code. Never pass complete results, code strings, tokens, cache payloads or raw
exceptions to renderer IPC or logging. Failures retain the existing sanitized error classes/codes.
Refresh remains noninteractive. Logout is local deletion, not remote consent revocation.

The own-app path remains available through `EncryptedMicrosoftTokenStorage`,
`LoopbackAuthenticationBrowser` and core's `MicrosoftAuthenticator`; supply app-owned account
directory, safeStorage and `openExternal`. There is no fallback between providers.

[`examples/studio-main.ts`](examples/studio-main.ts) demonstrates Studio composition without
importing the launcher. TESTRUN-MAIN-01 owns the real Studio adapter, IPC, translations and UI.

## Build both applications

Add `@torchlauncher/desktop-auth: workspace:*` to the consuming app's devDependencies, as done
for the launcher. In that app's electron-vite main configuration, preserve the existing plugins
and use these build options (both apps use the same entry/chunk layout):

```ts
import { fileURLToPath } from 'node:url';

build: {
  externalizeDeps: false,
  lib: {
    entry: {
      index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
      'public-java-worker': fileURLToPath(
        import.meta.resolve('@torchlauncher/desktop-auth/worker'),
      ),
    },
    formats: ['cjs'],
    fileName: (_format, name) => `${name}.cjs`,
  },
}
```

Keep **all** emitted main chunks with both `.cjs` entries. The worker dynamically imports the
bundled library; copying only its entry is insufficient. Use
`join(__dirname, 'public-java-worker.cjs')` in the consuming app's thin adapter. Do not externalize
prismarine-auth: packaging must work without a runtime node_modules tree. Electron remains owned
by the app. Its Node-mode child suppresses provider output and uses only the private IPC protocol.

The launcher already emits `third-party/prismarine-auth/NOTICE.txt` into main output. Studio must
emit that same consolidated notice when it starts bundling the dependency; preserve the existing
third-party provenance/license files and include the notice and all chunks in packaging rules.
No Studio application files are changed in this extraction task.

## Verification

Run `pnpm exec vitest run packages/desktop-auth packages/core/src/auth` from the repository root.
The original browser/storage/flow/lifecycle suites were moved intact. Additional tests verify
app-directory isolation and build the Studio example plus actual worker into a temporary bundle,
copy them to a standalone directory, reject unsafe storage and self-check bundled version 3.1.1
in a real Node child. These are synthetic checks, not account authentication or OS keyring proof.

`scripts/auth-smoke.mjs` continues to exercise the launcher's Electron adapters, including
`worker-check`, `reject-basic` and the user-operated `cycle` on a host with a secure keyring.

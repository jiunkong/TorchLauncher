# LANG-01

Worker agent-1, branch `feat/language-setting`. Renderer only (no main/shared/core change).

## Change
- Studio: `components/LanguageControl.tsx` (radio-style `.seg`: `자동 · Auto` / `한국어` / `English`, aria-label `Language / 언어`, active choice `aria-checked`) on the start screen (top right) and in the sidebar footer next to the version line (compact; the 800 px no-scroll sidebar check still passes).
- Launcher: same component in a `언어 / Language` card on the Settings page only (`data-testid="language-card"`), with a small `.seg` style.
- Choosing a language calls the existing store: `setLocale(choice)` (switches immediately, persisted in localStorage), `자동` calls `useAutomaticLocale()` (clears the preference, follows `navigator.languages`, unknown languages still resolve to English).
- Tests: `LanguageControl.test.ts` in both apps (three choices, active state, clicks report the choice, real `createLocaleStore` switch/persist/auto, wiring checks). Studio smoke: start screen switch `--lang=ko` -> English -> 한국어 -> 자동 (New project / 새 프로젝트) and sidebar control present; launcher renderer smoke: Settings card switches `Copy path` / `경로 복사` and 자동 follows `navigator.languages`.
- Screenshots (`.cache/smoke/`, 1100 px wide): `studio-language-start.png`, `launcher-language-card.png`.

## Why a Korean PC can still start in English
Probe (Electron 44, Linux, `LANG` only): `LANG=en_US` -> `app.getLocale()` en-US, `navigator.languages` ["en-US","en"]; `LANG=ko_KR` -> `getLocale()` ko, `navigator.languages` ["ko","ko-KR"]; `--lang=ko` forces ko. Chromium derives both from the system UI language list (Windows: the preferred display languages, not the region/format setting), so a PC with Korean region but English display language (or no Korean language pack) gives en-US. This is inferred from Chromium behaviour; not run on Windows. No main-process override was added (no real bug). The launcher's English catalog is still mostly copies of the Korean text (only a few keys differ), so "English" there looks mostly Korean.
Dev note: localStorage is per origin, so the stored preference is lost when `TORCH_*_DEV_PORT` changes; the production file/app origin is stable.

## Out of scope: hardcoded main-process text
Studio native dialog titles/filters and result messages (`apps/admin/src/main/index.ts`, `studio.ts`: e.g. 프로젝트 열기/저장, 배포 소스 폴더, 서명 키 백업, ZIP 저장), launcher `chooseMod` dialog title/filter and product error/log strings from main, application names and window titles.

## Validation (WSL2, DISPLAY=:0, corepack pnpm wrapper)
`pnpm check`, `pnpm build`, `node scripts/smoke.mjs`, `node apps/admin/scripts/smoke-functional.mjs`, `node apps/launcher/scripts/renderer-functional-smoke.mjs`: all passed (pnpm check exit 0: 104 test files, 1436 tests).

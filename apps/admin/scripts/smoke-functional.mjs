import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

/** Reads the META section of a TorchLauncher Studio file (checks magic, trailer hash and section hashes). */
function readStudioFile(bytes) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x54, 0x4c, 0x53, 0x0d, 0x0a, 0x1a, 0x0a],
    'magic',
  );
  assert.equal(bytes.readUInt16LE(8), 1, 'format');
  const end = bytes.length - 32;
  assert.ok(
    createHash('sha256').update(bytes.subarray(0, end)).digest().equals(bytes.subarray(end)),
    'trailer hash',
  );
  let offset = 16;
  let meta;
  for (let i = bytes.readUInt32LE(12); i > 0; i--) {
    const id = bytes.subarray(offset, offset + 4).toString('latin1');
    const length = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 40, offset + 40 + length);
    assert.ok(
      createHash('sha256')
        .update(data)
        .digest()
        .equals(bytes.subarray(offset + 8, offset + 40)),
      `${id} hash`,
    );
    if (id === 'META') meta = JSON.parse(inflateSync(data).toString('utf8'));
    offset += 40 + length;
  }
  assert.equal(offset, end, 'no trailing bytes');
  assert.ok(meta, 'META section');
  return meta;
}

import { _electron } from 'playwright';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'studio-ui-smoke-'));
const source = join(root, 'source');
const game = join(root, 'game');
await mkdir(source);
await mkdir(join(game, 'config'), { recursive: true });
await mkdir(join(game, 'shaderpacks'), { recursive: true });
await writeFile(join(source, 'custom.data'), 'UI selected payload');
await writeFile(join(source, 'options.txt'), 'renderDistance:12\n');
await writeFile(
  join(game, 'options.txt'),
  [
    'version:3955',
    'renderDistance:12',
    'fov:0.5',
    'key_key.jump:key.keyboard.space',
    'key_key.forward:key.keyboard.w',
    'key_key.exampleminimap.zoom_in:key.keyboard.equal',
    '',
  ].join('\n'),
);
await writeFile(join(game, 'config/example.properties'), 'alpha=1\nbeta=true\n');
await writeFile(join(game, 'config/iris.properties'), 'enableShaders=true\nshaderPack=Test.zip\n');
await writeFile(join(game, 'shaderpacks/Test.zip.txt'), 'SHADOW_RES=2048\n');
// Minimal zip-looking packs (the main process checks name, size and the zip signature).
const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]);
const packs = join(root, 'packs');
await mkdir(packs);
await writeFile(join(packs, 'server-pack.zip'), zipBytes);
await writeFile(join(packs, 'Test.zip'), zipBytes);
const launcher = join(root, 'TorchLauncher-test.AppImage');
await writeFile(launcher, Buffer.concat([Buffer.from('\x7fELF'), Buffer.alloc(2048, 1)]), {
  mode: 0o755,
});
const project = join(root, 'server-project.torchproj');
const pack = join(root, 'server.torchpack');
const exported = join(root, 'export', 'launcher.zip');
await mkdir(join(root, 'export'));
const publicUrl = 'https://packs.example.org/server.torchpack';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    ...(env.TORCH_STUDIO_ELECTRON_EXECUTABLE
      ? { executablePath: env.TORCH_STUDIO_ELECTRON_EXECUTABLE }
      : {}),
    args: [join(cwd, 'apps/admin'), `--user-data-dir=${join(root, 'profile')}`, '--lang=ko'],
    env,
    timeout: 30000,
  });
  await app.evaluate(
    ({ dialog, safeStorage, shell }, paths) => {
      // Headless Linux has no keyring; a reversible stub lets the signing path run (test only).
      const stub = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text) => Buffer.from(`k${text}`),
        decryptString: (buffer) => buffer.toString().slice(1),
      };
      for (const [name, value] of Object.entries(stub))
        Object.defineProperty(safeStorage, name, { value, configurable: true, writable: true });
      // Native file pickers stay native in the app; here they answer with fixture paths.
      const answers = {
        '프로젝트 열기': [paths.project],
        '배포 소스 폴더': [paths.source],
        '소스 폴더 안의 파일 선택': [paths.file, paths.options],
        '게임을 한 번 실행한 폴더 선택': [paths.game],
        'options.txt 선택': [join(paths.game, 'options.txt')],
        '리소스팩(.zip) 선택': [join(paths.packs, 'server-pack.zip')],
        '셰이더팩(.zip) 선택': [join(paths.packs, 'Test.zip')],
        '기존 공통 런처 선택': [paths.launcher],
      };
      function join(...parts) {
        return parts.join('/');
      }
      dialog.showOpenDialog = async (_window, options) => {
        const canceled = globalThis.__studioSmokeCancelNext === true;
        globalThis.__studioSmokeCancelNext = false;
        globalThis.__studioSmokeOpenTitles = [
          ...(globalThis.__studioSmokeOpenTitles ?? []),
          options.title,
        ];
        return { canceled, filePaths: canceled ? [] : (answers[options.title] ?? [paths.file]) };
      };
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.__studioSmokeSaveTitles = [
          ...(globalThis.__studioSmokeSaveTitles ?? []),
          options.title,
        ];
        return {
          canceled: false,
          filePath:
            options.title === '프로젝트 저장' || options.title === 'Save project'
              ? paths.project
              : options.title === '런처 내보내기 ZIP 저장' || options.title === 'Save launcher ZIP'
                ? paths.exported
                : paths.pack,
        };
      };
      // Studio must never show a native message box; count any attempt.
      dialog.showMessageBox = async () => {
        globalThis.__studioSmokeNativeBoxes = (globalThis.__studioSmokeNativeBoxes ?? 0) + 1;
        return { response: 0, checkboxChecked: false };
      };
      shell.showItemInFolder = (path) => {
        globalThis.__studioSmokeRevealed = [...(globalThis.__studioSmokeRevealed ?? []), path];
      };
      // The public deployment address is served from the built pack (range capable), test only.
      const fs = process.getBuiltinModule('node:fs');
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith(paths.publicUrl)) return new Response('not found', { status: 404 });
        const data = fs.readFileSync(paths.pack);
        const headers = new Headers(init.headers ?? {});
        const range = headers.get('range');
        const base = { 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' };
        if (init.method === 'HEAD')
          return new Response(null, {
            status: 200,
            headers: { ...base, 'content-length': String(data.length) },
          });
        const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
        if (!match)
          return new Response(data, {
            status: 200,
            headers: { ...base, 'content-length': String(data.length) },
          });
        const start =
          match[1] === '' ? Math.max(0, data.length - Number(match[2])) : Number(match[1]);
        const end =
          match[1] === '' || match[2] === ''
            ? data.length - 1
            : Math.min(Number(match[2]), data.length - 1);
        if (start > end)
          return new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${data.length}` },
          });
        const body = data.subarray(start, end + 1);
        return new Response(body, {
          status: 206,
          headers: {
            ...base,
            'content-length': String(body.length),
            'content-range': `bytes ${start}-${end}/${data.length}`,
          },
        });
      };
    },
    {
      source,
      game,
      packs,
      launcher,
      file: join(source, 'custom.data'),
      options: join(source, 'options.txt'),
      project,
      pack,
      exported,
      publicUrl,
    },
  );
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Splash badge: the STUDIO text is optically centred (letter-spacing trails the last letter).
  await page.locator('.splash .studio-tag').waitFor();
  await page.waitForTimeout(1300);
  const badge = await page.evaluate(() => {
    const tag = document.querySelector('.splash .studio-tag');
    if (!tag) return null;
    const range = document.createRange();
    range.selectNodeContents(tag);
    const text = range.getBoundingClientRect();
    const box = tag.getBoundingClientRect();
    const spacing = Number.parseFloat(getComputedStyle(tag).letterSpacing) || 0;
    return { left: text.left - box.left, right: box.right - text.right + spacing };
  });
  if (badge)
    assert.ok(
      Math.abs(badge.left - badge.right) < 1.5,
      `badge off centre ${JSON.stringify(badge)}`,
    );
  await mkdir(join(cwd, '.cache/smoke'), { recursive: true });
  await page
    .locator('.splash .studio-tag')
    .screenshot({ path: join(cwd, '.cache/smoke/studio-splash-badge.png') })
    .catch(() => {});
  await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20000 });
  await page.getByTestId('application-info').filter({ hasText: process.platform }).waitFor();
  const nav = (label) => page.locator('nav.menu .mi').filter({ hasText: label });
  const menuAction = async (menu, item) => {
    await page.getByTestId(`menu-${menu}`).click();
    await page.getByTestId(`menu-item-${item}`).click();
  };
  const goto = async (label) => {
    await nav(label).click();
    await page.getByRole('heading', { level: 1 }).first().waitFor();
  };

  const closeWindow = () =>
    app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
  const expectRevealed = async (path) => {
    const revealed = await app.evaluate(() => globalThis.__studioSmokeRevealed ?? []);
    assert.ok(revealed.includes(path), `reveal called with ${path}: ${JSON.stringify(revealed)}`);
  };

  // Fonts: the bundled Pretendard and Pixelify Sans load from the app, not the network.
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('14px "Pretendard Variable"', '서버'),
      document.fonts.load('700 36px "Pixelify Sans"', 'TORCH'),
    ]);
    return {
      pretendard: document.fonts.check('14px "Pretendard Variable"', '서버'),
      pixelify: document.fonts.check('700 36px "Pixelify Sans"', 'TORCH'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  assert.ok(fonts.pretendard && fonts.pixelify, JSON.stringify(fonts));
  assert.ok(
    fonts.loaded.some((f) => f.includes('Pretendard')),
    JSON.stringify(fonts),
  );
  assert.ok(
    fonts.loaded.some((f) => f.includes('Pixelify')),
    JSON.stringify(fonts),
  );
  // No native confirm/alert/prompt is reachable from the renderer code paths exercised below.
  await page.evaluate(() => {
    for (const name of ['confirm', 'alert', 'prompt'])
      window[name] = () => {
        throw new Error(`native ${name} used`);
      };
  });

  // Painted-content check: the key elements are really on top (not covered), at both widths.
  const assertPainted = async (label) => {
    const result = await page.evaluate(() => {
      const probe = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, found: false };
        const box = element.getBoundingClientRect();
        const x = Math.min(Math.max(box.x + Math.min(box.width / 2, 40), 0), innerWidth - 1);
        const y = Math.min(Math.max(box.y + box.height / 2, 0), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        return {
          selector,
          found: true,
          visible: box.width > 0 && box.height > 0,
          reachable: !!hit && element.contains(hit),
        };
      };
      const pageElement = document.querySelector('[data-testid="page"]');
      return {
        splash: document.querySelector('[data-testid="splash"]') !== null,
        probes: ['.side .mi.active', '[data-testid="page"] h1', '[data-testid="page"] .card'].map(
          probe,
        ),
        documentOverflow: document.documentElement.scrollWidth > innerWidth,
        pageOverflow: pageElement ? pageElement.scrollWidth > pageElement.clientWidth : false,
        width: innerWidth,
      };
    });
    assert.equal(result.splash, false, `${label}: splash still covers the app`);
    assert.equal(result.documentOverflow, false, `${label}: horizontal scroll at ${result.width}`);
    assert.equal(result.pageOverflow, false, `${label}: page overflows at ${result.width}`);
    for (const probe of result.probes) {
      if (!probe.found) continue;
      assert.ok(
        probe.visible && probe.reachable,
        `${label}: covered or hidden ${JSON.stringify(probe)}`,
      );
    }
  };

  // Start screen -> new project.
  await page.getByTestId('start-page').waitFor();
  // The menu bar is always there; without a project the project actions are disabled.
  await page.getByTestId('menubar').waitFor();
  await page.getByTestId('menu-file').click();
  for (const id of ['save', 'saveAs', 'close'])
    assert.equal(await page.getByTestId(`menu-item-${id}`).getAttribute('aria-disabled'), 'true');
  assert.equal(await page.getByTestId('menu-item-new').getAttribute('aria-disabled'), null);
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-menu-start.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('menu-file').getAttribute('aria-expanded'), 'false');
  // Language setting on the start screen: explicit choices switch text now, automatic follows --lang.
  const language = (name) => page.locator(`[data-testid="start-page"] [data-choice="${name}"]`);
  assert.equal(await language('auto').getAttribute('aria-checked'), 'true');
  await language('en').click();
  await page.getByTestId('start-new').filter({ hasText: 'New project' }).waitFor();
  assert.equal(await language('en').getAttribute('aria-checked'), 'true');
  await language('ko').click();
  await page.getByTestId('start-new').filter({ hasText: '새 프로젝트' }).waitFor();
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-language-start.png') });
  await language('auto').click();
  await page.getByTestId('start-new').filter({ hasText: '새 프로젝트' }).waitFor();
  assert.equal(await language('auto').getAttribute('aria-checked'), 'true');
  await page.getByTestId('start-new').click();
  await page.getByTestId('project-card').waitFor();
  assert.equal(await nav('개요').getAttribute('aria-current'), 'page');
  // The sidebar footer only shows the save state; the version lives in the About dialog.
  assert.equal(await page.locator('.sidefoot button').count(), 0);
  assert.equal(await page.locator('.side [data-testid="language-control"]').count(), 0);
  const noExtraWindow = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  // Menus: keyboard navigation, outside click, View > language, Help > About.
  await page.getByTestId('menu-file').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('menu-item-new').waitFor();
  assert.equal(await page.getByTestId('menu-file').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
    'menu-item-open',
  );
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('menu-item-lang-ko').waitFor();
  assert.equal(await page.getByTestId('menu-view').getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-menu-view.png') });
  await page.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
    'menu-view',
  );
  await page.getByTestId('menu-file').click();
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-menu-file.png') });
  await page.locator('.page').click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByTestId('menu-file').getAttribute('aria-expanded'), 'false');
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-lang-en').click();
  await nav('Overview').waitFor();
  await page.getByTestId('menu-view').click();
  assert.equal(await page.getByTestId('menu-item-lang-en').getAttribute('aria-checked'), 'true');
  await page.getByTestId('menu-item-lang-ko').click();
  await nav('개요').waitFor();
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-item-about').click();
  await page.getByTestId('about-dialog').waitFor();
  assert.match(await page.getByTestId('about-version').textContent(), /^v\d/);
  assert.equal(await noExtraWindow(), 1);
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-about.png') });
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByTestId('about-dialog').waitFor({ state: 'detached' });
  assert.match(await page.title(), /TorchLauncher Studio/);

  // Server info: validation.
  await goto('서버 정보');
  await page.getByLabel('서버 주소', { exact: true }).fill('bad host');
  assert.equal(
    await page.getByLabel('서버 주소', { exact: true }).getAttribute('aria-invalid'),
    'true',
  );
  await page.getByLabel('서버 주소', { exact: true }).fill('localhost:25565');
  assert.equal(
    await page.getByLabel('서버 주소', { exact: true }).getAttribute('aria-invalid'),
    'false',
  );
  await page.getByLabel('서버 이름', { exact: true }).fill('Functional Studio smoke');
  assert.equal(await page.getByTestId('save-state').getAttribute('data-dirty'), 'true');

  // Unsaved-changes confirmation is an in-app dialog.
  await menuAction('file', 'open');
  const dialog = page.getByTestId('unsaved-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('role'), 'dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke',
  );
  await menuAction('file', 'open');
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await app.evaluate(() => globalThis.__studioSmokeNativeBoxes ?? 0), 0);

  // New project from the menu with a dirty project asks first (in-app), cancel keeps the edit.
  await menuAction('file', 'new');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke',
  );
  // Ctrl+S saves even while a text input has focus.
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-lang-en').click();
  await nav('Overview').waitFor();
  await page.getByLabel('Server name', { exact: true }).focus();
  await page.keyboard.press('Control+s');
  await page.getByText(/프로젝트를 저장했습니다\.|Project saved\./).waitFor();
  assert.equal(
    (await app.evaluate(() => globalThis.__studioSmokeSaveTitles ?? [])).at(-1),
    'Save project',
  );
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-lang-ko').click();
  await nav('개요').waitFor();
  assert.equal(readStudioFile(await readFile(project)).name, 'Functional Studio smoke');
  await page.getByLabel('서버 이름', { exact: true }).fill('Functional Studio smoke 2');
  await menuAction('file', 'open');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByTestId('save-state').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(readStudioFile(await readFile(project)).name, 'Functional Studio smoke 2');
  await goto('서버 정보');
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke 2',
  );

  // Branding: app name round trip and preview.
  await goto('브랜딩');
  await page.getByRole('button', { name: '앱 이름 변경', exact: true }).click();
  await page.locator('.nameform input').fill('Branded Name');
  await page.locator('.nameform').getByRole('button', { name: '적용', exact: true }).click();
  await page.getByTestId('brand-preview').getByText('Branded Name').first().waitFor();
  assert.equal(
    readStudioFile(await readFile(project)).branding?.appName,
    undefined,
    'branding name is unsaved until the project is saved',
  );

  // UNSAVED contract: replacing a dirty project needs the in-app confirmation flag.
  await page
    .getByLabel('서버 이름', { exact: true })
    .waitFor()
    .catch(() => {});
  await goto('서버 정보');
  await page.getByLabel('서버 이름', { exact: true }).fill('Dirty edit');
  assert.deepEqual(await page.evaluate(() => window.torchlauncher.request({ action: 'new' })), {
    ok: false,
    code: 'UNSAVED',
  });
  await menuAction('file', 'open');
  await page.getByTestId('unsaved-dialog').getByRole('button', { name: '저장 안 함' }).click();
  await page.getByTestId('unsaved-dialog').waitFor({ state: 'detached' });
  await goto('서버 정보');
  await page.getByLabel('서버 이름', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke 2',
    'discarding reopens the saved project',
  );

  // Files: source folder, add files, real sizes, bulk policy, rescan.
  await goto('파일');
  await app.evaluate(() => {
    globalThis.__studioSmokeCancelNext = true;
  });
  await page.getByRole('button', { name: '폴더 변경', exact: true }).click();
  await page.getByText('작업을 취소했습니다.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('source-name').textContent(), '선택되지 않음');
  await page.getByRole('button', { name: '폴더 변경', exact: true }).click();
  await page.getByTestId('source-name').filter({ hasText: 'source' }).waitFor();
  await page.getByRole('button', { name: '파일 추가', exact: true }).click();
  const customRow = page.getByRole('row').filter({ hasText: 'custom.data' });
  await customRow.waitFor();
  assert.match(await customRow.textContent(), /19 B/);
  assert.equal(await page.getByRole('button', { name: '설정 화면에서 관리' }).count(), 1);
  await customRow
    .getByRole('radiogroup', { name: 'custom.data 적용 방식' })
    .getByRole('radio', { name: '최초만' })
    .click();
  await customRow.locator('button.i[aria-checked=true]').waitFor();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '제외', exact: true }).click();
  await page.locator('tr.off').filter({ hasText: 'custom.data' }).waitFor();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '항상 적용' }).click();
  await page.locator('tr:not(.off)').filter({ hasText: 'custom.data' }).waitFor();
  await writeFile(join(source, 'extra.txt'), 'added later');
  await page.getByTestId('files-rescan').click();
  await page.getByRole('row').filter({ hasText: 'extra.txt' }).waitFor();
  await page.getByLabel('extra.txt 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '제외', exact: true }).click();

  // Player settings imports options explicitly from either source.
  await goto('단축키 · 옵션');
  await page.getByTestId('settings-empty').waitFor();
  assert.equal(await page.locator('[data-testid="settings-empty"] .srcc').count(), 2);
  await page.getByRole('button', { name: '테스트 실행으로 이동' }).click();
  await page.getByTestId('test-page').waitFor();
  await page.getByRole('heading', { name: '테스트 실행' }).waitFor();
  await page.getByTestId('test-start').waitFor();
  // No login in progress: no code dialog, no extra window, and copying has nothing to copy.
  assert.equal(await page.getByTestId('login-dialog').count(), 0);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.deepEqual(
    await page.evaluate(() => window.torchlauncher.request({ action: 'testLoginCopyCode' })),
    {
      ok: false,
      code: 'INVALID',
    },
  );
  assert.equal(await page.getByTestId('test-login').isDisabled(), false);
  // Start screen: environment and account cards side by side, login inside the account card,
  // primary run button bottom-left below them, no explanatory body sentences.
  const startLayout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const env = box('[data-testid="test-env"]');
    const account = box('[data-testid="test-account-card"]');
    const run = box('[data-testid="test-start-button"]');
    const login = document.querySelector(
      '[data-testid="test-account-card"] [data-testid="test-login"]',
    );
    return {
      sideBySide: Math.abs(env.top - account.top) < 2 && account.left > env.right - 1,
      runBelow: run.top > Math.max(env.bottom, account.bottom) - 1,
      runLeft: run.left < env.left + 40,
      loginInCard: !!login,
      sentences: document.body.textContent.includes(
        '게임을 시작하려면 Microsoft 로그인이 필요합니다.',
      ),
    };
  });
  assert.deepEqual(startLayout, {
    sideBySide: true,
    runBelow: true,
    runLeft: true,
    loginInCard: true,
    sentences: false,
  });
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-polish-test-start.png') });
  assert.equal(await page.getByTestId('test-start-button').isDisabled(), true);
  await page.getByTestId('test-reset-open').click();
  await page.getByTestId('test-reset-dialog').waitFor();
  await page.getByTestId('test-reset-dialog').getByRole('button', { name: '취소' }).click();
  await page.getByTestId('test-reset-dialog').waitFor({ state: 'detached' });
  await goto('단축키 · 옵션');
  await page.getByRole('button', { name: '파일 선택' }).click();
  await page.getByTestId('settings-keys').waitFor();
  assert.equal(await page.getByTestId('settings-key-row').count(), 3);
  await page.getByRole('tab', { name: '테스트 실행 결과', exact: true }).click();
  await page.getByRole('button', { name: '다시 가져오기' }).click();
  // The failure shows once, on the page that ran the import (not as a page-top banner).
  await page.getByText('가져올 테스트 실행 결과가 없습니다.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('studio-message').count(), 0);
  // One-row import bar: segmented toggle, details, a plain (non-primary) import-again button.
  const bar = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="settings-imported"]').getBoundingClientRect();
    const seg = document
      .querySelector('[data-testid="settings-imported"] .seg')
      .getBoundingClientRect();
    const again = [...document.querySelectorAll('[data-testid="settings-imported"] button')].find(
      (b) => b.textContent.includes('다시 가져오기'),
    );
    return {
      oneRow: row.height < 90 && Math.abs(seg.top - again.getBoundingClientRect().top) < 40,
      plain: !again.classList.contains('primary'),
    };
  });
  assert.deepEqual(bar, { oneRow: true, plain: true });
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-polish-player-settings.png') });
  // A command message belongs to its page: it is gone after navigating away.
  await menuAction('file', 'save');
  await page.getByTestId('studio-message').waitFor();
  await goto('개요');
  assert.equal(await page.getByTestId('studio-message').count(), 0);

  // Folder import remains a helper for the mod and shader settings candidates.
  await goto('모드 설정');
  await page.getByRole('button', { name: '폴더에서 불러오기' }).click();
  await page.getByTestId('preset-dialog').waitFor();
  await page.getByTestId('import-folder').click();
  await page.getByTestId('preset-dialog').waitFor({ state: 'detached' });
  await page.getByTestId('settings-config').waitFor();
  assert.equal(await page.locator('[data-testid="settings-config"] > section').count(), 2);
  await page.getByTestId('config-file').filter({ hasText: 'example.properties' }).click();
  await page.getByTestId('config-items').getByText('alpha', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: '항목 검색' }).fill('bet');
  assert.equal(
    await page.getByTestId('config-items').getByText('alpha', { exact: true }).count(),
    0,
  );
  await page.getByRole('searchbox', { name: '항목 검색' }).fill('');
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-polish-mods.png') });
  await goto('단축키 · 옵션');
  await page.getByTestId('settings-keys').waitFor();
  assert.equal(await page.getByTestId('settings-key-row').count(), 3);
  await page.getByLabel('key.jump 선택').check();
  await page.getByTestId('settings-bulk').getByRole('radio', { name: '항상 고정' }).click();
  await page
    .getByRole('radiogroup', { name: 'key.jump 적용 방식' })
    .getByRole('radio', { name: '항상 고정', exact: true })
    .and(page.locator('[aria-checked=true]'))
    .waitFor();
  await page.getByRole('tab', { name: '소리 · 화면' }).click();
  await page.getByTestId('settings-options').waitFor();
  await page
    .getByRole('radiogroup', { name: 'renderDistance 적용 방식' })
    .getByRole('radio', { name: '최초 기본값' })
    .click();
  await goto('모드 설정');
  await page.getByTestId('config-file').filter({ hasText: 'example.properties' }).click();
  await page
    .getByRole('radiogroup', { name: 'alpha 적용 방식' })
    .getByRole('radio', { name: '최초 기본값' })
    .click();
  await page.getByTestId('settings-policy').waitFor();
  await goto('리소스팩');
  await page.getByTestId('pack-add').click();
  await page.getByTestId('pack-row').filter({ hasText: 'server-pack.zip' }).waitFor();
  assert.equal(await page.getByTestId('pack-row').count(), 1);
  await goto('셰이더');
  await page.getByTestId('pack-add').click();
  await page.getByTestId('shader-row').filter({ hasText: 'Test.zip' }).waitFor();
  await page.getByRole('radio', { name: /선택할 셰이더팩: Test.zip/ }).click();
  await page.getByRole('switch', { name: '셰이더 사용' }).click();
  await page
    .getByRole('radiogroup', { name: '셰이더 사용 적용 방식' })
    .getByRole('radio', { name: '최초 기본값' })
    .click();
  await page.getByRole('button', { name: '항목 보기' }).waitFor();
  assert.equal(await page.getByTestId('settings-policy-error').count(), 0);
  // The generated policy file is a managed file now.
  await goto('파일');
  await page
    .getByRole('row')
    .filter({ hasText: 'resourcepacks/server-pack.zip' })
    .getByRole('button', { name: '설정 화면에서 관리' })
    .waitFor();

  // Deploy: build, status from the main process.
  await goto('배포');
  assert.equal(await page.getByTestId('deploy-card').getAttribute('data-state'), 'unknown');
  await page.getByTestId('build-button').click();
  await page
    .getByTestId('studio-message')
    .filter({
      hasText: /torchpack 배포 파일을 생성했습니다|The torchpack deployment file was created/,
    })
    .waitFor();
  assert.ok(
    (await app.evaluate(() => globalThis.__studioSmokeSaveTitles ?? [])).includes('torchpack 생성'),
  );
  assert.equal((await readFile(pack)).subarray(0, 8).toString(), 'TORCHDEP');
  await page.locator('[data-testid="deploy-card"][data-state="current"]').waitFor();
  await page.getByTestId('deploy-lastbuild').filter({ hasText: 'server.torchpack' }).waitFor();
  await goto('개요');
  assert.equal(await page.getByTestId('deploy-status').getAttribute('data-state'), 'current');

  // Export is blocked until the public file was checked; the reason is listed.
  await goto('내보내기');
  await page.getByTestId('export-checks').waitFor();
  assert.equal(await page.getByTestId('export-checks').getAttribute('data-blocked'), 'true');
  assert.equal(await page.getByTestId('export-button').isDisabled(), true);
  await page
    .getByTestId('export-checks')
    .getByText('배포 주소를 검사하지 않았습니다', { exact: false })
    .first()
    .waitFor();

  // Address check against the (test-served) public file, then a real ZIP export.
  await goto('배포');
  await page.getByLabel('공개 torchpack HTTPS 주소').fill('http://example.org/server.torchpack');
  assert.equal(
    await page.getByRole('button', { name: '주소 검사', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('공개 torchpack HTTPS 주소').fill(publicUrl);
  await page.getByRole('button', { name: '주소 검사', exact: true }).click();
  await page.locator('[data-testid="address-card"][data-state="ok"]').waitFor();
  assert.equal(await page.getByTestId('address-checks').locator('.ck.ok').count(), 5);
  await goto('내보내기');
  await page.locator('[data-testid="export-checks"][data-blocked="false"]').waitFor();
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-done').waitFor();
  const zip = await readFile(exported);
  assert.equal(zip.subarray(0, 2).toString(), 'PK');
  assert.ok(zip.includes(Buffer.from('torchlauncher-server.json')), 'zip lists the server config');
  assert.ok(zip.includes(Buffer.from('TorchLauncher-test.AppImage')), 'zip lists the launcher');
  await page.getByRole('button', { name: '폴더 열기' }).click();
  await expectRevealed(exported);
  await page.getByRole('button', { name: '다시 내보내기' }).click();

  // A later file change blocks the export again with its reason.
  await goto('파일');
  await writeFile(join(source, 'custom.data'), 'UI payload changed after the build');
  await page.getByTestId('files-rescan').click();
  await page
    .getByRole('row')
    .filter({ hasText: 'custom.data' })
    .getByText('수정', { exact: true })
    .waitFor();
  await goto('내보내기');
  await page.locator('[data-testid="export-checks"][data-blocked="true"]').waitFor();
  await page.getByTestId('export-stale').waitFor();
  await page
    .getByTestId('export-checks')
    .getByText('마지막 배포 이후 파일이 바뀌었습니다', { exact: false })
    .waitFor();
  assert.equal(await page.getByTestId('export-button').isDisabled(), true);
  assert.equal(await app.evaluate(() => globalThis.__studioSmokeNativeBoxes ?? 0), 0);

  // Persistence: save, reopen the saved project.
  await menuAction('file', 'save');
  await page.getByText(/프로젝트를 저장했습니다\.|Project saved\./).waitFor();
  const saved = readStudioFile(await readFile(project));
  assert.equal(saved.version, 1);
  assert.ok(saved.lastBuild && saved.gameSettings.resourcePacks.length === 1);
  assert.equal(saved.gameSettings.shader.pack.value, 'Test.zip');
  // File > Close project returns to the start screen (clean project: no question).
  await menuAction('file', 'close');
  await page.getByTestId('start-page').waitFor();
  const mainState = () => page.evaluate(() => window.torchlauncher.request({ action: 'state' }));
  assert.equal((await mainState()).state.project, null);
  await menuAction('file', 'open');
  await goto('단축키 · 옵션');
  await page.getByTestId('settings-imported').waitFor();

  // Layout at the minimum and the default widths: every page paints and nothing overflows.
  await mkdir(join(cwd, '.cache/smoke'), { recursive: true });
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: width === 760 ? 760 : 800 });
    // The whole sidebar fits (no scrollbar, nothing cut) at 800 px height.
    const fit = await page.evaluate(() => {
      const side = document.querySelector('.side');
      const first = side.firstElementChild.getBoundingClientRect();
      const foot = side.lastElementChild.getBoundingClientRect();
      return {
        overflow: side.scrollHeight - side.clientHeight,
        topVisible: first.top >= 0,
        footVisible: foot.bottom <= innerHeight + 1,
      };
    });
    if (width === 1100) assert.deepEqual(fit, { overflow: 0, topVisible: true, footVisible: true });
    assert.equal(await page.evaluate(() => innerWidth), width);
    for (const label of [
      '개요',
      '서버 정보',
      '브랜딩',
      '모드 설정',
      '리소스팩',
      '셰이더',
      '파일',
      '테스트 실행',
      '단축키 · 옵션',
      '배포',
      '내보내기',
    ]) {
      await goto(label);
      await assertPainted(`${label}@${width}`);
      await page.screenshot({
        path: join(cwd, `.cache/smoke/studio-${width}-${label.replaceAll(' ', '')}.png`),
      });
    }
  }

  // Every menu entry has its own icon.
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('nav.menu .mi svg')].map((svg) => svg.innerHTML),
  );
  assert.equal(new Set(icons).size, icons.length, 'menu icons are distinct');
  // Small windows: no horizontal overflow, no clipped footer labels, thin dark scrollbar.
  for (const [width, height] of [
    [760, 560],
    [900, 600],
  ]) {
    await page.setViewportSize({ width, height });
    const small = await page.evaluate(() => {
      const side = document.querySelector('.side');
      const labels = [...side.querySelectorAll('.sidefoot .savest-text')];
      return {
        horizontal: side.scrollWidth > side.clientWidth,
        clipped: labels
          .filter((element) => element.scrollWidth > element.clientWidth)
          .map((element) => element.textContent.trim()),
        scrollbarWidth: getComputedStyle(side).scrollbarWidth,
        overflowY: getComputedStyle(side).overflowY,
        documentOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.deepEqual(
      small,
      {
        horizontal: false,
        clipped: [],
        scrollbarWidth: 'thin',
        overflowY: 'auto',
        documentOverflow: false,
      },
      `sidebar at ${width}x${height}`,
    );
    await page
      .locator('.sidefoot')
      .screenshot({ path: join(cwd, `.cache/smoke/studio-sidebar-footer-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await page
    .locator('.sidefoot')
    .screenshot({ path: join(cwd, '.cache/smoke/studio-sidebar-footer-1100x800.png') });
  // On a short window the sidebar scrolls instead of cutting content.
  await page.setViewportSize({ width: 1100, height: 580 });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.side')).overflowY),
    'auto',
  );
  await page.setViewportSize({ width: 1100, height: 800 });

  const isolation = await page.evaluate(() => ({
    require: 'require' in window,
    process: 'process' in window,
    keys: Object.keys(window.torchlauncher).sort(),
  }));
  assert.deepEqual(isolation, {
    require: false,
    process: false,
    keys: ['getApplicationInfo', 'onCloseRequest', 'request'],
  });
  assert.deepEqual(errors, []);

  // Closing a dirty project asks first; after discarding, main has no project and nothing is dirty
  // (so closing the window afterwards does not ask).
  await goto('서버 정보');
  await page.getByLabel('서버 이름', { exact: true }).fill('Discard me');
  await menuAction('file', 'close');
  const closeDialog = page.getByTestId('unsaved-dialog');
  await closeDialog.waitFor();
  await closeDialog.getByRole('button', { name: '취소', exact: true }).click();
  await closeDialog.waitFor({ state: 'detached' });
  assert.notEqual((await mainState()).state.project, null);
  await menuAction('file', 'close');
  await closeDialog.getByRole('button', { name: '저장 안 함', exact: true }).click();
  await page.getByTestId('start-page').waitFor();
  const afterClose = (await mainState()).state;
  assert.equal(afterClose.project, null);
  assert.equal(afterClose.dirty, false);
  await menuAction('file', 'open');
  await goto('서버 정보');

  // Window close with unsaved changes: main asks, the app answers in its own modal.
  await goto('서버 정보');
  await page.getByLabel('서버 이름', { exact: true }).fill('Closing edit');
  // File > Exit uses the window close path: the unsaved flow applies.
  await menuAction('file', 'exit');
  const closing = page.getByTestId('unsaved-dialog');
  await closing.waitFor();
  await closing.getByRole('button', { name: '취소', exact: true }).click();
  await closing.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await closeWindow();
  await closing.waitFor();
  await closing.getByRole('button', { name: '저장', exact: true }).click();
  await page.waitForEvent('close', { timeout: 15000 }); // save, then closeConfirm
  assert.equal(readStudioFile(await readFile(project)).name, 'Closing edit');
  assert.equal(
    await app.evaluate(() => globalThis.__studioSmokeNativeBoxes ?? 0).catch(() => 0),
    0,
  );
  console.log(
    'Studio Electron smoke passed: shell and splash, in-app unsaved dialog, split game/player settings pages, explicit options imports, server/branding/files/test/deploy/export pages, persistence, painted layout at 760 and 1100 px and isolation',
  );
} finally {
  // A dirty project answers a window close with its in-app dialog; never wait on it forever.
  const child = app?.process();
  await Promise.race([app?.close().catch(() => {}), new Promise((done) => setTimeout(done, 5000))]);
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
  }
  await rm(root, { recursive: true, force: true });
}

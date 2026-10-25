import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

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

/** A solid-colour RGB PNG built with zlib only (no image library, no stored binary fixture). */
function solidPng(width, height) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
const bigIcon = join(source, 'big-icon.png');
await writeFile(bigIcon, solidPng(2000, 2000));
const badIcon = join(source, 'bad-icon.png');
await writeFile(badIcon, 'this is not an image');
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
// Distinct coloured branding images so the preview is obviously not the default artwork.
function colourPng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b], y * (width * 3 + 1) + 1 + x * 3);
    }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const iconPng = join(source, 'icon-magenta.png');
const backgroundPng = join(source, 'background-green.png');
await writeFile(
  iconPng,
  colourPng(256, 256, (x, y) => (Math.abs(x - y) < 24 ? [0, 255, 255] : [255, 0, 255])),
);
await writeFile(
  backgroundPng,
  colourPng(1920, 1080, (x, y) => [
    0,
    140 + Math.round((y / 1080) * 80),
    40 + Math.round((x / 1920) * 160),
  ]),
);
const packs = join(root, 'packs');
await mkdir(packs);
await writeFile(join(packs, 'server-pack.zip'), zipBytes);
await writeFile(join(packs, 'Test.zip'), zipBytes);
await writeFile(join(packs, 'example-mod.jar'), zipBytes);
// Provide the dev resolver's expected package artifact; never overwrite an existing build.
const launcherVersion = JSON.parse(
  await readFile(join(cwd, 'apps/admin/package.json'), 'utf8'),
).version;
const launcherName = `TorchLauncher-${launcherVersion}-linux-x64.AppImage`;
const launcher = join(cwd, 'apps/launcher/dist', launcherName);
await mkdir(join(cwd, 'apps/launcher/dist'), { recursive: true });
let createdLauncherFixture = false;
try {
  await writeFile(launcher, Buffer.concat([Buffer.from('\x7fELF'), Buffer.alloc(2048, 1)]), {
    mode: 0o755,
    flag: 'wx',
  });
  createdLauncherFixture = true;
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
// New project creates <parent>/<name> itself; only the parent exists beforehand.
const projectParent = join(root, 'projects');
await mkdir(projectParent);
const project = join(projectParent, 'server-project');
const projectFile = join(project, 'project.torchproj');
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
        '프로젝트 폴더 열기': [paths.project],
        '프로젝트 폴더를 만들 위치 선택': [paths.projectParent],
        '추가할 파일 선택': [paths.file, paths.options],
        '게임을 한 번 실행한 폴더 선택': [paths.game],
        'options.txt 선택': [join(paths.game, 'options.txt')],
        '리소스팩(.zip) 선택': [join(paths.packs, 'server-pack.zip')],
        '셰이더팩(.zip) 선택': [join(paths.packs, 'Test.zip')],
        '모드(.jar) 선택': [join(paths.packs, 'example-mod.jar')],
        '앱 아이콘 선택 (PNG 또는 JPEG, 자동으로 크기 조정)': [paths.bigIcon],
        '홈 배경 선택 (PNG 또는 JPEG, 자동으로 크기 조정)': [paths.backgroundPng],
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
        if (!canceled && globalThis.__studioSmokeIcon && options.title.startsWith('앱 아이콘'))
          return { canceled: false, filePaths: [globalThis.__studioSmokeIcon] };
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
            options.title === '런처 내보내기 ZIP 저장' || options.title === 'Save launcher ZIP'
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
      bigIcon,
      badIcon,
      options: join(source, 'options.txt'),
      iconPng,
      backgroundPng,
      project,
      projectParent,
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
  // The start screen fills the renderer directly below the in-app menu, with no exposed page strip.
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    const startBounds = await page.evaluate(() => {
      const menu = document.querySelector('.menubar').getBoundingClientRect();
      const page = document.querySelector('.page').getBoundingClientRect();
      const hero = document.querySelector('.hero').getBoundingClientRect();
      const inner = document.querySelector('.hero .inner').getBoundingClientRect();
      const language = document.querySelector('.hero .lang-corner').getBoundingClientRect();
      return {
        menuBottom: menu.bottom,
        pageTop: page.top,
        heroTop: hero.top,
        innerLeft: inner.left,
        innerRight: inner.right,
        languageTop: language.top,
      };
    });
    assert.equal(startBounds.pageTop, startBounds.menuBottom);
    assert.equal(startBounds.heroTop, startBounds.pageTop);
    assert.ok(
      startBounds.innerLeft >= 36,
      `start content lost its left gutter: ${JSON.stringify(startBounds)}`,
    );
    assert.ok(
      width - startBounds.innerRight >= 36,
      `start content lost its right gutter: ${JSON.stringify(startBounds)}`,
    );
    assert.equal(startBounds.languageTop, startBounds.menuBottom + 44);
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-start-${width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.getByTestId('menu-file').click();
  for (const id of ['save', 'saveAs', 'revealProject', 'close'])
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
  // New project: in-app name prompt first (also at 760 px), then the native parent picker.
  await page.getByTestId('start-new').click();
  const nameDialog = page.getByTestId('project-name-dialog');
  await nameDialog.waitFor();
  const nameInput = page.getByTestId('project-name-input');
  const nameSubmit = page.getByTestId('project-name-submit');
  assert.equal(await nameInput.inputValue(), '새 서버');
  for (const bad of ['', 'a/b', 'CON', 'ends.']) {
    await nameInput.fill(bad);
    assert.equal(await nameSubmit.isDisabled(), true, `name "${bad}" must be refused`);
  }
  assert.notEqual(await page.getByTestId('project-name-error').textContent(), '');
  await nameInput.fill('server-project');
  assert.equal(await nameSubmit.isDisabled(), false);
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    const box = await nameDialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width, `name dialog fits at ${width}px`);
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-project-name-${width}.png`) });
  }
  // Cancelling the native parent picker leaves the prompt open and creates nothing.
  await app.evaluate(() => {
    globalThis.__studioSmokeCancelNext = true;
  });
  await nameSubmit.click();
  await page.getByTestId('project-name-error').filter({ hasText: /\S/ }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.torchlauncher.request({ action: 'state' }))).state.project,
    null,
  );
  assert.equal(await page.getByTestId('project-card').count(), 0);
  assert.equal(existsSync(project), false);
  await nameSubmit.click();
  await nameDialog.waitFor({ state: 'detached' });
  await page.getByTestId('project-card').waitFor();
  assert.deepEqual((await readdir(project)).sort(), ['files', 'project.torchproj']);
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

  // Server info: default game memory (Xmx default 2 GB, Xms blank; Xms requires Xmx and fits it).
  const memoryMax = page.getByTestId('memory-max');
  const memoryInitial = page.getByTestId('memory-initial');
  assert.equal(await memoryMax.inputValue(), '2');
  assert.equal(await memoryInitial.inputValue(), '');
  assert.equal(await memoryMax.getAttribute('aria-invalid'), 'false');
  await memoryInitial.fill('3');
  assert.equal(await memoryInitial.getAttribute('aria-invalid'), 'true');
  await memoryInitial.fill('');
  assert.equal(await memoryInitial.getAttribute('aria-invalid'), 'false');
  await memoryMax.fill('0.25');
  assert.equal(await memoryMax.getAttribute('aria-invalid'), 'true');
  await memoryMax.fill('');
  await memoryInitial.fill('1');
  assert.equal(await memoryInitial.getAttribute('aria-invalid'), 'true');
  await memoryMax.fill('4');
  assert.equal(await memoryMax.getAttribute('aria-invalid'), 'false');
  assert.equal(await memoryInitial.getAttribute('aria-invalid'), 'false');
  await memoryInitial.fill('1.5');
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const pageElement = document.querySelector('[data-testid="page"]');
      return {
        documentOverflow: document.documentElement.scrollWidth > innerWidth,
        pageOverflow: pageElement ? pageElement.scrollWidth > pageElement.clientWidth : false,
      };
    });
    assert.deepEqual(layout, { documentOverflow: false, pageOverflow: false });
    await memoryMax.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-server-memory-${width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 760 });

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
  // Save As asks for the name in-app too (prefilled with the folder name); Escape cancels.
  await menuAction('file', 'saveAs');
  await nameDialog.waitFor();
  assert.equal(await nameInput.inputValue(), 'server-project');
  await page.keyboard.press('Escape');
  await nameDialog.waitFor({ state: 'detached' });
  assert.equal(
    (await page.evaluate(() => window.torchlauncher.request({ action: 'state' }))).state
      .projectName,
    'server-project',
  );
  // Ctrl+S saves even while a text input has focus.
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-lang-en').click();
  await nav('Overview').waitFor();
  await page.getByLabel('Server name', { exact: true }).focus();
  await page.keyboard.press('Control+s');
  await page.getByText(/프로젝트를 저장했습니다\.|Project saved\./).waitFor();
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-lang-ko').click();
  await nav('개요').waitFor();
  assert.equal(readStudioFile(await readFile(projectFile)).name, 'Functional Studio smoke');
  assert.deepEqual(readStudioFile(await readFile(projectFile)).memory, {
    maxMiB: 4096,
    initialMiB: 1536,
  });
  await page.getByLabel('서버 이름', { exact: true }).fill('Functional Studio smoke 2');
  await menuAction('file', 'open');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByTestId('save-state').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(readStudioFile(await readFile(projectFile)).name, 'Functional Studio smoke 2');
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
    readStudioFile(await readFile(projectFile)).branding?.appName,
    undefined,
    'branding name is unsaved until the project is saved',
  );

  // Branding image: an oversized icon is converted, a broken file shows its concrete cause.
  const iconRow = page.getByTestId('brand-icon');
  await iconRow.getByText('기본값').waitFor();
  await page.getByRole('button', { name: '앱 아이콘 변경', exact: true }).click();
  await iconRow.getByText(/^PNG · /).waitFor();
  await page.getByTestId('brand-preview').waitFor();
  const converted = await page.evaluate(() => window.torchlauncher.request({ action: 'state' }));
  assert.ok(converted.state.project.branding.icon.length <= 1024 ** 2);
  const storedIcon = await readFile(join(project, 'branding', 'icon.png'));
  assert.equal(storedIcon.readUInt32BE(16), 512);
  assert.equal(storedIcon.readUInt32BE(20), 512);
  assert.equal(
    createHash('sha256').update(storedIcon).digest('hex'),
    converted.state.project.branding.icon.sha256,
  );
  await app.evaluate((_electron, icon) => {
    globalThis.__studioSmokeIcon = icon;
  }, badIcon);
  await page.getByRole('button', { name: '앱 아이콘 변경', exact: true }).click();
  const imageMessage = page.getByTestId('studio-message');
  await imageMessage.getByText(/bad-icon\.png/).waitFor();
  const imageText = await imageMessage.innerText();
  assert.ok(imageText.includes('지원하는 이미지가 아닙니다'), imageText);
  assert.ok(!imageText.includes('입력값'), imageText);
  assert.ok(!imageText.includes(source), 'no absolute path in the message');
  assert.equal(await app.evaluate(() => globalThis.__studioSmokeNativeBoxes ?? 0), 0);
  await app.evaluate(() => {
    globalThis.__studioSmokeIcon = undefined;
  });
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    const layout = await page.evaluate(() => ({
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      pageOverflow: (() => {
        const el = document.querySelector('[data-testid="page"]');
        return el ? el.scrollWidth > el.clientWidth : false;
      })(),
    }));
    assert.deepEqual(layout, { documentOverflow: false, pageOverflow: false });
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-branding-${width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 760 });

  // UNSAVED contract: replacing a dirty project needs the in-app confirmation flag.
  await page
    .getByLabel('서버 이름', { exact: true })
    .waitFor()
    .catch(() => {});
  await goto('서버 정보');
  await page.getByLabel('서버 이름', { exact: true }).fill('Dirty edit');
  assert.deepEqual(
    await page.evaluate(() => window.torchlauncher.request({ action: 'new', name: 'x' })),
    {
      ok: false,
      code: 'UNSAVED',
    },
  );
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

  // Files: project folder, add files, real sizes, bulk policy, launcher paths, deletion, rescan.
  await goto('파일');
  const projectFiles = async () =>
    page.evaluate(
      async () => (await window.torchlauncher.request({ action: 'state' })).state.project.files,
    );
  await page.getByTestId('source-name').filter({ hasText: 'server-project' }).waitFor();
  await page.getByTestId('project-reveal').click();
  await page.getByRole('button', { name: '파일 추가', exact: true }).click();
  const customRow = page.getByRole('row').filter({ hasText: 'custom.data' });
  await customRow.waitFor();
  assert.match(await customRow.textContent(), /19 B/);
  // Player settings (options.txt) are managed on their own page and never listed here.
  assert.equal(await page.getByRole('row').filter({ hasText: 'options.txt' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '설정 화면에서 관리' }).count(), 0);
  assert.deepEqual(await projectFiles(), [
    { path: 'custom.data', targetPath: 'custom.data', policy: 'always' },
  ]);
  // Added files start at the game folder; launcher folder editing keeps the source filename.
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  let targetDialog = page.getByTestId('files-target-dialog');
  let targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  assert.equal(await targetInput.inputValue(), '');
  assert.equal(await targetDialog.getByTestId('files-target-save').isDisabled(), true);
  await targetInput.fill('  ');
  assert.equal(await targetDialog.getByTestId('files-target-save').isDisabled(), true);
  await targetInput.press('Enter');
  assert.equal(await targetDialog.isVisible(), true);
  await targetInput.press('Escape');
  await targetDialog.waitFor({ state: 'detached' });
  assert.deepEqual(await projectFiles(), [
    { path: 'custom.data', targetPath: 'custom.data', policy: 'always' },
  ]);
  await customRow
    .getByRole('radiogroup', { name: 'custom.data 적용 방식' })
    .getByRole('radio', { name: '최초만' })
    .click();
  await customRow.locator('button.i[aria-checked=true]').waitFor();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '항상 적용' }).click();
  await customRow.locator('button.a[aria-checked=true]').waitFor();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '최초 설치만' }).click();
  await customRow.locator('button.i[aria-checked=true]').waitFor();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').getByRole('button', { name: '항상 적용' }).click();
  await customRow.locator('button.a[aria-checked=true]').waitFor();
  // Launcher folder: valid changes retain the source filename; invalid folders show an in-modal error.
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetInput.fill('data');
  await targetInput.press('Enter');
  await page.waitForFunction(
    async () =>
      (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
        .targetPath === 'data/custom.data',
  );
  await targetDialog.waitFor({ state: 'detached' });
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetInput.fill('/');
  await targetDialog.getByTestId('files-target-save').click();
  await targetDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    async () =>
      (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
        .targetPath === 'custom.data',
  );
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetInput.fill('./');
  assert.equal(await targetDialog.getByTestId('files-target-save').isDisabled(), true);
  await targetInput.press('Escape');
  await targetDialog.waitFor({ state: 'detached' });
  for (const [folder, target] of [
    ['./app/', 'app/custom.data'],
    ['/folder/', 'folder/custom.data'],
    ['/', 'custom.data'],
  ]) {
    await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
    targetDialog = page.getByTestId('files-target-dialog');
    targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
    await targetInput.fill(folder);
    await targetDialog.getByTestId('files-target-save').click();
    await targetDialog.waitFor({ state: 'detached' });
    await page.waitForFunction(
      async (expected) =>
        (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
          .targetPath === expected,
      target,
    );
  }
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetInput.fill('data');
  await targetDialog.getByTestId('files-target-save').click();
  await targetDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    async () =>
      (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
        .targetPath === 'data/custom.data',
  );
  for (const bad of ['../escape', 'resourcepacks', 'shaderpacks/subdir']) {
    if (!(await targetDialog.isVisible())) {
      await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
      targetDialog = page.getByTestId('files-target-dialog');
      targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
    }
    await targetInput.fill(bad);
    await targetDialog.getByTestId('files-target-save').click();
    await targetDialog.getByRole('alert').waitFor();
    assert.equal((await projectFiles())[0].targetPath, 'data/custom.data', `${bad} not stored`);
    assert.equal(await targetInput.inputValue(), bad, `${bad} stays editable`);
    await targetInput.press('Escape');
    await targetDialog.waitFor({ state: 'detached' });
  }
  // Reset copies the source folder into the editor; cancel keeps the persisted target folder.
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetDialog.getByTestId('files-target-reset').click();
  assert.equal(await targetInput.inputValue(), '');
  await targetDialog.getByRole('button', { name: '취소' }).click();
  await targetDialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
    'files-target-edit',
  );
  assert.equal((await projectFiles())[0].targetPath, 'data/custom.data');
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetDialog.getByTestId('files-target-reset').click();
  await targetDialog.getByTestId('files-target-save').click();
  await targetDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    async () =>
      (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
        .targetPath === 'custom.data',
  );
  // A source file that was never added is not listed.
  await writeFile(join(project, 'files', 'extra.txt'), 'added later');
  await page.getByTestId('files-rescan').click();
  await page.waitForFunction(async () => {
    const state = (await window.torchlauncher.request({ action: 'state' })).state;
    return state.files.entries.some((entry) => entry.path === 'extra.txt');
  });
  assert.equal(await page.getByRole('row').filter({ hasText: 'extra.txt' }).count(), 0);
  // Delete asks first; cancelling keeps the file, confirming removes the entry and the file.
  await customRow.getByTestId('files-remove').click();
  await page.getByTestId('files-remove-dialog').waitFor();
  await page.getByTestId('files-remove-dialog').getByRole('button', { name: '취소' }).click();
  assert.equal(
    await readFile(join(project, 'files', 'custom.data'), 'utf8'),
    'UI selected payload',
  );
  await customRow.getByTestId('files-remove').click();
  await page.getByTestId('files-remove-confirm').click();
  await customRow.waitFor({ state: 'detached' });
  await assert.rejects(readFile(join(project, 'files', 'custom.data')), { code: 'ENOENT' });
  assert.deepEqual(await projectFiles(), []);
  // Deleting autosaves; adding the file again lists it as "always" once more.
  assert.equal(
    await page.evaluate(
      async () => (await window.torchlauncher.request({ action: 'state' })).state.dirty,
    ),
    false,
  );
  await page.getByRole('button', { name: '파일 추가', exact: true }).click();
  await customRow.waitFor();
  assert.deepEqual(await projectFiles(), [
    { path: 'custom.data', targetPath: 'custom.data', policy: 'always' },
  ]);
  const longTargetFolder = `nested/${'long-folder/'.repeat(8)}tail`;
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  targetInput = targetDialog.getByLabel('custom.data의 런처 폴더');
  await targetInput.fill(longTargetFolder);
  await targetDialog.getByTestId('files-target-save').click();
  await targetDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    async (target) =>
      (await window.torchlauncher.request({ action: 'state' })).state.project.files[0]
        .targetPath === `${target}/custom.data`,
    longTargetFolder,
  );
  // The responsive table keeps all row controls in view and hit-testable at both widths.
  await mkdir(join(cwd, '.cache/smoke'), { recursive: true });
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    await customRow.scrollIntoViewIfNeeded();
    const fit = await page.evaluate((fullFolder) => {
      const scroll = document.querySelector('.tablecard .scroll').getBoundingClientRect();
      const card = document.querySelector('.tablecard').getBoundingClientRect();
      const row = [...document.querySelectorAll('.tbl tbody tr')].find((item) =>
        item.textContent.includes('custom.data'),
      );
      const controls = [
        row?.querySelector('[role="radio"]'),
        row?.querySelector('[data-testid="files-remove"]'),
        row?.querySelector('[data-testid="files-target-edit"]'),
      ];
      const controlRects = controls.map((item) => item?.getBoundingClientRect());
      const targetText = row?.querySelector('.target-value');
      const targetRect = targetText?.getBoundingClientRect();
      const editRect = row
        ?.querySelector('[data-testid="files-target-edit"]')
        ?.getBoundingClientRect();
      const targetStyle = targetText ? getComputedStyle(targetText) : null;
      const hitTargets = controls.map((item, index) => {
        const rect = controlRects[index];
        if (!item || !rect || rect.width === 0 || rect.height === 0) return false;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return (
          x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && !!hit && item.contains(hit)
        );
      });
      return {
        horizontal: document.documentElement.scrollWidth > innerWidth,
        cardHasNoHorizontalScroll:
          scroll.right <= card.right + 1 &&
          document.querySelector('.tablecard .scroll').scrollWidth <=
            document.querySelector('.tablecard .scroll').clientWidth,
        controlsInsideViewport: controlRects.every(
          (rect) => rect && rect.left >= 0 && rect.right <= innerWidth,
        ),
        controlsHitTest: hitTargets.every(Boolean),
        targetEllipsis:
          targetStyle?.textOverflow === 'ellipsis' &&
          targetStyle.whiteSpace === 'nowrap' &&
          targetStyle.overflow === 'hidden',
        targetTitleHasFullFolder: targetText?.getAttribute('title') === fullFolder,
        targetAndEditStayOnOneLine:
          !!targetRect &&
          !!editRect &&
          Math.abs(targetRect.top + targetRect.height / 2 - (editRect.top + editRect.height / 2)) <
            1,
      };
    }, longTargetFolder);
    assert.deepEqual(
      fit,
      {
        horizontal: false,
        cardHasNoHorizontalScroll: true,
        controlsInsideViewport: true,
        controlsHitTest: true,
        targetEllipsis: true,
        targetTitleHasFullFolder: true,
        targetAndEditStayOnOneLine: true,
      },
      `files@${width}`,
    );
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-files-${width}.png`) });
  }
  await customRow.getByRole('button', { name: 'custom.data의 런처 폴더 편집' }).click();
  targetDialog = page.getByTestId('files-target-dialog');
  await targetDialog.getByTestId('files-target-reset').click();
  await targetDialog.getByTestId('files-target-save').click();
  await targetDialog.waitFor({ state: 'detached' });
  assert.deepEqual(await projectFiles(), [
    { path: 'custom.data', targetPath: 'custom.data', policy: 'always' },
  ]);

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
  // Render a completed diagnostic snapshot without account/network/game side effects.
  const resultState = await page.evaluate(
    async () => (await window.torchlauncher.request({ action: 'state' })).state,
  );
  await app.evaluate(({ ipcMain }, state) => {
    const handler = ipcMain._invokeHandlers.get('studio:request');
    globalThis.__studioResultHandler = handler;
    globalThis.__studioResultCommands = [];
    const result = {
      ...state,
      busy: null,
      account: { ...state.account, signedIn: true, available: true },
      testRun: {
        ...state.testRun,
        phase: 'done',
        exit: { reason: 'exited', code: 1, signal: null },
        logs: [{ stream: 'stderr', text: 'synthetic recent log' }],
        report: {
          status: 'problems',
          truncated: true,
          items: [
            {
              severity: 'error',
              category: 'mixin',
              summary: { code: 'mixin-failed', parameters: {} },
              evidence: [],
            },
          ],
        },
        configFiles: [{ path: 'config/hidden.toml' }],
        extracted: { keybindCount: 1, otherOptionCount: 2, newConfigCount: 3 },
      },
    };
    ipcMain.removeHandler('studio:request');
    ipcMain.handle('studio:request', (_event, command) => {
      globalThis.__studioResultCommands.push(command);
      return { ok: true, state: result };
    });
  }, resultState);
  // Navigation performs a state request through the existing bridge.
  await goto('서버 정보');
  await goto('테스트 실행');
  await page.evaluate(() => window.torchlauncher.request({ action: 'state' }));
  // The controller refreshes through its normal polling while this page is active.
  await page.getByTestId('test-result').waitFor();
  assert.match(await page.getByTestId('test-result').textContent(), /문제 1건 · 경고 0건/);
  assert.match(await page.getByTestId('test-result').textContent(), /종료 코드 1/);
  assert.match(await page.getByTestId('test-log').textContent(), /synthetic recent log/);
  for (const selector of [
    '.test-findings',
    '.test-mods-card',
    '.test-extracted',
    '.test-config-summary',
  ])
    assert.equal(await page.locator(selector).count(), 0);
  await page.getByTestId('test-open-logs').click();
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  const commands = await app.evaluate(() => globalThis.__studioResultCommands);
  assert.ok(commands.some((command) => command.action === 'testOpenLogs'));
  assert.ok(commands.some((command) => command.action === 'testStart'));
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 760 });
    assert.ok(await page.getByTestId('test-open-logs').isVisible());
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-test-result-${width}.png`) });
  }
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('studio:request');
    ipcMain.handle('studio:request', globalThis.__studioResultHandler);
    delete globalThis.__studioResultHandler;
  });
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
  await goto('모드');
  await page.getByTestId('pack-add').click();
  await page.getByTestId('mod-row').filter({ hasText: 'example-mod.jar' }).waitFor();
  assert.equal(
    await page.getByRole('radiogroup', { name: 'example-mod.jar 적용 방식' }).count(),
    0,
  );
  await page.getByTestId('settings-config').waitFor();
  assert.equal(await page.getByTestId('mod-row').count(), 1);
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
  await goto('모드');
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
  // The generated policy and imported mod are managed files.
  await goto('파일');
  // They are not listed on the Files page; the mod stays on its own page.
  assert.equal(await page.getByRole('row').filter({ hasText: 'server-pack.zip' }).count(), 0);
  assert.equal(await page.getByRole('row').filter({ hasText: 'example-mod.jar' }).count(), 0);
  assert.equal(await page.getByRole('row').filter({ hasText: 'settings-policy' }).count(), 0);
  await goto('모드');
  await page.getByTestId('mod-row').waitFor();
  // Return to the file list through the side navigation.
  await page.getByRole('button', { name: '파일' }).click();
  await page.getByTestId('files-rescan').waitFor();

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
  await page.locator('#export-target').selectOption('linux');
  const pickerCountBeforeExport = await app.evaluate(
    () => (globalThis.__studioSmokeOpenTitles ?? []).length,
  );
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-done').waitFor();
  const zip = await readFile(exported);
  assert.equal(zip.subarray(0, 2).toString(), 'PK');
  assert.ok(zip.includes(Buffer.from('torchlauncher-server.json')), 'zip lists the server config');
  assert.ok(
    zip.includes(Buffer.from(launcherName)),
    'zip lists the automatically resolved launcher',
  );
  assert.equal(
    await app.evaluate(() => (globalThis.__studioSmokeOpenTitles ?? []).length),
    pickerCountBeforeExport,
    'export must not open a launcher picker',
  );
  assert.equal(
    (await page.evaluate(() => window.torchlauncher.request({ action: 'state' }))).state
      .launcherRelease.source,
    'local',
  );
  await page.getByRole('button', { name: '폴더 열기' }).click();
  await expectRevealed(exported);
  await page.getByRole('button', { name: '다시 내보내기' }).click();

  // A later file change blocks the export again with its reason.
  await goto('파일');
  await writeFile(join(project, 'files', 'custom.data'), 'UI payload changed after the build');
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
  const saved = readStudioFile(await readFile(projectFile));
  assert.equal(saved.version, 1);
  assert.ok(saved.lastBuild && saved.gameSettings.resourcePacks.length === 1);
  assert.equal(saved.gameSettings.mods[0].name, 'example-mod.jar');
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
      '모드',
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

  // Branding images: rows and preview show the chosen images (never the default art), also after
  // a save and reopen (read back from the project file), and return to default when removed.
  await goto('브랜딩');
  // Earlier steps may have left an icon; start from the default art.
  for (const label of ['앱 아이콘 제거', '홈 배경 제거']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count()) await button.click();
  }
  await page.locator('[data-testid="brand-preview-icon"][data-custom="false"]').waitFor();
  const brandState = async () =>
    page.evaluate(() => {
      const bg = document.querySelector('[data-testid="brand-preview-bg"]');
      const icon = document.querySelector('[data-testid="brand-preview-icon"]');
      const rowIcon = document.querySelector('[data-testid="brand-icon-thumb"] img');
      const rowBg = document.querySelector('[data-testid="brand-background-thumb"]');
      const rowBgImg = rowBg?.querySelector('img');
      return {
        previewIcon: icon?.getAttribute('src') ?? '',
        previewIconCustom: icon?.getAttribute('data-custom'),
        rowIcon: rowIcon?.getAttribute('src') ?? '',
        rowBgSrc: rowBgImg?.getAttribute('src') ?? '',
        rowBgCustom: rowBg?.getAttribute('data-custom'),
        previewBgCustom: bg?.getAttribute('data-custom'),
        previewBgImage: bg ? getComputedStyle(bg).backgroundImage : '',
        defaultArt: !!bg?.querySelector('.sun'),
      };
    });
  const defaults = await brandState();
  assert.equal(defaults.previewIconCustom, 'false');
  assert.ok(!defaults.previewIcon.startsWith('data:'));
  assert.equal(defaults.defaultArt, true);
  const expectChosen = async (label) => {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="brand-preview-icon"]')
          ?.getAttribute('data-custom') === 'true' &&
        document.querySelector('[data-testid="brand-preview-bg"]')?.getAttribute('data-custom') ===
          'true' &&
        document.querySelector('[data-testid="brand-icon-thumb"]')?.getAttribute('data-custom') ===
          'true' &&
        document
          .querySelector('[data-testid="brand-background-thumb"]')
          ?.getAttribute('data-custom') === 'true',
    );
    const now = await brandState();
    assert.ok(now.previewIcon.startsWith('data:image/png;base64,'), `${label} preview icon`);
    assert.ok(now.rowIcon.startsWith('data:image/png;base64,'), `${label} row icon`);
    assert.ok(now.rowBgSrc.startsWith('data:image/jpeg;base64,'), `${label} row background`);
    assert.ok(
      now.previewBgImage.includes('data:image/jpeg;base64,'),
      `${label} preview background`,
    );
    assert.equal(now.defaultArt, false);
    assert.notEqual(now.previewIcon, defaults.previewIcon);
    const sizes = await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(
            (url) =>
              new Promise((resolve) => {
                const image = new Image();
                image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
                image.src = url;
              }),
          ),
        ),
      [now.previewIcon, now.rowBgSrc],
    );
    assert.deepEqual(sizes, [
      [128, 128],
      [960, 540],
    ]);
  };
  await page.getByRole('button', { name: '앱 아이콘 변경', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="brand-preview-icon"]')?.getAttribute('data-custom') ===
      'true',
  );
  await page.getByRole('button', { name: '홈 배경 변경', exact: true }).click();
  await expectChosen('selected');
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByTestId('brand-preview').waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      0,
      `branding page overflows at ${width}`,
    );
    await page.screenshot({ path: join(cwd, `.cache/smoke/studio-branding-images-${width}.png`) });
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await menuAction('file', 'save');
  await page.getByTestId('save-state').filter({ hasText: '저장됨' }).waitFor();
  await menuAction('file', 'open');
  await page.getByTestId('brand-preview').waitFor();
  const reopened = await page.evaluate(async () => {
    const { project } = (await window.torchlauncher.request({ action: 'state' })).state;
    const out = {};
    for (const role of ['icon', 'background']) {
      const reply = await window.torchlauncher.request({
        action: 'brandingImage',
        role,
        sha256: project.branding[role].sha256,
      });
      out[role] = reply.ok ? reply.image.dataUrl.split(',')[0] : reply.code;
    }
    return out;
  });
  assert.deepEqual(reopened, {
    icon: 'data:image/png;base64',
    background: 'data:image/jpeg;base64',
  });
  await page.reload();
  await goto('브랜딩');
  await expectChosen('reloaded from the project file');
  await page.getByRole('button', { name: '앱 아이콘 제거', exact: true }).click();
  await page.getByRole('button', { name: '홈 배경 제거', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="brand-preview-icon"]')?.getAttribute('data-custom') ===
        'false' &&
      document.querySelector('[data-testid="brand-preview-bg"]')?.getAttribute('data-custom') ===
        'false',
  );
  const removed = await brandState();
  assert.equal(removed.rowBgCustom, 'false');
  assert.ok(!removed.previewIcon.startsWith('data:'));
  assert.ok(!removed.rowIcon.startsWith('data:'));
  assert.equal(removed.defaultArt, true);
  assert.equal(removed.previewIcon, defaults.previewIcon);

  const isolation = await page.evaluate(() => ({
    require: 'require' in window,
    process: 'process' in window,
    keys: Object.keys(window.torchlauncher).sort(),
  }));
  assert.deepEqual(isolation, {
    require: false,
    process: false,
    keys: [
      'getApplicationInfo',
      'getUpdateState',
      'onCloseRequest',
      'onUpdate',
      'request',
      'update',
    ],
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
  assert.equal(readStudioFile(await readFile(projectFile)).name, 'Closing edit');
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
  if (createdLauncherFixture) await rm(launcher, { force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

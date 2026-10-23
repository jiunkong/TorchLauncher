import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'studio-ui-smoke-'));
const source = join(root, 'source');
await mkdir(source);
await writeFile(join(source, 'custom.data'), 'UI selected payload');
await writeFile(join(source, 'options.txt'), 'renderDistance:12\n');
const project = join(root, 'server-project.json');
const pack = join(root, 'server.torchpack');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    ...(env.TORCH_STUDIO_ELECTRON_EXECUTABLE
      ? { executablePath: env.TORCH_STUDIO_ELECTRON_EXECUTABLE }
      : {}),
    args: [
      join(cwd, 'apps/admin'),
      `--user-data-dir=${join(root, 'profile')}`,
      '--lang=ko',
      '--password-store=basic',
    ],
    env,
    timeout: 30000,
  });
  await app.evaluate(
    ({ dialog, safeStorage }, paths) => {
      // Headless Linux has no keyring; a reversible stub lets the signing path run (test only).
      const stub = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (text) => Buffer.from(`k${text}`),
        decryptString: (buffer) => buffer.toString().slice(1),
      };
      for (const [name, value] of Object.entries(stub))
        Object.defineProperty(safeStorage, name, { value, configurable: true, writable: true });
      dialog.showOpenDialog = async (_window, options) => {
        const canceled = globalThis.__studioSmokeCancelNext === true;
        globalThis.__studioSmokeCancelNext = false;
        return {
          canceled,
          filePaths: canceled
            ? []
            : options.title === '프로젝트 열기'
              ? [paths.project]
              : options.title === '배포 소스 폴더'
                ? [paths.source]
                : options.title === '소스 폴더 안의 파일 선택'
                  ? [paths.file, paths.options]
                  : [paths.file],
        };
      };
      dialog.showSaveDialog = async (_window, options) => ({
        canceled: false,
        filePath: options.title === '프로젝트 저장' ? paths.project : paths.pack,
      });
      // The unsaved-changes confirmation is in-app; the main-process box only remains as a fallback.
      dialog.showMessageBox = async () => {
        globalThis.__studioSmokeNativeBoxes = (globalThis.__studioSmokeNativeBoxes ?? 0) + 1;
        return {
          response: globalThis.__studioSmokeKeepEdits === true ? 0 : 1,
          checkboxChecked: false,
        };
      };
    },
    {
      source,
      file: join(source, 'custom.data'),
      options: join(source, 'options.txt'),
      project,
      pack,
    },
  );
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 20000 });
  await page.getByTestId('application-info').filter({ hasText: process.platform }).waitFor();
  const nav = (label) => page.locator('nav.menu .mi').filter({ hasText: label });
  const goto = async (label) => {
    await nav(label).click();
    await page.getByRole('heading', { level: 1 }).first().waitFor();
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
  await page.getByTestId('start-new').click();
  await page.getByTestId('project-card').waitFor();
  assert.equal(await nav('개요').getAttribute('aria-current'), 'page');
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
  await page.getByRole('button', { name: '열기', exact: true }).click();
  const dialog = page.getByTestId('unsaved-dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('role'), 'dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke',
  );
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await app.evaluate(() => globalThis.__studioSmokeNativeBoxes ?? 0), 0);

  // Save, then reopen: the dialog's save path saves and proceeds without losing the project.
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('프로젝트를 저장했습니다.', { exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(project, 'utf8')).name, 'Functional Studio smoke');
  await page.getByLabel('서버 이름', { exact: true }).fill('Functional Studio smoke 2');
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByTestId('save-state').filter({ hasText: '저장됨' }).waitFor();
  assert.equal(JSON.parse(await readFile(project, 'utf8')).name, 'Functional Studio smoke 2');
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
    JSON.parse(await readFile(project, 'utf8')).branding?.appName,
    undefined,
    'branding name is unsaved until the project is saved',
  );

  // Files: source folder, add files, policy, managed files.
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
  await page.getByRole('cell', { name: 'custom.data', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '게임 설정에서 관리' }).count(), 1);
  await page
    .getByRole('radiogroup', { name: 'custom.data 적용 방식' })
    .getByRole('radio', { name: '최초만' })
    .click();
  await page.getByLabel('custom.data 선택').check();
  await page.getByTestId('files-bulk').waitFor();
  await page.getByRole('button', { name: '선택 해제' }).click();

  // Game settings: layout and local state from fixtures.
  await goto('게임 설정');
  await page.getByTestId('settings-empty').waitFor();
  await page.getByRole('button', { name: '프리셋 불러오기' }).first().click();
  await page.getByTestId('preset-dialog').waitFor();
  await page
    .getByTestId('preset-dialog')
    .getByRole('button', { name: '불러오기', exact: true })
    .click();
  await page.getByTestId('settings-keys').waitFor();
  assert.ok((await page.getByTestId('settings-key-row').count()) > 3);
  await page.getByLabel('점프 선택').check();
  await page.getByTestId('settings-bulk').getByRole('radio', { name: '항상 고정' }).click();
  assert.equal(
    await page
      .getByRole('radiogroup', { name: '점프 적용 방식' })
      .getByRole('radio', { name: '항상 고정' })
      .getAttribute('aria-checked'),
    'true',
  );
  for (const tab of ['소리 · 화면', '리소스팩', '셰이더', '단축키'])
    await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.getByRole('tab', { name: '셰이더', exact: true }).click();
  await page.getByRole('switch', { name: '셰이더 사용' }).click();

  // Deploy and the file diff against the build.
  await goto('배포');
  assert.equal(await page.getByTestId('deploy-card').getAttribute('data-state'), 'unknown');
  await page.getByRole('button', { name: '배포 파일 만들기', exact: true }).click();
  await page
    .getByTestId('studio-message')
    .filter({ hasText: 'torchpack 배포 파일을 생성했습니다' })
    .waitFor();
  assert.equal((await readFile(pack)).subarray(0, 8).toString(), 'TORCHDEP');
  await page.getByTestId('deploy-card').and(page.locator('[data-state="current"]')).waitFor();
  await goto('개요');
  assert.equal(await page.getByTestId('deploy-status').getAttribute('data-state'), 'current');
  await goto('파일');
  await page
    .getByRole('radiogroup', { name: 'custom.data 적용 방식' })
    .getByRole('radio', { name: '항상' })
    .click();
  await page.getByText('수정', { exact: true }).waitFor();
  await goto('개요');
  assert.equal(await page.getByTestId('deploy-status').getAttribute('data-state'), 'stale');
  await page.locator('nav.menu .mi').filter({ hasText: '다시 만들기' }).waitFor();

  // Export is blocked until the deployment address was checked.
  await goto('배포');
  await page.getByLabel('공개 torchpack HTTPS 주소').fill('http://example.org/server.torchpack');
  assert.equal(
    await page.getByRole('button', { name: '주소 검사', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('공개 torchpack HTTPS 주소').fill('https://example.org/server.torchpack');
  assert.equal(
    await page.getByRole('button', { name: '주소 검사', exact: true }).isEnabled(),
    true,
  );
  await goto('내보내기');
  assert.equal(await page.getByTestId('export-button').isDisabled(), true);
  assert.equal(await page.getByTestId('export-checks').getAttribute('data-blocked'), 'true');
  await page.getByTestId('export-stale').waitFor();

  // Persistence: save, reopen from the start state of the same session.
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('프로젝트를 저장했습니다.', { exact: true }).waitFor();
  assert.deepEqual(
    JSON.parse(await readFile(project, 'utf8')).files.find((f) => f.path === 'custom.data'),
    {
      path: 'custom.data',
      policy: 'always',
    },
  );
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await goto('파일');
  await page.getByTestId('source-name').filter({ hasText: '선택되지 않음' }).waitFor();

  // Layout at the minimum and the default widths: every page paints and nothing overflows.
  await mkdir(join(cwd, '.cache/smoke'), { recursive: true });
  for (const width of [760, 1100]) {
    await page.setViewportSize({ width, height: width === 760 ? 760 : 800 });
    assert.equal(await page.evaluate(() => innerWidth), width);
    for (const label of ['개요', '서버 정보', '브랜딩', '파일', '게임 설정', '배포', '내보내기']) {
      await goto(label);
      await assertPainted(`${label}@${width}`);
      await page.screenshot({
        path: join(cwd, `.cache/smoke/studio-${width}-${label.replaceAll(' ', '')}.png`),
      });
    }
  }

  const isolation = await page.evaluate(() => ({
    require: 'require' in window,
    process: 'process' in window,
    keys: Object.keys(window.torchlauncher).sort(),
  }));
  assert.deepEqual(isolation, {
    require: false,
    process: false,
    keys: ['getApplicationInfo', 'request'],
  });
  assert.deepEqual(errors, []);
  console.log(
    'Studio Electron smoke passed: shell and splash, in-app unsaved dialog, server/branding/files/settings/deploy/export pages, persistence, painted layout at 760 and 1100 px and isolation',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}

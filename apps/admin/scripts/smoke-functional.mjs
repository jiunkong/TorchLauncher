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
    args: [join(cwd, 'apps/admin'), `--user-data-dir=${join(root, 'profile')}`],
    env,
    timeout: 30000,
  });
  await app.evaluate(
    ({ dialog }, paths) => {
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
                : [paths.file],
        };
      };
      dialog.showSaveDialog = async (_window, options) => ({
        canceled: false,
        filePath: options.title === '프로젝트 저장' ? paths.project : paths.pack,
      });
      dialog.showMessageBox = async () => ({
        response: globalThis.__studioSmokeKeepEdits === true ? 0 : 1,
        checkboxChecked: false,
      });
    },
    { source, file: join(source, 'custom.data'), project, pack },
  );
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('application-info').filter({ hasText: process.platform }).waitFor();
  await page
    .locator('.project-toolbar')
    .getByRole('button', { name: '새 프로젝트', exact: true })
    .click();
  await page.getByRole('button', { name: '서버 구성', exact: true }).click();
  await page.getByLabel('서버 접속 주소 (host:port)').fill('bad host');
  assert.equal(
    await page.getByLabel('서버 접속 주소 (host:port)').getAttribute('aria-invalid'),
    'true',
  );
  await page.getByLabel('서버 접속 주소 (host:port)').fill('localhost:25565');
  assert.equal(
    await page.getByLabel('서버 접속 주소 (host:port)').getAttribute('aria-invalid'),
    'false',
  );
  await page.getByLabel('서버 이름', { exact: true }).fill('Functional Studio smoke');
  await app.evaluate(() => {
    globalThis.__studioSmokeKeepEdits = true;
  });
  await page.locator('.project-toolbar').getByRole('button', { name: '열기', exact: true }).click();
  await page.getByText('작업을 취소했습니다.', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('서버 이름', { exact: true }).inputValue(),
    'Functional Studio smoke',
  );
  await app.evaluate(() => {
    globalThis.__studioSmokeKeepEdits = false;
  });
  await page.locator('.project-toolbar').getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('프로젝트를 저장했습니다.', { exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(project, 'utf8')).name, 'Functional Studio smoke');
  await page.getByRole('button', { name: '배포', exact: true }).click();
  await app.evaluate(() => {
    globalThis.__studioSmokeCancelNext = true;
  });
  await page.getByRole('button', { name: '소스 폴더 선택', exact: true }).click();
  await page.getByText('작업을 취소했습니다.', { exact: true }).waitFor();
  assert.equal(await page.getByText('소스 폴더: 선택되지 않음', { exact: false }).count(), 1);
  await page.getByRole('button', { name: '소스 폴더 선택', exact: true }).click();
  await page.getByRole('button', { name: '파일 추가', exact: true }).click();
  await page.getByLabel('custom.data 적용 정책').selectOption('initial-only');
  await page.getByRole('button', { name: 'torchpack 생성', exact: true }).click();
  await page
    .getByText(
      'torchpack 배포 파일을 생성했습니다. 공개 호스팅에 직접 업로드한 뒤 URL을 검사하세요.',
      { exact: true },
    )
    .waitFor();
  assert.equal((await readFile(pack)).subarray(0, 8).toString(), 'TORCHDEP');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByLabel('공개 torchpack HTTPS URL').fill('http://example.org/server.torchpack');
  assert.equal(
    await page.getByRole('button', { name: '배포 URL 검사', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('공개 torchpack HTTPS URL').fill('https://example.org/server.torchpack');
  assert.equal(
    await page.getByRole('button', { name: '배포 URL 검사', exact: true }).isEnabled(),
    true,
  );
  await page.locator('.project-toolbar').getByRole('button', { name: '저장', exact: true }).click();
  await page.getByText('프로젝트를 저장했습니다.', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await readFile(project, 'utf8')).files, [
    { path: 'custom.data', policy: 'initial-only' },
  ]);
  await page.locator('.project-toolbar').getByRole('button', { name: '열기', exact: true }).click();
  await page.getByText('선택되지 않음', { exact: true }).waitFor();
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
  await page.setViewportSize({ width: 760, height: 760 });
  await mkdir(join(cwd, '.cache/smoke'), { recursive: true });
  await page.screenshot({ path: join(cwd, '.cache/smoke/studio-functional.png'), fullPage: true });
  console.log(
    'Studio Electron smoke passed: renderer editing, native dialog adapters, real persistence, file policy, writer generation, reopen and isolation',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}

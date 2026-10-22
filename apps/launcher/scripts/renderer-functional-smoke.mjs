import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const temp = await mkdtemp(resolve(tmpdir(), 'torchlauncher-renderer-'));
const configPath = resolve(temp, 'server.json');
await writeFile(
  configPath,
  `${JSON.stringify({
    format: 'torchlauncher-server',
    version: 1,
    serverId: '44444444-4444-4444-8444-444444444444',
    name: 'Renderer smoke fixture',
    address: '127.0.0.1:1',
    sourceUrl: 'https://example.invalid/smoke.torchpack',
  })}\n`,
);

const env = { ...process.env, TORCH_SERVER_CONFIG: configPath };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [resolve('apps/launcher'), `--user-data-dir=${resolve(temp, 'user-data')}`],
  env,
  timeout: 30_000,
});

try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByTestId('app-shell').waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Microsoft 계정으로 로그인' }).isEnabled(),
    true,
  );

  await page.getByRole('button', { name: '내 모드', exact: true }).click();
  await page.getByText('설치된 모드가 없습니다.', { exact: true }).waitFor();

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('활성 팩 ID (위에서 아래 순서)').waitFor();
  const packDraft = 'vanilla\nfile/my-local-pack.zip';
  const editor = page.getByLabel('활성 팩 ID (위에서 아래 순서)');
  await editor.fill(packDraft);

  const status = await page.evaluate(() => window.torchlauncher.command({ type: 'status' }));
  assert.equal(status.state.status.state, 'unavailable');
  assert.equal(status.ok, false);
  await page.getByRole('alert').filter({ hasText: '작업 결과:' }).waitFor();
  assert.equal(await editor.inputValue(), packDraft);
  assert.deepEqual(pageErrors, []);
  console.log('Launcher: real mod/pack reads and draft preservation across a status event passed');
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}

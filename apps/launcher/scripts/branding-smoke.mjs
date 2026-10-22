// Production native decoder/cache/IPC/preload/renderer, fake validated reader and isolated data only.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { build } from 'vite';

const root = await mkdtemp(resolve(tmpdir(), 'torch-branding-smoke-'));
let app;
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: resolve(root, 'bundle'),
      emptyOutDir: true,
      lib: {
        entry: resolve('apps/launcher/scripts/fixtures/branding-main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.cjs',
      },
      rollupOptions: { external: ['electron', /^node:/] },
    },
  });
  const env = { ...process.env, BRANDING_FIXTURE_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['--no-sandbox', resolve(root, 'bundle/main.cjs')], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByTestId('splash').waitFor();
  assert.match(await page.getByTestId('splash').textContent(), /TorchLauncher/i);
  assert.doesNotMatch(await page.getByTestId('splash').textContent(), /Operator title/);
  await page.getByTestId('splash').waitFor({ state: 'detached' });
  for (const role of ['icon', 'background'])
    await page.waitForFunction(
      (role) =>
        document.querySelector(`[data-testid="branding-${role}"]`)?.getAttribute('data-custom') ===
        'true',
      role,
    );
  assert.equal(await page.getByTestId('home').locator('h1').textContent(), 'Home server fixed');
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  assert.equal(await page.locator('.side-name').textContent(), 'Operator title');
  const identity = await app.evaluate(() => globalThis.brandingFixture.identity());
  assert.equal(identity.name, 'TorchLauncher');
  assert.equal(identity.title, 'Operator title');
  assert.equal(identity.data, resolve(root, 'user-data'));
  assert.equal(await app.evaluate(() => globalThis.brandingFixture.invalidDecode()), true);
  for (const width of [760, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760),
      width,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
  }
  const previous = await page
    .getByTestId('branding-background')
    .locator('[data-layer="current"] img')
    .getAttribute('src');
  await app.evaluate(() => globalThis.brandingFixture.update({ icon: 'red', background: 'green' }));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="branding-background"]')?.getAttribute('data-fading') ===
      'true',
  );
  assert.equal(
    await page
      .getByTestId('branding-background')
      .locator('[data-layer="previous"] img')
      .getAttribute('src'),
    previous,
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="branding-background"]')?.getAttribute('data-fading') ===
      'false',
  );
  assert.deepEqual(await app.evaluate(() => globalThis.brandingFixture.downloads()), [
    'background',
  ]);
  const green = await page
    .getByTestId('branding-background')
    .locator('[data-layer="current"] img')
    .getAttribute('src');
  await app.evaluate(() => globalThis.brandingFixture.update({ background: 'bad' }));
  assert.equal(
    await page
      .getByTestId('branding-background')
      .locator('[data-layer="current"] img')
      .getAttribute('src'),
    green,
  );
  // A browser decode failure must also retain the old visible image after main-side validation.
  await page.evaluate(() => {
    globalThis.fixtureDecode = Image.prototype.decode;
    Image.prototype.decode = () => Promise.reject(new Error('fixture browser decode failure'));
  });
  await app.evaluate(() => globalThis.brandingFixture.update({ background: 'red' }));
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .getByTestId('branding-background')
      .locator('[data-layer="current"] img')
      .getAttribute('src'),
    green,
  );
  await page.evaluate(() => {
    Image.prototype.decode = globalThis.fixtureDecode;
  });
  await app.evaluate(() => globalThis.brandingFixture.update({ background: 'jpeg' }));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="branding-background"] [data-layer="current"] img')
      ?.getAttribute('src')
      ?.startsWith('data:image/jpeg;'),
  );
  assert.equal(
    await page
      .getByTestId('branding-background')
      .locator('[data-layer="current"] img')
      .evaluate((image) => getComputedStyle(image).objectFit),
    'cover',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(() => globalThis.brandingFixture.update({ icon: null, background: null }));
  for (const role of ['icon', 'background']) {
    await page.waitForFunction(
      (role) =>
        document.querySelector(`[data-testid="branding-${role}"]`)?.getAttribute('data-custom') ===
        'false',
      role,
    );
    assert.equal(await page.getByTestId(`branding-${role}`).getAttribute('data-fading'), 'false');
  }
  await app.close();
  app = undefined;
  app = await electron.launch({ args: ['--no-sandbox', resolve(root, 'bundle/main.cjs')], env });
  const restarted = await app.firstWindow();
  await restarted.getByTestId('app-shell').waitFor();
  await app.evaluate(async () => {
    await globalThis.brandingFixture.service.settled();
  });
  await restarted.getByTestId('splash').waitFor({ state: 'detached' });
  for (const role of ['icon', 'background'])
    assert.equal(
      await restarted.getByTestId(`branding-${role}`).getAttribute('data-custom'),
      'false',
    );
  assert.deepEqual(errors, []);
  console.log(
    'PASS branding: native PNG/JPEG decode, sidecar/cache/IPC, changed-role only, retained failure, crossfade/default/reduced-motion, tombstone restart, browser decode retention, fixed splash/identity/home, 760/1100 layout',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}

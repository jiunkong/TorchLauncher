// Production native decoder/cache/IPC/preload/renderer, fake validated reader and isolated data only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  await mkdir(resolve('apps/launcher/.cache/ui-feedback'), { recursive: true });
  const assertPaint = async (selector, label) => {
    const shot = await page.locator(selector).screenshot();
    const brightPixels = await app.evaluate(({ nativeImage }, encoded) => {
      const pixels = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toBitmap();
      let bright = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 175 && pixels[i + 1] > 175 && pixels[i + 2] > 175 && pixels[i + 3] > 0)
          bright++;
      return bright;
    }, shot.toString('base64'));
    assert.ok(brightPixels > 20, `${label}: text was covered (${brightPixels} bright pixels)`);
  };
  const assertHome = async (label, transition = false) => {
    const targets = await page.evaluate(() => {
      return ['[data-testid="home"] h1', '[data-testid="launch-button"]'].map((selector) => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { target: element.tagName, hit: hit?.tagName, reachable: element.contains(hit) };
      });
    });
    assert.ok(
      targets.every((target) => target.reachable),
      `${label}: ${JSON.stringify(targets)}`,
    );
    await assertPaint('[data-testid="home"] h1', label);
    if (transition) return;
    await assertPaint('[data-testid="launch-button"]', label);
    const before = await app.evaluate(
      () => globalThis.brandingFixture.commands().filter((type) => type === 'login').length,
    );
    await page.getByTestId('launch-button').click();
    assert.equal(
      await app.evaluate(
        () => globalThis.brandingFixture.commands().filter((type) => type === 'login').length,
      ),
      before + 1,
    );
    assert.match(
      await page
        .locator('[data-testid="home"] .shade')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
      /linear-gradient/,
    );
    await page.screenshot({ path: resolve(`apps/launcher/.cache/ui-feedback/home-${label}.png`) });
  };
  await assertHome('custom-initial');
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
    await assertHome(`custom-${width}`);
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
  for (const width of [760, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760),
      width,
    );
    await page.evaluate(() => {
      window.fixtureTransition = new Promise((resolveTransition) => {
        const background = document.querySelector('[data-testid="branding-background"]');
        const deadline = setTimeout(() => resolveTransition(false), 5000);
        const observer = new MutationObserver(() => {
          if (background.getAttribute('data-fading') !== 'true') return;
          observer.disconnect();
          clearTimeout(deadline);
          const reachable = ['[data-testid="home"] h1', '[data-testid="launch-button"]'].every(
            (selector) => {
              const element = document.querySelector(selector);
              const box = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
              );
            },
          );
          resolveTransition(reachable);
        });
        observer.observe(background, { attributes: true, attributeFilter: ['data-fading'] });
      });
    });
    const changing = app.evaluate(
      (_electron, width) =>
        globalThis.brandingFixture.update({ background: width === 760 ? 'red' : 'green' }),
      width,
    );
    assert.equal(await page.evaluate(() => window.fixtureTransition), true);
    await assertHome(`transition-${width}`, true);
    await changing;
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="branding-background"]')
          ?.getAttribute('data-fading') === 'false',
    );
  }
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
  for (const width of [760, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760),
      width,
    );
    await assertHome(`default-reduced-${width}`);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => globalThis.brandingFixture.setState(null));
  await page.locator('.stage-home .copy p').filter({ hasText: '런처 서비스 연결 중' }).waitFor();
  await assertPaint('.stage-home .copy p', 'loading-fallback');
  await app.evaluate(() => globalThis.brandingFixture.setState({}));
  const exactPath = [
    'C:',
    'Users',
    '긴 사용자 이름',
    'AppData',
    'Roaming',
    ...Array(18).fill('아주 긴 서버 데이터 폴더'),
    'servers',
    '11111111-1111-4111-8111-111111111111',
  ].join(String.fromCharCode(92));
  await app.evaluate(
    (_electron, serverDataRoot) =>
      globalThis.brandingFixture.setState({
        serverDataRoot,
        usage: { bytes: 1024, files: 1, directories: 1 },
      }),
    exactPath,
  );
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const clipboardPermission = await page.evaluate(async () => {
    try {
      return (await navigator.permissions.query({ name: 'clipboard-write' })).state;
    } catch {
      return 'unavailable';
    }
  });
  console.log(`Clipboard write permission with production deny policy: ${clipboardPermission}`);
  assert.equal(clipboardPermission, 'denied');
  await page.evaluate(() => {
    const copy = window.torchlauncher.copyServerDataPath;
    // The exposed contextBridge object is frozen. Main IPC tests verify absence of path/text slots.
    if (typeof copy !== 'function') throw new Error('Missing fixed-path copy API');
  });
  for (const width of [760, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760),
      width,
    );
    const copy = page.getByTestId('copy-data-path');
    await copy.scrollIntoViewIfNeeded();
    assert.equal(await copy.isEnabled(), true);
    assert.equal(await page.locator('.settings-data-path .path').getAttribute('title'), exactPath);
    assert.equal(await page.locator('.settings-data-path .path').textContent(), exactPath);
    const visible = await copy.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button.contains(hit) && box.right <= window.innerWidth;
    });
    assert.equal(visible, true);
    await copy.click();
    await page
      .getByTestId('copy-data-path-result')
      .filter({ hasText: /경로를 복사했습니다\.|Path copied\./ })
      .waitFor();
    assert.equal(await app.evaluate(() => globalThis.brandingFixture.copiedPath()), exactPath);
    await page.screenshot({
      path: resolve(`apps/launcher/.cache/ui-feedback/settings-${width}.png`),
    });
  }
  await app.evaluate(() =>
    globalThis.brandingFixture.setState({ running: true, operation: 'launch' }),
  );
  await page.getByTestId('copy-data-path').click();
  assert.equal(await app.evaluate(() => globalThis.brandingFixture.copiedPath()), exactPath);
  await app.evaluate(() => globalThis.brandingFixture.failCopy());
  await page.getByTestId('copy-data-path').click();
  await page
    .getByTestId('copy-data-path-result')
    .filter({ hasText: /경로를 복사하지 못했습니다\.|Could not copy the path\./ })
    .waitFor();
  assert.equal(await page.getByTestId('copy-data-path-result').getAttribute('role'), 'alert');
  assert.equal(await page.getByTestId('copy-data-path').isEnabled(), true);
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
    'PASS branding: native PNG/JPEG decode, sidecar/cache/IPC, changed-role only, retained failure, crossfade/default/reduced-motion, tombstone restart, browser decode retention, fixed splash/identity/home, 760/1100 paint/hit/click + exact path copy/failure',
  );
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}

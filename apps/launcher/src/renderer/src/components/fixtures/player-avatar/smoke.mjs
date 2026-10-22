// Run from the repository root: node apps/launcher/src/renderer/src/components/fixtures/player-avatar/smoke.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import ts from 'typescript';
import { createServer } from 'vite';

const temp = await mkdtemp(resolve(tmpdir(), 'torch-avatar-'));
// Compile just the production service and Electron adapter; no product wiring or live network.
for (const name of ['service', 'index']) {
  const source = await readFile(`apps/launcher/src/main/skins/${name}.ts`, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  await writeFile(resolve(temp, `${name}.js`), output);
}
await writeFile(
  resolve(temp, 'main.cjs'),
  `const {app,BrowserWindow}=require('electron'); global.createFixtureSkinService=require('./index.js').createPlayerSkinService; app.whenReady().then(()=>{global.fixtureWindow=new BrowserWindow({width:100,height:100,webPreferences:{contextIsolation:true,nodeIntegration:false}}); global.fixtureWindow.loadURL('about:blank');});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 },
});
let app;
try {
  await vite.listen();
  app = await electron.launch({ args: ['--no-sandbox', resolve(temp, 'main.cjs')], env });
  const page = await app.firstWindow();
  const address = vite.httpServer.address();
  assert(address && typeof address !== 'string');
  await page.goto(
    `http://127.0.0.1:${address.port}/apps/launcher/src/renderer/src/components/fixtures/player-avatar/index.html`,
  );
  await page.waitForFunction(() => typeof window.renderAvatar === 'function');
  for (const height of [32, 64]) {
    const skin = await app.evaluate(
      async ({ nativeImage }, { height }) => {
        const bitmap = Buffer.alloc(64 * height * 4);
        const pixel = (x, y, b, g, r, a) => bitmap.set([b, g, r, a], (y * 64 + x) * 4);
        for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) pixel(x, y, 0, 0, 255, 255);
        for (let y = 8; y < 16; y++) for (let x = 40; x < 44; x++) pixel(x, y, 0, 255, 0, 255);
        const png = nativeImage.createFromBitmap(bitmap, { width: 64, height }).toPNG();
        const id = '069a79f444e94726a5befca90e38aaf5';
        const texture = Buffer.from(
          JSON.stringify({
            profileId: id,
            textures: { SKIN: { url: `http://textures.minecraft.net/texture/${'a'.repeat(64)}` } },
          }),
        ).toString('base64');
        const original = globalThis.fetch;
        globalThis.fetch = async (url) =>
          String(url).includes('sessionserver')
            ? Response.json({ id, properties: [{ name: 'textures', value: texture }] })
            : new Response(png);
        try {
          const service = globalThis.createFixtureSkinService();
          const result = await service.get(id);
          service.clear();
          return result;
        } finally {
          globalThis.fetch = original;
        }
      },
      { height },
    );
    assert(skin?.startsWith('data:image/png;base64,'));
    await page.evaluate((value) => window.renderAvatar(value), skin);
    await page.locator('.player-avatar-skin[data-ready="true"]').waitFor();
    const boxes = await page.locator('.player-avatar-skin img').evaluateAll((images) =>
      images.map((image) => {
        const box = image.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    assert.deepEqual(boxes, [
      { x: -32, y: -32, width: 256, height: height * 4 },
      { x: -160, y: -32, width: 256, height: height * 4 },
    ]);
    const screenshot = await page.locator('.avatar').screenshot();
    const colors = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return [
        Array.from(ctx.getImageData(4, 4, 1, 1).data),
        Array.from(ctx.getImageData(28, 4, 1, 1).data),
      ];
    }, screenshot.toString('base64'));
    assert.deepEqual(colors, [
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
    assert.equal(
      await page
        .locator('.player-avatar-fallback')
        .evaluate((node) => getComputedStyle(node).visibility),
      'hidden',
    );
  }
  // Header passes the renderer boundary but the browser rejects missing PNG chunks.
  const malformed = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(malformed);
  malformed.writeUInt32BE(13, 8);
  malformed.write('IHDR', 12);
  malformed.writeUInt32BE(64, 16);
  malformed.writeUInt32BE(64, 20);
  await page.evaluate(
    (skin) => window.renderAvatar(skin),
    `data:image/png;base64,${malformed.toString('base64')}`,
  );
  await page.waitForFunction(() => document.querySelectorAll('.player-avatar-skin').length === 0);
  assert.equal(
    await page
      .locator('.player-avatar-fallback')
      .evaluate((node) => getComputedStyle(node).visibility),
    'visible',
  );
  // Production native decoder also rejects a header-only image.
  assert.equal(
    await app.evaluate(
      ({ nativeImage }, base64) =>
        nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).isEmpty(),
      malformed.toString('base64'),
    ),
    true,
  );
  console.log(
    'PASS: native PNG canonicalization, 64x32/64x64 face/hat coordinates and transparent overlay, decode-failure fallback',
  );
} finally {
  await app?.close();
  await vite.close();
}

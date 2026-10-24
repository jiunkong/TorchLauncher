// Run from the repository root: node apps/admin/scripts/branding-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = await mkdtemp(join(tmpdir(), 'studio-native-branding-'));
const require = createRequire(import.meta.url);
try {
  const probe = join(root, 'probe.ts');
  await writeFile(
    probe,
    `
import assert from 'node:assert/strict';
import { app, nativeImage, safeStorage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeNativeImage } from ${JSON.stringify(resolve('apps/admin/src/main/native-branding.ts'))};
import { validateImage } from ${JSON.stringify(resolve('apps/admin/src/main/branding.ts'))};
import { StudioService } from ${JSON.stringify(resolve('apps/admin/src/main/studio.ts'))};
import { SigningKeyStore } from ${JSON.stringify(resolve('apps/admin/src/main/signing.ts'))};
app.setPath('userData', ${JSON.stringify(root)});
app.setPath('sessionData', ${JSON.stringify(root)});
console.log('Native branding probe starting');
app.whenReady().then(async () => {
try {
  const image = nativeImage.createFromBitmap(Buffer.from([0,0,255,255]), {width:1,height:1});
  const png=image.toPNG(); const jpeg=image.toJPEG(90);
  assert.deepEqual(decodeNativeImage(png),{width:1,height:1});
  assert.equal(validateImage('icon',png,decodeNativeImage).mediaType,'image/png');
  assert.equal(validateImage('background',jpeg,decodeNativeImage).mediaType,'image/jpeg');
  assert.throws(()=>validateImage('icon',jpeg,decodeNativeImage));
  assert.throws(()=>validateImage('background',png.subarray(0,33),decodeNativeImage));
  const path=join(${JSON.stringify(root)},'native.png');await writeFile(path,png);
  const projDir=join(${JSON.stringify(root)},'test-project');
  await mkdir(projDir);
  let selected=[projDir];
  const service=new StudioService({open:async()=>selected,save:async()=>projDir,discard:async()=>true},undefined,decodeNativeImage,new SigningKeyStore(join(${JSON.stringify(root)},'keys'),safeStorage));
  assert.equal((await service.request({action:'new'})).ok,true);
  selected=[path];
  assert.equal((await service.request({action:'brandingSelect',role:'icon'})).ok,true);
  const before=service.snapshot().project;
  assert.equal((await service.request({action:'save'})).ok,true);
  selected=[projDir];assert.equal((await service.request({action:'open'})).ok,true);
  assert.deepEqual(service.snapshot().project,before);
  await writeFile(path,png.subarray(0,33));selected=[path];
  assert.deepEqual(await service.request({action:'brandingSelect',role:'icon'}),{ok:false,code:'INVALID'});
  assert.deepEqual(service.snapshot().project,before);
  console.log('Studio native branding smoke passed: PNG/JPEG decode, truncation, durable snapshot, failed import preservation');
  app.exit(0);
} catch(error) { console.error(error); app.exit(1); }
});
`,
  );
  console.log('Building native branding probe');
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: join(root, 'out'),
      emptyOutDir: true,
      target: 'node24',
      ssr: true,
      minify: false,
      rollupOptions: {
        input: probe,
        external: ['electron'],
        output: { format: 'es', entryFileNames: 'probe.mjs' },
      },
    },
  });
  console.log('Starting native Electron probe');
  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(electron, ['--no-sandbox', join(root, 'out/probe.mjs')], {
      stdio: 'inherit',
      env,
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Electron probe timeout'));
    }, 30000);
    child.once('error', reject);
    child.once('exit', () => clearTimeout(timeout));
    child.once('exit', (code) => resolveResult(code));
  });
  assert.equal(result, 0, 'Electron probe failed');
} finally {
  await rm(root, { recursive: true, force: true });
}

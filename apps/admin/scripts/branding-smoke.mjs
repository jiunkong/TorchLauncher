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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { decodeNativeImage, rasterNativeImage } from ${JSON.stringify(resolve('apps/admin/src/main/native-branding.ts'))};
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
  const parentDir=join(${JSON.stringify(root)},'projects');
  await mkdir(parentDir);
  const projDir=join(parentDir,'test-project');
  let selected=[parentDir];
  const service=new StudioService({open:async()=>selected,save:async()=>projDir,discard:async()=>true},undefined,decodeNativeImage,new SigningKeyStore(join(${JSON.stringify(root)},'keys'),safeStorage),undefined,undefined,rasterNativeImage);
  assert.equal((await service.request({action:'new',name:'test-project'})).ok,true);
  selected=[path];
  assert.equal((await service.request({action:'brandingSelect',role:'icon'})).ok,true);
  const before=service.snapshot().project;
  assert.equal((await service.request({action:'save'})).ok,true);
  selected=[projDir];assert.equal((await service.request({action:'open'})).ok,true);
  assert.deepEqual(service.snapshot().project,before);
  await writeFile(path,png.subarray(0,33));selected=[path];
  assert.deepEqual(await service.request({action:'brandingSelect',role:'icon'}),{ok:false,code:'IMAGE_FAILED',image:{reason:'corrupt',role:'icon',name:'native.png',part:'data',format:'PNG',width:1,height:1}});
  assert.deepEqual(service.snapshot().project,before);
  // Conversion of oversized or wrongly typed sources with the real Electron decoder and encoders.
  const bitmap=(w,h,noise)=>{const b=noise?randomBytes(w*h*4):Buffer.alloc(w*h*4);for(let i=0;i<w*h;i++){if(!noise){b[i*4]=i%251;b[i*4+1]=(i>>8)%251;b[i*4+2]=128;}b[i*4+3]=noise?255-(b[i*4+3]&7):255;}return nativeImage.createFromBitmap(b,{width:w,height:h});};
  const pick=async(role,name,bytes)=>{const file=join(${JSON.stringify(root)},name);await writeFile(file,bytes);selected=[file];return service.request({action:'brandingSelect',role});};
  const stored=async(file)=>readFile(join(projDir,'branding',file));
  const big=bitmap(2000,2000,false);
  assert.equal((await pick('icon','big-icon.png',big.toPNG())).ok,true);
  let icon=await stored('icon.png');
  assert.deepEqual(decodeNativeImage(icon),{width:512,height:512});
  assert.equal(validateImage('icon',icon,decodeNativeImage).mediaType,'image/png');
  assert.equal(service.snapshot().project.branding.icon.length,icon.length);
  const noisy=bitmap(2800,2000,true).toPNG();
  assert.ok(noisy.length>8*1024**2,'noise background exceeds the 8 MiB limit: '+noisy.length);
  assert.equal((await pick('background','noisy.png',noisy)).ok,true);
  const noisyStored=await stored('background.jpg');
  assert.ok(noisyStored.length<=8*1024**2);
  assert.equal(validateImage('background',noisyStored,decodeNativeImage).mediaType,'image/jpeg');
  assert.equal((await pick('icon','jpeg-icon.png',bitmap(256,256,false).toJPEG(90))).ok,true);
  icon=await stored('icon.png');
  assert.equal(icon[0],137);
  assert.equal(validateImage('icon',icon,decodeNativeImage).mediaType,'image/png');
  assert.equal((await pick('background','photo.jpg',bitmap(5000,3000,false).toJPEG(90))).ok,true);
  const bg=await stored('background.jpg');
  assert.deepEqual(decodeNativeImage(bg),{width:3600,height:2160});
  assert.equal(validateImage('background',bg,decodeNativeImage).mediaType,'image/jpeg');
  assert.equal((await pick('background','wide.png',bitmap(4400,2200,false).toPNG())).ok,true);
  const bgSize=decodeNativeImage(await stored('background.png'));
  assert.ok(bgSize.width<=3840&&bgSize.height<=2160&&bgSize.width*bgSize.height<=8294400);
  assert.equal(bgSize.width/bgSize.height,2);
  const afterConversions=service.snapshot().project;
  const files=await readdir(join(projDir,'branding'));
  assert.deepEqual(files.sort(),['background.png','icon.png']);
  const cut=big.toPNG();
  const failure=await pick('icon','cut.png',cut.subarray(0,Math.floor(cut.length/2)));
  assert.equal(failure.ok,false);assert.equal(failure.code,'IMAGE_FAILED');
  assert.equal(failure.image.reason,'corrupt');assert.equal(failure.image.part,'data');
  assert.deepEqual([failure.image.format,failure.image.width,failure.image.height],['PNG',2000,2000]);
  for (const [name,bytes] of [['not.png',Buffer.from('text, not an image')],['x.bmp',Buffer.from('BM'+'0'.repeat(100))]]) {
    const reply=await pick('icon',name,bytes);
    assert.deepEqual([reply.ok,reply.code,reply.image.reason],[false,'IMAGE_FAILED','unsupported']);
  }
  assert.equal((await pick('icon','empty.png',Buffer.alloc(0))).image.part,'empty');
  assert.deepEqual(service.snapshot().project,afterConversions);
  assert.deepEqual((await readdir(join(projDir,'branding'))).sort(),files);
  assert.equal((await service.request({action:'brandingRemove',role:'background'})).ok,true);
  assert.deepEqual(await readdir(join(projDir,'branding')),['icon.png']);
  console.log('Studio native branding smoke passed: PNG/JPEG decode, truncation, durable snapshot, oversize and byte-limit conversion, precise import failures, failed import preservation, scoped removal');
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

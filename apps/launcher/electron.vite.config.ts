import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/** Renderer dev-server port: `TORCH_LAUNCHER_DEV_PORT` (integer 1024-65535), default 5173; invalid values fail fast. */
function devPort(): number {
  const raw = process.env.TORCH_LAUNCHER_DEV_PORT;
  if (raw === undefined || raw === '') return 5173;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1024 || port > 65535)
    throw new Error(
      `TORCH_LAUNCHER_DEV_PORT must be an integer from 1024 to 65535 (got "${raw}"). Unset it to use 5173.`,
    );
  return port;
}

export default defineConfig({
  main: {
    plugins: [
      {
        name: 'auth-dependency-notices',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'prismarine-auth-NOTICE.txt',
            source: readFileSync(
              new URL('../../third-party/prismarine-auth/NOTICE.txt', import.meta.url),
              'utf8',
            ),
          });
          const fontNotice = (name: string, file: string) =>
            `${name}\n\n${readFileSync(new URL(`../../third-party/${file}/LICENSE`, import.meta.url), 'utf8').trim()}\n`;
          this.emitFile({
            type: 'asset',
            fileName: 'font-licenses-NOTICE.txt',
            source: [
              'Bundled fonts (SIL Open Font License 1.1)\n',
              fontNotice('Pretendard Variable', 'pretendard'),
              fontNotice('Pixelify Sans', 'pixelify-sans'),
            ].join('\n----------------------------------------\n\n'),
          });
        },
      },
    ],
    build: {
      externalizeDeps: false,
      lib: {
        entry: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'public-java-worker': fileURLToPath(
            import.meta.resolve('@torchlauncher/desktop-auth/worker'),
          ),
        },
        formats: ['cjs'],
        fileName: (_format, name) => `${name}.cjs`,
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      lib: { formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
  renderer: {
    server: { host: '127.0.0.1', strictPort: true, port: devPort() },
    plugins: [
      react(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          return html
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
            .replace("connect-src 'self'", "connect-src 'self' ws:");
        },
      },
    ],
  },
});

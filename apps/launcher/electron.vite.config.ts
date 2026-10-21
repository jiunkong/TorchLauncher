import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

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
        },
      },
    ],
    build: {
      externalizeDeps: false,
      lib: {
        entry: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'public-java-worker': fileURLToPath(
            new URL('./src/main/auth/public-java-worker.ts', import.meta.url),
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
    server: { host: '127.0.0.1', strictPort: true, port: 5173 },
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

import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      {
        // Same OFL notice file as the launcher package (the renderer bundles the same two fonts).
        name: 'font-license-notices',
        generateBundle() {
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
      lib: { formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      lib: { formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
  renderer: {
    server: { host: '127.0.0.1', strictPort: true, port: 5174 },
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

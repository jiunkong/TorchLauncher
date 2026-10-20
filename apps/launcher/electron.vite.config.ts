import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
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

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, join } from 'path';
import { createReadStream, statSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import type { Plugin } from 'vite';
import { getBuildInfo } from './scripts/build-info.mjs';

const ICONS_DIR = resolve(__dirname, 'node_modules/material-icon-theme/icons');

function materialIconsPlugin(): Plugin {
  const PREFIX = '/material-icons/';
  return {
    name: 'material-icons-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIX)) return next();
        const name = req.url.slice(PREFIX.length).split('?')[0];
        if (!/^[\w.-]+\.svg$/.test(name)) return next();
        const file = join(ICONS_DIR, name);
        try {
          statSync(file);
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          createReadStream(file).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
    closeBundle() {
      if (process.env.NODE_ENV === 'production' || process.env.MODE === 'production') {
        const outDir = resolve(__dirname, 'out/renderer/material-icons');
        try {
          mkdirSync(outDir, { recursive: true });
          for (const f of readdirSync(ICONS_DIR)) {
            if (f.endsWith('.svg')) copyFileSync(join(ICONS_DIR, f), join(outDir, f));
          }
        } catch {}
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: { __APP_BUILD_INFO__: JSON.stringify(getBuildInfo(__dirname)) },
    plugins: [react(), materialIconsPlugin()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});

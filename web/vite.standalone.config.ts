// Single-file build that runs entirely in the browser (server logic + SQLite included).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const shim = fileURLToPath(new URL('./src/standalone/node-shim.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    'import.meta.env.VITE_STANDALONE': 'true',
    'process.env': '{}',
  },
  resolve: {
    alias: {
      'node:fs': shim, 'node:path': shim, 'node:module': shim, 'node:url': shim,
      fs: shim, path: shim, crypto: shim,
    },
  },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    chunkSizeWarningLimit: 10_000,
  },
});

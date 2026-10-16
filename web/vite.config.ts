import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The standalone backend is never loaded in this build, but Rollup still resolves its imports.
const shim = fileURLToPath(new URL('./src/standalone/node-shim.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_STANDALONE': 'false' },
  resolve: {
    alias: { 'node:fs': shim, 'node:path': shim, 'node:module': shim, 'node:url': shim, fs: shim, path: shim, crypto: shim },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build a doppia uscita:
 *  - default (`npm run build`): output multi-file con sourcemap (per debug + Playwright e2e).
 *  - SINGLEFILE=1 (`SINGLEFILE=1 npm run build`): output `dist/index.html` standalone
 *    con tutto inlined (JS+CSS) — adatto per distribuzione playtest.
 */
const SINGLE_FILE = process.env.SINGLEFILE === '1';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@data': resolve(__dirname, 'src/data'),
      '@entities': resolve(__dirname, 'src/entities'),
      '@ai': resolve(__dirname, 'src/ai'),
      '@scenes': resolve(__dirname, 'src/scenes'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@persistence': resolve(__dirname, 'src/persistence'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
  plugins: SINGLE_FILE ? [viteSingleFile()] : [],
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: !SINGLE_FILE,
    // Per il single-file: niente sourcemap inline (sennò il file esplode), niente asset separati
    assetsInlineLimit: SINGLE_FILE ? 100_000_000 : 4096,
  },
});

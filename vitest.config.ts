import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@data': resolve(__dirname, 'src/data'),
      '@entities': resolve(__dirname, 'src/entities'),
      '@ai': resolve(__dirname, 'src/ai'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    // Le simulazioni di bilanciamento si attivano con RUN_SIM=1 (vedi tests/sim/balance.test.ts).
    // I file in tests/e2e/ sono test Playwright (non vitest) — esclusi.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**', 'src/ai/**', 'src/utils/**'],
      exclude: ['src/scenes/**', 'src/ui/**'],
    },
  },
});

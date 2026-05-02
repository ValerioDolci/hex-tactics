import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright per smoke test UI hex-tactics.
 * - Avvia automaticamente vite preview prima dei test
 * - Solo Chromium (sufficiente per smoke)
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Phaser usa WebGL: in headless serve software rendering altrimenti
        // crash "Framebuffer Unsupported". --use-gl=swiftshader abilita SwiftShader.
        launchOptions: {
          args: [
            '--use-gl=swiftshader',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'node node_modules/.bin/vite preview --port 4173',
    url: 'http://localhost:4173/',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});

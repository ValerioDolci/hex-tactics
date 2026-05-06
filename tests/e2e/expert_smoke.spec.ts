import { test, expect } from '@playwright/test';

test('home loads without errors', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

  await page.goto(baseURL ?? 'http://localhost:5173/');
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('TOTAL errors:', errors.length);
  errors.forEach((e, i) => console.log(`  [${i}]`, e.substring(0, 200)));

  // Filtro favicon e altri innocui
  const real = errors.filter((e) => !e.includes('favicon') && !e.match(/Failed to load resource.*404/));
  expect(real, real.join('\n')).toEqual([]);
});

/**
 * Screenshot skirmish setup + battaglia 2v2 — verifica visiva UX.
 *
 * Run:
 *   PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node node_modules/.bin/playwright \
 *     test tests/e2e/skirmish-screenshots.spec.ts
 */
import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/skirmish-shots';

test.setTimeout(120_000);

async function startSkirmish(page: Page, presetsA: string[], presetsB: string[]) {
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  await page.evaluate(
    ({ presetsA, presetsB }) => {
      const game = (window as any).__hexGame;
      game.scene.stop('MainMenuScene');
      game.scene.start('BattleScene', {
        presetA: presetsA[0],
        presetB: presetsB[0],
        modeA: 'ai',
        modeB: 'ai',
        aiLevelA: 'hard',
        aiLevelB: 'hard',
        skirmishA: presetsA,
        skirmishB: presetsB,
      });
    },
    { presetsA, presetsB },
  );
  await page.waitForTimeout(2500);
}

test('SkirmishSetupScene look + 2v2 battle screens', async ({ page }) => {
  // 1. Apri MainMenu
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/01_main_menu.png` });

  // 2. Naviga a SkirmishSetupScene direttamente
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('SkirmishSetupScene');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/02_skirmish_setup_empty.png` });

  // 3. Simula skirmish 2v2 partendo direttamente da BattleScene con preset multi
  await startSkirmish(page, ['arciere', 'spadaccino'], ['tank', 'arciere']);
  await page.screenshot({ path: `${SHOT}/03_battle_start.png` });

  // 4. Screenshot a intervalli durante AI vs AI
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT}/auto_${String(i).padStart(2, '0')}.png` });
  }

  expect(true).toBe(true);
});

/**
 * Screenshot della narrazione in azione — per verifica visiva del layout overlay.
 *
 * Run:
 *   PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node node_modules/.bin/playwright \
 *     test tests/e2e/narrator-screenshots.spec.ts
 */
import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/narrator-shots';

test.setTimeout(120_000);

async function startBattleAIvsAI(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  // AI vs AI: tutto auto, nessun popup human → vediamo overlay nelle fasi sgombre
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', {
      presetA: 'arciere',
      presetB: 'tank',
      modeA: 'ai',
      modeB: 'ai',
      aiLevelA: 'hard',
      aiLevelB: 'hard',
    });
  });
  await page.waitForTimeout(2500);
}

test('cattura overlay narrazione AI vs AI', async ({ page }) => {
  await startBattleAIvsAI(page);

  // Scatto a intervalli per beccare l'overlay in azione
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: `${SHOT}/auto_${String(i).padStart(2, '0')}.png` });
    await page.waitForTimeout(1200);
  }

  expect(true).toBe(true);
});

/**
 * Screenshot dei sprite con armi riconoscibili: lancia tutti i preset insieme
 * per vedere ogni simbolo di arma renderizzato.
 */
import { test, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/hex-screenshots';

interface Cap { errors: string[] }
function capture(page: Page): Cap {
  const c: Cap = { errors: [] };
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') c.errors.push(m.text()); });
  page.on('pageerror', (e) => c.errors.push(`PAGE ERROR: ${e.message}`));
  return c;
}

test.setTimeout(60_000);

const COMBOS = [
  { presetA: 'spadaccino', presetB: 'arciere', label: 'spadaccino_vs_arciere' },
  { presetA: 'tank', presetB: 'spadaccino', label: 'tank_vs_spadaccino' },
  { presetA: 'arciere', presetB: 'tank', label: 'arciere_vs_tank' },
];

for (const combo of COMBOS) {
  test(`Sprite preview: ${combo.label}`, async ({ page }) => {
    const cap = capture(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 10_000 });
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

    await page.evaluate(({ a, b }) => {
      const setup = { presetA: a, presetB: b, modeA: 'human', modeB: 'human' };
      localStorage.setItem('hexTactics.lastSetup', JSON.stringify(setup));
      const game = (window as any).__hexGame;
      game.scene.stop('MainMenuScene');
      game.scene.start('BattleScene', setup);
    }, { a: combo.presetA, b: combo.presetB });
    await page.waitForTimeout(2500);
    // Skip the slancio dice prompt: dispatch START_TURN directly
    await page.evaluate(() => {
      const game = (window as any).__hexGame;
      const scene = game.scene.getScene('BattleScene') as any;
      if (scene?.state?.phase === 'turn-start') {
        scene.dispatch({ type: 'START_TURN', slancioDice: 0 });
      }
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/sprite_${combo.label}.png` });
    void cap;
  });
}

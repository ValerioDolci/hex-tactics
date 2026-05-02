/**
 * Smoke test: ogni scenario tutorial T1-T9 si avvia senza errori.
 * Per ognuno: lancia BattleScene in tutorialMode, verifica state, screenshot.
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/hex-screenshots';

const SCENARIOS = [
  { id: 't1-muoviti', label: 'T1' },
  { id: 't2-slancio', label: 'T2' },
  { id: 't3-attacca', label: 'T3' },
  { id: 't4-schiva', label: 'T4' },
  { id: 't5-para', label: 'T5' },
  { id: 't6-spara', label: 'T6' },
  { id: 't7-carica', label: 'T7' },
  { id: 't8-stance', label: 'T8' },
  { id: 't9-asta', label: 'T9' },
];

interface Cap {
  errors: string[];
}

function capture(page: Page): Cap {
  const c: Cap = { errors: [] };
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') c.errors.push(m.text());
  });
  page.on('pageerror', (e) => c.errors.push(`PAGE ERROR: ${e.message}`));
  return c;
}

test.setTimeout(180_000);

for (const scenario of SCENARIOS) {
  test(`scenario ${scenario.id} si avvia senza errori`, async ({ page }) => {
    const cap = capture(page);
    await page.goto(BASE_URL);
    await page.waitForSelector('canvas', { timeout: 10_000 });
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

    await page.evaluate(({ id }) => {
      const game = (window as any).__hexGame;
      game.scene.stop('MainMenuScene');
      game.scene.start('BattleScene', { tutorialMode: id });
    }, { id: scenario.id });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SHOT}/sc_${scenario.label}.png` });

    // Verifica state
    const state = await page.evaluate(() => {
      const game = (window as any).__hexGame;
      const scene = game.scene.getScene('BattleScene') as any;
      return {
        hasState: scene?.state != null,
        phase: scene?.state?.phase,
        tutorialId: scene?.tutorialScenario?.id,
      };
    });

    expect(state.hasState).toBe(true);
    expect(state.tutorialId).toBe(scenario.id);

    const serious = cap.errors.filter(
      (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
    );
    expect(serious, `errors:\n${serious.join('\n')}`).toEqual([]);
  });
}

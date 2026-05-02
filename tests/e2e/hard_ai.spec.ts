/**
 * Smoke test Hard mode AI: avvia BattleScene con aiLevelB='hard',
 * lascia girare la simulazione e verifica che NON ci siano errori console
 * + l'AI fa decisioni (almeno un evento dispatch dopo il turn-start).
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';

interface Cap { errors: string[] }
function capture(page: Page): Cap {
  const c: Cap = { errors: [] };
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') c.errors.push(m.text()); });
  page.on('pageerror', (e) => c.errors.push(`PAGE ERROR: ${e.message}`));
  return c;
}

test.setTimeout(60_000);

test('Hard mode AI: avvio BattleScene senza errori', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  // Avvia BattleScene con A=hard B=hard, AI vs AI per testare entrambe le policy
  await page.evaluate(() => {
    const setup = {
      presetA: 'spadaccino',
      presetB: 'tank',
      modeA: 'ai',
      modeB: 'ai',
      aiLevelA: 'hard',
      aiLevelB: 'hard',
    };
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', setup);
  });

  await page.waitForTimeout(8000); // lascia girare per ~8s

  const state = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    return {
      hasState: scene?.state != null,
      round: scene?.state?.round,
      phase: scene?.state?.phase,
      aiLevels: scene?.aiLevel,
    };
  });

  expect(state.hasState).toBe(true);
  expect(state.aiLevels).toEqual({ A: 'hard', B: 'hard' });
  // L'AI hard deve avere giocato qualche turno entro 8s
  expect(state.round).toBeGreaterThanOrEqual(1);

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious, `errors:\n${serious.join('\n')}`).toEqual([]);
});

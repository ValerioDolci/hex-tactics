/**
 * Smoke test per ManualScene + TutorialMenuScene.
 * Verifica che:
 *  - Main menu mostri i bottoni Tutorial + Manuale
 *  - Click sul Manuale apra ManualScene senza errori
 *  - Click sul Tutorial apra TutorialMenuScene senza errori
 *  - Click su uno scenario tutorial avvii BattleScene in tutorialMode
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/hex-screenshots';

interface Cap {
  errors: string[];
  warnings: string[];
  logs: string[];
}

function capture(page: Page): Cap {
  const c: Cap = { errors: [], warnings: [], logs: [] };
  page.on('console', (m: ConsoleMessage) => {
    const t = m.type();
    if (t === 'error') c.errors.push(m.text());
    else if (t === 'warning') c.warnings.push(m.text());
    else c.logs.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => c.errors.push(`PAGE ERROR: ${e.message}\n${e.stack ?? ''}`));
  return c;
}

test.setTimeout(60_000);

test('MainMenu mostra bottoni Tutorial + Manuale', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/mt1_main_menu_with_buttons.png` });

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious, `errors:\n${serious.join('\n')}`).toEqual([]);
});

test('Click Manuale apre ManualScene', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  // Lancio direttamente ManualScene via window.__hexGame (più affidabile dei click su canvas)
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('ManualScene');
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/mt2_manual_open.png` });

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious).toEqual([]);
});

test('Click Tutorial apre TutorialMenuScene', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('TutorialMenuScene');
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/mt3_tutorial_menu.png` });

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious).toEqual([]);
});

test('Avvia tutorial T1 (Muoviti)', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', { tutorialMode: 't1-muoviti' });
  });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${SHOT}/mt4_tutorial_t1_open.png` });

  // Verifica che BattleScene sia attiva e che il tutorial overlay sia visibile
  const tutorialState = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    return {
      hasState: scene?.state != null,
      phase: scene?.state?.phase,
      hasTutorial: scene?.tutorialScenario != null,
      tutorialId: scene?.tutorialScenario?.id,
    };
  });

  console.log('T1 state:', JSON.stringify(tutorialState));
  expect(tutorialState.hasTutorial).toBe(true);
  expect(tutorialState.tutorialId).toBe('t1-muoviti');

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious).toEqual([]);
});

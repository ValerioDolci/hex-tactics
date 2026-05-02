/**
 * Smoke test Playwright: apre la pagina, clicca attraverso il flusso UI completo
 * (main menu → battaglia → slancio → action menu → passa turno) e cattura screenshot
 * per analisi visiva.
 *
 * Phaser è canvas-only → non si può ispezionare DOM.
 * Strategia: click a coordinate basate sul layout noto + screenshot.
 *
 * Run: node node_modules/.bin/playwright test tests/e2e/smoke.spec.ts
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

test.setTimeout(120_000);

test('hex-tactics flow completo', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/01_main_menu.png` });

  // No errori al boot (filtra noise)
  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious, `boot errors:\n${serious.join('\n')}`).toEqual([]);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const cx = box.x + box.width / 2;
  // Coords basate su viewport 1280×720

  // Avvia BattleScene direttamente (la y di "Inizia battaglia" varia coi nuovi bottoni in MainMenu)
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5000 });
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const setup = JSON.parse(localStorage.getItem('hexTactics.lastSetup') ?? 'null') ?? {
      presetA: 'spadaccino',
      presetB: 'arciere',
      modeA: 'human',
      modeB: 'ai',
    };
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', setup);
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOT}/02_battle_slancio.png` });

  // DiceChoiceUI ha bottoni 0/1/2 verticalmente allineati alla parte bassa del box.
  // Box centrato → bottoni a y ~505. "2" è il rightmost a x ~765 (centro-screen +~125).
  // Per max slancio, click su "2".
  await page.mouse.click(cx + 125, box.y + 505);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/03_action_menu.png` });

  // Action menu è ancorato in alto-destra, x = w - 300, y = 140.
  // Su 1280: ActionMenu inizia a (980, 140). Ogni item è alto ~46 px (vedere ActionMenu.ts).
  // L'ultimo item è "Passa turno". Conta items per Spadaccino:
  //   - 1+ "Attacca Arciere" (forse fuori range mischia, ma può esserci ranged se applicabile)
  //   - "Muovi" se slancio>0
  //   - "🛡 Posizione difensiva" se ha scudo (Spadaccino NO scudo)
  //   - "Passa turno"
  // Spadaccino default ha spada+armatura_media, no scudo, no ranged. Items: Muovi + Passa turno.
  // Click "Passa turno" che è il 2° item → y ≈ 140 + 46 = 186.
  // Per sicurezza clicchiamo a y=240 (dovrebbe essere l'ultimo item indipendentemente).
  const menuX = box.x + box.width - 150;
  await page.mouse.click(menuX, box.y + 240);
  await page.waitForTimeout(2500); // attende AI turn
  await page.screenshot({ path: `${SHOT}/04_after_pass_turn.png` });

  // Avanza ancora un turno: arciere (B) AI ha appena giocato. Ora dovrebbe essere il
  // turno di A nuovamente (o un altro slancio se nuovo round).
  // Se DiceChoiceUI appare per slancio: click "2"
  await page.mouse.click(cx + 125, box.y + 505);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/05_round2_action.png` });

  // Pass turn ancora
  await page.mouse.click(menuX, box.y + 240);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT}/06_round2_after_pass.png` });

  // Salva log completo
  const fs = await import('fs');
  fs.writeFileSync(
    `${SHOT}/console_log.txt`,
    `=== ERRORS (${cap.errors.length}) ===\n${cap.errors.join('\n')}\n\n` +
      `=== WARNINGS (${cap.warnings.length}) ===\n${cap.warnings.slice(0, 10).join('\n')}\n\n` +
      `=== LOGS (${cap.logs.length}) ===\n${cap.logs.slice(0, 200).join('\n')}\n`,
  );

  console.log(`Done. errors=${cap.errors.length}, warnings=${cap.warnings.length}, logs=${cap.logs.length}`);
  expect(serious).toEqual([]); // di nuovo: nessun errore durante il flusso
});

/**
 * Repro REALISTICO: simula esattamente il flusso utente.
 * - Avvia battaglia umano vs AI
 * - Forza A primo turn, posizionato adiacente a B
 * - Click "Inizia turno" / scelta slancio (via dispatch fittizio)
 * - Click "Attacca" via menu (chiamando direttamente startAttackFlow come farebbe il bottone)
 * - Click "1 dado" sul DiceUI (chiamando l'onChoose del bottone)
 * - Verifica: post-combat, menu items > 0 e cliccabili
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';

interface Cap { errors: string[]; logs: string[] }
function capture(page: Page): Cap {
  const c: Cap = { errors: [], logs: [] };
  page.on('console', (m: ConsoleMessage) => {
    const t = m.type();
    if (t === 'error') c.errors.push(m.text());
    else c.logs.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => c.errors.push(`PAGE: ${e.message}`));
  return c;
}

test.setTimeout(60_000);

test('Repro real: dopo umano vs AI mischia, menu cliccabile', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  await page.evaluate(() => {
    const setup = {
      presetA: 'spadaccino', presetB: 'tank', modeA: 'human', modeB: 'ai',
      aiLevelA: 'easy', aiLevelB: 'easy',
    };
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', setup);
  });
  await page.waitForTimeout(2000);

  // Setup: A primo nel turnOrder, posizionato adiacente a B
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    const aId = Object.keys(scene.state.units).find((id: string) => scene.state.units[id].faction === 'A');
    const bId = Object.keys(scene.state.units).find((id: string) => scene.state.units[id].faction === 'B');
    const a = scene.state.units[aId];
    const b = scene.state.units[bId];
    a.position = { q: 0, r: 9 }; a.positionAtTurnStart = { q: 0, r: 9 };
    b.position = { q: 1, r: 9 }; b.positionAtTurnStart = { q: 1, r: 9 };
    a.dadiAzione = 6; a.slancio = 5;
    b.dadiAzione = 6; b.slancio = 0;
    // Forza turnOrder con A primo
    scene.state.turnOrder = [aId, bId];
    scene.state.currentTurnIdx = 0;
    // Resetta phase a turn-start cosi START_TURN funziona
    scene.state.phase = 'turn-start';
  });

  // START_TURN slancio 0 (resta in choosing-action col menu items)
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    scene.dispatch({ type: 'START_TURN', slancioDice: 0 });
    scene.showActionMenu();
  });
  await page.waitForTimeout(300);

  // Pre-attacco: menu items > 0
  const pre = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    return { phase: scene.state.phase, items: scene.menu.buttons?.length ?? -1 };
  });
  console.log('PRE attack:', JSON.stringify(pre));

  // Simula click "Attacca": chiamo startAttackFlow + simulo onChoose con 1 dado
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    const aId = Object.keys(scene.state.units).find((id: string) => scene.state.units[id].faction === 'A');
    const bId = Object.keys(scene.state.units).find((id: string) => scene.state.units[id].faction === 'B');
    const a = scene.state.units[aId];
    // Simula bottone "Attacca" che chiama startAttackFlow(aId, bId, weapon, 0, stat, false)
    scene.startAttackFlow(aId, bId, a.weapon, 0, 'forza', false);
  });
  await page.waitForTimeout(400);

  // Ora dovremmo essere in 'declaring-attack' con DiceChoiceUI aperta.
  // Simula il click "1" del bottone: la diceUI ha buttons[1] con onChoose binding.
  // Più realistico: chiama diceUI.buttons[1] click event.
  const diceClick = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    const phase = scene.state.phase;
    const dice = scene.diceUI;
    // Trova il bottone "1" (secondo nei choices [1,2])
    if (!dice.buttons || dice.buttons.length === 0) return { err: 'no buttons', phase };
    // Emit pointerup sul bottone 0 (il primo, di solito "1" dado)
    const btn = dice.buttons[0];
    const rect = btn.list[0]; // Phaser.GameObjects.Rectangle
    rect.emit('pointerup');
    return { phase, clicked: true };
  });
  console.log('after dice click:', JSON.stringify(diceClick));
  await page.waitForTimeout(800);

  const post = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    return {
      phase: scene.state.phase,
      menuItems: scene.menu.buttons?.length ?? -1,
      pendingAction: scene.state.pendingAction != null,
      logTail: scene.state.log.slice(-3).map((l: any) => l.message),
    };
  });
  console.log('POST combat:', JSON.stringify(post));

  expect(post.phase).toBe('choosing-action');
  expect(post.menuItems).toBeGreaterThan(0);
  expect(post.pendingAction).toBe(false);

  // Verifica esplicita che i bottoni del menu ABBIANO listener attivi
  const menuClickable = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    const btn = scene.menu.buttons[scene.menu.buttons.length - 1]; // ultimo = Passa turno
    if (!btn) return false;
    const bg = btn.list[0]; // Rectangle
    return bg.input != null && bg.input.enabled;
  });
  expect(menuClickable).toBe(true);

  console.log('console errors:', cap.errors.length);
});

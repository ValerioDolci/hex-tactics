/**
 * Smoke test del Character Builder.
 *
 * Verifica:
 *  - CharacterBuilderScene si avvia senza errori (lanciata via __hexGame)
 *  - Costruzione di una build via API: dispatch dei cambi e validazione
 *  - Save/load builds in localStorage
 *  - Battaglia con custom build funziona
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

const BASE_URL = process.env.HEX_BASE_URL ?? 'http://localhost:4173/';
const SHOT = '/tmp/hex-screenshots';

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

test.setTimeout(60_000);

test('CharacterBuilderScene si avvia senza errori', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    game.scene.stop('MainMenuScene');
    game.scene.start('CharacterBuilderScene', { faction: 'A' });
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/cb1_default_view.png` });

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious, `errors:\n${serious.join('\n')}`).toEqual([]);
});

test('Build con weapon + armor + skill: validazione + save in localStorage', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  // Crea una build via API direttamente in localStorage e verifica che la possiamo caricare
  await page.evaluate(() => {
    const build = {
      id: 'test-build-1',
      name: 'Test Tank',
      weaponId: 'mazza',
      offhandId: 'scudo_medio',
      armorId: 'armatura_media',
      skills: [
        { modifier: '-1impedimento', level: 3, cost: 700 },
        { modifier: '-1impedimento', level: 3, classeOggetto: 'scudi', cost: 350 },
      ],
    };
    localStorage.setItem('hexTactics.customBuilds', JSON.stringify([build]));
  });

  // Apri builder con questa build pre-caricata
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const all = JSON.parse(localStorage.getItem('hexTactics.customBuilds') ?? '[]');
    const build = all[0];
    game.scene.stop('MainMenuScene');
    game.scene.start('CharacterBuilderScene', { faction: 'A', build });
  });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: `${SHOT}/cb2_loaded_build.png` });

  // Verifica la validazione via API
  const validation = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('CharacterBuilderScene') as any;
    return scene?.build;
  });
  expect(validation.weaponId).toBe('mazza');
  expect(validation.skills).toHaveLength(2);

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious).toEqual([]);
});

test('Battaglia con custom build via setup', async ({ page }) => {
  const cap = capture(page);
  await page.goto(BASE_URL);
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  // Pre-popola una build custom + setup che la usa per fazione A
  await page.evaluate(() => {
    const build = {
      id: 'test-build-battle',
      name: 'Custom A',
      weaponId: 'spada_lunga',
      armorId: 'armatura_leggera',
      skills: [{ modifier: '-1impedimento', level: 1, cost: 100 }],
    };
    localStorage.setItem('hexTactics.customBuilds', JSON.stringify([build]));
    const setup = {
      presetA: 'spadaccino',
      presetB: 'arciere',
      modeA: 'human',
      modeB: 'ai',
      customBuildIdA: 'test-build-battle',
    };
    localStorage.setItem('hexTactics.lastSetup', JSON.stringify(setup));
  });

  await page.reload();
  await page.waitForSelector('canvas', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (window as any).__hexGame != null, { timeout: 5_000 });

  // Avvia BattleScene direttamente (più affidabile dei click su canvas grandi posizionati dinamicamente)
  await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const setup = JSON.parse(localStorage.getItem('hexTactics.lastSetup') ?? 'null');
    game.scene.stop('MainMenuScene');
    game.scene.start('BattleScene', setup);
  });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: `${SHOT}/cb3_battle_with_custom.png` });

  // Verifica che A nello state abbia weapon = spada_lunga
  const state = await page.evaluate(() => {
    const game = (window as any).__hexGame;
    const scene = game.scene.getScene('BattleScene') as any;
    if (!scene?.state) return null;
    const aId = Object.keys(scene.state.units).find(
      (id) => scene.state.units[id].faction === 'A',
    );
    if (!aId) return null;
    return {
      name: scene.state.units[aId].name,
      weapon: scene.state.units[aId].weapon,
      armor: scene.state.units[aId].armor,
    };
  });

  expect(state).not.toBeNull();
  expect(state!.name).toBe('Custom A');
  expect(state!.weapon).toBe('spada_lunga');
  expect(state!.armor).toBe('armatura_leggera');

  const serious = cap.errors.filter(
    (e) => !e.includes('Failed to load') && !e.toLowerCase().includes('favicon'),
  );
  expect(serious).toEqual([]);
});

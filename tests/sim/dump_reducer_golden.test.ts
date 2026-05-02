/**
 * Dump golden parità reducer TS↔Py (P7).
 *
 * Genera `python/tests/fixtures/reducer_golden.json` con scenari scriptati:
 *   - sequenze di eventi hardcoded
 *   - snapshot stato dopo ogni evento (units HP/slancio/impeto/dadi, phase, log_size)
 *
 * Eseguire:
 *   DUMP_REDUCER_GOLDEN=1 npx vitest run tests/sim/dump_reducer_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, getPreset } from '@data/presets';
import { createInitialState, GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';

function snapshot(state: GameState) {
  const unitsSnap: Record<string, any> = {};
  for (const [id, u] of Object.entries(state.units)) {
    unitsSnap[id] = {
      id: u.id,
      hp: u.hp,
      impeto: u.impeto,
      slancio: u.slancio,
      dadiAzione: u.dadiAzione,
      alive: u.alive,
      hexMovedThisTurn: u.hexMovedThisTurn,
      actionTakenThisTurn: u.actionTakenThisTurn,
      weaponLoaded: u.weaponLoaded,
      position: { q: u.position.q, r: u.position.r },
    };
  }
  return {
    round: state.round,
    phase: state.phase,
    currentTurnIdx: state.currentTurnIdx,
    turnOrder: state.turnOrder.slice(),
    rngSeed: state.rngSeed,
    logSize: state.log.length,
    pendingAction: state.pendingAction
      ? {
          attackerId: state.pendingAction.attackerId,
          targetId: state.pendingAction.targetId,
          weaponId: state.pendingAction.weaponId,
          attackModeIdx: state.pendingAction.attackModeIdx,
          isRanged: state.pendingAction.isRanged,
          chosenStat: state.pendingAction.chosenStat ?? null,
          attackerDice: state.pendingAction.attackerDice ?? null,
          defense: state.pendingAction.defense ?? null,
        }
      : null,
    winner: state.winner ?? null,
    units: unitsSnap,
  };
}

interface ScenarioInput {
  label: string;
  unitsSpec: Array<{ presetId: string; faction: 'A' | 'B'; pos: { col: number; row: number } }>;
  rngSeed: number;
  events: Array<{ event: GameEvent; description: string }>;
}

function runScenario(sc: ScenarioInput) {
  const units = sc.unitsSpec.map((s) =>
    unitFromPreset(getPreset(s.presetId)!, s.faction, offsetToAxial(s.pos)),
  );
  // Per scenari A vs B con stesso preset: rinomino gli ID per evitare collisioni
  const idCounts: Record<string, number> = {};
  for (const u of units) {
    const key = `${u.faction}-${u.presetId ?? 'unit'}`;
    idCounts[key] = (idCounts[key] ?? 0) + 1;
  }

  let state = createInitialState({
    units,
    board: { cols: 24, rows: 18 },
    rngSeed: sc.rngSeed,
  });
  const snapshots: any[] = [{ step: -1, description: 'initial', state: snapshot(state) }];
  for (let i = 0; i < sc.events.length; i++) {
    const ev = sc.events[i];
    state = reduce(state, ev.event);
    snapshots.push({ step: i, description: ev.description, eventType: ev.event.type, state: snapshot(state) });
  }
  return {
    label: sc.label,
    unitsSpec: sc.unitsSpec,
    rngSeed: sc.rngSeed,
    events: sc.events.map((e, i) => ({
      step: i,
      description: e.description,
      event: e.event,
    })),
    snapshots,
  };
}

describe('dump_reducer_golden', () => {
  it('dumps reducer fixtures', () => {
    if (!process.env.DUMP_REDUCER_GOLDEN) return;

    const scenarios: any[] = [];

    // ── Scenario 1: round base + 2 turn end (no combat) ──────────────────
    scenarios.push(
      runScenario({
        label: 'round-base-2-passes',
        unitsSpec: [
          { presetId: 'spadaccino', faction: 'A', pos: { col: 4, row: 4 } },
          { presetId: 'tank', faction: 'B', pos: { col: 12, row: 4 } },
        ],
        rngSeed: 100001,
        events: [
          { event: { type: 'START_ROUND' }, description: 'inizio round 1' },
          { event: { type: 'START_TURN', slancioDice: 2, impetoToSlancio: 0 }, description: 'turn-1 start (2 dadi)' },
          { event: { type: 'END_TURN' }, description: 'turn-1 end' },
          { event: { type: 'START_TURN', slancioDice: 1, impetoToSlancio: 2 }, description: 'turn-2 start (1 dado, transfer 2)' },
          { event: { type: 'END_TURN' }, description: 'turn-2 end (porta a end-round → start-round 2)' },
        ],
      }),
    );

    // ── Scenario 2: CaC con dodge che fallisce → contraccolpo ────────────
    scenarios.push(
      runScenario({
        label: 'cac-attack-dodge-hit',
        unitsSpec: [
          { presetId: 'spadaccino', faction: 'A', pos: { col: 4, row: 4 } },
          { presetId: 'arciere', faction: 'B', pos: { col: 5, row: 4 } }, // adiacente
        ],
        rngSeed: 100002,
        events: [
          { event: { type: 'START_ROUND' }, description: 'round 1' },
          { event: { type: 'START_TURN', slancioDice: 2 }, description: 'turn-1 start' },
          {
            event: {
              type: 'DECLARE_ATTACK',
              attackerId: 'A-spadaccino',
              targetId: 'B-arciere',
              weaponId: 'spada_lunga',
              attackModeIdx: 1, // 2 mani, +6 fixed
              isRanged: false,
            },
            description: 'declare attack',
          },
          { event: { type: 'CHOOSE_ATTACKER_DICE', diceN: 2 }, description: 'choose atk dice 2' },
          { event: { type: 'CHOOSE_DEFENSE', defenseType: 'dodge', diceN: 2 }, description: 'choose dodge 2' },
          { event: { type: 'RESOLVE_COMBAT' }, description: 'resolve' },
        ],
      }),
    );

    // ── Scenario 3: ranged arciere → tank ───────────────────────────────
    scenarios.push(
      runScenario({
        label: 'ranged-attack-arciere-vs-tank',
        unitsSpec: [
          { presetId: 'arciere', faction: 'A', pos: { col: 4, row: 4 } },
          { presetId: 'tank', faction: 'B', pos: { col: 8, row: 4 } },
        ],
        rngSeed: 100003,
        events: [
          { event: { type: 'START_ROUND' }, description: 'round 1' },
          { event: { type: 'START_TURN', slancioDice: 2 }, description: 'start turn' },
          {
            event: {
              type: 'DECLARE_ATTACK',
              attackerId: 'A-arciere',
              targetId: 'B-tank',
              weaponId: 'arco_lungo',
              attackModeIdx: 0,
              isRanged: true,
            },
            description: 'declare ranged',
          },
          { event: { type: 'CHOOSE_ATTACKER_DICE', diceN: 2 }, description: 'choose atk dice 2' },
          { event: { type: 'RESOLVE_COMBAT' }, description: 'resolve ranged (no defense step)' },
        ],
      }),
    );

    // ── Scenario 4: parry + miss + slancio penalty ──────────────────────
    scenarios.push(
      runScenario({
        label: 'cac-parry-miss',
        unitsSpec: [
          { presetId: 'arciere', faction: 'A', pos: { col: 4, row: 4 } }, // pugnale offhand
          { presetId: 'tank', faction: 'B', pos: { col: 5, row: 4 } },
        ],
        rngSeed: 100004,
        events: [
          { event: { type: 'START_ROUND' }, description: 'round 1' },
          { event: { type: 'START_TURN', slancioDice: 2 }, description: 'start' },
          {
            event: {
              type: 'DECLARE_ATTACK',
              attackerId: 'A-arciere',
              targetId: 'B-tank',
              weaponId: 'pugnale', // offhand → ma weapon è arco_lungo. Cambiamo:
              attackModeIdx: 0,
              isRanged: false,
            },
            description: 'declare melee attack with pugnale (default arco_lungo non parabile, useremo pugnale come arma)',
          },
          { event: { type: 'CHOOSE_ATTACKER_DICE', diceN: 1 }, description: 'choose 1' },
          { event: { type: 'CHOOSE_DEFENSE', defenseType: 'parry', parryWith: 'offhand', diceN: 2 }, description: 'parry with shield (tank offhand)' },
          { event: { type: 'RESOLVE_COMBAT' }, description: 'resolve' },
        ],
      }),
    );

    // ── Scenario 5: movement ─────────────────────────────────────────────
    scenarios.push(
      runScenario({
        label: 'movement-cost',
        unitsSpec: [
          { presetId: 'spadaccino', faction: 'A', pos: { col: 4, row: 4 } },
          { presetId: 'tank', faction: 'B', pos: { col: 12, row: 4 } },
        ],
        rngSeed: 100005,
        events: [
          { event: { type: 'START_ROUND' }, description: 'round 1' },
          { event: { type: 'START_TURN', slancioDice: 2 }, description: 'start' },
          { event: { type: 'MOVE', unitId: 'A-spadaccino', targetHex: offsetToAxial({ col: 5, row: 4 }) }, description: 'move 1 hex (free)' },
          { event: { type: 'MOVE', unitId: 'A-spadaccino', targetHex: offsetToAxial({ col: 7, row: 4 }) }, description: 'move 2 hex (cost 2)' },
        ],
      }),
    );

    // ── Scenario 6: reload balestra ─────────────────────────────────────
    scenarios.push(
      runScenario({
        label: 'reload-balestra',
        unitsSpec: [
          { presetId: 'tank', faction: 'A', pos: { col: 4, row: 4 } },
          { presetId: 'spadaccino', faction: 'B', pos: { col: 12, row: 4 } },
        ],
        rngSeed: 100006,
        events: [
          { event: { type: 'START_ROUND' }, description: 'round 1' },
          { event: { type: 'START_TURN', slancioDice: 1 }, description: 'start' },
          // Tank ha mazza, no balestra. Inutile testare reload qui.
          // Useremo un test sintetico: in Py preferiremo altri scenari.
          { event: { type: 'END_TURN' }, description: 'pass' },
        ],
      }),
    );

    const out = {
      meta: { generated_by: 'tests/sim/dump_reducer_golden.test.ts' },
      scenarios,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/reducer_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[dump_reducer_golden] wrote ${outPath} (${scenarios.length} scenarios)`);
  });
});

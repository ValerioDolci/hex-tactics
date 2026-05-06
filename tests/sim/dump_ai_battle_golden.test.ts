/**
 * Dump golden parità AI + battaglie end-to-end TS↔Py (P9 + P8).
 *
 * Genera `python/tests/fixtures/ai_battle_golden.json` con:
 *   - ai_decisions: scenari isolati per ai_decide_slancio / action / attacker_dice / defense
 *   - battles: 30 battaglie complete (matchup × seed) con AI heuristic da entrambi i lati,
 *     riportando winner, rounds, hp_a_finale, hp_b_finale + sequenza eventi (per debug)
 *
 * Eseguire:
 *   DUMP_AI_BATTLE_GOLDEN=1 npx vitest run tests/sim/dump_ai_battle_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, getPreset } from '@data/presets';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';
import {
  aiDecideSlancio,
  aiDecideAction,
  aiDecideAttackerDice,
  aiDecideDefense,
} from '@ai/basicAi';

interface BattleResult {
  matchup: { a: string; b: string };
  seed: number;
  winner: string | null;
  rounds: number;
  hpA: number;
  hpB: number;
  events: number; // count
  finalState: any;
}

function eventToJson(e: GameEvent): any {
  return JSON.parse(JSON.stringify(e));
}

function runBattle(presetA: string, presetB: string, seed: number, maxRounds = 30): BattleResult {
  const A = unitFromPreset(getPreset(presetA)!, 'A', offsetToAxial({ col: 4, row: 8 }));
  const B = unitFromPreset(getPreset(presetB)!, 'B', offsetToAxial({ col: 18, row: 8 }));
  let state = createInitialState({
    units: [A, B],
    board: { cols: 24, rows: 18 },
    rngSeed: seed,
  });

  let eventsCount = 0;
  let safetyCounter = 0;
  state = reduce(state, { type: 'START_ROUND' });
  eventsCount++;

  while (state.phase !== 'game-over' && state.round <= maxRounds && safetyCounter < 5000) {
    safetyCounter++;
    const currentUnitId = state.turnOrder[state.currentTurnIdx];

    if (state.phase === 'turn-start') {
      const slancioDice = aiDecideSlancio(state, currentUnitId);
      state = reduce(state, { type: 'START_TURN', slancioDice });
      eventsCount++;
      continue;
    }

    if (state.phase === 'choosing-action') {
      const action = aiDecideAction(state, currentUnitId);
      state = reduce(state, action);
      eventsCount++;
      continue;
    }

    if (state.phase === 'declaring-attack') {
      const dice = aiDecideAttackerDice(state, currentUnitId);
      state = reduce(state, { type: 'CHOOSE_ATTACKER_DICE', diceN: dice });
      eventsCount++;
      continue;
    }

    if (state.phase === 'awaiting-defense') {
      const pa = state.pendingAction!;
      const defId = pa.targetId;
      const decision = aiDecideDefense(state, defId);
      state = reduce(state, {
        type: 'CHOOSE_DEFENSE',
        defenseType: decision.defenseType,
        parryWith: decision.parryWith,
        diceN: decision.diceN,
      });
      eventsCount++;
      continue;
    }

    if (state.phase === 'resolving') {
      state = reduce(state, { type: 'RESOLVE_COMBAT' });
      eventsCount++;
      continue;
    }

    // turn-end / round-end → END_TURN ciclo
    // NB: il narrowing TS qui dice che 'choosing-action'/'turn-start' sono già stati
    // gestiti, ma manteniamo i fallback per robustezza (state.phase può ricomparire
    // in scenari di ricezione asincrona). Cast a string per silenziare TS2367.
    if ((state.phase as string) === 'choosing-action' || (state.phase as string) === 'turn-start') {
      state = reduce(state, { type: 'END_TURN' });
      eventsCount++;
      continue;
    }

    // Fallback safety: chiudi turno
    state = reduce(state, { type: 'END_TURN' });
    eventsCount++;
  }

  const aliveA = Object.values(state.units).filter((u) => u.faction === 'A')[0];
  const aliveB = Object.values(state.units).filter((u) => u.faction === 'B')[0];

  return {
    matchup: { a: presetA, b: presetB },
    seed,
    winner: state.winner ?? null,
    rounds: state.round,
    hpA: aliveA.hp,
    hpB: aliveB.hp,
    events: eventsCount,
    finalState: {
      phase: state.phase,
      currentTurnIdx: state.currentTurnIdx,
      rngSeed: state.rngSeed,
      logSize: state.log.length,
      units: Object.fromEntries(
        Object.entries(state.units).map(([id, u]) => [
          id,
          { hp: u.hp, slancio: u.slancio, impeto: u.impeto, dadiAzione: u.dadiAzione, alive: u.alive },
        ]),
      ),
    },
  };
}

describe('dump_ai_battle_golden', () => {
  it('dumps AI + battle fixtures', () => {
    if (!process.env.DUMP_AI_BATTLE_GOLDEN) return;

    // ── AI decisions: scenari isolati ────────────────────────────────────
    const aiDecisions: Array<any> = [];

    // Scenario A: arciere vs tank, distance ~3, atk a turno
    const A_arc = unitFromPreset(getPreset('arciere')!, 'A', offsetToAxial({ col: 4, row: 4 }));
    const B_tank = unitFromPreset(getPreset('tank')!, 'B', offsetToAxial({ col: 7, row: 4 }));
    const state1 = createInitialState({
      units: [A_arc, B_tank],
      board: { cols: 24, rows: 18 },
      rngSeed: 31337,
    });
    const stateAfterRound = reduce(state1, { type: 'START_ROUND' });
    const stateTurnStart = reduce(stateAfterRound, { type: 'START_TURN', slancioDice: 2 });

    aiDecisions.push({
      label: 'arciere-vs-tank-decideSlancio',
      forUnit: stateAfterRound.turnOrder[0],
      input: { phase: stateAfterRound.phase, round: stateAfterRound.round },
      output: aiDecideSlancio(stateAfterRound, stateAfterRound.turnOrder[0]),
    });
    aiDecisions.push({
      label: 'arciere-vs-tank-decideAction',
      forUnit: stateTurnStart.turnOrder[0],
      output: eventToJson(aiDecideAction(stateTurnStart, stateTurnStart.turnOrder[0])),
    });
    aiDecisions.push({
      label: 'arciere-vs-tank-decideAttackerDice',
      forUnit: stateTurnStart.turnOrder[0],
      output: aiDecideAttackerDice(stateTurnStart, stateTurnStart.turnOrder[0]),
    });
    aiDecisions.push({
      label: 'arciere-vs-tank-decideDefense-no-pendingAction',
      forUnit: stateTurnStart.turnOrder[1],
      output: aiDecideDefense(stateTurnStart, stateTurnStart.turnOrder[1]),
    });

    // Scenario B: spadaccino vs spadaccino in mischia, decide defense con pendingAction
    const sa = unitFromPreset(getPreset('spadaccino')!, 'A', offsetToAxial({ col: 4, row: 4 }));
    const sb = unitFromPreset(getPreset('spadaccino')!, 'B', offsetToAxial({ col: 5, row: 4 }));
    let stateMischia = createInitialState({
      units: [sa, sb],
      board: { cols: 24, rows: 18 },
      rngSeed: 31338,
    });
    stateMischia = reduce(stateMischia, { type: 'START_ROUND' });
    stateMischia = reduce(stateMischia, { type: 'START_TURN', slancioDice: 0 });
    stateMischia = reduce(stateMischia, {
      type: 'DECLARE_ATTACK',
      attackerId: stateMischia.turnOrder[0],
      targetId: stateMischia.turnOrder[1],
      weaponId: 'spada_lunga',
      attackModeIdx: 1,
      isRanged: false,
    });
    stateMischia = reduce(stateMischia, { type: 'CHOOSE_ATTACKER_DICE', diceN: 2 });

    aiDecisions.push({
      label: 'spadaccino-vs-spadaccino-decideDefense-pa-2D6',
      forUnit: stateMischia.turnOrder[1],
      output: aiDecideDefense(stateMischia, stateMischia.turnOrder[1]),
    });

    // ── Battles end-to-end ───────────────────────────────────────────────
    const battles: BattleResult[] = [];
    const matchups: Array<[string, string]> = [
      ['spadaccino', 'tank'],
      ['arciere', 'spadaccino'],
      ['tank', 'arciere'],
      ['spadaccino', 'spadaccino'],
      ['arciere', 'arciere'],
      ['tank', 'tank'],
    ];

    for (const [a, b] of matchups) {
      for (let seedOffset = 0; seedOffset < 5; seedOffset++) {
        const seed = 200000 + seedOffset * 17;
        battles.push(runBattle(a, b, seed));
      }
    }

    const out = {
      meta: { generated_by: 'tests/sim/dump_ai_battle_golden.test.ts' },
      ai_decisions: aiDecisions,
      battles,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/ai_battle_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `[dump_ai_battle_golden] wrote ${outPath} (decisions=${aiDecisions.length}, battles=${battles.length})`,
    );
  });
});

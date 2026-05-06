/**
 * Dump golden parità Utility AI + legalMoves TS↔Py (P10).
 *
 * Genera `python/tests/fixtures/utility_ai_golden.json` con:
 *   - legal_moves_states: per ogni scenario × phase, lista mosse legali (tipo+payload)
 *   - utility_decisions: per ogni scenario × phase, mossa scelta da utilityDecideMove
 *   - utility_battles: 18 battaglie complete (matchup × seed) con Utility AI da entrambi i lati
 *
 * Eseguire:
 *   DUMP_UTILITY_AI_GOLDEN=1 npx vitest run tests/sim/dump_utility_ai_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, getPreset } from '@data/presets';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';
import { legalMoves } from '@ai/legalMoves';
import { utilityDecideMove, DEFAULT_WEIGHTS, scoreMove } from '@ai/utilityAi';

function eventToJson(e: GameEvent): any {
  return JSON.parse(JSON.stringify(e));
}

function runUtilityBattle(presetA: string, presetB: string, seed: number, maxRounds = 30): any {
  const A = unitFromPreset(getPreset(presetA)!, 'A', offsetToAxial({ col: 4, row: 8 }));
  const B = unitFromPreset(getPreset(presetB)!, 'B', offsetToAxial({ col: 18, row: 8 }));
  let state = createInitialState({
    units: [A, B],
    board: { cols: 24, rows: 18 },
    rngSeed: seed,
  });
  let eventsCount = 0;
  let safety = 0;
  state = reduce(state, { type: 'START_ROUND' });
  eventsCount++;

  while (state.phase !== 'game-over' && state.round <= maxRounds && safety < 5000) {
    safety++;
    const currentUnitId = state.turnOrder[state.currentTurnIdx];

    if (state.phase === 'turn-start') {
      const move = utilityDecideMove(state, currentUnitId);
      state = reduce(state, move);
      eventsCount++;
      continue;
    }

    if (state.phase === 'choosing-action') {
      const move = utilityDecideMove(state, currentUnitId);
      state = reduce(state, move);
      eventsCount++;
      continue;
    }

    if (state.phase === 'declaring-attack') {
      const move = utilityDecideMove(state, currentUnitId);
      state = reduce(state, move);
      eventsCount++;
      continue;
    }

    if (state.phase === 'awaiting-defense') {
      const pa = state.pendingAction!;
      const move = utilityDecideMove(state, pa.targetId);
      state = reduce(state, move);
      eventsCount++;
      continue;
    }

    if (state.phase === 'resolving') {
      state = reduce(state, { type: 'RESOLVE_COMBAT' });
      eventsCount++;
      continue;
    }

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
    finalRngSeed: state.rngSeed,
    logSize: state.log.length,
  };
}

describe('dump_utility_ai_golden', () => {
  it('dumps utility AI fixtures', () => {
    if (!process.env.DUMP_UTILITY_AI_GOLDEN) return;

    // Scenari per legal moves + utility decisions
    const scenarios: any[] = [];

    function makeScenario(label: string, presetA: string, presetB: string, posA: { col: number; row: number }, posB: { col: number; row: number }, seed: number) {
      const A = unitFromPreset(getPreset(presetA)!, 'A', offsetToAxial(posA));
      const B = unitFromPreset(getPreset(presetB)!, 'B', offsetToAxial(posB));
      let state = createInitialState({
        units: [A, B],
        board: { cols: 24, rows: 18 },
        rngSeed: seed,
      });
      state = reduce(state, { type: 'START_ROUND' });
      // Catturo decisioni in due fasi: turn-start, choosing-action
      const phases: any[] = [];
      const unitIdAtStart = state.turnOrder[state.currentTurnIdx];

      const lmTurnStart = legalMoves(state, unitIdAtStart);
      const decisionTurnStart = utilityDecideMove(state, unitIdAtStart);
      phases.push({
        phase: 'turn-start',
        unit: unitIdAtStart,
        legalMoves: lmTurnStart.map(eventToJson),
        decision: eventToJson(decisionTurnStart),
        scoreOfDecision: scoreMove(state, unitIdAtStart, decisionTurnStart, DEFAULT_WEIGHTS),
      });

      // Avanza con la decisione
      state = reduce(state, decisionTurnStart);
      const lmChoosing = legalMoves(state, unitIdAtStart);
      const decisionChoosing = utilityDecideMove(state, unitIdAtStart);
      phases.push({
        phase: state.phase, // dovrebbe essere 'choosing-action'
        unit: unitIdAtStart,
        legalMoves: lmChoosing.map(eventToJson),
        decision: eventToJson(decisionChoosing),
        scoreOfDecision: scoreMove(state, unitIdAtStart, decisionChoosing, DEFAULT_WEIGHTS),
      });

      scenarios.push({
        label,
        presetA,
        presetB,
        posA,
        posB,
        seed,
        phases,
      });
    }

    makeScenario('arc-vs-tank-mid-distance', 'arciere', 'tank', { col: 4, row: 4 }, { col: 8, row: 4 }, 41001);
    makeScenario('spadaccino-adjacent', 'spadaccino', 'tank', { col: 4, row: 4 }, { col: 5, row: 4 }, 41002);
    makeScenario('tank-vs-arciere-far', 'tank', 'arciere', { col: 4, row: 4 }, { col: 12, row: 4 }, 41003);

    // Battaglie complete con Utility AI
    const battles: any[] = [];
    const matchups: Array<[string, string]> = [
      ['spadaccino', 'tank'],
      ['arciere', 'spadaccino'],
      ['tank', 'arciere'],
    ];
    for (const [a, b] of matchups) {
      for (let seedOff = 0; seedOff < 6; seedOff++) {
        const seed = 300000 + seedOff * 23;
        battles.push(runUtilityBattle(a, b, seed));
      }
    }

    const out = {
      meta: { generated_by: 'tests/sim/dump_utility_ai_golden.test.ts' },
      scenarios,
      battles,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/utility_ai_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `[dump_utility_ai_golden] wrote ${outPath} (${scenarios.length} scenarios, ${battles.length} battles)`,
    );
  });
});

/**
 * Dump golden parità turn + round TS↔Py (P6).
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, getPreset } from '@data/presets';
import { createRng } from '@/utils/rng';
import {
  applyTurnStart,
  applyInitialSlancio,
  applySlancioPenalty,
  computeDiceRecovery,
  getMaxSlancioRoll,
} from '@core/turn';
import { computeTurnOrder, checkGameOver } from '@core/round';
import { Unit } from '@entities/Unit';

function unitSnapshot(u: Unit) {
  return {
    id: u.id,
    hp: u.hp,
    impeto: u.impeto,
    slancio: u.slancio,
    dadiAzione: u.dadiAzione,
    alive: u.alive,
    hexMovedThisTurn: u.hexMovedThisTurn,
    actionTakenThisTurn: u.actionTakenThisTurn,
  };
}

describe('dump_turn_round_golden', () => {
  it('dumps turn + round fixtures', () => {
    if (!process.env.DUMP_TURN_ROUND_GOLDEN) return;

    const pos = offsetToAxial({ col: 0, row: 0 });

    // ── max slancio roll + dice recovery (per ciascun preset) ────────────
    const presetStats: Array<any> = [];
    for (const presetId of ['spadaccino', 'arciere', 'tank']) {
      const u = unitFromPreset(getPreset(presetId)!, 'A', pos);
      presetStats.push({
        presetId,
        maxSlancioRoll: getMaxSlancioRoll(u),
        diceRecoveryNormal: computeDiceRecovery(u),
        diceRecoveryImpetoZero: computeDiceRecovery({ ...u, impeto: 0 }),
      });
    }

    // ── apply_initial_slancio (D-045) per ciascun preset ─────────────────
    const initialSlancio: Array<any> = [];
    for (let seedOffset = 0; seedOffset < 5; seedOffset++) {
      for (const presetId of ['spadaccino', 'arciere', 'tank']) {
        const u = unitFromPreset(getPreset(presetId)!, 'A', pos);
        const seed = 50000 + seedOffset * 10;
        const rng = createRng(seed);
        const after = applyInitialSlancio(u, rng);
        initialSlancio.push({
          presetId,
          seed,
          slancioAfter: after.slancio,
          finalRngState: rng.getState(),
        });
      }
    }

    // ── apply_turn_start (varie diceN, vari impetoToSlancio) ─────────────
    const turnStart: Array<any> = [];
    let scenarioIdx = 0;
    for (const presetId of ['spadaccino', 'arciere', 'tank']) {
      for (const slancioDiceN of [0, 1, 2, 3]) {
        for (const impetoToSlancio of [0, 5]) {
          const u = unitFromPreset(getPreset(presetId)!, 'A', pos);
          // Setup: simula stato a metà partita (impeto e slancio non default)
          u.slancio = 4;
          u.impeto = 12;
          u.dadiAzione = 3;
          const seed = 70000 + scenarioIdx * 7;
          const rng = createRng(seed);
          const after = applyTurnStart(u, slancioDiceN, rng, impetoToSlancio);
          turnStart.push({
            idx: scenarioIdx,
            presetId,
            slancioDiceN,
            impetoToSlancio,
            seed,
            input: { impeto: u.impeto, slancio: u.slancio, dadiAzione: u.dadiAzione },
            output: unitSnapshot(after),
            finalRngState: rng.getState(),
          });
          scenarioIdx++;
        }
      }
    }

    // ── apply_slancio_penalty ────────────────────────────────────────────
    const slancioPenalty: Array<any> = [];
    for (const startSlancio of [0, 3, 8]) {
      for (const startImpeto of [10, 14, 20]) {
        for (const penalty of [0, 2, 5, 10]) {
          const u = unitFromPreset(getPreset('tank')!, 'A', pos);
          u.slancio = startSlancio;
          u.impeto = startImpeto;
          const after = applySlancioPenalty(u, penalty);
          slancioPenalty.push({
            startSlancio,
            startImpeto,
            penalty,
            slancioAfter: after.slancio,
            impetoAfter: after.impeto,
          });
        }
      }
    }

    // ── compute_turn_order ───────────────────────────────────────────────
    // Scenari con impeti/slanci differenti, anche con tie su impeto.
    const turnOrder: Array<any> = [];
    function makeUnits(specs: Array<{ id: string; faction: 'A' | 'B'; impeto: number; slancio: number; alive?: boolean }>) {
      const units: Record<string, Unit> = {};
      for (const s of specs) {
        const u = unitFromPreset(getPreset('spadaccino')!, s.faction, pos);
        u.id = s.id;
        u.impeto = s.impeto;
        u.slancio = s.slancio;
        if (s.alive === false) {
          u.alive = false;
          u.hp = 0;
        }
        units[s.id] = u;
      }
      return units;
    }

    const orderCases = [
      {
        label: 'distinct-impetos',
        units: makeUnits([
          { id: 'A1', faction: 'A', impeto: 14, slancio: 0 },
          { id: 'B1', faction: 'B', impeto: 16, slancio: 3 },
        ]),
        seed: 88000,
      },
      {
        label: 'tie-impeto-distinct-slancio',
        units: makeUnits([
          { id: 'A1', faction: 'A', impeto: 14, slancio: 5 },
          { id: 'B1', faction: 'B', impeto: 14, slancio: 2 },
        ]),
        seed: 88001,
      },
      {
        label: 'full-tie-rng-decides',
        units: makeUnits([
          { id: 'A1', faction: 'A', impeto: 14, slancio: 0 },
          { id: 'B1', faction: 'B', impeto: 14, slancio: 0 },
        ]),
        seed: 88002,
      },
      {
        label: 'with-dead-unit-skipped',
        units: makeUnits([
          { id: 'A1', faction: 'A', impeto: 14, slancio: 5 },
          { id: 'A2', faction: 'A', impeto: 20, slancio: 0, alive: false },
          { id: 'B1', faction: 'B', impeto: 16, slancio: 0 },
        ]),
        seed: 88003,
      },
    ];

    for (const c of orderCases) {
      const rng = createRng(c.seed);
      const order = computeTurnOrder(c.units, rng);
      turnOrder.push({
        label: c.label,
        seed: c.seed,
        unitInputs: Object.values(c.units).map((u) => ({
          id: u.id,
          faction: u.faction,
          impeto: u.impeto,
          slancio: u.slancio,
          alive: u.alive,
        })),
        order,
        finalRngState: rng.getState(),
      });
    }

    // ── check_game_over ──────────────────────────────────────────────────
    const gameOver: Array<any> = [];
    function gameOverCase(label: string, specs: Array<{ id: string; faction: 'A' | 'B'; alive: boolean }>) {
      const units: Record<string, Unit> = {};
      for (const s of specs) {
        const u = unitFromPreset(getPreset('spadaccino')!, s.faction, pos);
        u.id = s.id;
        if (!s.alive) {
          u.alive = false;
          u.hp = 0;
        }
        units[s.id] = u;
      }
      gameOver.push({ label, result: checkGameOver(units) });
    }
    gameOverCase('both-alive', [
      { id: 'A1', faction: 'A', alive: true },
      { id: 'B1', faction: 'B', alive: true },
    ]);
    gameOverCase('A-wins', [
      { id: 'A1', faction: 'A', alive: true },
      { id: 'B1', faction: 'B', alive: false },
    ]);
    gameOverCase('B-wins', [
      { id: 'A1', faction: 'A', alive: false },
      { id: 'B1', faction: 'B', alive: true },
    ]);
    gameOverCase('all-dead-draw', [
      { id: 'A1', faction: 'A', alive: false },
      { id: 'B1', faction: 'B', alive: false },
    ]);

    const out = {
      meta: { generated_by: 'tests/sim/dump_turn_round_golden.test.ts' },
      preset_stats: presetStats,
      initial_slancio: initialSlancio,
      turn_start: turnStart,
      slancio_penalty: slancioPenalty,
      turn_order: turnOrder,
      game_over: gameOver,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/turn_round_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[dump_turn_round_golden] wrote ${outPath}`);
  });
});

/**
 * Dump golden parità hex per il port Python (P1 — python/TODO.md).
 *
 * Genera `python/tests/fixtures/hex_golden.json` con:
 *   - 50 pair (q,r) random via Mulberry32 seed=42, q∈[-20,20], r∈[-20,20], + hexDistance attesa
 *   - 20 line (subset dei primi 20 pair) con il path completo atteso (hexLine)
 *
 * Eseguire con:
 *   DUMP_HEX_GOLDEN=1 npx vitest run tests/sim/dump_hex_golden.test.ts
 *
 * Senza la env, il test no-op (skipped). Questo è solo un runner di dump,
 * non un test di regressione: l'eseguibile vero è `python/tests/test_hex.py`
 * che legge il JSON prodotto qui e verifica la parità Py↔TS.
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRng } from '@/utils/rng';
import { hexDistance } from '@core/hex/distance';
import { hexLine } from '@core/hex/line';

describe('dump_hex_golden', () => {
  it('dumps hex golden JSON for Py parity', () => {
    if (!process.env.DUMP_HEX_GOLDEN) {
      // No-op in normal runs.
      return;
    }

    const rng = createRng(42);
    const N_PAIRS = 50;
    const N_LINES = 20;
    const RANGE = 20; // q,r ∈ [-20, 20]

    const pairs: Array<{
      a: { q: number; r: number };
      b: { q: number; r: number };
      distance: number;
    }> = [];

    for (let i = 0; i < N_PAIRS; i++) {
      const a = { q: rng.nextInt(-RANGE, RANGE), r: rng.nextInt(-RANGE, RANGE) };
      const b = { q: rng.nextInt(-RANGE, RANGE), r: rng.nextInt(-RANGE, RANGE) };
      pairs.push({ a, b, distance: hexDistance(a, b) });
    }

    const lines: Array<{
      a: { q: number; r: number };
      b: { q: number; r: number };
      path: Array<{ q: number; r: number }>;
    }> = [];

    for (let i = 0; i < N_LINES; i++) {
      const { a, b } = pairs[i];
      lines.push({ a, b, path: hexLine(a, b) });
    }

    const out = {
      meta: {
        seed: 42,
        n_pairs: N_PAIRS,
        n_lines: N_LINES,
        range: RANGE,
        rng: 'Mulberry32',
        generated_by: 'tests/sim/dump_hex_golden.test.ts',
      },
      pairs,
      lines,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/hex_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[dump_hex_golden] wrote ${outPath} (${N_PAIRS} pairs, ${N_LINES} lines)`);
  });
});

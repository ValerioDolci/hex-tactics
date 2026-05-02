/**
 * Dump golden parità ranged + LoS TS↔Py (P5).
 *
 * Genera `python/tests/fixtures/ranged_golden.json` con:
 *   - LoS scenarios: posizioni varie atk/target ± unità bloccanti
 *   - canFireRanged: archi/balestre/giavellotti/lance con var distanze
 *   - composeRangedAttackRoll: arciere + balestriere vs target a varie distanze (D-042/D-043)
 *
 * Eseguire:
 *   DUMP_RANGED_GOLDEN=1 npx vitest run tests/sim/dump_ranged_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, PRESETS, getPreset } from '@data/presets';
import { createRng } from '@/utils/rng';
import { computeLoS, canFireRanged, composeRangedAttackRoll } from '@core/ranged';
import { Unit } from '@entities/Unit';
import { Stat } from '@entities/Equipment';

function rollToJson(r: { variable: number[]; fixed: number }) {
  return { variable: r.variable.slice(), fixed: r.fixed };
}

describe('dump_ranged_golden', () => {
  it('dumps ranged fixtures', () => {
    if (!process.env.DUMP_RANGED_GOLDEN) return;

    // ── LoS scenarios ────────────────────────────────────────────────────
    const losScenarios: Array<any> = [];

    function losCase(
      label: string,
      attackerPos: { col: number; row: number },
      targetPos: { col: number; row: number },
      blockerPositions: Array<{ col: number; row: number }>,
    ) {
      const arciere = getPreset('arciere')!;
      const tank = getPreset('tank')!;
      const atk = unitFromPreset(arciere, 'A', offsetToAxial(attackerPos));
      atk.id = 'atk';
      const tgt = unitFromPreset(tank, 'B', offsetToAxial(targetPos));
      tgt.id = 'tgt';
      const units: Record<string, Unit> = { atk, tgt };
      blockerPositions.forEach((bp, i) => {
        const blocker = unitFromPreset(arciere, 'A', offsetToAxial(bp));
        blocker.id = `blocker-${i}`;
        units[blocker.id] = blocker;
      });
      const los = computeLoS(atk, tgt, units);
      losScenarios.push({
        label,
        attackerPos,
        targetPos,
        blockerPositions,
        fromHex: { q: los.fromHex.q, r: los.fromHex.r },
        visibility: los.visibility,
        distance: los.distance,
      });
    }

    losCase('clear-line-far', { col: 0, row: 0 }, { col: 10, row: 0 }, []);
    losCase('clear-line-mid', { col: 0, row: 0 }, { col: 5, row: 5 }, []);
    losCase('blocker-mid', { col: 0, row: 0 }, { col: 10, row: 0 }, [{ col: 5, row: 0 }]);
    losCase('blocker-near-atk', { col: 0, row: 0 }, { col: 8, row: 0 }, [{ col: 4, row: 0 }]);
    losCase('blocker-multiple', { col: 0, row: 0 }, { col: 8, row: 0 }, [
      { col: 4, row: 0 },
      { col: 6, row: 1 },
    ]);
    losCase('adjacent', { col: 0, row: 0 }, { col: 3, row: 0 }, []); // basette si sovrappongono

    // ── canFireRanged ────────────────────────────────────────────────────
    const canFireScenarios: Array<any> = [];

    function canFireCase(
      label: string,
      atkPreset: string,
      weapon: string,
      attackerPos: { col: number; row: number },
      targetPos: { col: number; row: number },
      blockerPositions: Array<{ col: number; row: number }> = [],
      weaponLoaded = true,
    ) {
      const atk = unitFromPreset(getPreset(atkPreset)!, 'A', offsetToAxial(attackerPos));
      atk.id = 'atk';
      atk.weapon = weapon;
      atk.weaponLoaded = weaponLoaded;
      const tgt = unitFromPreset(getPreset('tank')!, 'B', offsetToAxial(targetPos));
      tgt.id = 'tgt';
      const units: Record<string, Unit> = { atk, tgt };
      blockerPositions.forEach((bp, i) => {
        const blocker = unitFromPreset(getPreset('arciere')!, 'A', offsetToAxial(bp));
        blocker.id = `blocker-${i}`;
        units[blocker.id] = blocker;
      });
      const r = canFireRanged(atk, tgt, weapon, units);
      canFireScenarios.push({
        label,
        atkPreset,
        weapon,
        attackerPos,
        targetPos,
        blockerPositions,
        weaponLoaded,
        ok: r.ok,
        reason: r.reason ?? null,
        los: r.los
          ? { fromHex: { q: r.los.fromHex.q, r: r.los.fromHex.r }, visibility: r.los.visibility, distance: r.los.distance }
          : null,
      });
    }

    canFireCase('arco-lungo-in-range', 'arciere', 'arco_lungo', { col: 0, row: 0 }, { col: 7, row: 0 });
    canFireCase('arco-lungo-out-of-range', 'arciere', 'arco_lungo', { col: 0, row: 0 }, { col: 12, row: 0 });
    canFireCase('arco-lungo-blocked', 'arciere', 'arco_lungo', { col: 0, row: 0 }, { col: 7, row: 0 }, [
      { col: 4, row: 0 },
    ]);
    canFireCase('balestra-loaded', 'tank', 'balestra', { col: 0, row: 0 }, { col: 5, row: 0 }, [], true);
    canFireCase('balestra-unloaded', 'tank', 'balestra', { col: 0, row: 0 }, { col: 5, row: 0 }, [], false);
    canFireCase('mazza-non-ranged', 'tank', 'mazza', { col: 0, row: 0 }, { col: 5, row: 0 });
    canFireCase('giavellotto-throw', 'spadaccino', 'giavellotto', { col: 0, row: 0 }, { col: 5, row: 0 });

    // ── composeRangedAttackRoll ──────────────────────────────────────────
    const rangedAttackScenarios: Array<any> = [];
    let scenarioIdx = 0;

    const arciere = getPreset('arciere')!;
    const spadaccino = getPreset('spadaccino')!;
    const tank = getPreset('tank')!;

    for (const targetPos of [{ col: 5, row: 0 }, { col: 8, row: 0 }, { col: 10, row: 0 }]) {
      for (const targetPreset of [tank, arciere, spadaccino]) {
        for (const targetSlancio of [0, 3, 6]) {
          const atk = unitFromPreset(arciere, 'A', offsetToAxial({ col: 0, row: 0 }));
          atk.id = 'atk';
          const tgt = unitFromPreset(targetPreset, 'B', offsetToAxial(targetPos));
          tgt.id = 'tgt';
          tgt.slancio = targetSlancio;
          const units: Record<string, Unit> = { atk, tgt };
          const check = canFireRanged(atk, tgt, atk.weapon!, units);
          if (!check.ok || !check.los) continue;
          const seed = 999000 + scenarioIdx;
          const rng = createRng(seed);
          const roll = composeRangedAttackRoll(
            atk,
            atk.weapon!,
            0,
            undefined,
            2,
            tgt,
            check.los,
            rng,
          );
          rangedAttackScenarios.push({
            idx: scenarioIdx,
            atkPreset: atk.presetId,
            weapon: atk.weapon,
            targetPreset: targetPreset.id,
            targetPos,
            targetSlancio,
            visibility: check.los.visibility,
            distance: check.los.distance,
            seed,
            diceN: 2,
            roll: rollToJson(roll),
          });
          scenarioIdx++;
        }
      }
    }

    const out = {
      meta: { generated_by: 'tests/sim/dump_ranged_golden.test.ts' },
      los: losScenarios,
      can_fire: canFireScenarios,
      ranged_attack: rangedAttackScenarios,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/ranged_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `[dump_ranged_golden] wrote ${outPath} (los=${losScenarios.length}, can_fire=${canFireScenarios.length}, ranged_attack=${rangedAttackScenarios.length})`,
    );
  });
});

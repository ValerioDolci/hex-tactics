/**
 * Dump golden parità combat math TS↔Py (P4).
 *
 * Genera `python/tests/fixtures/combat_golden.json` con scenari deterministici:
 *   - compose_attack_roll: per ogni preset × diceN ∈ {1,2} × stat scelta
 *     (anche edge case D-047 spada: 2 dadi → bonus dual-stat)
 *   - compose_dodge_roll: per ogni preset × diceN ∈ {1,2}
 *   - compose_parry_roll: per i preset con parry (weapon+offhand combinati)
 *   - resolve_dodge / parry / no_defense: input statici → output atteso
 *   - apply_damage_with_armor: matrice (raw, armor) → effective+newHp
 *   - sequence test: alcune chiamate consecutive con stesso RNG (catch errori di ordine)
 *
 * Eseguire con:
 *   DUMP_COMBAT_GOLDEN=1 npx vitest run tests/sim/dump_combat_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, PRESETS } from '@data/presets';
import { createRng } from '@/utils/rng';
import {
  composeAttackRoll,
  composeDodgeRoll,
  composeParryRoll,
  resolveDodge,
  resolveParry,
  resolveNoDefense,
  applyDamageWithArmor,
} from '@core/combat';
import { getWeapon } from '@data/weapons';
import { Stat } from '@entities/Equipment';

function rollToJson(r: { variable: number[]; fixed: number } | null) {
  if (!r) return null;
  return { variable: r.variable.slice(), fixed: r.fixed };
}

describe('dump_combat_golden', () => {
  it('dumps combat fixtures', () => {
    if (!process.env.DUMP_COMBAT_GOLDEN) return;

    const pos = offsetToAxial({ col: 0, row: 0 });
    const SEED = 12345;

    // ── compose_attack_roll ──────────────────────────────────────────────
    const attackScenarios: Array<any> = [];
    let scenarioIdx = 0;

    for (const preset of PRESETS) {
      const u = unitFromPreset(preset, 'A', pos);
      if (!u.weapon) continue;
      const weapon = getWeapon(u.weapon)!;
      for (let modeIdx = 0; modeIdx < weapon.attackModes.length; modeIdx++) {
        const mode = weapon.attackModes[modeIdx];
        const stats: Array<Stat | undefined> =
          mode.stat === 'either' ? [undefined, 'forza', 'agilità'] : [mode.stat];
        for (const stat of stats) {
          for (const diceN of [1, 2, 3]) {
            const rng = createRng(SEED + scenarioIdx);
            const roll = composeAttackRoll(u, u.weapon, modeIdx, stat as Stat | undefined, diceN, rng);
            attackScenarios.push({
              idx: scenarioIdx,
              presetId: preset.id,
              weaponId: u.weapon,
              attackModeIdx: modeIdx,
              modeStat: mode.stat,
              modeLabel: mode.label,
              chosenStat: stat ?? null,
              diceN,
              seed: SEED + scenarioIdx,
              roll: rollToJson(roll),
            });
            scenarioIdx++;
          }
        }
      }
    }

    // ── compose_dodge_roll ───────────────────────────────────────────────
    const dodgeScenarios: Array<any> = [];
    for (const preset of PRESETS) {
      const u = unitFromPreset(preset, 'A', pos);
      for (const diceN of [1, 2, 3]) {
        const rng = createRng(SEED + scenarioIdx);
        const roll = composeDodgeRoll(u, diceN, rng);
        dodgeScenarios.push({
          idx: scenarioIdx,
          presetId: preset.id,
          diceN,
          seed: SEED + scenarioIdx,
          roll: rollToJson(roll),
        });
        scenarioIdx++;
      }
    }

    // ── compose_parry_roll ───────────────────────────────────────────────
    const parryScenarios: Array<any> = [];
    for (const preset of PRESETS) {
      const u = unitFromPreset(preset, 'A', pos);
      for (const parryWith of ['weapon', 'offhand'] as const) {
        for (const diceN of [1, 2]) {
          const rng = createRng(SEED + scenarioIdx);
          const roll = composeParryRoll(u, parryWith, diceN, rng);
          parryScenarios.push({
            idx: scenarioIdx,
            presetId: preset.id,
            parryWith,
            diceN,
            seed: SEED + scenarioIdx,
            roll: rollToJson(roll),
          });
          scenarioIdx++;
        }
      }
    }

    // ── resolve_dodge / parry / no_defense ───────────────────────────────
    const resolveCases: Array<any> = [];
    const sample = [
      { atk: { variable: [3, 5], fixed: 4 }, def: { variable: [4, 6], fixed: 2 } }, // dodge: var(8) - tot(12) = -4 → miss, slancio pen 4
      { atk: { variable: [6, 6], fixed: 4 }, def: { variable: [1, 1], fixed: 2 } }, // dodge: var(12) - tot(4) = 8 → hit, dmg 8+4=12
      { atk: { variable: [3, 3], fixed: 2 }, def: { variable: [3, 3], fixed: 2 } }, // dodge: 6-8=-2 → miss
      { atk: { variable: [5], fixed: 9 }, def: { variable: [], fixed: 5 } }, // parry: 14-5=9 → hit
      { atk: { variable: [1, 2], fixed: 0 }, def: { variable: [3, 4], fixed: 6 } }, // parry: 3-13=-10 → miss
    ];
    for (let i = 0; i < sample.length; i++) {
      const s = sample[i];
      const rDodge = resolveDodge(s.atk, s.def);
      const rParry = resolveParry(s.atk, s.def);
      const rNo = resolveNoDefense(s.atk);
      resolveCases.push({
        idx: i,
        atk: s.atk,
        def: s.def,
        dodge: { hit: rDodge.hit, rawDamage: rDodge.rawDamage, slancioPenalty: rDodge.slancioPenaltyToAttacker },
        parry: { hit: rParry.hit, rawDamage: rParry.rawDamage, slancioPenalty: rParry.slancioPenaltyToAttacker },
        noDefense: { hit: rNo.hit, rawDamage: rNo.rawDamage, slancioPenalty: rNo.slancioPenaltyToAttacker },
      });
    }

    // ── apply_damage_with_armor ──────────────────────────────────────────
    const damageCases: Array<any> = [];
    const targets = [
      { name: 'no-armor', armor: undefined },
      { name: 'leg-armor', armor: 'armatura_leggera' }, // RD 3
      { name: 'med-armor', armor: 'armatura_media' }, // RD 6
      { name: 'pes-armor', armor: 'armatura_pesante' }, // RD 9
    ];
    for (const t of targets) {
      const u = unitFromPreset(PRESETS[0], 'A', pos);
      u.armor = t.armor;
      u.hp = 20;
      for (const raw of [0, 1, 5, 9, 10, 15, 25]) {
        const r = applyDamageWithArmor(u, raw);
        damageCases.push({
          target: t.name,
          armor: t.armor ?? null,
          startHp: u.hp,
          raw,
          effectiveDamage: r.effectiveDamage,
          newHp: r.newHp,
        });
      }
    }

    // ── sequence test (RNG ordering) ─────────────────────────────────────
    // Stesso RNG, due chiamate consecutive: compose_attack + compose_dodge.
    // Verifica che il porting Py consumi i dadi nello stesso ordine del TS.
    const seqRng = createRng(SEED + 999);
    const u_atk = unitFromPreset(PRESETS[0], 'A', pos);
    const u_def = unitFromPreset(PRESETS[2], 'B', pos);
    const seq_atk = composeAttackRoll(u_atk, u_atk.weapon!, 0, undefined, 2, seqRng);
    const seq_dodge = composeDodgeRoll(u_def, 2, seqRng);
    const seq_parry = composeParryRoll(u_def, 'offhand', 1, seqRng);
    const sequence = {
      seed: SEED + 999,
      atkPreset: PRESETS[0].id,
      defPreset: PRESETS[2].id,
      atkRoll: rollToJson(seq_atk),
      dodgeRoll: rollToJson(seq_dodge),
      parryRoll: rollToJson(seq_parry),
      finalRngState: seqRng.getState(),
    };

    const out = {
      meta: {
        generated_by: 'tests/sim/dump_combat_golden.test.ts',
        seed: SEED,
      },
      attack: attackScenarios,
      dodge: dodgeScenarios,
      parry: parryScenarios,
      resolve: resolveCases,
      damage: damageCases,
      sequence,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/combat_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      `[dump_combat_golden] wrote ${outPath} (atk=${attackScenarios.length}, dodge=${dodgeScenarios.length}, parry=${parryScenarios.length})`,
    );
  });
});

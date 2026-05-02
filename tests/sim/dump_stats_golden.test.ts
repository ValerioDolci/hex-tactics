/**
 * Dump golden parità stats (impedimento + skill match) per il port Python (P3).
 *
 * Genera `python/tests/fixtures/stats_golden.json` con:
 *   - per ogni preset: imp totale + scomposizione per pezzo + bonus skill nei contesti standard
 *   - matrice 4×3 di valori: per ogni preset, count_flat_bonuses/count_forced/count_max
 *     in 4 contesti: attacco arma principale, parry offhand (se applicabile), dodge, slancio
 *
 * Eseguire con:
 *   DUMP_STATS_GOLDEN=1 npx vitest run tests/sim/dump_stats_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { offsetToAxial } from '@core/hex/coords';
import { unitFromPreset, PRESETS } from '@data/presets';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import {
  getImpedimentTotal,
  countFlatBonuses,
  countForcedExtraDice,
  countMaxDiceExtra,
  makeAttackContext,
  makeParryContext,
  makeDodgeContext,
  makeSlancioContext,
} from '@core/stats';
import { RollContext } from '@entities/Skill';

describe('dump_stats_golden', () => {
  it('dumps stats fixtures', () => {
    if (!process.env.DUMP_STATS_GOLDEN) return;

    const presets: Array<any> = [];
    for (const p of PRESETS) {
      const u = unitFromPreset(p, 'A', offsetToAxial({ col: 0, row: 0 }));

      // Per-piece breakdown (per debug se diverge)
      const pieces: Array<{ id: string; category: string; impediment: number; reduction: number }> = [];
      const weapon = u.weapon ? getWeapon(u.weapon) : undefined;
      const offW = u.offhand ? getWeapon(u.offhand) : undefined;
      const offS = u.offhand ? getShield(u.offhand) : undefined;
      const armor = u.armor ? getArmor(u.armor) : undefined;

      const sumLvl = (mod: string, predicate: (s: any) => boolean) =>
        u.skills.filter((s) => s.modifier === mod && predicate(s)).reduce((sum, s) => sum + (s.level ?? 1), 0);

      if (weapon) {
        const red = sumLvl('-1impedimento', (s) =>
          (!s.classeOggetto || s.classeOggetto === weapon.category) &&
          (!s.oggettoSpecifico || s.oggettoSpecifico === weapon.id),
        );
        pieces.push({ id: weapon.id, category: weapon.category, impediment: weapon.impediment, reduction: red });
      }
      if (offW) {
        const red = sumLvl('-1impedimento', (s) =>
          (!s.classeOggetto || s.classeOggetto === offW.category) &&
          (!s.oggettoSpecifico || s.oggettoSpecifico === offW.id),
        );
        pieces.push({ id: offW.id, category: offW.category, impediment: offW.impediment, reduction: red });
      } else if (offS) {
        const red = sumLvl('-1impedimento', (s) =>
          (!s.classeOggetto || s.classeOggetto === offS.category) &&
          (!s.oggettoSpecifico || s.oggettoSpecifico === offS.id),
        );
        pieces.push({ id: offS.id, category: offS.category, impediment: offS.impediment, reduction: red });
      }
      if (armor) {
        const red = sumLvl('-1impedimento', (s) =>
          (!s.classeOggetto || s.classeOggetto === armor.category) &&
          (!s.oggettoSpecifico || s.oggettoSpecifico === armor.id),
        );
        pieces.push({ id: armor.id, category: armor.category, impediment: armor.impediment, reduction: red });
      }

      // Contexts
      const ctxAttack: RollContext | null = weapon
        ? makeAttackContext(weapon.id, weapon.category, undefined)
        : null;
      const ctxParry: RollContext | null = offS
        ? makeParryContext(offS.id, offS.category)
        : weapon && weapon.parry
        ? makeParryContext(weapon.id, weapon.category)
        : null;
      const ctxDodge = makeDodgeContext();
      const ctxSlancio = makeSlancioContext();

      const ctxBonuses = (ctx: RollContext | null) => {
        if (!ctx) return null;
        return {
          ctx: {
            azione: ctx.azione,
            stat: ctx.stat ?? null,
            classeOggetto: ctx.classeOggetto ?? null,
            oggettoSpecifico: ctx.oggettoSpecifico ?? null,
          },
          flat: countFlatBonuses(u.skills, ctx),
          forced: countForcedExtraDice(u.skills, ctx),
          maxExtra: countMaxDiceExtra(u.skills, ctx),
        };
      };

      presets.push({
        id: p.id,
        impedimentTotal: getImpedimentTotal(u),
        pieces,
        attack: ctxBonuses(ctxAttack),
        parry: ctxBonuses(ctxParry),
        dodge: ctxBonuses(ctxDodge),
        slancio: ctxBonuses(ctxSlancio),
      });
    }

    const out = {
      meta: { generated_by: 'tests/sim/dump_stats_golden.test.ts' },
      presets,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/stats_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[dump_stats_golden] wrote ${outPath}`);
  });
});

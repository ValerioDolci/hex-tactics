/**
 * Dump golden parità data + skill costs per il port Python (P2).
 *
 * Genera `python/tests/fixtures/data_golden.json` con:
 *   - WEAPONS, SHIELDS, ARMORS (record completo)
 *   - SKILL_COSTS, MODIFIER_LABELS, SKILL_ABILITA, SKILL_AZIONI, SKILL_CLASSI_OGGETTO
 *   - PRESETS (3 preset post-D-046) con skills complete
 *   - cost_check: per ogni skill di ogni preset, computeSkillCost(modifier, level, specCount)
 *
 * Eseguire con:
 *   DUMP_DATA_GOLDEN=1 npx vitest run tests/sim/dump_data_golden.test.ts
 */

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { WEAPONS } from '@data/weapons';
import { SHIELDS } from '@data/shields';
import { ARMORS } from '@data/armors';
import {
  SKILL_COSTS,
  MODIFIER_LABELS,
  SKILL_ABILITA,
  SKILL_AZIONI,
  SKILL_CLASSI_OGGETTO,
  WEAPON_CATEGORIES,
  REFERENCE_PG_EXP,
} from '@data/skills';
import { PRESETS } from '@data/presets';
import { computeSkillCost, countSpecializations, skillKey, validateSkillSet } from '@entities/Skill';

describe('dump_data_golden', () => {
  it('dumps data + skill costs JSON for Py parity', () => {
    if (!process.env.DUMP_DATA_GOLDEN) return;

    // Cost check: per ogni preset, valida ogni skill (chiama computeSkillCost)
    // e dichiara il totale che il Py deve riprodurre.
    const presetCostChecks = PRESETS.map((p) => {
      const validation = validateSkillSet(
        p.skills.map((s, i) => ({ ...s, id: `dump-${p.id}-${i}` })),
      );
      const skillRows = p.skills.map((s) => ({
        modifier: s.modifier,
        level: s.level,
        specCount: countSpecializations(s),
        expectedCost: computeSkillCost(s.modifier, s.level, countSpecializations(s)),
        declaredCost: s.cost,
        key: skillKey(s),
      }));
      return {
        presetId: p.id,
        totalCost: validation.totalCost,
        valid: validation.valid,
        errors: validation.errors,
        skills: skillRows,
      };
    });

    // Casi sintetici aggiuntivi per il cost calculator (D-046).
    // Coprono level 1..6 × specCount 0..4 per tutti i 4 modifiers.
    const costGrid: Array<{
      modifier: string;
      level: number;
      specCount: number;
      cost: number;
    }> = [];
    const modifiers = ['-1impedimento', '+1tiro', '+1dado', '+1dadomax'] as const;
    for (const m of modifiers) {
      for (let lv = 1; lv <= 6; lv++) {
        for (let sc = 0; sc <= 4; sc++) {
          costGrid.push({ modifier: m, level: lv, specCount: sc, cost: computeSkillCost(m, lv, sc) });
        }
      }
    }

    const out = {
      meta: {
        generated_by: 'tests/sim/dump_data_golden.test.ts',
        reference_pg_exp: REFERENCE_PG_EXP,
      },
      weapons: WEAPONS,
      shields: SHIELDS,
      armors: ARMORS,
      skill_costs: SKILL_COSTS,
      modifier_labels: MODIFIER_LABELS,
      skill_abilita: SKILL_ABILITA,
      skill_azioni: SKILL_AZIONI,
      skill_classi_oggetto: SKILL_CLASSI_OGGETTO,
      weapon_categories: WEAPON_CATEGORIES,
      presets: PRESETS,
      preset_cost_checks: presetCostChecks,
      cost_grid: costGrid,
    };

    const outPath = resolve(__dirname, '../../python/tests/fixtures/data_golden.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`[dump_data_golden] wrote ${outPath}`);
  });
});

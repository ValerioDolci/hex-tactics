import { describe, it, expect } from 'vitest';
import { createBaselineUnit } from '@entities/Unit';
import { AcquiredSkill } from '@entities/Skill';
import {
  getImpedimentTotal,
  countFlatBonuses,
  countForcedExtraDice,
  countMaxDiceExtra,
  getDiceChoiceRange,
  getActualDiceCount,
  makeAttackContext,
  makeDodgeContext,
} from '@core/stats';

function nakedUnit() {
  return createBaselineUnit({ id: 'u', name: 'X', faction: 'A', position: { q: 0, r: 0 } });
}

function skill(partial: Partial<AcquiredSkill>): AcquiredSkill {
  return {
    id: 's',
    modifier: '+1tiro',
    level: 1,
    cost: 600,
    ...partial,
  };
}

describe('getImpedimentTotal', () => {
  it('naked PG = 0', () => {
    expect(getImpedimentTotal(nakedUnit())).toBe(0);
  });

  it('spada (imp 3) = 3', () => {
    const u = nakedUnit();
    u.weapon = 'spada';
    expect(getImpedimentTotal(u)).toBe(3);
  });

  it('spada + scudo medio (3+6) = 9', () => {
    const u = nakedUnit();
    u.weapon = 'spada';
    u.offhand = 'scudo_medio';
    expect(getImpedimentTotal(u)).toBe(9);
  });

  it('spada + armatura pesante (3+9) = 12', () => {
    const u = nakedUnit();
    u.weapon = 'spada';
    u.armor = 'armatura_pesante';
    expect(getImpedimentTotal(u)).toBe(12);
  });

  it('-1 impedimento generico applica a tutti i pezzi', () => {
    const u = nakedUnit();
    u.weapon = 'spada'; // 3
    u.offhand = 'scudo_medio'; // 6
    u.armor = 'armatura_pesante'; // 9
    u.skills = [skill({ modifier: '-1impedimento' })];
    // 2 + 5 + 8 = 15
    expect(getImpedimentTotal(u)).toBe(15);
  });

  it('-1 impedimento [armature] applica solo all\'armatura', () => {
    const u = nakedUnit();
    u.weapon = 'spada'; // 3
    u.armor = 'armatura_pesante'; // 9
    u.skills = [skill({ modifier: '-1impedimento', classeOggetto: 'armature' })];
    // 3 + 8 = 11
    expect(getImpedimentTotal(u)).toBe(11);
  });

  it('-1 impedimento [oggettoSpecifico] applica solo a quello', () => {
    const u = nakedUnit();
    u.weapon = 'spada'; // 3
    u.armor = 'armatura_pesante'; // 9
    u.skills = [skill({ modifier: '-1impedimento', oggettoSpecifico: 'spada' })];
    // 2 + 9 = 11
    expect(getImpedimentTotal(u)).toBe(11);
  });

  it('-1 impedimento cumulativo (3 acquisti)', () => {
    const u = nakedUnit();
    u.armor = 'armatura_pesante'; // 9
    u.skills = [
      skill({ id: 'a', modifier: '-1impedimento' }),
      skill({ id: 'b', modifier: '-1impedimento' }),
      skill({ id: 'c', modifier: '-1impedimento' }),
    ];
    expect(getImpedimentTotal(u)).toBe(6);
  });

  it('floor 0: pugnale (imp 0) con -1 imp resta 0', () => {
    const u = nakedUnit();
    u.weapon = 'pugnale'; // 0
    u.skills = [skill({ modifier: '-1impedimento' })];
    expect(getImpedimentTotal(u)).toBe(0);
  });

  it('PG 2000 exp \"sensato\": ~9 acquisti -1 imp = quasi tutto azzerato', () => {
    const u = nakedUnit();
    u.weapon = 'spada'; // 3
    u.offhand = 'scudo_medio'; // 6
    u.armor = 'armatura_media'; // 6
    // 9 acquisti = 900 exp, azzererebbe spada (3), scudo medio fino a -3 → 3, armatura media fino a -3 → 3
    // Ma con specializzazioni mirate si fa molto meglio.
    u.skills = Array.from({ length: 9 }, (_, i) =>
      skill({ id: `s${i}`, modifier: '-1impedimento' }),
    );
    // 0 + 0 + 0 = 0 (con 9 -1imp generici, tutti pezzi vanno a 0)
    expect(getImpedimentTotal(u)).toBe(0);
  });
});

describe('count* skills', () => {
  it('countFlatBonuses solo +1tiro matchanti', () => {
    const u = nakedUnit();
    u.weapon = 'spada';
    u.skills = [
      skill({ modifier: '+1tiro' }), // generico → match
      skill({ modifier: '+1tiro', azione: 'attaccare' }), // match
      skill({ modifier: '+1tiro', azione: 'parare' }), // no match
      skill({ modifier: '+1tiro', azione: 'attaccare', classeOggetto: 'archi' }), // no match (spada)
    ];
    const ctx = makeAttackContext('spada', 'spade', 'forza');
    expect(countFlatBonuses(u.skills, ctx)).toBe(2);
  });

  it('countForcedExtraDice: solo +1dado matchanti', () => {
    const u = nakedUnit();
    u.skills = [
      skill({ modifier: '+1dado', azione: 'attaccare' }),
      skill({ modifier: '+1dado', azione: 'schivare' }),
    ];
    expect(countForcedExtraDice(u.skills, makeAttackContext('spada', 'spade'))).toBe(1);
    expect(countForcedExtraDice(u.skills, makeDodgeContext())).toBe(1);
  });

  it('countMaxDiceExtra: solo +1dadomax matchanti', () => {
    const u = nakedUnit();
    u.skills = [skill({ modifier: '+1dadomax', azione: 'attaccare' })];
    expect(countMaxDiceExtra(u.skills, makeAttackContext('spada', 'spade'))).toBe(1);
    expect(countMaxDiceExtra(u.skills, makeDodgeContext())).toBe(0);
  });
});

describe('getDiceChoiceRange / getActualDiceCount', () => {
  it('range default 1-2 senza skill', () => {
    const u = nakedUnit();
    const range = getDiceChoiceRange(u, makeAttackContext('spada', 'spade'), 1, 2);
    expect(range).toEqual({ min: 1, max: 2 });
  });

  it('+1 dado max alza il tetto a 3', () => {
    const u = nakedUnit();
    u.skills = [skill({ modifier: '+1dadomax', azione: 'attaccare' })];
    const range = getDiceChoiceRange(u, makeAttackContext('spada', 'spade'), 1, 2);
    expect(range).toEqual({ min: 1, max: 3 });
  });

  it('+1 dado forza un dado extra (chosen 1 → actual 2)', () => {
    const u = nakedUnit();
    u.skills = [skill({ modifier: '+1dado', azione: 'attaccare' })];
    expect(getActualDiceCount(u, makeAttackContext('spada', 'spade'), 1)).toBe(2);
    expect(getActualDiceCount(u, makeAttackContext('spada', 'spade'), 2)).toBe(3);
  });
});

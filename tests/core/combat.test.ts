import { describe, it, expect } from 'vitest';
import { createRng } from '@utils/rng';
import { createBaselineUnit } from '@entities/Unit';
import {
  composeAttackRoll,
  composeDodgeRoll,
  composeParryRoll,
  resolveDodge,
  resolveParry,
  resolveNoDefense,
  applyDamageWithArmor,
  BASE_PG_FIXED,
} from '@core/combat';

function unit(id: string) {
  return createBaselineUnit({ id, name: id, faction: 'A', position: { q: 0, r: 0 } });
}

describe('composeAttackRoll', () => {
  it('spada modo Forza, 2 dadi PG → variabile 2+1 dadi, fissa 2+2(F)+2(A, D-047), variableMod=-3 (V2 imp)', () => {
    const u = unit('att');
    u.weapon = 'spada';
    const rng = createRng(1);
    const roll = composeAttackRoll(u, 'spada', 0, 'forza', 2, rng);
    expect(roll.variable).toHaveLength(3);
    // V2: imp NON è più nella fissa, ma in variableMod
    expect(roll.fixed).toBe(BASE_PG_FIXED + 2 + 2);
    expect(roll.variableMod).toBe(-3);
  });

  it('spada modo Forza, 1 dado PG → solo Forza (D-047 non si attiva con 1 dado)', () => {
    const u = unit('att');
    u.weapon = 'spada';
    const rng = createRng(1);
    const roll = composeAttackRoll(u, 'spada', 0, 'forza', 1, rng);
    expect(roll.variable).toHaveLength(2); // 1 PG + 1 spada
    expect(roll.fixed).toBe(BASE_PG_FIXED + 2);
    expect(roll.variableMod).toBe(-3);
  });

  it('mazza, 1 dado PG → variabile 1 dado, fissa 2+9, variableMod=-3', () => {
    const u = unit('att');
    u.weapon = 'mazza';
    const rng = createRng(2);
    const roll = composeAttackRoll(u, 'mazza', 0, undefined, 1, rng);
    expect(roll.variable).toHaveLength(1);
    expect(roll.fixed).toBe(BASE_PG_FIXED + 9);
    expect(roll.variableMod).toBe(-3);
  });

  it('arco lungo modo default, 2 dadi PG → 2+2 dadi, fissa 2+6, variableMod=-6', () => {
    const u = unit('att');
    u.weapon = 'arco_lungo';
    const rng = createRng(3);
    const roll = composeAttackRoll(u, 'arco_lungo', 0, undefined, 2, rng);
    expect(roll.variable).toHaveLength(4);
    expect(roll.fixed).toBe(BASE_PG_FIXED + 6);
    expect(roll.variableMod).toBe(-6);
  });

  it('+1 al tiro skill aumenta la fissa', () => {
    const u = unit('att');
    u.weapon = 'spada';
    u.skills = [{ id: 's1', modifier: '+1tiro', azione: 'attaccare', level: 1, cost: 600 }];
    const rng = createRng(4);
    const roll = composeAttackRoll(u, 'spada', 0, 'forza', 1, rng);
    // V2: fissa = 2 (PG) + 2 (spada Forza) + 1 (skill); imp -3 in variableMod
    expect(roll.fixed).toBe(2 + 2 + 1);
    expect(roll.variableMod).toBe(-3);
  });

  it('+1 dado forza un dado in più', () => {
    const u = unit('att');
    u.weapon = 'spada';
    u.skills = [{ id: 's1', modifier: '+1dado', level: 1, azione: 'attaccare', cost: 3600 }];
    const rng = createRng(5);
    const roll = composeAttackRoll(u, 'spada', 0, 'forza', 1, rng);
    // PG dadi: 1 (chosen) + 1 (forced) = 2; arma 1 → 3 totale
    expect(roll.variable).toHaveLength(3);
  });
});

describe('composeDodgeRoll', () => {
  it('schivata 2 dadi → variabile 2 dadi, fissa 2', () => {
    const u = unit('def');
    const rng = createRng(10);
    const roll = composeDodgeRoll(u, 2, rng);
    expect(roll.variable).toHaveLength(2);
    expect(roll.fixed).toBe(2);
  });

  it('schivata 0 dadi possibile (slancio? no, dodge è 1-2 ma teniamo 0 abilitato per consistenza)', () => {
    const u = unit('def');
    const rng = createRng(11);
    const roll = composeDodgeRoll(u, 0, rng);
    expect(roll.variable).toHaveLength(0);
  });
});

describe('composeParryRoll', () => {
  it('parata con spada 1 dado → 1+1 dadi, fissa 2+2, variableMod=-3', () => {
    const u = unit('def');
    u.weapon = 'spada';
    const rng = createRng(20);
    const roll = composeParryRoll(u, 'weapon', 1, rng);
    expect(roll).not.toBeNull();
    expect(roll!.variable).toHaveLength(2); // 1 PG + 1 spada
    // V2: imp non più nella fissa
    expect(roll!.fixed).toBe(2 + 2);
    expect(roll!.variableMod).toBe(-3);
  });

  it('parata con scudo medio (offhand) 1 dado → 1+1 dadi, fissa 2+8, variableMod=-6', () => {
    const u = unit('def');
    u.offhand = 'scudo_medio';
    const rng = createRng(21);
    const roll = composeParryRoll(u, 'offhand', 1, rng);
    expect(roll).not.toBeNull();
    expect(roll!.variable).toHaveLength(2);
    expect(roll!.fixed).toBe(2 + 8);
    expect(roll!.variableMod).toBe(-6);
  });

  it('parata con arco è null', () => {
    const u = unit('def');
    u.weapon = 'arco_corto';
    const rng = createRng(22);
    const roll = composeParryRoll(u, 'weapon', 1, rng);
    expect(roll).toBeNull();
  });

  it('parata senza arma equipaggiata è null', () => {
    const u = unit('def');
    const rng = createRng(23);
    const roll = composeParryRoll(u, 'weapon', 1, rng);
    expect(roll).toBeNull();
  });
});

describe('resolveDodge', () => {
  it('schivata riesce: variabile attaccante <= totale difensore', () => {
    const att = { variable: [1, 1], fixed: 100 }; // var 2
    const def = { variable: [3, 4], fixed: 2 }; // total 9
    const r = resolveDodge(att, def);
    expect(r.hit).toBe(false);
    expect(r.rawDamage).toBe(0);
    expect(r.slancioPenaltyToAttacker).toBe(7);
  });

  it('schivata fallisce: si somma fissa attaccante', () => {
    const att = { variable: [5, 6], fixed: 4 }; // var 11, total 15
    const def = { variable: [2, 2], fixed: 1 }; // total 5
    const r = resolveDodge(att, def);
    // residual var = 11 - 5 = 6 > 0; rawDamage = 6 + fissa(4) = 10
    expect(r.hit).toBe(true);
    expect(r.rawDamage).toBe(10);
  });

  it('residual zero esatto = schivata riuscita (penalty 0)', () => {
    const att = { variable: [3, 2], fixed: 5 }; // var 5
    const def = { variable: [3], fixed: 2 }; // total 5
    const r = resolveDodge(att, def);
    expect(r.hit).toBe(false);
    expect(r.slancioPenaltyToAttacker).toBe(0);
  });
});

describe('resolveParry', () => {
  it('parata riesce: total attaccante <= total difensore', () => {
    const att = { variable: [3], fixed: 4 }; // total 7
    const def = { variable: [5, 6], fixed: 2 }; // total 13
    const r = resolveParry(att, def);
    expect(r.hit).toBe(false);
    expect(r.slancioPenaltyToAttacker).toBe(6);
  });

  it('parata fallisce: residual = damage', () => {
    const att = { variable: [4, 5], fixed: 6 }; // total 15
    const def = { variable: [2], fixed: 4 }; // total 6
    const r = resolveParry(att, def);
    expect(r.hit).toBe(true);
    expect(r.rawDamage).toBe(9);
  });
});

describe('resolveNoDefense', () => {
  it('all damage passes', () => {
    const att = { variable: [3, 4], fixed: 5 }; // total 12
    const r = resolveNoDefense(att);
    expect(r.hit).toBe(true);
    expect(r.rawDamage).toBe(12);
  });

  it('total <= 0 → no hit', () => {
    const att = { variable: [], fixed: -5 };
    const r = resolveNoDefense(att);
    expect(r.hit).toBe(false);
    expect(r.rawDamage).toBe(0);
  });
});

describe('applyDamageWithArmor', () => {
  it('niente armatura: full damage', () => {
    const t = unit('t');
    const r = applyDamageWithArmor(t, 8);
    expect(r.effectiveDamage).toBe(8);
    expect(r.newHp).toBe(12);
  });

  it('armatura media (RD 6): danno ridotto', () => {
    const t = unit('t');
    t.armor = 'armatura_media';
    const r = applyDamageWithArmor(t, 10);
    expect(r.effectiveDamage).toBe(4);
    expect(r.newHp).toBe(16);
  });

  it('armatura pesante (RD 9) assorbe interamente piccoli colpi', () => {
    const t = unit('t');
    t.armor = 'armatura_pesante';
    const r = applyDamageWithArmor(t, 8);
    expect(r.effectiveDamage).toBe(0);
    expect(r.newHp).toBe(20);
  });

  it('HP non scende sotto 0', () => {
    const t = unit('t');
    t.hp = 5;
    const r = applyDamageWithArmor(t, 100);
    expect(r.newHp).toBe(0);
  });
});

describe('integration: spada vs schivata vs mazza vs schivata', () => {
  it('mazza ha alta fissa ma bassa variabile → schivata frequentemente blocca tutto', () => {
    // Simulazione qualitativa con seed deterministico
    const att = unit('att');
    att.weapon = 'mazza';
    const def = unit('def');
    const rng = createRng(2026);

    // Attaccante mazza 1 dado, difensore schiva 2 dadi
    const attRoll = composeAttackRoll(att, 'mazza', 0, undefined, 1, rng);
    const defRoll = composeDodgeRoll(def, 2, rng);
    const result = resolveDodge(attRoll, defRoll);
    // V2: variabile attaccante = 1d6 + variableMod (-3 imp), fissa = 2+9 = 11
    // Variabile difensore = 2d6 + variableMod (-0 imp), fissa = 2 → total ~9
    // È ancora più probabile che schivi: imp ora morde la VARIABILE attaccante
    expect(typeof result.hit).toBe('boolean');
    expect(attRoll.variable).toHaveLength(1);
    expect(attRoll.fixed).toBe(2 + 9);
    expect(attRoll.variableMod).toBe(-3);
  });
});

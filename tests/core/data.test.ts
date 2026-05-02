import { describe, it, expect } from 'vitest';
import { WEAPONS, getWeapon } from '@data/weapons';
import { SHIELDS, getShield } from '@data/shields';
import { ARMORS, getArmor } from '@data/armors';
import { skillCost, MODIFIER_LABELS, REFERENCE_PG_EXP } from '@data/skills';

describe('weapons data', () => {
  it('all 12 weapons exist', () => {
    const expected = [
      'pugnale',
      'spada',
      'spada_lunga',
      'mazza',
      'ascia_1h',
      'ascia_2h',
      'lancia_2m',
      'lancia_3m',
      'giavellotto',
      'arco_corto',
      'arco_lungo',
      'balestra',
    ];
    for (const id of expected) {
      expect(WEAPONS[id]).toBeDefined();
    }
  });

  it('spada has two attack modes (forza/agilità)', () => {
    const w = WEAPONS.spada;
    expect(w.attackModes).toHaveLength(2);
    expect(w.attackModes.map((m) => m.stat).sort()).toEqual(['agilità', 'forza']);
  });

  it('spada_lunga has two attack modes (1h/2h) with different bonus', () => {
    const w = WEAPONS.spada_lunga;
    expect(w.attackModes).toHaveLength(2);
    // 1h: +2, 2h: +6
    const oneH = w.attackModes.find((m) => m.label === '1 mano')!;
    const twoH = w.attackModes.find((m) => m.label === '2 mani')!;
    expect(oneH.fixedBonus).toBe(2);
    expect(twoH.fixedBonus).toBe(6);
  });

  it('mazza is fixed-only (0 dice)', () => {
    expect(WEAPONS.mazza.attackModes[0].diceVariable).toBe(0);
    expect(WEAPONS.mazza.attackModes[0].fixedBonus).toBe(9);
  });

  it('arco_lungo has correct range params', () => {
    const r = WEAPONS.arco_lungo.range!;
    expect(r.distance).toBe(4); // 2.0m * 2hex/m
    expect(r.rangedDivisor).toBe(5);
  });

  it('balestra has reload 7', () => {
    expect(WEAPONS.balestra.range!.reload).toBe(7);
  });

  it('archi e balestre non parano (parry null)', () => {
    expect(WEAPONS.arco_corto.parry).toBeNull();
    expect(WEAPONS.arco_lungo.parry).toBeNull();
    expect(WEAPONS.balestra.parry).toBeNull();
  });

  it('armi mischia parano (parry not null)', () => {
    expect(WEAPONS.spada.parry).not.toBeNull();
    expect(WEAPONS.mazza.parry).not.toBeNull();
    expect(WEAPONS.lancia_2m.parry).not.toBeNull();
  });

  it('getWeapon helper works', () => {
    expect(getWeapon('spada')).toBe(WEAPONS.spada);
    expect(getWeapon('inesistente')).toBeUndefined();
  });
});

describe('shields data', () => {
  it('all 3 shields exist', () => {
    expect(SHIELDS.scudo_piccolo).toBeDefined();
    expect(SHIELDS.scudo_medio).toBeDefined();
    expect(SHIELDS.scudo_pesante).toBeDefined();
  });

  it('parry bonus increases with shield size', () => {
    expect(SHIELDS.scudo_piccolo.parry.fixed).toBe(4);
    expect(SHIELDS.scudo_medio.parry.fixed).toBe(8);
    expect(SHIELDS.scudo_pesante.parry.fixed).toBe(12);
  });

  it('all shields are parry-capable (1d6+X)', () => {
    expect(SHIELDS.scudo_piccolo.parry.dice).toBe(1);
    expect(SHIELDS.scudo_medio.parry.dice).toBe(1);
    expect(SHIELDS.scudo_pesante.parry.dice).toBe(1);
  });

  it('getShield helper', () => {
    expect(getShield('scudo_medio')).toBe(SHIELDS.scudo_medio);
  });
});

describe('armors data', () => {
  it('all 3 armors exist', () => {
    expect(ARMORS.armatura_leggera).toBeDefined();
    expect(ARMORS.armatura_media).toBeDefined();
    expect(ARMORS.armatura_pesante).toBeDefined();
  });

  it('damage reduction matches table', () => {
    expect(ARMORS.armatura_leggera.damageReduction).toBe(3);
    expect(ARMORS.armatura_media.damageReduction).toBe(6);
    // Tweak D3 (M-2 in CLAUDE.md): armatura pesante RD 9 → 12 (specialist).
    expect(ARMORS.armatura_pesante.damageReduction).toBe(12);
  });

  it('impediment matches damage reduction', () => {
    expect(ARMORS.armatura_leggera.impediment).toBe(3);
    expect(ARMORS.armatura_media.impediment).toBe(6);
    expect(ARMORS.armatura_pesante.impediment).toBe(9);
  });

  it('getArmor helper', () => {
    expect(getArmor('armatura_media')).toBe(ARMORS.armatura_media);
  });
});

describe('skills data', () => {
  it('skill costs match design', () => {
    expect(skillCost('-1impedimento')).toBe(100);
    expect(skillCost('+1tiro')).toBe(600);
    expect(skillCost('+1dado')).toBe(3600);
    expect(skillCost('+1dadomax')).toBe(1200);
  });

  it('modifier labels exist for all', () => {
    expect(MODIFIER_LABELS['-1impedimento']).toContain('impedimento');
    expect(MODIFIER_LABELS['+1tiro']).toContain('tiro');
  });

  it('reference PG exp is 2000', () => {
    expect(REFERENCE_PG_EXP).toBe(2000);
  });
});

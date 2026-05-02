import { describe, it, expect } from 'vitest';
import { createBaselineUnit } from '@entities/Unit';
import { computeLoS, canFireRanged, composeRangedAttackRoll } from '@core/ranged';
import { createRng } from '@utils/rng';

describe('computeLoS', () => {
  it('clear LoS: bestVisibility 7/7', () => {
    const a = createBaselineUnit({
      id: 'a',
      name: 'A',
      faction: 'A',
      position: { q: 0, r: 0 },
    });
    const b = createBaselineUnit({
      id: 'b',
      name: 'B',
      faction: 'B',
      position: { q: 6, r: 0 },
    });
    const los = computeLoS(a, b, { a, b });
    expect(los.visibility).toBe(7);
    expect(los.distance).toBeGreaterThan(0);
  });

  it('blocked LoS: another unit blocks visibility', () => {
    const a = createBaselineUnit({
      id: 'a',
      name: 'A',
      faction: 'A',
      position: { q: 0, r: 0 },
    });
    const blocker = createBaselineUnit({
      id: 'blk',
      name: 'Blocker',
      faction: 'A',
      position: { q: 3, r: 0 }, // basetta in mezzo
    });
    const b = createBaselineUnit({
      id: 'b',
      name: 'B',
      faction: 'B',
      position: { q: 7, r: 0 },
    });
    const los = computeLoS(a, b, { a, b, blocker });
    // Blocker in mezzo: la visibility dovrebbe essere ridotta
    expect(los.visibility).toBeLessThan(7);
  });
});

describe('canFireRanged', () => {
  it('arco corto entro range OK', () => {
    const a = createBaselineUnit({ id: 'a', name: 'A', faction: 'A', position: { q: 0, r: 0 } });
    a.weapon = 'arco_corto';
    const b = createBaselineUnit({ id: 'b', name: 'B', faction: 'B', position: { q: 4, r: 0 } });
    const r = canFireRanged(a, b, 'arco_corto', { a, b });
    expect(r.ok).toBe(true);
  });

  it('arco corto fuori range fallisce', () => {
    const a = createBaselineUnit({ id: 'a', name: 'A', faction: 'A', position: { q: 0, r: 0 } });
    a.weapon = 'arco_corto';
    const b = createBaselineUnit({ id: 'b', name: 'B', faction: 'B', position: { q: 20, r: 0 } });
    const r = canFireRanged(a, b, 'arco_corto', { a, b });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('fuori range');
  });

  it('spada non utilizzabile a distanza', () => {
    const a = createBaselineUnit({ id: 'a', name: 'A', faction: 'A', position: { q: 0, r: 0 } });
    a.weapon = 'spada';
    const b = createBaselineUnit({ id: 'b', name: 'B', faction: 'B', position: { q: 10, r: 0 } });
    const r = canFireRanged(a, b, 'spada', { a, b });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('non utilizzabile a distanza');
  });
});

describe('composeRangedAttackRoll', () => {
  it('arco lungo, 2 dadi PG, target a distanza 4 → componi roll completo', () => {
    const att = createBaselineUnit({ id: 'a', name: 'A', faction: 'A', position: { q: 0, r: 0 } });
    att.weapon = 'arco_lungo';
    const tgt = createBaselineUnit({ id: 'b', name: 'B', faction: 'B', position: { q: 6, r: 0 } });
    const los = { fromHex: { q: 0, r: 0 }, visibility: 7, distance: 5 };
    const rng = createRng(123);
    const roll = composeRangedAttackRoll(att, 'arco_lungo', 0, undefined, 2, tgt, los, rng);
    // Variabile: 2 PG + 2 arma = 4 dadi
    expect(roll.variable).toHaveLength(4);
    // Fissa: 2 PG + 6 arma + 7 visibility - floor(5/5)=1 - slancio_target=0 - imp_arco_lungo=6 = 8
    expect(roll.fixed).toBe(2 + 6 + 7 - 1 - 0 - 6);
  });

  it('malus distanza N=5 (arco lungo): a dist 4 → -0; a dist 5 → -1; a dist 10 → -2', () => {
    const att = createBaselineUnit({ id: 'a', name: 'A', faction: 'A', position: { q: 0, r: 0 } });
    const tgt = createBaselineUnit({ id: 'b', name: 'B', faction: 'B', position: { q: 0, r: 0 } });
    const rng = createRng(1);
    const baseLos = { fromHex: { q: 0, r: 0 }, visibility: 7, distance: 4 };
    const r1 = composeRangedAttackRoll(att, 'arco_lungo', 0, undefined, 0, tgt, baseLos, rng);
    const r2 = composeRangedAttackRoll(att, 'arco_lungo', 0, undefined, 0, tgt, { ...baseLos, distance: 5 }, createRng(1));
    const r3 = composeRangedAttackRoll(att, 'arco_lungo', 0, undefined, 0, tgt, { ...baseLos, distance: 10 }, createRng(1));
    expect(r1.fixed - r2.fixed).toBe(1);
    expect(r1.fixed - r3.fixed).toBe(2);
  });
});

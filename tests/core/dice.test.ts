import { describe, it, expect } from 'vitest';
import { createRng } from '@utils/rng';
import {
  emptyRoll,
  variableSum,
  rollTotal,
  makeRoll,
  combineRolls,
  addFixed,
  subtractFromVariable,
  subtractFromTotal,
} from '@core/dice';

describe('rng (Mulberry32)', () => {
  it('is deterministic with same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBeCloseTo(b.next(), 10);
    }
  });

  it('different seeds give different sequences', () => {
    const a = createRng(1);
    const b = createRng(2);
    let allEqual = true;
    for (let i = 0; i < 10; i++) {
      if (a.next() !== b.next()) {
        allEqual = false;
        break;
      }
    }
    expect(allEqual).toBe(false);
  });

  it('next() in [0, 1)', () => {
    const r = createRng(123);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('d6() in [1, 6]', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.d6();
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
    }
  });

  it('rollD6s returns array of correct length', () => {
    const r = createRng(99);
    expect(r.rollD6s(0)).toHaveLength(0);
    expect(r.rollD6s(5)).toHaveLength(5);
  });

  it('state save/restore reproduces sequence', () => {
    const r = createRng(101);
    r.next();
    const checkpoint = r.getState();
    const next1 = r.next();
    r.setState(checkpoint);
    const next2 = r.next();
    expect(next1).toBe(next2);
  });
});

describe('dice (Roll)', () => {
  it('emptyRoll has zero variable and fixed', () => {
    const r = emptyRoll();
    expect(r.variable).toEqual([]);
    expect(r.fixed).toBe(0);
  });

  it('variableSum sums dice', () => {
    expect(variableSum({ variable: [3, 5, 2], fixed: 100 })).toBe(10);
  });

  it('rollTotal adds variable + fixed', () => {
    expect(rollTotal({ variable: [3, 4], fixed: 5 })).toBe(12);
  });

  it('makeRoll respects dice count', () => {
    const rng = createRng(1);
    const roll = makeRoll(rng, 3, 7);
    expect(roll.variable).toHaveLength(3);
    expect(roll.fixed).toBe(7);
    for (const v of roll.variable) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('makeRoll with 0 dice is allowed', () => {
    const rng = createRng(1);
    const roll = makeRoll(rng, 0, 9);
    expect(roll.variable).toHaveLength(0);
    expect(roll.fixed).toBe(9);
  });

  it('combineRolls merges variable arrays and sums fixed', () => {
    const a = { variable: [1, 2], fixed: 3 };
    const b = { variable: [4], fixed: 5 };
    const c = combineRolls(a, b);
    expect(c.variable).toEqual([1, 2, 4]);
    expect(c.fixed).toBe(8);
  });

  it('addFixed shifts fixed', () => {
    const r = addFixed({ variable: [1], fixed: 5 }, -3);
    expect(r.fixed).toBe(2);
    expect(r.variable).toEqual([1]);
  });

  it('subtractFromVariable: dodge math', () => {
    // Attacker variable=10, defender total=4 → residual = 6 (hit)
    const att = { variable: [4, 6], fixed: 100 }; // fixed is ignored in dodge
    const def = { variable: [3], fixed: 1 }; // total 4
    expect(subtractFromVariable(att, def)).toBe(6);
  });

  it('subtractFromVariable: dodge wins (zero or negative)', () => {
    const att = { variable: [2, 1], fixed: 100 }; // variable 3
    const def = { variable: [4, 5], fixed: 2 }; // total 11
    expect(subtractFromVariable(att, def)).toBe(-8);
  });

  it('subtractFromTotal: parry math', () => {
    const att = { variable: [3, 4], fixed: 5 }; // total 12
    const def = { variable: [2], fixed: 3 }; // total 5
    expect(subtractFromTotal(att, def)).toBe(7);
  });
});

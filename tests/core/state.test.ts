import { describe, it, expect } from 'vitest';
import { createInitialState, updateUnit, appendLog } from '@core/state';
import { createBaselineUnit } from '@entities/Unit';

describe('GameState', () => {
  function makeUnits() {
    const u1 = createBaselineUnit({
      id: 'u1',
      name: 'Alpha',
      faction: 'A',
      position: { q: 0, r: 0 },
    });
    const u2 = createBaselineUnit({
      id: 'u2',
      name: 'Bravo',
      faction: 'B',
      position: { q: 5, r: 0 },
    });
    return { u1, u2 };
  }

  it('createInitialState wires units correctly', () => {
    const { u1, u2 } = makeUnits();
    const s = createInitialState({
      units: [u1, u2],
      board: { cols: 24, rows: 18 },
      rngSeed: 42,
    });
    expect(s.round).toBe(0);
    // D-045: createInitialState applica il tiro slancio iniziale a ogni unit alive,
    // quindi le istanze in state.units NON sono identical-equal a quelle passate.
    // Verifichiamo invece id e slancio > 0 (tiro 2d6+2 senza skill/imp ⇒ min 4).
    expect(s.units['u1'].id).toBe('u1');
    expect(s.units['u2'].id).toBe('u2');
    expect(s.units['u1'].slancio).toBeGreaterThanOrEqual(4);
    expect(s.units['u2'].slancio).toBeGreaterThanOrEqual(4);
    expect(s.board).toEqual({ cols: 24, rows: 18 });
    // rngSeed avanza per i 2 tiri slancio
    expect(s.rngSeed).not.toBe(42);
    expect(s.phase).toBe('turn-start');
  });

  it('createBaselineUnit produces canonical baseline', () => {
    const u = createBaselineUnit({
      id: 'x',
      name: 'X',
      faction: 'A',
      position: { q: 0, r: 0 },
    });
    expect(u.hp).toBe(20);
    expect(u.hpMax).toBe(20);
    expect(u.forza).toBe(2);
    expect(u.agilita).toBe(2);
    expect(u.volonta).toBe(2);
    expect(u.impeto).toBe(14);
    expect(u.slancio).toBe(0);
    expect(u.dadiAzione).toBe(6);
    expect(u.dadiAzioneMax).toBe(9);
    expect(u.alive).toBe(true);
    expect(u.skills).toEqual([]);
  });

  it('updateUnit returns new state without mutating original', () => {
    const { u1, u2 } = makeUnits();
    const s1 = createInitialState({ units: [u1, u2], board: { cols: 24, rows: 18 }, rngSeed: 1 });
    const s2 = updateUnit(s1, 'u1', { hp: 10 });
    // s1 unchanged
    expect(s1.units['u1'].hp).toBe(20);
    // s2 has the patch
    expect(s2.units['u1'].hp).toBe(10);
    // s2 preserves the rest (s1.units['u2'] è già la copia post-D-045 con slancio iniziale)
    expect(s2.units['u2']).toBe(s1.units['u2']);
  });

  it('updateUnit on missing id returns same state', () => {
    const { u1 } = makeUnits();
    const s1 = createInitialState({ units: [u1], board: { cols: 24, rows: 18 }, rngSeed: 1 });
    const s2 = updateUnit(s1, 'ghost', { hp: 10 });
    expect(s2).toBe(s1);
  });

  it('appendLog adds entries without mutating', () => {
    const { u1 } = makeUnits();
    const s1 = createInitialState({ units: [u1], board: { cols: 24, rows: 18 }, rngSeed: 1 });
    const s2 = appendLog(s1, 'first');
    const s3 = appendLog(s2, 'second');
    expect(s1.log).toHaveLength(0);
    expect(s2.log).toHaveLength(1);
    expect(s3.log).toHaveLength(2);
    expect(s3.log[1].message).toBe('second');
  });
});

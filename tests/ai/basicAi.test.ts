import { describe, it, expect } from 'vitest';
import { createBaselineUnit } from '@entities/Unit';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { aiDecideAction, aiDecideAttackerDice, aiDecideDefense, aiDecideSlancio } from '@ai/basicAi';

function setupBattle() {
  const a = createBaselineUnit({
    id: 'A',
    name: 'Alpha',
    faction: 'A',
    position: { q: 0, r: 0 },
  });
  a.weapon = 'spada';
  const b = createBaselineUnit({
    id: 'B',
    name: 'Bravo',
    faction: 'B',
    position: { q: 10, r: 0 },
  });
  b.weapon = 'arco_corto';
  return createInitialState({ units: [a, b], board: { cols: 24, rows: 18 }, rngSeed: 1 });
}

describe('aiDecideSlancio', () => {
  it('2 dadi se ha tanti dadi azione', () => {
    const s = setupBattle();
    const reduced = reduce(s, { type: 'START_ROUND' });
    expect(aiDecideSlancio(reduced, 'A')).toBe(2);
  });

  it('1 dado se dadi medi', () => {
    const s = setupBattle();
    s.units.A.dadiAzione = 3;
    expect(aiDecideSlancio(s, 'A')).toBe(1);
  });

  it('0 dadi se dadi azione esauriti', () => {
    const s = setupBattle();
    s.units.A.dadiAzione = 1;
    expect(aiDecideSlancio(s, 'A')).toBe(0);
  });
});

describe('aiDecideAction', () => {
  it('attacca mischia se nemico adiacente', () => {
    const s = setupBattle();
    s.units.B.position = { q: 3, r: 0 }; // distanza 1 (basetta)
    const ev = aiDecideAction(s, 'A');
    expect(ev.type).toBe('DECLARE_ATTACK');
  });

  it('si muove se nemico lontano', () => {
    const s = setupBattle();
    s.units.A.slancio = 5;
    const ev = aiDecideAction(s, 'A');
    expect(ev.type).toBe('MOVE');
  });

  it('end turn se nessun nemico', () => {
    const s = setupBattle();
    s.units.B.alive = false;
    s.units.B.hp = 0;
    const ev = aiDecideAction(s, 'A');
    expect(ev.type).toBe('END_TURN');
  });

  it('arco corto: spara se in range', () => {
    const s = setupBattle();
    s.units.B.weapon = 'arco_corto';
    s.units.A.position = { q: 0, r: 0 };
    s.units.B.position = { q: 4, r: 0 }; // distanza ~ 2-3 (basetta), in range arco corto
    const ev = aiDecideAction(s, 'B');
    expect(ev.type).toBe('DECLARE_ATTACK');
    if (ev.type === 'DECLARE_ATTACK') {
      // Mischia non possibile per arco; deve essere ranged
      expect(ev.isRanged).toBe(true);
    }
  });
});

describe('aiDecideAttackerDice', () => {
  it('2 dadi se disponibili', () => {
    const s = setupBattle();
    expect(aiDecideAttackerDice(s, 'A')).toBe(2);
  });

  it('1 dado se solo 1 disponibile', () => {
    const s = setupBattle();
    s.units.A.dadiAzione = 1;
    expect(aiDecideAttackerDice(s, 'A')).toBe(1);
  });
});

describe('aiDecideDefense', () => {
  it('parà se HP basso e ha arma idonea', () => {
    const s = setupBattle();
    s.units.A.hp = 5; // sotto 40% di 20
    const def = aiDecideDefense(s, 'A');
    expect(def.defenseType).toBe('parry');
  });

  it('schiva se nessuna arma parry e HP alto', () => {
    const s = setupBattle();
    s.units.A.weapon = 'arco_corto'; // non parabile
    const def = aiDecideDefense(s, 'A');
    expect(def.defenseType).toBe('dodge');
  });

  it('niente difesa se 0 dadi', () => {
    const s = setupBattle();
    s.units.A.dadiAzione = 0;
    const def = aiDecideDefense(s, 'A');
    expect(def.defenseType).toBe('none');
  });
});

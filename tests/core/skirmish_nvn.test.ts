/**
 * Smoke test: il reducer core supporta partite NvN (skirmish) senza modifiche
 * al state/reducer.
 *
 * Phase 1.1 audit (2026-05-14): verificare prima di costruire l'UI skirmish che
 *   - createInitialState accetta N unit con faction A/B mixate
 *   - computeTurnOrder ordina tutte le unit per impeto desc
 *   - checkGameOver: null finché entrambe le faction hanno almeno 1 alive,
 *     'A'/'B'/'draw' al termine
 *   - doStartRound + doEndTurn ciclano correttamente tra N unit (skip morti)
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { unitFromPreset, getPreset } from '@data/presets';
import { checkGameOver } from '@core/round';
import { pickTargetForAction } from '@ai/basicAi';

function setup2v2() {
  const a1 = Object.assign(unitFromPreset(getPreset('arciere')!, 'A', { q: 0, r: 0 }, 'Arciere A1'), { id: 'A1' });
  const a2 = Object.assign(unitFromPreset(getPreset('spadaccino')!, 'A', { q: 0, r: 2 }, 'Spadaccino A2'), { id: 'A2' });
  const b1 = Object.assign(unitFromPreset(getPreset('tank')!, 'B', { q: 10, r: 0 }, 'Tank B1'), { id: 'B1' });
  const b2 = Object.assign(unitFromPreset(getPreset('arciere')!, 'B', { q: 10, r: 2 }, 'Arciere B2'), { id: 'B2' });
  return createInitialState({ units: [a1, a2, b1, b2], board: { cols: 24, rows: 18 }, rngSeed: 100 });
}

describe('Skirmish 2v2 — reducer core NvN-ready', () => {
  it('createInitialState accetta 4 unit (2 per faction)', () => {
    const s = setup2v2();
    expect(Object.keys(s.units)).toHaveLength(4);
    expect(s.units['A1'].faction).toBe('A');
    expect(s.units['B1'].faction).toBe('B');
  });

  it('START_ROUND ordina tutte e 4 le unit per turn order', () => {
    let s = setup2v2();
    s = reduce(s, { type: 'START_ROUND' });
    expect(s.turnOrder).toHaveLength(4);
    expect(s.round).toBe(1);
    // Tutte le 4 unit sono presenti
    expect(new Set(s.turnOrder)).toEqual(new Set(['A1', 'A2', 'B1', 'B2']));
  });

  it('checkGameOver: null con tutti vivi', () => {
    const s = setup2v2();
    expect(checkGameOver(s.units)).toBe(null);
  });

  it('checkGameOver: null con 1 morto per faction (1v1 residuo)', () => {
    const s = setup2v2();
    const dead = { ...s.units['A1'], hp: 0, alive: false };
    const units = { ...s.units, A1: dead };
    expect(checkGameOver(units)).toBe(null);
  });

  it('checkGameOver: faction B vince se tutti A morti', () => {
    const s = setup2v2();
    const units = {
      ...s.units,
      A1: { ...s.units['A1'], hp: 0, alive: false },
      A2: { ...s.units['A2'], hp: 0, alive: false },
    };
    expect(checkGameOver(units)).toBe('B');
  });

  it('checkGameOver: draw se tutti morti simultaneamente', () => {
    const s = setup2v2();
    const units = {
      ...s.units,
      A1: { ...s.units['A1'], hp: 0, alive: false },
      A2: { ...s.units['A2'], hp: 0, alive: false },
      B1: { ...s.units['B1'], hp: 0, alive: false },
      B2: { ...s.units['B2'], hp: 0, alive: false },
    };
    expect(checkGameOver(units)).toBe('draw');
  });

  it('END_TURN avanza l\'idx ignorando i morti', () => {
    let s = setup2v2();
    s = reduce(s, { type: 'START_ROUND' });
    const firstId = s.turnOrder[0];
    // Mark seconda unit nel turnOrder come morta
    const secondId = s.turnOrder[1];
    s = { ...s, units: { ...s.units, [secondId]: { ...s.units[secondId], hp: 0, alive: false } } };
    // Sostituisco la fase con turn-start (perché START_ROUND la setta) e finto turno
    s = reduce(s, { type: 'START_TURN', slancioDice: 0 });
    s = reduce(s, { type: 'END_TURN' });
    // currentTurnIdx deve essere 2 (skip morto a idx=1)
    expect(s.currentTurnIdx).toBe(2);
    void firstId;
  });

  it('round può finire con 3 unit residue (1 morto)', () => {
    let s = setup2v2();
    // Mark A2 come morto pre-round
    s = { ...s, units: { ...s.units, A2: { ...s.units['A2'], hp: 0, alive: false } } };
    s = reduce(s, { type: 'START_ROUND' });
    expect(s.turnOrder).toHaveLength(3); // solo i 3 vivi
    expect(s.turnOrder.includes('A2')).toBe(false);
  });
});

describe('Skirmish 2v2 — pickTargetForAction (main threat selector)', () => {
  it('1v1: ritorna l\'unico nemico vivo', () => {
    const s = setup2v2();
    const units = { ...s.units, B2: { ...s.units['B2'], hp: 0, alive: false } };
    const me = units['A1'];
    const target = pickTargetForAction({ ...s, units }, me);
    expect(target?.id).toBe('B1');
  });

  it('2v2: con nemici a parità HP, peso pericolosità arma + distanza', () => {
    const s = setup2v2();
    // B1 tank (mazza fissa+9, dist 10), B2 arciere (arco lungo 2d6+6, dist ~11).
    // Score: danger×1/hp×1/dist. Tank danger=9, Arc danger=6+7=13. HP=20 entrambi.
    // → B1=(9/20)/10=0.045, B2=(13/20)/11=0.059 → main threat = B2 (arciere più pericoloso).
    const target = pickTargetForAction(s, s.units['A1']);
    expect(target!.id).toBe('B2');
  });

  it('2v2: nemico ferito (HP basso) viene preferito anche se più lontano', () => {
    const s = setup2v2();
    // Lascia B1 a 10,0, ferisci B2 (1 HP) — ora vale di più finirlo
    const units = { ...s.units, B2: { ...s.units['B2'], hp: 1 } };
    const target = pickTargetForAction({ ...s, units }, units['A1']);
    expect(target!.id).toBe('B2');
  });

  it('2v2: nemico melee adiacente preferito su nemico lontano (anche se HP simili)', () => {
    const s = setup2v2();
    // Sposto B2 adiacente ad A1 (posizione 1,0 = distanza 1 da 0,0)
    const units = {
      ...s.units,
      A1: { ...s.units['A1'], weapon: 'spada' }, // spada ha reach 1
      B2: { ...s.units['B2'], position: { q: 1, r: 0 } },
    };
    const target = pickTargetForAction({ ...s, units }, units['A1']);
    expect(target!.id).toBe('B2'); // adiacente prevale (in melee range)
  });

  it('0 nemici vivi: ritorna null', () => {
    const s = setup2v2();
    const units = {
      ...s.units,
      B1: { ...s.units['B1'], hp: 0, alive: false },
      B2: { ...s.units['B2'], hp: 0, alive: false },
    };
    const target = pickTargetForAction({ ...s, units }, units['A1']);
    expect(target).toBeNull();
  });
});

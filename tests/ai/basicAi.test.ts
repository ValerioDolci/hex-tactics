import { describe, it, expect } from 'vitest';
import { createBaselineUnit } from '@entities/Unit';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { aiDecideAction, aiDecideAttackerDice, aiDecideDefense, aiDecideSlancio } from '@ai/basicAi';
import { baseDistance } from '@core/hex/base';

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

describe('AI repro — bug "rimane bloccata vicino"', () => {
  /**
   * Repro stretto: forza slancio = 5 manualmente. AI a (0,0), nemico (10,0).
   * Range=6 (5+1 free). Hex max raggiungibile dal centro AI: dist 6 → (6,0).
   * baseDistance((6,0),(10,0))=2. Quindi AI non raggiunge baseDistance=1 al primo turno.
   * END_TURN (correttamente).
   * Al turno successivo, AI è a (6,0). hexMovedThisTurn resettato a 0 → free hex
   * disponibile. Ma slancio nuovo è quello che è. Vediamo cosa fa.
   */
  it('AI con slancio insufficiente al 1° turno, deve attaccare al 2°', () => {
    let s = setupBattle();
    s.units.A.position = { q: 0, r: 0 };
    s.units.B.position = { q: 10, r: 0 };
    s.units.A.weapon = 'spada';
    s.units.B.weapon = 'spada';
    s = reduce(s, { type: 'START_ROUND' });
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0 };
    s = reduce(s, { type: 'START_TURN', slancioDice: 0 }); // 0 dadi slancio
    // Force slancio = 5 manualmente (override post-roll)
    s.units.A.slancio = 5;
    const ev1 = aiDecideAction(s, 'A');
    expect(ev1.type).toBe('MOVE');
    s = reduce(s, ev1);
    const dist1 = baseDistance(s.units.A.position, s.units.B.position);
    // eslint-disable-next-line no-console
    console.log('Stretto T1: A pos', s.units.A.position, 'dist=', dist1, 'sl=', s.units.A.slancio, 'hexMoved=', s.units.A.hexMovedThisTurn);

    if (dist1 <= 1) {
      const ev2 = aiDecideAction(s, 'A');
      // eslint-disable-next-line no-console
      console.log('Stretto T1 ev2=', ev2.type);
      return;
    }

    // dist > 1: l'AI deve provare ad attaccare se può, altrimenti muovere ancora
    // o END_TURN
    const ev2 = aiDecideAction(s, 'A');
    // eslint-disable-next-line no-console
    console.log('Stretto T1 dopo MOVE primo, ev2=', ev2.type, 'sl=', s.units.A.slancio);

    // Se AI ha ancora slancio, dovrebbe muovere ancora! Verifichiamolo
    if (s.units.A.slancio >= 1) {
      // 2° MOVE possibile
      expect(['MOVE', 'DECLARE_ATTACK']).toContain(ev2.type);
    }

    // Simula END_TURN A → START_TURN B (END_TURN) → START_ROUND → START_TURN A
    if (ev2.type === 'END_TURN') {
      s = reduce(s, ev2);
      s = reduce(s, { type: 'START_TURN', slancioDice: 0 });
      s = reduce(s, { type: 'END_TURN' });
      s = reduce(s, { type: 'START_ROUND' });
      s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0 };
      s = reduce(s, { type: 'START_TURN', slancioDice: 0 });
      // Force slancio 0 (worst case: solo free hex)
      s.units.A.slancio = 0;
      // eslint-disable-next-line no-console
      console.log('Stretto T2 start: A pos', s.units.A.position, 'dist=', baseDistance(s.units.A.position, s.units.B.position), 'sl=', s.units.A.slancio, 'hexMoved=', s.units.A.hexMovedThisTurn);
      const ev3 = aiDecideAction(s, 'A');
      // eslint-disable-next-line no-console
      console.log('Stretto T2 ev3 type=', ev3.type);
      // Con free hex disponibile (hexMoved=0) e dist=2, AI dovrebbe muovere a baseDist=1
      // poi al fork successivo attaccare. Verifichiamo passo per passo.
      if (ev3.type === 'MOVE') {
        s = reduce(s, ev3);
        const dist3 = baseDistance(s.units.A.position, s.units.B.position);
        // eslint-disable-next-line no-console
        console.log('Stretto T2 dopo MOVE: pos=', s.units.A.position, 'dist=', dist3);
        const ev4 = aiDecideAction(s, 'A');
        // eslint-disable-next-line no-console
        console.log('Stretto T2 ev4=', ev4.type);
        if (dist3 <= 1) {
          expect(ev4.type).toBe('DECLARE_ATTACK');
        }
      }
    }
  });

});

describe('AI repro — muove vicino e poi attacca', () => {
  /**
   * Repro del bug "AI muove sempre vicino ma poi non attacca mai":
   * - Setup: AI a (0,0), umano a (10,0), entrambi spadaccini (reach 1)
   * - START_TURN AI: tira slancio
   * - aiDecideAction: deve essere MOVE (dist > reach)
   * - dispatch MOVE: AI muove fino al limite slancio
   * - END_TURN
   * - START_TURN umano (skip): umano END_TURN
   * - START_TURN AI di nuovo
   * - aiDecideAction: deve essere DECLARE_ATTACK se può raggiungere baseDistance=1
   *   con il nuovo slancio
   */
  it('AI con slancio sufficiente arriva a baseDistance=1 e poi attacca', () => {
    let s = setupBattle();
    s.units.A.position = { q: 0, r: 0 };
    s.units.B.position = { q: 10, r: 0 };
    s.units.A.weapon = 'spada';
    s.units.B.weapon = 'spada';
    s = reduce(s, { type: 'START_ROUND' });
    // Override turn order DOPO START_ROUND (che ricalcola da impeto)
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0 };
    // START_TURN A con 2 dadi slancio (massimo)
    s = reduce(s, { type: 'START_TURN', slancioDice: 2 });
    const aBefore = s.units.A;
    const distBefore = baseDistance(aBefore.position, s.units.B.position);
    expect(distBefore).toBeGreaterThan(1); // siamo lontani

    // AI sceglie azione: dovrebbe essere MOVE (lontana)
    const ev1 = aiDecideAction(s, 'A');
    expect(ev1.type).toBe('MOVE');
    s = reduce(s, ev1);
    const distAfterMove1 = baseDistance(s.units.A.position, s.units.B.position);

    // Diagnostic — log per capire dove AI è arrivata
    // eslint-disable-next-line no-console
    console.log('Turno1: A pos', s.units.A.position, 'dist=', distAfterMove1, 'slancio=', s.units.A.slancio);

    // Se AI già a dist<=1 → ATTACK al fork (caso lucky con slancio alto al primo turno)
    // Altrimenti END_TURN e nuovo turno.
    if (distAfterMove1 <= 1) {
      const ev2 = aiDecideAction(s, 'A');
      expect(ev2.type).toBe('DECLARE_ATTACK');
      return;
    }

    // END_TURN A
    s = reduce(s, { type: 'END_TURN' });
    // START_TURN B (umano) — passa subito turno
    s = reduce(s, { type: 'START_TURN', slancioDice: 0 });
    s = reduce(s, { type: 'END_TURN' });
    // Nuovo round: START_ROUND
    s = reduce(s, { type: 'START_ROUND' });
    // Force order A primo nel nuovo round
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0 };
    s = reduce(s, { type: 'START_TURN', slancioDice: 2 });

    const distBeforeT2 = baseDistance(s.units.A.position, s.units.B.position);
    // eslint-disable-next-line no-console
    console.log('Turno2 start: A pos', s.units.A.position, 'dist=', distBeforeT2, 'slancio=', s.units.A.slancio);

    const ev3 = aiDecideAction(s, 'A');
    // eslint-disable-next-line no-console
    console.log('Turno2 ev3 type=', ev3.type);
    if (ev3.type === 'MOVE') {
      s = reduce(s, ev3);
      const distAfterMove2 = baseDistance(s.units.A.position, s.units.B.position);
      // eslint-disable-next-line no-console
      console.log('Turno2 dopo MOVE: A pos', s.units.A.position, 'dist=', distAfterMove2);
      const ev4 = aiDecideAction(s, 'A');
      // eslint-disable-next-line no-console
      console.log('Turno2 ev4 type=', ev4.type, 'expected DECLARE_ATTACK');
      // Al 2° turno DOPO MOVE dovrebbe attaccare se è arrivato a dist<=1
      if (distAfterMove2 <= 1) {
        expect(ev4.type).toBe('DECLARE_ATTACK');
      }
    }
  });
});

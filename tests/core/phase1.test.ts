/**
 * Smoke-test integrato delle meccaniche "Fase 1" introdotte post-MVP:
 *  - TOGGLE_DEFENSIVE (posizione difensiva con scudo)
 *  - awaiting-carica → CHOOSE_CARICA (bonus alla fissa = amount, costo amount slancio)
 *  - awaiting-attacker-bid + awaiting-defender-bid (asta movimento contro reach >= 4)
 *
 * Costruiamo gli state direttamente bypassando il flow turni (non-deterministico
 * a causa del tiro slancio), in modo da testare i singoli handler del reducer.
 */
import { describe, it, expect } from 'vitest';
import { GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { createBaselineUnit, Unit } from '@entities/Unit';
import { offsetToAxial } from '@core/hex/coords';

function makeUnit(opts: {
  id: string;
  faction: 'A' | 'B';
  position: { col: number; row: number };
  weapon?: string;
  offhand?: string;
  armor?: string;
  slancio?: number;
  positionAtTurnStart?: { col: number; row: number };
}): Unit {
  const u = createBaselineUnit({
    id: opts.id,
    name: opts.id,
    faction: opts.faction,
    position: offsetToAxial(opts.position),
  });
  if (opts.weapon) u.weapon = opts.weapon;
  if (opts.offhand) u.offhand = opts.offhand;
  if (opts.armor) u.armor = opts.armor;
  if (opts.slancio != null) u.slancio = opts.slancio;
  if (opts.positionAtTurnStart) {
    u.positionAtTurnStart = offsetToAxial(opts.positionAtTurnStart);
  } else {
    u.positionAtTurnStart = u.position;
  }
  return u;
}

function makeState(
  units: Unit[],
  phase: GameState['phase'],
  extras: Partial<GameState> = {},
): GameState {
  const unitsMap: Record<string, Unit> = {};
  for (const u of units) unitsMap[u.id] = u;
  return {
    round: 1,
    turnOrder: units.map((u) => u.id),
    currentTurnIdx: 0,
    units: unitsMap,
    board: { cols: 24, rows: 18 },
    phase,
    log: [],
    rngSeed: 42,
    ...extras,
  };
}

describe('Fase 1 — TOGGLE_DEFENSIVE', () => {
  it('toggla la stance di una unità con scudo durante choosing-action', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      offhand: 'scudo_medio',
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'spada',
    });
    const s = makeState([a, b], 'choosing-action');

    expect(s.units['A'].defensiveStance).toBe(false);
    const s2 = reduce(s, { type: 'TOGGLE_DEFENSIVE', unitId: 'A' });
    expect(s2.units['A'].defensiveStance).toBe(true);
    expect(s2.units['A'].defensiveToggledThisTurn).toBe(true);
    expect(s2.phase).toBe('choosing-action');
  });

  it('rifiuta secondo toggle nello stesso turno', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      offhand: 'scudo_medio',
    });
    a.defensiveStance = true;
    a.defensiveToggledThisTurn = true;
    const s = makeState([a], 'choosing-action');
    const s2 = reduce(s, { type: 'TOGGLE_DEFENSIVE', unitId: 'A' });
    // Toggle rifiutato → state invariato (modulo log entry).
    expect(s2.units['A'].defensiveStance).toBe(true);
    expect(s2.units['A'].defensiveToggledThisTurn).toBe(true);
  });

  it('rifiuta toggle se offhand non è uno scudo', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      offhand: 'pugnale',
    });
    const s = makeState([a], 'choosing-action');
    const s2 = reduce(s, { type: 'TOGGLE_DEFENSIVE', unitId: 'A' });
    expect(s2.units['A'].defensiveStance).toBe(false);
    expect(s2.units['A'].defensiveToggledThisTurn).toBe(false);
  });

  it('rifiuta toggle se non è il turno dell unità', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      offhand: 'scudo_medio',
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'spada',
      offhand: 'scudo_medio',
    });
    // Turno di A (currentTurnIdx=0), tentativo toggle su B
    const s = makeState([a, b], 'choosing-action');
    const s2 = reduce(s, { type: 'TOGGLE_DEFENSIVE', unitId: 'B' });
    expect(s2.units['B'].defensiveStance).toBe(false);
  });
});

describe('Fase 1 — Carica (awaiting-carica → CHOOSE_CARICA)', () => {
  it('DECLARE_ATTACK con delta_distance > 0 e slancio > 0 entra in awaiting-carica', () => {
    // A è partito da col 5, ora in col 7 → si è avvicinato a B (col 9) di 2 hex.
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 7, row: 9 },
      positionAtTurnStart: { col: 5, row: 9 },
      weapon: 'lancia_2m_1h',
      slancio: 5,
    });
    a.actionTakenThisTurn = false;
    a.dadiAzione = 5;
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 9, row: 9 },
      weapon: 'spada',
    });

    const s = makeState([a, b], 'choosing-action');
    const s2 = reduce(s, {
      type: 'DECLARE_ATTACK',
      attackerId: 'A',
      targetId: 'B',
      weaponId: 'lancia_2m_1h',
      attackModeIdx: 0,
      isRanged: false,
    });
    expect(s2.phase).toBe('awaiting-carica');
    expect(s2.pendingAction).toBeDefined();
  });

  it('CHOOSE_CARICA con amount > 0 setta caricaAmount e scala lo slancio', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 7, row: 9 },
      positionAtTurnStart: { col: 5, row: 9 },
      weapon: 'lancia_2m_1h',
      slancio: 5,
    });
    a.actionTakenThisTurn = false;
    a.dadiAzione = 5;
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 9, row: 9 },
      weapon: 'spada',
    });
    let s = makeState([a, b], 'choosing-action');
    s = reduce(s, {
      type: 'DECLARE_ATTACK',
      attackerId: 'A',
      targetId: 'B',
      weaponId: 'lancia_2m_1h',
      attackModeIdx: 0,
      isRanged: false,
    });
    expect(s.phase).toBe('awaiting-carica');
    const slancioPre = s.units['A'].slancio;
    s = reduce(s, { type: 'CHOOSE_CARICA', amount: 2 });
    expect(s.phase).toBe('declaring-attack');
    expect(s.pendingAction?.caricaAmount).toBe(2);
    expect(s.units['A'].slancio).toBe(slancioPre - 2);
  });

  it('CHOOSE_CARICA clampa amount a min(delta_dist, slancio)', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 6, row: 9 }, // delta = 1
      positionAtTurnStart: { col: 5, row: 9 },
      weapon: 'lancia_2m_1h',
      slancio: 5, // slancio alto, ma delta clampa a 1
    });
    a.actionTakenThisTurn = false;
    a.dadiAzione = 5;
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 9, row: 9 },
      weapon: 'spada',
    });
    let s = makeState([a, b], 'choosing-action');
    s = reduce(s, {
      type: 'DECLARE_ATTACK',
      attackerId: 'A',
      targetId: 'B',
      weaponId: 'lancia_2m_1h',
      attackModeIdx: 0,
      isRanged: false,
    });
    s = reduce(s, { type: 'CHOOSE_CARICA', amount: 99 });
    expect(s.pendingAction?.caricaAmount).toBe(1);
    expect(s.units['A'].slancio).toBe(4); // 5 - 1
  });
});

describe('Fase 1 — Asta movimento (BID_MOVEMENT)', () => {
  it('sequenza completa: atk vs def, atk perde con def_bid > atk_bid', () => {
    // Setup pre-fase: phase = 'awaiting-attacker-bid', moveInProgress popolato.
    // B distante per evitare basetta overlap quando si valuta movimento.
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      slancio: 4,
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'lancia_3m_2h',
      slancio: 4,
    });
    const aPos = a.position;
    const targetHex = { q: aPos.q + 1, r: aPos.r };
    let s = makeState([a, b], 'awaiting-attacker-bid', {
      moveInProgress: {
        unitId: 'A',
        path: [targetHex],
        currentIdx: 0,
        freeHexUsed: false,
        contestedHexIdx: 0,
        defenderId: 'B',
      },
    });

    // A puntua 1
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 1 });
    expect(s.phase).toBe('awaiting-defender-bid');
    expect(s.moveInProgress?.attackerBid).toBe(1);

    // B puntua 2 → B vince → atk si ferma
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 2 });
    expect(s.phase).toBe('choosing-action');
    expect(s.moveInProgress).toBeUndefined();
    // D-052: atk paga sempre 1 fisso + bid (anche se perde). 4 - (1+1) = 2
    expect(s.units['A'].slancio).toBe(2);
    expect(s.units['B'].slancio).toBe(2); // 4 - 2
    // A è rimasto fermo (movimento abortito)
    expect(s.units['A'].position).toEqual(aPos);
  });

  it('parità nel bid: difensore vince (D-052)', () => {
    // B distante (col 15) per evitare overlap basette quando A avanza di 1 hex.
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      slancio: 4,
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'lancia_3m_2h',
      slancio: 4,
    });
    const aPos = a.position;
    const targetHex = { q: aPos.q + 1, r: aPos.r };
    let s = makeState([a, b], 'awaiting-attacker-bid', {
      moveInProgress: {
        unitId: 'A',
        path: [targetHex],
        currentIdx: 0,
        freeHexUsed: false,
        contestedHexIdx: 0,
        defenderId: 'B',
      },
    });

    s = reduce(s, { type: 'BID_MOVEMENT', amount: 2 });
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 2 }); // D-052: parità → DEF vince, atk si ferma
    // D-052: A paga sempre 1 fisso + bid (4 - (1+2) = 1), non muove (perde la parità)
    expect(s.units['A'].slancio).toBe(1);
    expect(s.units['B'].slancio).toBe(2); // 4 - 2 bid
    // A è rimasto fermo
    expect(s.units['A'].position).toEqual(aPos);
    expect(s.phase).toBe('choosing-action');
  });

  it('atk vince e completa il movimento sul path corrente', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      slancio: 5,
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'lancia_3m_2h',
      slancio: 4,
    });
    const aPos = a.position;
    const hex1 = { q: aPos.q + 1, r: aPos.r };
    let s = makeState([a, b], 'awaiting-attacker-bid', {
      moveInProgress: {
        unitId: 'A',
        path: [hex1],
        currentIdx: 0,
        freeHexUsed: false,
        contestedHexIdx: 0,
        defenderId: 'B',
      },
    });
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 3 }); // atk
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 1 }); // def

    expect(s.units['A'].position).toEqual(hex1);
    expect(s.phase).toBe('choosing-action');
    // D-052: A paga 1 fisso + bid 3 = 4. Slancio: 5 - 4 = 1.
    expect(s.units['A'].slancio).toBe(1);
    // B: 4 - 1 (bid) = 3
    expect(s.units['B'].slancio).toBe(3);
  });

  it('D-052: atk con slancio 1 non può biddare (clampato a 0)', () => {
    const a = makeUnit({
      id: 'A',
      faction: 'A',
      position: { col: 5, row: 9 },
      weapon: 'spada',
      slancio: 1,
    });
    const b = makeUnit({
      id: 'B',
      faction: 'B',
      position: { col: 15, row: 9 },
      weapon: 'lancia_3m_2h',
      slancio: 4,
    });
    const aPos = a.position;
    const targetHex = { q: aPos.q + 1, r: aPos.r };
    let s = makeState([a, b], 'awaiting-attacker-bid', {
      moveInProgress: {
        unitId: 'A',
        path: [targetHex],
        currentIdx: 0,
        freeHexUsed: false,
        contestedHexIdx: 0,
        defenderId: 'B',
      },
    });
    // A prova a bidare 5 → clampato a max(0, slancio-1) = 0
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 5 });
    expect(s.moveInProgress?.attackerBid).toBe(0);
    // B bida 0 → parità → def vince (D-052)
    s = reduce(s, { type: 'BID_MOVEMENT', amount: 0 });
    // A: 1 - (1 fisso + 0 bid) = 0; B: 4 - 0 = 4. A non muove.
    expect(s.units['A'].slancio).toBe(0);
    expect(s.units['B'].slancio).toBe(4);
    expect(s.units['A'].position).toEqual(aPos);
    expect(s.phase).toBe('choosing-action');
  });
});

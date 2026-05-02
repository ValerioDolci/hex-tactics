/**
 * Generatore di mosse legali per AI strategiche (Utility AI, MCTS).
 *
 * Data uno `GameState` e una unit attiva, restituisce tutti i `GameEvent` plausibili.
 * Per controllare il branching factor, applichiamo discretizzazione intelligente:
 * - MOVE: solo a una rosa di hex "interessanti" (verso nemico, verso copertura, sul posto)
 *         non TUTTI gli hex raggiungibili
 * - DECLARE_ATTACK: per ogni nemico in range, primo modo dell'arma (no enumerazione)
 * - CHOOSE_DEFENSE: limitato a {dodge 1d, dodge 2d, parry 1d, parry 2d, none}
 */

import { GameState } from '@core/state';
import { GameEvent } from '@core/events';
import { UnitId, Unit } from '@entities/Unit';
import { Axial } from '@core/hex/coords';
import { hexesInRange } from '@core/hex/distance';
import { baseDistance, getBaseHexes } from '@core/hex/base';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { canFireRanged } from '@core/ranged';
import { findClosestEnemy } from './basicAi';

/**
 * Restituisce le mosse legali per l'unità attiva nello stato corrente.
 * La fase dello stato determina quali eventi sono validi.
 */
export function legalMoves(state: GameState, unitId: UnitId): GameEvent[] {
  const phase = state.phase;
  const unit = state.units[unitId];
  if (!unit || !unit.alive) return [];

  switch (phase) {
    case 'turn-start':
      return legalSlancioMoves(state, unitId);
    case 'choosing-action':
      return legalActionMoves(state, unit);
    case 'declaring-attack':
      return legalAttackerDiceMoves(state, unit);
    case 'awaiting-defense':
      return legalDefenseMoves(state, unit);
    case 'resolving':
      return [{ type: 'RESOLVE_COMBAT' }];
    case 'turn-end':
    case 'round-end':
    case 'game-over':
    default:
      return [];
  }
}

/** Mosse legali per la fase turn-start (scelta dadi slancio + transfer impeto→slancio D-044) */
function legalSlancioMoves(state: GameState, unitId: UnitId): GameEvent[] {
  // Base: 0, 1, 2 dadi (range standard)
  const base: GameEvent[] = [
    { type: 'START_TURN', slancioDice: 0 },
    { type: 'START_TURN', slancioDice: 1 },
    { type: 'START_TURN', slancioDice: 2 },
  ];
  // D-044: se l'unità ha impeto disponibile, considera anche varianti con transfer impeto→slancio.
  // Discretizziamo: 3, 6, 9 punti (per limitare branching). Solo con slancioDice=2 (caso più aggressivo).
  const me = state.units[unitId];
  if (!me || me.impeto < 3) return base;
  const transfers = [3, 6, 9].filter((t) => t <= me.impeto);
  for (const t of transfers) {
    base.push({ type: 'START_TURN', slancioDice: 2, impetoToSlancio: t });
  }
  return base;
}

/** Mosse legali per la fase choosing-action: muovi, attacca, ricarica, end turn */
function legalActionMoves(state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  const enemy = findClosestEnemy(state, unit);
  const weapon = unit.weapon ? getWeapon(unit.weapon) : undefined;

  // ATTACCO: se nemico in range mischia o ranged
  if (enemy && weapon && !unit.actionTakenThisTurn && unit.dadiAzione >= 1) {
    const dist = baseDistance(unit.position, enemy.position);
    const meleeRange = weapon.range?.reach ?? 1;
    if (dist <= meleeRange) {
      // Per ogni modo dell'arma (es. spada forza/agilità)
      for (let mi = 0; mi < weapon.attackModes.length; mi++) {
        const mode = weapon.attackModes[mi];
        moves.push({
          type: 'DECLARE_ATTACK',
          attackerId: unit.id,
          targetId: enemy.id,
          weaponId: weapon.id,
          attackModeIdx: mi,
          chosenStat: mode.stat === 'either' ? 'forza' : mode.stat,
          isRanged: false,
        });
      }
    }
    // Ranged
    const can = canFireRanged(unit, enemy, weapon.id, state.units);
    if (can.ok) {
      for (let mi = 0; mi < weapon.attackModes.length; mi++) {
        const mode = weapon.attackModes[mi];
        moves.push({
          type: 'DECLARE_ATTACK',
          attackerId: unit.id,
          targetId: enemy.id,
          weaponId: weapon.id,
          attackModeIdx: mi,
          chosenStat: mode.stat === 'either' ? 'agilità' : mode.stat,
          isRanged: true,
        });
      }
    }
  }

  // RELOAD: se l'arma con reload è scarica
  if (
    weapon &&
    weapon.range?.reload != null &&
    !unit.weaponLoaded &&
    !unit.actionTakenThisTurn &&
    unit.dadiAzione >= 1
  ) {
    moves.push({ type: 'RELOAD', unitId: unit.id, diceN: 1 });
    if (unit.dadiAzione >= 2) moves.push({ type: 'RELOAD', unitId: unit.id, diceN: 2 });
  }

  // MOVE: discretizzazione intelligente — fino a 5 hex raggiungibili "interessanti"
  // (verso nemico più vicino, hex strategici)
  const freeHex = unit.hexMovedThisTurn === 0 ? 1 : 0;
  const moveRange = unit.slancio + freeHex;
  if (moveRange >= 1 && enemy) {
    const candidates = hexesInRange(unit.position, moveRange);
    // Filtra: niente posizioni occupate
    const blocked = new Set<string>();
    for (const u of Object.values(state.units)) {
      if (u.id === unit.id || !u.alive) continue;
      for (const h of getBaseHexes(u.position)) blocked.add(`${h.q},${h.r}`);
    }
    const valid: { hex: Axial; distToEnemy: number }[] = [];
    for (const h of candidates) {
      if (h.q === unit.position.q && h.r === unit.position.r) continue;
      let overlap = false;
      for (const bh of getBaseHexes(h)) {
        if (blocked.has(`${bh.q},${bh.r}`)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      valid.push({ hex: h, distToEnemy: baseDistance(h, enemy.position) });
    }
    valid.sort((a, b) => a.distToEnemy - b.distToEnemy);
    // Top 3 hex più vicini al nemico + top 2 più lontani (ritirata)
    const closer = valid.slice(0, 3);
    const farther = valid.slice(-2).filter((x) => !closer.includes(x));
    for (const c of [...closer, ...farther]) {
      moves.push({ type: 'MOVE', unitId: unit.id, targetHex: c.hex });
    }
  }

  // END_TURN sempre disponibile
  moves.push({ type: 'END_TURN' });

  return moves;
}

/** Mosse legali per CHOOSE_ATTACKER_DICE: 1 o 2 dadi (basico) */
function legalAttackerDiceMoves(_state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  if (unit.dadiAzione >= 1) moves.push({ type: 'CHOOSE_ATTACKER_DICE', diceN: 1 });
  if (unit.dadiAzione >= 2) moves.push({ type: 'CHOOSE_ATTACKER_DICE', diceN: 2 });
  return moves;
}

/** Mosse legali per CHOOSE_DEFENSE: schivata/parata/niente con 0/1/2 dadi */
function legalDefenseMoves(_state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  // Niente difesa è sempre legale
  moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'none', diceN: 0 });

  // Schivata se ha dadi
  for (let n = 1; n <= Math.min(2, unit.dadiAzione); n++) {
    moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'dodge', diceN: n });
  }

  // Parata se ha arma/scudo idoneo
  const tryParry = (slot: 'weapon' | 'offhand'): void => {
    const id = slot === 'weapon' ? unit.weapon : unit.offhand;
    if (!id) return;
    const w = getWeapon(id);
    const sh = getShield(id);
    const canParry = (w && w.parry !== null) || sh != null;
    if (!canParry) return;
    for (let n = 1; n <= Math.min(2, unit.dadiAzione); n++) {
      moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'parry', parryWith: slot, diceN: n });
    }
  };
  tryParry('weapon');
  tryParry('offhand');

  return moves;
}

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
import { Axial, axialToOffset } from '@core/hex/coords';
import { hexesInRange } from '@core/hex/distance';
import { baseDistance, getBaseHexes } from '@core/hex/base';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { canFireRanged } from '@core/ranged';
import {
  countMaxDiceExtra,
  makeAttackContext,
  makeDodgeContext,
  makeParryContext,
  makeSlancioContext,
} from '@core/stats';
import { computeInitialImpeto } from '@core/turn';
import { pickTargetForAction } from './basicAi';

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
    case 'awaiting-attacker-bid':
    case 'awaiting-defender-bid':
      return legalBidMoves(state, unit);
    case 'awaiting-carica':
      return legalCaricaMoves(state, unit);
    case 'turn-end':
    case 'round-end':
    case 'game-over':
    default:
      return [];
  }
}

/** Bid options per asta movimento (meccanica A): {0, 1, 2, 4, slancio_max}. */
function legalBidMoves(_state: GameState, unit: Unit): GameEvent[] {
  void _state;
  const maxSla = Math.max(0, unit.slancio);
  const cands = Array.from(new Set([0, 1, 2, 4, maxSla])).sort((a, b) => a - b);
  return cands
    .filter((c) => c >= 0 && c <= maxSla)
    .map((c) => ({ type: 'BID_MOVEMENT' as const, amount: c }));
}

/** Carica options: {0, 1, 3, max} clampato a [0, min(delta, slancio)]. */
function legalCaricaMoves(state: GameState, unit: Unit): GameEvent[] {
  if (!state.pendingAction) return [{ type: 'CHOOSE_CARICA', amount: 0 }];
  const target = state.units[state.pendingAction.targetId];
  if (!target) return [{ type: 'CHOOSE_CARICA', amount: 0 }];
  let delta = 0;
  if (unit.positionAtTurnStart) {
    const dStart = baseDistance(unit.positionAtTurnStart, target.position);
    const dNow = baseDistance(unit.position, target.position);
    delta = Math.max(0, dStart - dNow);
  }
  const maxCarica = Math.max(0, Math.min(delta, unit.slancio));
  const cands = Array.from(new Set([0, 1, 3, maxCarica])).sort((a, b) => a - b);
  return cands
    .filter((c) => c >= 0 && c <= maxCarica)
    .map((c) => ({ type: 'CHOOSE_CARICA' as const, amount: c }));
}

/** Mosse legali per la fase turn-start (scelta dadi slancio + transfer impeto→slancio D-044) */
function legalSlancioMoves(state: GameState, unitId: UnitId): GameEvent[] {
  // 2026-05-05 fix:
  //  - dadi cap fino a 2 + countMaxDiceExtra (skill `+1dadomax [slancio/...]` ora attiva)
  //  - transfer continui da 1 a min(impeto, max teorico tiro slancio) — granularità 1
  const me = state.units[unitId];
  if (!me) return [{ type: 'START_TURN', slancioDice: 0 }];
  const ctx = makeSlancioContext();
  const extraMax = countMaxDiceExtra(me.skills, ctx);
  const maxDice = 2 + extraMax;
  const base: GameEvent[] = [];
  for (let d = 0; d <= maxDice; d++) {
    base.push({ type: 'START_TURN', slancioDice: d });
  }
  if (me.impeto <= 0) return base;
  const maxSlancio = computeInitialImpeto(me); // = max teorico tiro slancio
  const upperTransfer = Math.min(me.impeto, maxSlancio);
  for (let t = 1; t <= upperTransfer; t++) {
    base.push({ type: 'START_TURN', slancioDice: maxDice, impetoToSlancio: t });
  }
  return base;
}

/** Mosse legali per la fase choosing-action: muovi, attacca, ricarica, end turn */
function legalActionMoves(state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  // 2026-05-14 (Phase 1.2 skirmish): in NvN scegliamo il target "di valore" anziché
  // il puramente più vicino. In 1v1 questo collassa al solo nemico → comportamento
  // identico. Per il target-picker UI umano vedi `legalActionMovesAllTargets`
  // (Step 1.4 — non ancora implementato).
  //
  // 2026-05-15 (Bug A propagation fix): stabilizza il target sul positionAtTurnStart
  // come fa aiDecideAction. Senza, anche gli MLP (Hard/Expert) che chiamano legalMoves
  // possono vedere azioni candidate che cambiano ad ogni MOVE.
  const unitForTargeting: Unit = unit.positionAtTurnStart
    ? { ...unit, position: unit.positionAtTurnStart }
    : unit;
  const enemy = pickTargetForAction(state, unitForTargeting);
  const weapon = unit.weapon ? getWeapon(unit.weapon) : undefined;

  // ATTACCO: se nemico in range mischia o ranged (V2 D-049)
  if (enemy && weapon && !unit.actionTakenThisTurn && unit.dadiAzione >= 1) {
    const dist = baseDistance(unit.position, enemy.position);
    // V2 D-049: solo armi con reach esplicito sono melee-capable
    const meleeCapable = weapon.range?.reach != null;
    const meleeRange = weapon.range?.reach ?? 0;
    // Threat in mischia: nemico (anche altro) melee con slancio>0 → ranged vietato
    const inMeleeThreat = Object.values(state.units).some(
      (u) => u.faction !== unit.faction && u.alive
        && baseDistance(unit.position, u.position) <= 1 && u.slancio > 0,
    );
    if (meleeCapable && dist <= meleeRange) {
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
    // Ranged: bloccato se in melee threat
    if (!inMeleeThreat) {
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
  }

  // D-051 / 2026-05-14 fix (bug A): ATTACCO OFFHAND (arma o scudo) per il nemico più vicino.
  // Senza questa generazione, il TS non aveva parità con `python/hex_tactics/ai/legal_moves.py`:
  // il modello distillato (training su Python) si trova indici diversi a inference → l'arciere
  // col pugnale offhand in mischia preferiva MOVE invece di pugnalare.
  if (enemy && unit.offhand && !unit.actionTakenThisTurn && unit.dadiAzione >= 1) {
    const offWeapon = getWeapon(unit.offhand);
    const offShield = getShield(unit.offhand);
    const dist = baseDistance(unit.position, enemy.position);
    if (offWeapon && offWeapon.range?.reach != null) {
      const offRange = offWeapon.range.reach;
      if (dist <= offRange) {
        for (let mi = 0; mi < offWeapon.attackModes.length; mi++) {
          const mode = offWeapon.attackModes[mi];
          moves.push({
            type: 'DECLARE_ATTACK',
            attackerId: unit.id,
            targetId: enemy.id,
            weaponId: offWeapon.id,
            attackModeIdx: mi,
            chosenStat: mode.stat === 'either' ? 'forza' : mode.stat,
            isRanged: false,
          });
        }
      }
    } else if (offShield && dist <= 1 && !unit.defensiveStance) {
      // Bludgeon con scudo: 1 modo, no dadi arma. NO se in stance.
      moves.push({
        type: 'DECLARE_ATTACK',
        attackerId: unit.id,
        targetId: enemy.id,
        weaponId: offShield.id,
        attackModeIdx: 0,
        chosenStat: undefined,
        isRanged: false,
      });
    }
  }

  // RELOAD: se l'arma con reload (cost-slancio o legacy) è scarica.
  // 2026-05-04 fix: include reloadCostSlancio (nuovo path) accanto a reload legacy.
  if (
    weapon &&
    weapon.range &&
    (weapon.range.reload != null || weapon.range.reloadCostSlancio != null) &&
    !unit.weaponLoaded &&
    !unit.actionTakenThisTurn &&
    unit.dadiAzione >= 1
  ) {
    if (weapon.range.reloadCostSlancio != null) {
      // Path slancio: serve solo che lo slancio sia ≥ costo
      if (unit.slancio >= weapon.range.reloadCostSlancio) {
        moves.push({ type: 'RELOAD', unitId: unit.id, diceN: 1 });
      }
    } else {
      // Path legacy prova abilità
      moves.push({ type: 'RELOAD', unitId: unit.id, diceN: 1 });
      if (unit.dadiAzione >= 2) moves.push({ type: 'RELOAD', unitId: unit.id, diceN: 2 });
    }
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
      // Fix 2026-05-04: tutti i 7 hex della basetta devono essere nella board.
      // Senza, CFR Nash kita off-map (bug confermato 44.6% out-of-bounds CFR Python).
      let outOfBounds = false;
      for (const bh of getBaseHexes(h)) {
        const off = axialToOffset(bh);
        if (off.col < 0 || off.col >= state.board.cols || off.row < 0 || off.row >= state.board.rows) {
          outOfBounds = true;
          break;
        }
      }
      if (outOfBounds) continue;
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

  // Fase 1: TOGGLE_DEFENSIVE (gratuita, max 1/turno, solo con scudo offhand)
  if (!unit.defensiveToggledThisTurn && unit.offhand && getShield(unit.offhand)) {
    moves.push({ type: 'TOGGLE_DEFENSIVE', unitId: unit.id });
  }

  // END_TURN sempre disponibile
  moves.push({ type: 'END_TURN' });

  return moves;
}

/**
 * Mosse legali per CHOOSE_ATTACKER_DICE.
 * 2026-05-05 fix:
 *  - cap base = 2 + countMaxDiceExtra (skill `+1dadomax [attaccare/...]` ora attiva)
 *  - +1 al cap se l'AttackMode dichiarato è isTwoHanded (regola 2h: PG +1d dalla riserva).
 */
function legalAttackerDiceMoves(state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  let extraMax = 0;
  let twoHandedBonus = 0;
  const pa = state.pendingAction;
  const weaponId = pa && 'weaponId' in pa ? (pa.weaponId as string) : unit.weapon;
  const modeIdx = pa && 'attackModeIdx' in pa ? (pa.attackModeIdx as number) : 0;
  if (weaponId) {
    const w = getWeapon(weaponId);
    if (w) {
      const ctx = makeAttackContext(w.id, w.category, undefined);
      extraMax = countMaxDiceExtra(unit.skills, ctx);
      if (modeIdx >= 0 && modeIdx < w.attackModes.length && w.attackModes[modeIdx].isTwoHanded) {
        twoHandedBonus = 1;
      }
    }
  }
  const maxDice = 2 + extraMax + twoHandedBonus;
  const upper = Math.min(maxDice, unit.dadiAzione);
  for (let d = 1; d <= upper; d++) {
    moves.push({ type: 'CHOOSE_ATTACKER_DICE', diceN: d });
  }
  return moves;
}

/**
 * Mosse legali per CHOOSE_DEFENSE.
 * 2026-05-05 fix: dodge/parry cap +1dadomax (skill); parry +1d se arma 2h.
 */
function legalDefenseMoves(_state: GameState, unit: Unit): GameEvent[] {
  const moves: GameEvent[] = [];
  // Niente difesa è sempre legale
  moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'none', diceN: 0 });

  // Dodge: skill `+1dadomax [schivare/...]`
  const dodgeExtra = countMaxDiceExtra(unit.skills, makeDodgeContext());
  const dodgeMax = 2 + dodgeExtra;
  for (let n = 1; n <= Math.min(dodgeMax, unit.dadiAzione); n++) {
    moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'dodge', diceN: n });
  }

  // Parry: skill `+1dadomax [parare/...]` + bonus 2h se l'arma ha qualsiasi modo 2h.
  const tryParry = (slot: 'weapon' | 'offhand'): void => {
    const id = slot === 'weapon' ? unit.weapon : unit.offhand;
    if (!id) return;
    const w = getWeapon(id);
    const sh = getShield(id);
    const canParry = (w && w.parry !== null) || sh != null;
    if (!canParry) return;
    const cat = w ? w.category : sh!.category;
    const parryExtra = countMaxDiceExtra(unit.skills, makeParryContext(id, cat));
    const twoHandedBonus = w && w.attackModes.some((m) => m.isTwoHanded) ? 1 : 0;
    const parryMax = 2 + parryExtra + twoHandedBonus;
    for (let n = 1; n <= Math.min(parryMax, unit.dadiAzione); n++) {
      moves.push({ type: 'CHOOSE_DEFENSE', defenseType: 'parry', parryWith: slot, diceN: n });
    }
  };
  tryParry('weapon');
  tryParry('offhand');

  return moves;
}

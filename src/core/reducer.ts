/**
 * Reducer principale: `reduce(state, event) → newState`.
 *
 * Pure function. Tutte le mutazioni di GameState passano da qui.
 * In multiplayer (post-MVP) sarà replicato sul server come autoritativo.
 */

import { GameState, appendLog, updateUnit, PendingAction, MoveInProgress } from './state';
import { Unit } from '@entities/Unit';
import { GameEvent, EventDeclareAttack } from './events';
import { createRng } from '@utils/rng';
import { applyTurnStart, applySlancioPenalty } from './turn';
import { computeTurnOrder, checkGameOver } from './round';
import { hexDistance } from './hex/distance';
import { hexLine } from './hex/line';
import { getBaseHexes, baseDistance } from './hex/base';
import { getShield } from '@data/shields';
import {
  composeAttackRoll,
  composeShieldAttackRoll,
  composeDodgeRoll,
  composeParryRoll,
  resolveDodge,
  resolveParry,
  resolveNoDefense,
  applyDamageWithArmor,
} from './combat';
import { computeLoS, composeRangedAttackRoll } from './ranged';
import { rollTotal, variableSum, makeRoll } from './dice';
import { getWeapon } from '@data/weapons';
import {
  countFlatBonuses,
  countForcedExtraDice,
  getActualDiceCount,
  getImpedimentTotal,
} from './stats';
import { BASE_PG_FIXED } from './combat';

/**
 * Reducer principale.
 *
 * Validazione di **phase**: ogni handler verifica che `state.phase` sia compatibile
 * con il tipo di evento. Eventi out-of-phase (es. MOVE durante CHOOSE_DEFENSE per
 * doppio-click rapido) vengono **rifiutati** con log warning, lo stato resta invariato.
 * Niente eccezioni thrown — il client può ricevere stato invariato e gestirlo.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'START_ROUND':
      return doStartRound(state);
    case 'START_TURN':
      return doStartTurn(state, event.slancioDice, event.impetoToSlancio ?? 0);
    case 'MOVE':
      return doMove(state, event.unitId, event.targetHex);
    case 'DECLARE_ATTACK':
      return doDeclareAttack(state, event);
    case 'CHOOSE_ATTACKER_DICE':
      return doChooseAttackerDice(state, event.diceN);
    case 'CHOOSE_DEFENSE':
      return doChooseDefense(state, event);
    case 'RESOLVE_COMBAT':
      return doResolveCombat(state);
    case 'RELOAD':
      return doReload(state, event.unitId, event.diceN);
    case 'END_TURN':
      return doEndTurn(state);
    case 'END_ROUND':
      return doEndRound(state);
    case 'BID_MOVEMENT':
      return doBidMovement(state, event.amount);
    case 'TOGGLE_DEFENSIVE':
      return doToggleDefensive(state, event.unitId);
    case 'CHOOSE_CARICA':
      return doChooseCarica(state, event.amount);
    default: {
      const _exhaust: never = event;
      void _exhaust;
      return state;
    }
  }
}

/**
 * Rifiuta un evento out-of-phase loggando il motivo, lascia lo stato invariato.
 * Il client può ispezionare l'ultimo log per capire perché un'azione è andata persa.
 */
function rejectEvent(state: GameState, eventType: string, reason: string): GameState {
  return appendLog(state, `[reducer] evento '${eventType}' rifiutato: ${reason} (phase=${state.phase})`);
}

/** Verifica che la fase sia tra quelle ammesse per l'evento. */
function ensurePhase(state: GameState, eventType: string, allowed: GameState['phase'][]): GameState | null {
  if (allowed.includes(state.phase)) return null; // ok, nessun reject
  return rejectEvent(state, eventType, `fase richiesta: ${allowed.join('|')}`);
}

function doStartRound(state: GameState): GameState {
  // Anti-loop: se il game è già over, niente
  if (state.phase === 'game-over') {
    return rejectEvent(state, 'START_ROUND', 'partita già conclusa');
  }

  // Calcola turn order con seed corrente
  const rng = createRng(state.rngSeed + state.round * 1000);
  const order = computeTurnOrder(state.units, rng);

  return {
    ...state,
    round: state.round + 1,
    turnOrder: order,
    currentTurnIdx: 0,
    phase: 'turn-start',
    rngSeed: rng.getState(),
    log: [
      ...state.log,
      { round: state.round + 1, turnUnitId: null, message: `── Inizio round ${state.round + 1} ──` },
    ],
  };
}

function doStartTurn(state: GameState, slancioDice: number, impetoToSlancio: number = 0): GameState {
  const reject = ensurePhase(state, 'START_TURN', ['turn-start']);
  if (reject) return reject;
  const unitId = state.turnOrder[state.currentTurnIdx];
  if (!unitId) return rejectEvent(state, 'START_TURN', 'turnOrder vuoto');
  const unit = state.units[unitId];
  if (!unit) return rejectEvent(state, 'START_TURN', `unit ${unitId} non trovata`);
  if (!unit.alive) return rejectEvent(state, 'START_TURN', `unit ${unitId} non viva`);

  const rng = createRng(state.rngSeed);
  const updated = applyTurnStart(unit, slancioDice, rng, impetoToSlancio);

  let newState = updateUnit(state, unitId, {
    dadiAzione: updated.dadiAzione,
    impeto: updated.impeto,
    slancio: updated.slancio,
    hexMovedThisTurn: updated.hexMovedThisTurn,
    actionTakenThisTurn: updated.actionTakenThisTurn,
    positionAtTurnStart: updated.positionAtTurnStart,
    defensiveToggledThisTurn: updated.defensiveToggledThisTurn,
    turnsPlayed: updated.turnsPlayed,
  });
  newState = appendLog(
    newState,
    `${unit.name}: turno start (dadi ${updated.dadiAzione}, impeto ${updated.impeto}, slancio ${updated.slancio})`,
  );
  return {
    ...newState,
    phase: 'choosing-action',
    rngSeed: rng.getState(),
    lastResolution: undefined,
  };
}

/**
 * Verifica se un esagono è entro l'area minacciata da un difensore avversario.
 *
 * V2 (regola universale): TUTTE le armi melee con `reach >= 1` triggerano l'asta.
 * Default: pugnale, spada, mazza, ascia 1h, ascia 2h hanno reach 1 (= 0.5m).
 * Spada lunga reach 2, lancia 2m reach 4, lancia 3m reach 6, giavellotto reach 2.
 *
 * NON triggerano:
 * - Disarmato (no weapon) → reach considerato 0
 * - Armi solo-ranged senza secondaria melee (arco, balestra) → reach undefined
 * - Difensore con slancio = 0 (non può biddare)
 *
 * In caso di più candidati, sceglie quello con reach maggiore (chi outranges di più).
 */
function checkThreatZone(state: GameState, moverId: string, targetHex: { q: number; r: number }): string | null {
  const mover = state.units[moverId];
  if (!mover) return null;
  type Cand = { id: string; reach: number };
  const candidates: Cand[] = [];
  for (const other of Object.values(state.units)) {
    if (other.id === moverId || !other.alive) continue;
    if (other.faction === mover.faction) continue;
    if (other.slancio <= 0) continue;
    if (!other.weapon) continue;
    const w = getWeapon(other.weapon);
    if (!w || !w.range || w.range.reach == null) continue;
    // V2: rimosso check reach >= 4. Ora ogni reach >= 1 (qualunque arma melee) triggera asta.
    if (w.range.reach < 1) continue;
    const d = hexDistance(other.position, targetHex);
    if (d <= w.range.reach) {
      candidates.push({ id: other.id, reach: w.range.reach });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.reach - a.reach) || a.id.localeCompare(b.id));
  return candidates[0].id;
}

/** Avanza il movimento step-by-step finché incontra un hex contestato (apre asta) o completa il path. */
function advanceMovement(state: GameState): GameState {
  if (!state.moveInProgress) return state;
  // eslint-disable-next-line no-constant-condition
  while (state.moveInProgress) {
    const mip = state.moveInProgress;
    if (mip.currentIdx >= mip.path.length) {
      return { ...state, moveInProgress: undefined };
    }
    const unit = state.units[mip.unitId];
    if (!unit) return { ...state, moveInProgress: undefined };
    const nextHex = mip.path[mip.currentIdx];

    // Verifica se contestato
    const defenderId = checkThreatZone(state, mip.unitId, nextHex);
    if (defenderId !== null) {
      const newMip: MoveInProgress = {
        ...mip,
        contestedHexIdx: mip.currentIdx,
        defenderId,
        attackerBid: undefined,
        defenderBid: undefined,
      };
      const defender = state.units[defenderId];
      let newState: GameState = { ...state, phase: 'awaiting-attacker-bid', moveInProgress: newMip };
      newState = appendLog(
        newState,
        `${unit.name}: zona di controllo di ${defender ? defender.name : defenderId} su (${nextHex.q},${nextHex.r}) — asta`,
      );
      return newState;
    }

    // Hex non contestato: applica step
    const cost = !mip.freeHexUsed && unit.hexMovedThisTurn === 0 ? 0 : 1;
    if (unit.slancio < cost) {
      return appendLog({ ...state, moveInProgress: undefined },
        `${unit.name}: movimento interrotto a (${unit.position.q},${unit.position.r}) — slancio insufficiente`);
    }
    // Verifica overlap basette
    const newPosBase = new Set(getBaseHexes(nextHex).map((h) => `${h.q},${h.r}`));
    let blocked = false;
    for (const other of Object.values(state.units)) {
      if (other.id === mip.unitId || !other.alive) continue;
      for (const h of getBaseHexes(other.position)) {
        if (newPosBase.has(`${h.q},${h.r}`)) { blocked = true; break; }
      }
      if (blocked) break;
    }
    if (blocked) {
      return appendLog({ ...state, moveInProgress: undefined },
        `${unit.name}: movimento bloccato (basetta nemica) a (${nextHex.q},${nextHex.r})`);
    }
    // Applica step
    state = updateUnit(state, mip.unitId, {
      position: { q: nextHex.q, r: nextHex.r },
      slancio: unit.slancio - cost,
      hexMovedThisTurn: unit.hexMovedThisTurn + 1,
    });
    state = { ...state, moveInProgress: { ...mip, currentIdx: mip.currentIdx + 1, freeHexUsed: true } };
  }
  return state;
}

function doMove(state: GameState, unitId: string, target: { q: number; r: number }): GameState {
  const reject = ensurePhase(state, 'MOVE', ['choosing-action']);
  if (reject) return reject;
  const unit = state.units[unitId];
  if (!unit) return rejectEvent(state, 'MOVE', `unit ${unitId} non trovata`);
  if (unit.id !== state.turnOrder[state.currentTurnIdx]) {
    return rejectEvent(state, 'MOVE', `non è il turno di ${unitId}`);
  }
  if (state.moveInProgress) {
    return rejectEvent(state, 'MOVE', 'movimento già in corso');
  }

  const dist = hexDistance(unit.position, target);
  if (dist === 0) {
    return rejectEvent(state, 'MOVE', 'target == posizione corrente');
  }

  // Cost stimate (free hex se prima mossa)
  const freeHexLeft = unit.hexMovedThisTurn === 0 ? 1 : 0;
  const costEstimate = Math.max(0, dist - freeHexLeft);
  if (unit.slancio < costEstimate) {
    return appendLog(state, `${unit.name}: movimento rifiutato (slancio insufficiente: ${unit.slancio} < ${costEstimate})`);
  }

  // Verifica destinazione (basetta) non sovrapposta
  const targetBase = new Set(getBaseHexes(target).map((h) => `${h.q},${h.r}`));
  for (const other of Object.values(state.units)) {
    if (other.id === unit.id || !other.alive) continue;
    for (const h of getBaseHexes(other.position)) {
      if (targetBase.has(`${h.q},${h.r}`)) {
        return appendLog(state, `${unit.name}: movimento rifiutato (basetta sovrapposta a ${other.name})`);
      }
    }
  }

  // Computa path con hexLine (escluso start)
  const fullLine = hexLine(unit.position, target);
  const path = fullLine.slice(1);

  const mip: MoveInProgress = {
    unitId,
    path,
    currentIdx: 0,
    freeHexUsed: false,
  };
  const newState = { ...state, moveInProgress: mip };
  return advanceMovement(newState);
}

function doDeclareAttack(state: GameState, e: EventDeclareAttack): GameState {
  const reject = ensurePhase(state, 'DECLARE_ATTACK', ['choosing-action']);
  if (reject) return reject;
  const attacker = state.units[e.attackerId];
  const target = state.units[e.targetId];
  if (!attacker) return rejectEvent(state, 'DECLARE_ATTACK', `attaccante ${e.attackerId} non trovato`);
  if (!target) return rejectEvent(state, 'DECLARE_ATTACK', `target ${e.targetId} non trovato`);
  if (!target.alive) return rejectEvent(state, 'DECLARE_ATTACK', `target ${e.targetId} è già caduto`);
  if (attacker.id !== state.turnOrder[state.currentTurnIdx]) {
    return rejectEvent(state, 'DECLARE_ATTACK', `non è il turno di ${e.attackerId}`);
  }
  if (state.pendingAction) {
    return rejectEvent(state, 'DECLARE_ATTACK', 'pendingAction già attivo');
  }
  if (attacker.actionTakenThisTurn) {
    return rejectEvent(state, 'DECLARE_ATTACK', `${e.attackerId} ha già usato la sua azione questo turno`);
  }
  if (attacker.dadiAzione < 1) {
    return rejectEvent(state, 'DECLARE_ATTACK', `${e.attackerId} ha 0 dadi azione (minimo 1 per attaccare)`);
  }
  // V2 D-049: ranged BLOCCATO se l'attaccante è in mischia con un nemico
  // melee con slancio>0 (invariante reducer, oltre al filter UI/AI).
  if (e.isRanged === true) {
    let inMeleeThreat = false;
    for (const u of Object.values(state.units)) {
      if (u.id === attacker.id || !u.alive) continue;
      if (u.faction === attacker.faction) continue;
      if (u.slancio <= 0) continue;
      const d = baseDistance(attacker.position, u.position);
      if (d <= 1) { inMeleeThreat = true; break; }
    }
    if (inMeleeThreat) {
      return rejectEvent(state, 'DECLARE_ATTACK',
        `${attacker.name}: ranged bloccato (in mischia con nemico slancio>0)`);
    }
  }

  const pending: PendingAction = {
    attackerId: e.attackerId,
    targetId: e.targetId,
    weaponId: e.weaponId,
    attackModeIdx: e.attackModeIdx,
    isRanged: e.isRanged === true,
    chosenStat: e.chosenStat,
    caricaAmount: 0,
  };

  // Fase 1: se arma carica-able + delta_dist > 0 + slancio > 0 → awaiting-carica
  const delta = deltaDistanceForCarica(attacker, target);
  const canCharge =
    canChargeWithWeapon(e.weaponId) && delta > 0 && attacker.slancio > 0;
  const nextPhase: GameState['phase'] = canCharge ? 'awaiting-carica' : 'declaring-attack';

  return {
    ...state,
    phase: nextPhase,
    pendingAction: pending,
    log: [
      ...state.log,
      {
        round: state.round,
        turnUnitId: e.attackerId,
        message: `${attacker.name} dichiara ${e.isRanged ? 'attacco a distanza' : 'attacco'} a ${target.name} con ${e.weaponId}`,
      },
    ],
  };
}

// === Fase 1 helpers ===

function canChargeWithWeapon(weaponId: string): boolean {
  // Ranged-only = ha range.distance senza reach o throw. Tutto il resto può caricare.
  const w = getWeapon(weaponId);
  if (!w || !w.range) return true;
  if (w.range.distance != null && w.range.throw == null && w.range.reach == null) return false;
  return true;
}

function deltaDistanceForCarica(attacker: Unit, target: Unit): number {
  if (!attacker.positionAtTurnStart) return 0;
  const dStart = baseDistance(attacker.positionAtTurnStart, target.position);
  const dNow = baseDistance(attacker.position, target.position);
  return Math.max(0, dStart - dNow);
}

function doChooseAttackerDice(state: GameState, diceN: number): GameState {
  const reject = ensurePhase(state, 'CHOOSE_ATTACKER_DICE', ['declaring-attack']);
  if (reject) return reject;
  if (!state.pendingAction) {
    return rejectEvent(state, 'CHOOSE_ATTACKER_DICE', 'pendingAction mancante');
  }
  if (diceN < 1) {
    return rejectEvent(state, 'CHOOSE_ATTACKER_DICE', `diceN < 1 (minimo 1 dado per attaccare)`);
  }
  // Per attacchi ranged, salta lo step di scelta difensiva (D-032).
  if (state.pendingAction.isRanged) {
    return {
      ...state,
      phase: 'resolving',
      pendingAction: { ...state.pendingAction, attackerDice: diceN },
    };
  }
  return {
    ...state,
    phase: 'awaiting-defense',
    pendingAction: { ...state.pendingAction, attackerDice: diceN },
  };
}

function doChooseDefense(
  state: GameState,
  e: { defenseType: 'parry' | 'dodge' | 'none'; parryWith?: 'weapon' | 'offhand'; diceN: number },
): GameState {
  const reject = ensurePhase(state, 'CHOOSE_DEFENSE', ['awaiting-defense']);
  if (reject) return reject;
  if (!state.pendingAction) {
    return rejectEvent(state, 'CHOOSE_DEFENSE', 'pendingAction mancante');
  }
  if (e.diceN < 0) {
    return rejectEvent(state, 'CHOOSE_DEFENSE', `diceN negativo (${e.diceN})`);
  }
  return {
    ...state,
    phase: 'resolving',
    pendingAction: {
      ...state.pendingAction,
      defense: {
        type: e.defenseType,
        diceN: e.diceN,
        parryWith: e.parryWith,
      },
    },
  };
}

function doResolveCombat(state: GameState): GameState {
  const reject = ensurePhase(state, 'RESOLVE_COMBAT', ['resolving']);
  if (reject) return reject;
  if (!state.pendingAction) {
    return rejectEvent(state, 'RESOLVE_COMBAT', 'pendingAction mancante');
  }
  const pa = state.pendingAction;
  if (pa.attackerDice == null) {
    return rejectEvent(state, 'RESOLVE_COMBAT', 'attackerDice non scelti');
  }
  if (!pa.isRanged && !pa.defense) {
    return rejectEvent(state, 'RESOLVE_COMBAT', 'difesa CaC non scelta');
  }
  const attacker = state.units[pa.attackerId];
  const target = state.units[pa.targetId];
  if (!attacker) return rejectEvent(state, 'RESOLVE_COMBAT', `attaccante ${pa.attackerId} non trovato`);
  if (!target) return rejectEvent(state, 'RESOLVE_COMBAT', `target ${pa.targetId} non trovato`);

  const rng = createRng(state.rngSeed);

  let attRoll;
  let result;

  if (pa.isRanged) {
    const los = computeLoS(attacker, target, state.units);
    attRoll = composeRangedAttackRoll(
      attacker,
      pa.weaponId,
      pa.attackModeIdx,
      pa.chosenStat,
      pa.attackerDice,
      target,
      los,
      rng,
      { caricaAmount: pa.caricaAmount ?? 0 },
    );
    result = resolveNoDefense(attRoll);
  } else {
    // CaC: scelta del difensore
    // D-051: se weaponId è uno SCUDO (offhand), usa composeShieldAttackRoll
    const shieldAttack = getShield(pa.weaponId);
    if (shieldAttack) {
      const shRoll = composeShieldAttackRoll(attacker, pa.weaponId, pa.attackerDice, rng);
      attRoll = shRoll ?? composeAttackRoll(attacker, pa.weaponId, pa.attackModeIdx, pa.chosenStat, pa.attackerDice, rng,
        { target, caricaAmount: pa.caricaAmount ?? 0 });
    } else {
      attRoll = composeAttackRoll(attacker, pa.weaponId, pa.attackModeIdx, pa.chosenStat, pa.attackerDice, rng,
        { target, caricaAmount: pa.caricaAmount ?? 0 });
    }
    if (pa.defense!.type === 'dodge') {
      const dodgeRoll = composeDodgeRoll(target, pa.defense!.diceN, rng);
      result = resolveDodge(attRoll, dodgeRoll);
    } else if (pa.defense!.type === 'parry') {
      const parryWith = pa.defense!.parryWith ?? 'weapon';
      const parryRoll = composeParryRoll(target, parryWith, pa.defense!.diceN, rng);
      if (!parryRoll) {
        result = resolveNoDefense(attRoll);
      } else {
        result = resolveParry(attRoll, parryRoll);
      }
    } else {
      result = resolveNoDefense(attRoll);
    }
  }

  // Spendi dadi azione: attaccante perde i suoi dadi PG (chosen, non actual) — D-030
  let newState: GameState = state;
  // Se arma con reload (cost-slancio o legacy prova), dopo il tiro diventa scarica
  const attackerWeaponData = getWeapon(pa.weaponId);
  const becomeUnloaded =
    pa.isRanged &&
    (attackerWeaponData?.range?.reload != null ||
      attackerWeaponData?.range?.reloadCostSlancio != null);
  // 2026-05-05 (rev3): armi 'throw' (no distance) sono SINGLE-USE.
  // Dopo lancio: pop prossima da thrownInventory → altrimenti backupWeapon → altrimenti disarmato.
  const isThrownSingleUse =
    pa.isRanged &&
    attackerWeaponData?.range?.throw != null &&
    attackerWeaponData?.range?.distance == null;
  const update: Partial<typeof attacker> = {
    dadiAzione: Math.max(0, attacker.dadiAzione - pa.attackerDice),
    actionTakenThisTurn: true,
    ...(becomeUnloaded ? { weaponLoaded: false } : {}),
  };
  if (isThrownSingleUse) {
    const inv = attacker.thrownInventory ? [...attacker.thrownInventory] : [];
    if (inv.length > 0) {
      update.weapon = inv.shift() as any;
      update.thrownInventory = inv;
    } else if (attacker.backupWeapon) {
      update.weapon = attacker.backupWeapon;
      update.backupWeapon = undefined;
    } else {
      update.weapon = undefined;
    }
  }
  newState = updateUnit(newState, attacker.id, update);
  if (!pa.isRanged && pa.defense && pa.defense.type !== 'none') {
    newState = updateUnit(newState, target.id, {
      dadiAzione: Math.max(0, target.dadiAzione - pa.defense.diceN),
    });
  }

  // Log dei tiri
  const attDescr = `var=[${attRoll.variable.join(',')}](sum ${variableSum(attRoll)}) + fix ${attRoll.fixed} = total ${rollTotal(attRoll)}`;
  newState = appendLog(newState, `${attacker.name} tira ${pa.isRanged ? 'attacco ranged' : 'attacco'}: ${attDescr}`);
  if (!pa.isRanged && pa.defense && pa.defense.type !== 'none') {
    const dr = result.defenderRoll;
    const defDescr = `var=[${dr.variable.join(',')}](sum ${variableSum(dr)}) + fix ${dr.fixed} = total ${rollTotal(dr)}`;
    newState = appendLog(newState, `${target.name} tira ${pa.defense.type}: ${defDescr}`);
  }

  // V2: tracking per lastResolution
  let trackedEffectiveDamage = 0;
  // Applica risultato
  if (result.hit) {
    // D-043: per ranged "il tiro è il danno" — RD armatura già pagata al tiro
    // (vedi composeRangedAttackRoll). NON ri-applicare RD al damage stage.
    const dmg = pa.isRanged
      ? { effectiveDamage: result.rawDamage, newHp: Math.max(0, target.hp - result.rawDamage) }
      : applyDamageWithArmor(target, result.rawDamage);
    trackedEffectiveDamage = dmg.effectiveDamage;
    newState = updateUnit(newState, target.id, {
      hp: dmg.newHp,
      alive: dmg.newHp > 0,
    });
    newState = appendLog(
      newState,
      `${attacker.name} colpisce ${target.name} per ${dmg.effectiveDamage} danni (raw ${result.rawDamage}, RD ${result.rawDamage - dmg.effectiveDamage}). HP: ${dmg.newHp}/${target.hpMax}`,
    );
    // D-048: contraccolpo allo slancio del difensore = rawDamage (PRE-RD).
    // L'armatura assorbe gli HP ma il colpo destabilizza comunque. Slancio sotto 0 propaga
    // a impeto (regola esistente in applySlancioPenalty).
    if (result.rawDamage > 0) {
      const targetAfterHit = newState.units[target.id];
      if (targetAfterHit && targetAfterHit.alive) {
        const updated = applySlancioPenalty(targetAfterHit, result.rawDamage);
        newState = updateUnit(newState, target.id, {
          slancio: updated.slancio,
          impeto: updated.impeto,
        });
        newState = appendLog(
          newState,
          `${target.name} contraccolpo: -${result.rawDamage} slancio (slancio ${updated.slancio}, impeto ${updated.impeto})`,
        );
      }
    }
    if (dmg.newHp === 0) {
      newState = appendLog(newState, `${target.name} è caduto!`);
    }
  } else {
    // Miss
    if (pa.isRanged) {
      newState = appendLog(newState, `${attacker.name} manca ${target.name} (tiro ${rollTotal(attRoll)} <= 0 dopo malus)`);
    } else if (pa.defense) {
      // CaC miss: penalty allo slancio dell'attaccante
      if (result.slancioPenaltyToAttacker > 0) {
        const updated = applySlancioPenalty(attacker, result.slancioPenaltyToAttacker);
        newState = updateUnit(newState, attacker.id, {
          slancio: updated.slancio,
          impeto: updated.impeto,
        });
        newState = appendLog(
          newState,
          `${target.name} ha ${pa.defense.type === 'parry' ? 'parato' : 'schivato'}. ${attacker.name} perde ${result.slancioPenaltyToAttacker} slancio`,
        );
      } else {
        newState = appendLog(newState, `${target.name} ha ${pa.defense.type === 'parry' ? 'parato' : 'schivato'} senza penalty`);
      }
    }
  }

  // V2: applicazione slancio loss da imp variabile (atk/def). Cumulativo a slancioPenalty
  // se entrambi presenti. Floor a 0 sul totale.
  if (result.slancioLossAttackerImp > 0) {
    const aktNow = newState.units[attacker.id];
    if (aktNow && aktNow.alive) {
      const updated = applySlancioPenalty(aktNow, result.slancioLossAttackerImp);
      newState = updateUnit(newState, attacker.id, {
        slancio: updated.slancio,
        impeto: updated.impeto,
      });
      newState = appendLog(
        newState,
        `${attacker.name} impedimento eccessivo: -${result.slancioLossAttackerImp} slancio (sl ${updated.slancio}, imp ${updated.impeto})`,
      );
    }
  }
  if (result.slancioLossDefenderImp > 0) {
    const defNow = newState.units[target.id];
    if (defNow && defNow.alive) {
      const updated = applySlancioPenalty(defNow, result.slancioLossDefenderImp);
      newState = updateUnit(newState, target.id, {
        slancio: updated.slancio,
        impeto: updated.impeto,
      });
      newState = appendLog(
        newState,
        `${target.name} impedimento eccessivo: -${result.slancioLossDefenderImp} slancio (sl ${updated.slancio}, imp ${updated.impeto})`,
      );
    }
  }

  // V2: esposto lastResolution per UI animazione dadi (con breakdown numerico + esito)
  const defType: 'parry' | 'dodge' | 'none' = (pa.defense?.type ?? 'none') as 'parry' | 'dodge' | 'none';
  // Residuo: per dodge = variabile_atk - totale_def; per parry = totale_atk - totale_def
  let residual = 0;
  if (defType === 'dodge') {
    residual = variableSum(attRoll) - rollTotal(result.defenderRoll);
  } else if (defType === 'parry') {
    residual = rollTotal(attRoll) - rollTotal(result.defenderRoll);
  } else {
    // No defense (incl. ranged): residuo = totale_atk
    residual = rollTotal(attRoll);
  }
  const lastResolution = {
    attackerName: attacker.name,
    attackerDice: [...attRoll.variable],
    attackerFixed: attRoll.fixed,
    attackerVariable: variableSum(attRoll),
    attackerTotal: rollTotal(attRoll),
    defenderName: target.name,
    defenderDice: [...result.defenderRoll.variable],
    defenderFixed: result.defenderRoll.fixed,
    defenderTotal: rollTotal(result.defenderRoll),
    isRanged: pa.isRanged,
    defenseType: defType,
    residual,
    hit: result.hit,
    rawDamage: result.rawDamage,
    effectiveDamage: trackedEffectiveDamage,
  };

  return {
    ...newState,
    phase: 'choosing-action',
    pendingAction: undefined,
    rngSeed: rng.getState(),
    lastResolution,
  };
}

/**
 * Ricarica un'arma (es. balestra). Tiro di abilità con stat FORZA, difficoltà 7.
 * Tira 1-2 d6 + 2 + skill (azione=ricaricare) − impedimento. Se totale ≥ 7: arma carica.
 * Se fallisce: nessuna penalità, può ritentare al prossimo turno.
 * Costa `diceN` dadi azione (D-030).
 */
function doReload(state: GameState, unitId: string, diceN: number): GameState {
  const reject = ensurePhase(state, 'RELOAD', ['choosing-action']);
  if (reject) return reject;
  const unit = state.units[unitId];
  if (!unit) return rejectEvent(state, 'RELOAD', `unit ${unitId} non trovata`);
  if (unit.id !== state.turnOrder[state.currentTurnIdx]) {
    return rejectEvent(state, 'RELOAD', `non è il turno di ${unitId}`);
  }
  if (!unit.weapon) return rejectEvent(state, 'RELOAD', 'nessuna arma equipaggiata');
  const weapon = getWeapon(unit.weapon);
  if (!weapon) return rejectEvent(state, 'RELOAD', 'arma non trovata');
  if (!weapon.range || (weapon.range.reload == null && weapon.range.reloadCostSlancio == null)) {
    return rejectEvent(state, 'RELOAD', 'arma non richiede ricarica');
  }
  if (unit.weaponLoaded) return rejectEvent(state, 'RELOAD', 'arma già carica');
  if (unit.actionTakenThisTurn) {
    return rejectEvent(state, 'RELOAD', `${unitId} ha già usato la sua azione questo turno`);
  }

  // 2026-05-04: NEW path costo-slancio fisso. Sostituisce la prova abilità.
  // 2026-05-04 (rev2): NON setta actionTakenThisTurn=true — lo SLANCIO è il costo,
  // non l'azione del turno. Permette reload+shoot nello stesso turno.
  if (weapon.range.reloadCostSlancio != null) {
    const cost = weapon.range.reloadCostSlancio;
    if (unit.slancio < cost) {
      return rejectEvent(state, 'RELOAD', `slancio insufficiente (${unit.slancio} < ${cost})`);
    }
    let newState = updateUnit(state, unitId, {
      slancio: unit.slancio - cost,
      weaponLoaded: true,
    });
    newState = appendLog(
      newState,
      `${unit.name}: ricarica ${weapon.name} (paga ${cost} slancio, slancio rimasto: ${unit.slancio - cost}) → CARICA ✓`,
    );
    return newState;
  }

  // LEGACY: prova abilità (path mantenuto per eventual armi senza reloadCostSlancio)
  if (diceN < 1) return rejectEvent(state, 'RELOAD', `diceN < 1 (minimo 1 dado per ricaricare)`);
  if (unit.dadiAzione < diceN) {
    return rejectEvent(state, 'RELOAD', `dadi azione insufficienti (${unit.dadiAzione} < ${diceN})`);
  }

  const ctx = {
    azione: 'ricaricare' as const,
    stat: 'forza' as const,
    classeOggetto: weapon.category,
    oggettoSpecifico: weapon.id,
  };
  const rng = createRng(state.rngSeed);
  const actualDice = getActualDiceCount(unit, ctx, diceN);
  const roll = makeRoll(rng, actualDice, BASE_PG_FIXED);
  roll.fixed += countFlatBonuses(unit.skills, ctx);
  // V2: imp alla variabile, non alla fissa.
  roll.variableMod = (roll.variableMod ?? 0) - getImpedimentTotal(unit);
  // Anche +1 dado forzato già applicato in getActualDiceCount; countForcedExtraDice solo per log
  const forcedExtra = countForcedExtraDice(unit.skills, ctx);
  void forcedExtra;

  const total = rollTotal(roll);
  const difficulty = weapon.range.reload;
  const success = total >= difficulty;

  let newState = updateUnit(state, unitId, {
    dadiAzione: Math.max(0, unit.dadiAzione - diceN),
    weaponLoaded: success ? true : unit.weaponLoaded,
    actionTakenThisTurn: true, // ricaricare consuma l'azione del turno
  });
  newState = appendLog(
    newState,
    `${unit.name}: ricarica ${weapon.name} (var=[${roll.variable.join(',')}] sum ${variableSum(roll)} + fix ${roll.fixed} = ${total} vs diff ${difficulty}) → ${success ? 'CARICA ✓' : 'fallita, ritenta'}`,
  );
  return newState;
}

function doEndTurn(state: GameState): GameState {
  const reject = ensurePhase(state, 'END_TURN', ['choosing-action', 'turn-start']);
  if (reject) return reject;
  // Se c'è un pendingAction in mezzo (es. attacco non risolto), rifiuta:
  // forzare END_TURN durante una sequenza combat lascerebbe stato sporco.
  if (state.pendingAction) {
    return rejectEvent(state, 'END_TURN', 'pendingAction in corso, completarlo prima');
  }
  // Skip eventuali unit cadute nel turnOrder (futuro: 4v4, dove un'unità può
  // morire prima del proprio turno per effetti d'area).
  let nextIdx = state.currentTurnIdx + 1;
  while (nextIdx < state.turnOrder.length) {
    const u = state.units[state.turnOrder[nextIdx]];
    if (u && u.alive) break;
    nextIdx++;
  }
  if (nextIdx >= state.turnOrder.length) {
    // Fine round
    return doEndRound(state);
  }
  return { ...state, currentTurnIdx: nextIdx, phase: 'turn-start' };
}

function doEndRound(state: GameState): GameState {
  // Filtra turn order rimuovendo unit morte
  // Verifica game over
  const winner = checkGameOver(state.units);
  if (winner) {
    let s = appendLog(state, `Game over: vincitore ${winner === 'draw' ? 'pareggio' : `fazione ${winner}`}`);
    return { ...s, phase: 'game-over', winner: winner };
  }
  // Prossimo round
  return doStartRound(state);
}

// === Fase 1 handlers ===

/**
 * CHOOSE_CARICA — bonus alla fissa atk = amount, costa amount slancio.
 * Clampato a delta_distance e slancio attuale.
 */
function doChooseCarica(state: GameState, amount: number): GameState {
  const reject = ensurePhase(state, 'CHOOSE_CARICA', ['awaiting-carica']);
  if (reject) return reject;
  if (!state.pendingAction) {
    return rejectEvent(state, 'CHOOSE_CARICA', 'pendingAction mancante');
  }
  const pa = state.pendingAction;
  const attacker = state.units[pa.attackerId];
  const target = state.units[pa.targetId];
  if (!attacker || !target) {
    return rejectEvent(state, 'CHOOSE_CARICA', 'atk/target non trovato');
  }
  const delta = deltaDistanceForCarica(attacker, target);
  const maxCarica = Math.min(delta, attacker.slancio);
  const clamped = Math.max(0, Math.min(amount, maxCarica));

  let newState = updateUnit(state, attacker.id, { slancio: attacker.slancio - clamped });
  newState = {
    ...newState,
    phase: 'declaring-attack',
    pendingAction: { ...pa, caricaAmount: clamped },
  };
  if (clamped > 0) {
    newState = appendLog(newState, `${attacker.name}: carica +${clamped} (delta_dist=${delta}, slancio -${clamped})`);
  }
  return newState;
}

/**
 * TOGGLE_DEFENSIVE — entra/esce dalla posizione difensiva con scudo.
 * Azione gratuita, max 1 toggle/turno. Solo scudi veri.
 */
function doToggleDefensive(state: GameState, unitId: string): GameState {
  const reject = ensurePhase(state, 'TOGGLE_DEFENSIVE', ['choosing-action']);
  if (reject) return reject;
  const unit = state.units[unitId];
  if (!unit) return rejectEvent(state, 'TOGGLE_DEFENSIVE', `unit ${unitId} non trovata`);
  if (unit.id !== state.turnOrder[state.currentTurnIdx]) {
    return rejectEvent(state, 'TOGGLE_DEFENSIVE', `non è il turno di ${unitId}`);
  }
  if (unit.defensiveToggledThisTurn) {
    return rejectEvent(state, 'TOGGLE_DEFENSIVE', 'già toggled in questo turno');
  }
  if (!unit.offhand) {
    return rejectEvent(state, 'TOGGLE_DEFENSIVE', 'no offhand');
  }
  const sh = getShield(unit.offhand);
  if (!sh) {
    return rejectEvent(state, 'TOGGLE_DEFENSIVE', 'offhand non è uno scudo');
  }
  const newStance = !unit.defensiveStance;
  let newState = updateUnit(state, unitId, {
    defensiveStance: newStance,
    defensiveToggledThisTurn: true,
  });
  const label = newStance ? 'ATTIVA' : 'DISATTIVA';
  newState = appendLog(newState, `${unit.name}: ${label} posizione difensiva con ${sh.name}`);
  return newState;
}

/**
 * BID_MOVEMENT — meccanica A. Asta nascosta atk/def per attraversare zona reach.
 * Phase awaiting-attacker-bid: salva atk_bid → awaiting-defender-bid.
 * Phase awaiting-defender-bid: risolvi (atk_bid > def_bid → atk vince, parità → def), entrambi pagano.
 *
 * Regola D-052: atk paga sempre `1 + atk_bid` (1 fisso movimento + bid), def paga `def_bid`.
 * Atk bid clampato in [0, slancio-1] per riservare 1 slancio al movimento.
 */
function doBidMovement(state: GameState, amount: number): GameState {
  if (!state.moveInProgress) {
    return rejectEvent(state, 'BID_MOVEMENT', 'nessun movimento in corso');
  }
  const mip = state.moveInProgress;

  if (state.phase === 'awaiting-attacker-bid') {
    const unit = state.units[mip.unitId];
    if (!unit) return rejectEvent(state, 'BID_MOVEMENT', 'attaccante non trovato');
    // Atk deve riservare 1 slancio per il costo fisso movimento → bid max = slancio - 1
    const maxBid = Math.max(0, unit.slancio - 1);
    const clamped = Math.max(0, Math.min(amount, maxBid));
    const newMip: MoveInProgress = { ...mip, attackerBid: clamped, defenderBid: undefined };
    return { ...state, phase: 'awaiting-defender-bid', moveInProgress: newMip };
  }

  if (state.phase === 'awaiting-defender-bid') {
    if (!mip.defenderId || mip.attackerBid == null) {
      return rejectEvent(state, 'BID_MOVEMENT', 'stato bid corrotto');
    }
    const defender = state.units[mip.defenderId];
    if (!defender) return rejectEvent(state, 'BID_MOVEMENT', 'difensore non trovato');
    const clamped = Math.max(0, Math.min(amount, defender.slancio));
    const atkBid = mip.attackerBid;
    const defBid = clamped;
    const atkWins = atkBid > defBid;  // D-052: parità → def vince
    const atkUnit = state.units[mip.unitId];
    if (!atkUnit) return rejectEvent(state, 'BID_MOVEMENT', 'atk non trovato');

    // D-052: atk paga 1 fisso (movimento) + bid; def paga solo bid
    const atkTotal = atkBid + 1;
    let newState = updateUnit(state, mip.unitId, { slancio: atkUnit.slancio - atkTotal });
    newState = updateUnit(newState, mip.defenderId, { slancio: defender.slancio - defBid });
    const resultStr = atkWins ? 'passa' : 'BLOCCATO';
    newState = appendLog(newState,
      `  asta: atk=${atkBid} vs def=${defBid} → ${resultStr} (atk -${atkTotal} sla [${atkBid} bid + 1 move], def -${defBid} sla)`);

    if (atkWins) {
      // Continua MOVE: applica step. D-052: il costo movimento dell'esagono è già
      // stato pagato come parte del "+1 fisso" dell'asta — qui non si paga di nuovo.
      const nextHex = mip.path[mip.currentIdx];
      const atkAfter = newState.units[mip.unitId];
      const newPosBase = new Set(getBaseHexes(nextHex).map((h) => `${h.q},${h.r}`));
      let blocked = false;
      for (const other of Object.values(newState.units)) {
        if (other.id === mip.unitId || !other.alive) continue;
        for (const h of getBaseHexes(other.position)) {
          if (newPosBase.has(`${h.q},${h.r}`)) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (blocked) {
        return appendLog({ ...newState, phase: 'choosing-action', moveInProgress: undefined },
          `${atkUnit.name}: post-asta, basetta bloccata`);
      }
      newState = updateUnit(newState, mip.unitId, {
        position: { q: nextHex.q, r: nextHex.r },
        // costo movimento già pagato come +1 fisso dell'asta
        hexMovedThisTurn: atkAfter.hexMovedThisTurn + 1,
      });
      newState = {
        ...newState,
        phase: 'choosing-action',
        moveInProgress: { ...mip, currentIdx: mip.currentIdx + 1, freeHexUsed: true,
          contestedHexIdx: undefined, defenderId: undefined,
          attackerBid: undefined, defenderBid: undefined },
      };
      return advanceMovement(newState);
    } else {
      // Atk perde: stop movement
      return { ...newState, phase: 'choosing-action', moveInProgress: undefined };
    }
  }

  return rejectEvent(state, 'BID_MOVEMENT', `phase ${state.phase} non valida per bid`);
}

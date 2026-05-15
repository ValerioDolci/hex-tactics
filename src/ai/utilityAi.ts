/**
 * Utility AI: per ogni mossa legale, calcola un punteggio di utilità
 * combinando metriche del gioco. Sceglie la mossa con utility massima.
 *
 * Vantaggi: deterministico, debuggabile, parametrizzabile (cambi i pesi e
 * cambi "personalità" dell'AI). Niente training, niente rollout.
 *
 * Limitazione: la quality dipende dalle funzioni di utilità scritte a mano.
 */

import { GameState } from '@core/state';
import { GameEvent } from '@core/events';
import { UnitId } from '@entities/Unit';
import { baseDistance } from '@core/hex/base';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { canFireRanged } from '@core/ranged';
import { findClosestEnemy } from './basicAi';
import { legalMoves } from './legalMoves';
import {
  countFlatBonuses,
  getImpedimentTotal,
  makeAttackContext,
  makeDodgeContext,
  makeParryContext,
} from '@core/stats';


/** Pesi configurabili (default: AI bilanciata) */
export interface UtilityWeights {
  /** Quanto vale infliggere danni stimati */
  damageDealt: number;
  /** Quanto vale evitare danni (per le difese) */
  damageAvoided: number;
  /** Quanto vale chiudere la distanza con il nemico */
  closeDistance: number;
  /** Quanto vale conservare HP propri */
  selfHp: number;
  /** Quanto vale risparmiare dadi azione (per turni futuri) */
  saveDice: number;
  /** Penalità per movimento inutile */
  wastedMove: number;
}

export const DEFAULT_WEIGHTS: UtilityWeights = {
  damageDealt: 1.0,
  damageAvoided: 0.8,
  closeDistance: 0.5,
  selfHp: 0.3,
  saveDice: 0.1,
  wastedMove: -0.2,
};

/** Sceglie la mossa con utility massima. Tie-break: prima nella lista. */
export function utilityDecideMove(
  state: GameState,
  unitId: UnitId,
  weights: UtilityWeights = DEFAULT_WEIGHTS,
): GameEvent {
  const moves = legalMoves(state, unitId);
  if (moves.length === 0) return { type: 'END_TURN' };

  let bestMove: GameEvent = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(state, unitId, move, weights);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

/** Calcola il punteggio di utilità di una mossa specifica nello stato corrente. */
export function scoreMove(
  state: GameState,
  unitId: UnitId,
  move: GameEvent,
  w: UtilityWeights,
): number {
  const me = state.units[unitId];
  if (!me) return -Infinity;
  const enemy = findClosestEnemy(state, me);

  switch (move.type) {
    case 'START_TURN': {
      // D-044: se c'è una minaccia ranged (nemico con arma a distanza in grado di spararmi),
      // lo slancio alto + transfer impeto→slancio agisce da scudo (riduce il tiro nemico 1:1).
      // Quando non c'è minaccia ranged, vale la regola classica: max dadi se devi muovere,
      // 0 se già in mischia.
      const transfer = move.impetoToSlancio ?? 0;
      if (!enemy || !me.weapon) return move.slancioDice === 2 && transfer === 0 ? 1 : 0;
      const weapon = getWeapon(me.weapon);
      // 2026-05-15 (Bug B propagation fix): per armi ranged-only (no reach) il
      // default era 1 → considerava "in mischia se dist ≤ 1" e ritornava 0 sla.
      // Per arco scarico significava: niente slancio → niente reload → niente shot.
      const reach = weapon?.range?.reach ?? 0;
      const dist = baseDistance(me.position, enemy.position);

      // Minaccia ranged? (nemico con arma ranged caricata + LoS verso me)
      let rangedThreatDamage = 0;
      const enemyWeapon = enemy.weapon ? getWeapon(enemy.weapon) : null;
      if (enemyWeapon?.range && (enemyWeapon.range.distance != null || enemyWeapon.range.throw != null)) {
        const can = canFireRanged(enemy, me, enemyWeapon.id, state.units);
        if (can.ok && can.los) {
          // Stima danno atteso del nemico: variabile (PG+arma)*3.5 + fissi (skill+visibility-dist-imp-passivi)
          const mode = enemyWeapon.attackModes[0];
          const enemyDicePG = 2;
          const expectedVar = (enemyDicePG + mode.diceVariable) * 3.5;
          const expectedFixed =
            2 + mode.fixedBonus + can.los.visibility - Math.floor(can.los.distance / (enemyWeapon.range.rangedDivisor ?? 3));
          rangedThreatDamage = Math.max(0, expectedVar + expectedFixed);
        }
      }

      // Caso minaccia ranged alta: privilegia slancio massimo + transfer.
      // Ogni punto di slancio in più toglie 1 al damage nemico (single application D-043).
      if (rangedThreatDamage > 5) {
        // Score = damage evitato dal mio slancio totale (atteso ≈ 9 da 2d6+2 + transfer)
        const expectedSlancio = move.slancioDice === 2 ? 9 : move.slancioDice === 1 ? 5.5 : 0;
        const totalSlancioGain = expectedSlancio + transfer;
        // Bonus: maggior slancio futuro = anche mobilità
        return totalSlancioGain * 0.5 - transfer * 0.05; // piccola penalty per "non bruciare impeto"
      }

      // Catch-up logic SOFT: solo se deficit grave AND non ho scudo (no buffer parry).
      // Idea: chi ha scudo vince con parry; chi non ha scudo deve massimizzare slancio.
      const myInit = me.impeto + me.slancio;
      const enemyInit = enemy.impeto + enemy.slancio;
      const initDeficit = enemyInit - myInit;
      const hasShield = me.offhand && getShield(me.offhand) != null;
      const severeDeficit = initDeficit >= 10;

      // Budget consciousness: penalità se la scelta lascerebbe pochi dadi per parare.
      // Recovery medio = ⌊(F+A+V)/2⌋ = 3. Se sceglie 2d slancio, restano (dadiAzione-2) per
      // attack+parry. Se < 4 totale, rischio di non avere dadi per difesa critica.
      const slancioCost = move.slancioDice;
      const budgetAfter = me.dadiAzione - slancioCost;
      const lowBudget = budgetAfter < 4;
      const budgetPenalty = lowBudget ? -1.5 : 0;

      if (severeDeficit && !hasShield) {
        // Senza scudo + svantaggio grave: catch-up con max slancio
        if (move.slancioDice === 2) {
          const usefulTransfer = Math.min(transfer, Math.max(0, initDeficit - 5));
          return 2.5 + usefulTransfer * 0.15 + budgetPenalty;
        }
        return move.slancioDice === 1 ? 1 + budgetPenalty : 0;
      }

      // No minaccia ranged + no catch-up: regola classica con budget penalty
      if (transfer > 0) return -2;
      // 2026-05-15 (Bug B): check valido solo per armi melee-capable (reach >= 1).
      // Per ranged-only la regola "in mischia → 0 dadi" non si applica.
      if (reach >= 1 && dist <= reach) {
        // In mischia: 0 dadi (risparmia) — confermato ottimale per build con scudo
        return move.slancioDice === 0 ? 2 : -1 + budgetPenalty;
      }
      // Lontano: max dadi (ma se budget basso, contenere)
      return (move.slancioDice === 2 ? 2 : move.slancioDice === 1 ? 1 : 0) + budgetPenalty;
    }

    case 'DECLARE_ATTACK': {
      if (!enemy) return -1;
      const target = state.units[move.targetId];
      if (!target) return -1;
      // Stima danno atteso assumendo 2 dadi PG (D-047: con 2d l'arma dual-stat dà +bonus extra)
      const weapon = getWeapon(move.weaponId);
      if (!weapon) return -1;
      const mode = weapon.attackModes[move.attackModeIdx];
      // Variabile: 2d PG + diceVariable arma
      const expectedAttackerVar = (2 + mode.diceVariable) * 3.5;
      // Fissa: 2 (PG) + fixedBonus arma
      let expectedFixed = 2 + mode.fixedBonus;
      // D-047: se l'arma ha 2 modes con stat 'forza'/'agilità' (dual-stat), aggiungi
      // il fixedBonus dell'altro mode (perché il giocatore userà 2d → entrambi i bonus).
      if (mode.stat !== 'either' && weapon.attackModes.length >= 2) {
        const otherMode = weapon.attackModes.find(
          (m, i) => i !== move.attackModeIdx && m.stat !== 'either' && m.stat !== mode.stat,
        );
        if (otherMode) expectedFixed += otherMode.fixedBonus;
      }
      const expectedDmg = expectedAttackerVar + expectedFixed;
      // Bonus se finisce il bersaglio (HP critici)
      const finishBonus = target.hp <= expectedDmg ? 5 : 0;
      // Penalità se ranged a corto raggio (alta vulnerabilità future)
      const rangedPenalty = move.isRanged && baseDistance(me.position, target.position) <= 2 ? -1 : 0;
      return w.damageDealt * (expectedDmg / 5) + finishBonus + rangedPenalty;
    }

    case 'CHOOSE_ATTACKER_DICE': {
      // D-047: per armi dual-stat (es. spada), 2d PG attiva entrambi i bonus → +4 fissi extra.
      // Premia 2d più del default. Budget penalty: se dadi rimanenti dopo questa scelta
      // sono insufficienti per la difesa successiva (≥2d parry/dodge), penalizza 2d.
      const weapon = me.weapon ? getWeapon(me.weapon) : null;
      const isDualStat =
        weapon &&
        weapon.attackModes.length >= 2 &&
        weapon.attackModes.some((m) => m.stat === 'forza') &&
        weapon.attackModes.some((m) => m.stat === 'agilità');
      const budgetAfter = me.dadiAzione - move.diceN;
      const budgetPenalty = budgetAfter < 2 ? -1.5 : 0;
      if (isDualStat) {
        return (move.diceN === 2 ? 2.5 - w.saveDice * 1 : 0.8 - w.saveDice * 0.5) + budgetPenalty;
      }
      return (move.diceN === 2 ? 1.5 - w.saveDice * 1 : 1.0 - w.saveDice * 0.5) + budgetPenalty;
    }

    case 'CHOOSE_DEFENSE': {
      // Calcola expected values di attaccante e difese, sceglie quella che blocca con margine maggiore.
      const pa = state.pendingAction;
      if (!pa) return 0;
      const attacker = state.units[pa.attackerId];
      const w_att = attacker?.weapon ? getWeapon(attacker.weapon) : null;
      const mode = w_att?.attackModes[pa.attackModeIdx];
      if (!attacker || !w_att || !mode) return move.defenseType === 'none' ? -2 : 0;

      const attackerDicePG = pa.attackerDice ?? 2;
      const armDice = mode.diceVariable;
      const armFix = mode.fixedBonus;
      // Stima expected attaccante: variabile (PG+arma)*3.5, fissa = 2 + armFix + skill - imp_attacker
      const attackerStat = mode.stat === 'either' ? 'forza' : mode.stat;
      const ctxAttack = makeAttackContext(w_att.id, w_att.category, attackerStat);
      const attFlatSkill = countFlatBonuses(attacker.skills, ctxAttack);
      const attImp = getImpedimentTotal(attacker);
      const expectedAttackerVar = (attackerDicePG + armDice) * 3.5;
      const expectedAttackerFixed = 2 + armFix + attFlatSkill - attImp;
      const expectedAttackerTotal = expectedAttackerVar + expectedAttackerFixed;

      const myImp = getImpedimentTotal(me);
      const baseFix = 2; // PG base

      // D-048: il damage subito (raw, pre-RD) toglie slancio pari quantità.
      // Quindi il costo "totale" di una difesa fallita = damage HP + costo slancio (~30% per HP).
      // SLANCIO_COST_FACTOR pesa l'impatto futuro (turni più lenti, meno difesa).
      const SLANCIO_COST_FACTOR = 0.3;

      if (move.defenseType === 'dodge') {
        // Dodge: morde solo la VARIABILE attaccante. Se vince blocca TUTTO il colpo
        // (incluso il fisso → MOLTO valore evitato per armi a fisso puro tipo mazza, balestra).
        const ctxDodge = makeDodgeContext();
        const dodgeFlatSkill = countFlatBonuses(me.skills, ctxDodge);
        const dodgeFixed = baseFix + dodgeFlatSkill - myImp;
        const expectedDodgeTotal = move.diceN * 3.5 + dodgeFixed;
        const variableMargin = expectedDodgeTotal - expectedAttackerVar;

        let expectedDamageSubita: number;
        if (variableMargin >= 0) {
          // Schivata vince → 0 danni e 0 contraccolpo slancio (blocca tutto).
          expectedDamageSubita = 0;
          const fixedAvoidedBonus = Math.max(0, expectedAttackerFixed) * 0.3;
          return w.damageAvoided * (variableMargin + fixedAvoidedBonus) - move.diceN * w.saveDice * 0.5;
        } else {
          expectedDamageSubita = expectedAttackerTotal - expectedDodgeTotal;
        }
        // D-048: aggiungo il costo slancio. Il damage RAW (pre-RD) = expectedDamageSubita.
        const slancioCost = expectedDamageSubita * SLANCIO_COST_FACTOR;
        return -w.damageAvoided * (expectedDamageSubita + slancioCost) - move.diceN * w.saveDice * 0.5;
      }

      if (move.defenseType === 'parry') {
        // Parry: morde tutto il tiro attaccante. Se vince blocca completamente.
        const itemId = move.parryWith === 'weapon' ? me.weapon : me.offhand;
        if (!itemId) return -1;
        const w_def = getWeapon(itemId);
        const sh_def = getShield(itemId);
        const parryDice = w_def?.parry?.dice ?? sh_def?.parry.dice ?? 0;
        const parryFixed = w_def?.parry?.fixed ?? sh_def?.parry.fixed ?? 0;
        const cat = w_def?.category ?? sh_def?.category;
        if (!cat) return -1;
        const ctxParry = makeParryContext(itemId, cat);
        const parryFlatSkill = countFlatBonuses(me.skills, ctxParry);
        const expectedParryTotal = (move.diceN + parryDice) * 3.5 + baseFix + parryFixed + parryFlatSkill - myImp;
        const totalMargin = expectedParryTotal - expectedAttackerTotal;
        const expectedDamageSubita = totalMargin >= 0 ? 0 : -totalMargin;
        // D-048: contraccolpo se il colpo passa
        const slancioCost = expectedDamageSubita * SLANCIO_COST_FACTOR;
        const hpBonus = me.hp / me.hpMax < 0.4 ? 0.5 : 0;
        return -w.damageAvoided * (expectedDamageSubita + slancioCost) - move.diceN * w.saveDice * 0.5 + hpBonus;
      }

      // 'none' default: subisce TUTTO. expected damage = attacker total. + contraccolpo.
      const noneDmg = Math.max(0, expectedAttackerTotal);
      const noneSlancio = noneDmg * SLANCIO_COST_FACTOR;
      return -w.damageAvoided * (noneDmg + noneSlancio) - 1; // small penalty per inazione
    }

    case 'MOVE': {
      if (!enemy) return -1;
      const distNow = baseDistance(me.position, enemy.position);
      const distAfter = baseDistance(move.targetHex, enemy.position);

      // Detection arma: ranged-only (no melee viable) → kite; melee → close.
      const myWeapon = me.weapon ? getWeapon(me.weapon) : null;
      const hasRanged = !!(myWeapon?.range && (myWeapon.range.distance != null || myWeapon.range.throw != null));
      // 2026-05-15 (Bug B propagation fix): no melee capability → reach 0, non 1.
      const meleeReach = myWeapon?.range?.reach ?? 0;
      const rangedMax = myWeapon?.range?.distance ?? myWeapon?.range?.throw ?? 0;
      const isRangedOnly = hasRanged && myWeapon!.attackModes[0].diceVariable >= 1 && rangedMax >= 3;

      if (isRangedOnly) {
        // Kite: target distance = sweet spot tra 2 e rangedMax (se possibile).
        // Penalità se troppo vicino (in mischia) o troppo lontano (fuori range).
        const sweetSpotMin = 2;
        const sweetSpotMax = Math.max(2, rangedMax);
        let kiteScore = 0;
        if (distAfter < sweetSpotMin) kiteScore = -1.5; // troppo vicino: nemico chiude
        else if (distAfter > sweetSpotMax) kiteScore = -1.0; // fuori range: non posso sparare
        else kiteScore = 1.0; // sweet spot
        // Bonus se mi sto allontanando da nemico in mischia
        if (distNow <= meleeReach && distAfter > distNow) kiteScore += 1.5;
        return kiteScore;
      }

      // Melee: chiudi distanza
      const closer = distNow - distAfter;
      const aggressionBonus = !me.actionTakenThisTurn && distAfter <= 1 ? 2 : 0;
      return w.closeDistance * closer + aggressionBonus;
    }

    case 'RELOAD': {
      // Sempre buona se necessario, modulata da dadi spesi
      return 3 - move.diceN * w.saveDice;
    }

    case 'END_TURN': {
      // Default: utilità bassa ma non negativa, scelto se altre mosse non rendono
      return 0.1;
    }

    default:
      return 0;
  }
}

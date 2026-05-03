/**
 * Decision Tree AI (Hard mode).
 *
 * Wrapper attorno al DT distillato dal modello v14 MaskablePPO.
 *
 * Architettura:
 *   1. `buildObsV2` costruisce il vettore di 153 feature dello state
 *   2. `predictDtAction(obs)` ritorna un action_id (0..19)
 *   3. `legalMoves(state, unitId)` ritorna l'elenco delle azioni legali
 *      nello stesso ordine in cui lo faceva l'env Python
 *   4. action_id → legalMoves[action_id] → GameEvent
 *
 * Action masking: il DT può predire un'azione fuori range o non legale.
 * In quel caso fallback alla prima azione legale (semantica matchata col
 * Python env: `if action >= len(moves): event = EventEndTurn() if any...`).
 */

import { GameState } from '@core/state';
import { Unit, UnitId } from '@entities/Unit';
import { GameEvent } from '@core/events';
import { buildObsV2 } from '@ai/obsFeaturesV2';
import { predictDtAction } from '@ai/dtAI_generated';
import { legalMoves } from '@ai/legalMoves';
import { getWeapon } from '@data/weapons';

/**
 * Decisione AI Hard: usa il DT per predire l'azione, decode via legalMoves.
 *
 * Se in qualche fase non ci sono azioni legali (es. game-over), fallback a END_TURN.
 */
export function aiDecideHard(state: GameState, unitId: UnitId): GameEvent {
  const unit = state.units[unitId];
  if (!unit) return { type: 'END_TURN' };

  const moves = legalMoves(state, unitId);
  if (moves.length === 0) return { type: 'END_TURN' };

  let actionId: number;
  try {
    const obs = buildObsV2(state, { agentFaction: unit.faction, agentUnitId: unitId });
    actionId = predictDtAction(obs);
  } catch {
    actionId = 0; // fallback: prima legale
  }

  // Action masking: se actionId è fuori range, fallback alla prima azione UTILE
  // Preferenza: ATTACK > MOVE > END_TURN (era: END_TURN). Cambiato perché il DT è
  // calibrato su stato spazio leggermente diverso (slancio costa dadi, etc.) e a
  // volte predice fuori range portando a END_TURN spuri che bloccano l'AI in mischia.
  if (actionId < 0 || actionId >= moves.length) {
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
    const move = moves.find((m) => m.type === 'MOVE');
    if (move) return move;
    return moves[moves.length - 1];
  }

  let chosen = moves[actionId];
  // Override anti-degenerazione: se DT propone END_TURN ma esiste un attacco
  // legale (cioè AI è in range mischia o ranged), forziamo l'attacco. Il DT su
  // stati non visti durante distillazione (D-044 transfer, slancio cost change)
  // può essere sub-ottimale; questo override garantisce che l'AI non rinunci a
  // un attacco già "guadagnato" col movimento.
  if (chosen.type === 'END_TURN') {
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
  }

  // V2 D-050: counter-ranged override.
  // Diagnostica empirica (diag_archer.py) mostra che il DT v16 sceglie quasi
  // sempre slancioDice=0 a START_TURN anche contro arciere. Inoltre, anche
  // forzando slancio max il melee spende tutto in movimento → slancio_target
  // è 0 quando viene colpito.
  // Strategia corretta (confermata Valerio): tira slancio max + transfer
  // impeto→slancio per avere slancio "sempre al massimo" anche dopo movimento.
  if (chosen.type === 'START_TURN') {
    const myWeapon = unit.weapon ? getWeapon(unit.weapon) : null;
    const iAmRangedOnly = myWeapon?.range?.distance != null && myWeapon?.range?.reach == null;
    if (!iAmRangedOnly) {
      const enemies = Object.values(state.units).filter(
        (u) => u.faction !== unit.faction && u.alive,
      );
      const enemyHasRanged = enemies.some((e) => {
        if (!e.weapon) return false;
        const w = getWeapon(e.weapon);
        return !!w && !!w.range && w.range.distance != null;
      });
      if (enemyHasRanged) {
        // Preferenza: la variante con slancioDice=2 + impetoToSlancio max disponibile
        // (in legalMoves è discretizzata su 3,6,9 — prendi il più alto che il DT ha
        // in lista). Fallback a solo slancioDice=2 se varianti transfer assenti.
        const transferVariants = moves.filter(
          (m) => m.type === 'START_TURN'
            && (m as { slancioDice?: number }).slancioDice === 2
            && (m as { impetoToSlancio?: number }).impetoToSlancio != null,
        );
        if (transferVariants.length > 0) {
          // Sort by impetoToSlancio desc, prendi il più alto
          transferVariants.sort(
            (a, b) =>
              ((b as { impetoToSlancio?: number }).impetoToSlancio ?? 0)
              - ((a as { impetoToSlancio?: number }).impetoToSlancio ?? 0),
          );
          chosen = transferVariants[0];
        } else {
          // Niente transfer disponibile → solo slancioDice=2
          const altMax = moves.find(
            (m) => m.type === 'START_TURN' && (m as { slancioDice?: number }).slancioDice === 2,
          );
          if (altMax) chosen = altMax;
        }
      }
    }
  }

  return chosen;
}

/**
 * Wrapper: AI Hard è uno step-by-step decisore. Il loop nel BattleScene
 * deve dispatchare ogni evento in cascata fino a turn-end (basicAi pattern).
 *
 * Esempio:
 *   while (state.phase !== 'turn-end' && state.units[unitId].faction === 'B' && AI):
 *     event = aiDecideHard(state, unitId);
 *     dispatch(event);
 */
export type { Unit };

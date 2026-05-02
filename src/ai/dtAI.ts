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

  // Action masking: se actionId è fuori range, scegli la prima legale (preferenza END_TURN se presente)
  if (actionId < 0 || actionId >= moves.length) {
    const endTurn = moves.find((m) => m.type === 'END_TURN');
    return endTurn ?? moves[moves.length - 1];
  }

  return moves[actionId];
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

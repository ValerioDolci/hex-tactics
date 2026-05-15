/**
 * Monte Carlo Tree Search AI per il gioco.
 *
 * UCB1 selection, expansion lazy, simulation con rollout policy euristica
 * (basicAi heuristic come fast policy), backpropagation standard.
 *
 * Il rollout simula la partita fino al game-over usando l'AI heuristic come
 * "policy random ma non stupida". Reward: 1 se la fazione attiva vince, 0 altrimenti.
 */

import { GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';
import { UnitId, FactionId } from '@entities/Unit';
import { legalMoves } from './legalMoves';
import {
  aiDecideAction,
  aiDecideAttackerDice,
  aiDecideDefense,
  aiDecideTurnStart,
} from './basicAi';

const UCB1_C = Math.sqrt(2); // exploration constant standard

interface MctsNode {
  state: GameState;
  parent: MctsNode | null;
  /** Mossa che ha portato a questo nodo */
  moveFromParent: GameEvent | null;
  /** Faction di chi muove al nodo (per assegnare reward correttamente) */
  factionToMove: FactionId | null;
  children: MctsNode[];
  /** Mosse non ancora espanse (lazy expansion) */
  untriedMoves: GameEvent[];
  visits: number;
  /** Reward cumulato dal punto di vista di chi muove al PARENT */
  totalReward: number;
}

/** Crea un nuovo nodo. Non espande i figli. */
function makeNode(
  state: GameState,
  parent: MctsNode | null,
  moveFromParent: GameEvent | null,
  unitId: UnitId | null,
): MctsNode {
  const factionToMove = unitId ? state.units[unitId]?.faction ?? null : null;
  const moves = unitId ? legalMoves(state, unitId) : [];
  return {
    state,
    parent,
    moveFromParent,
    factionToMove,
    children: [],
    untriedMoves: [...moves],
    visits: 0,
    totalReward: 0,
  };
}

/** UCB1 selection: prossimo figlio da esplorare */
function ucb1Select(node: MctsNode): MctsNode {
  let best = node.children[0];
  let bestVal = -Infinity;
  for (const child of node.children) {
    const exploitation = child.visits > 0 ? child.totalReward / child.visits : 0;
    const exploration =
      child.visits > 0 ? UCB1_C * Math.sqrt(Math.log(node.visits) / child.visits) : Infinity;
    const val = exploitation + exploration;
    if (val > bestVal) {
      bestVal = val;
      best = child;
    }
  }
  return best;
}

/** Espande un figlio scegliendo una untriedMove */
function expand(node: MctsNode): MctsNode {
  const move = node.untriedMoves.pop()!;
  const newState = reduce(node.state, move);
  // L'unità attiva nel nuovo stato (può essere diversa se è cambiato turno)
  const activeUnitId = newState.turnOrder[newState.currentTurnIdx];
  const child = makeNode(newState, node, move, activeUnitId ?? null);
  node.children.push(child);
  return child;
}

/**
 * Rollout: simula dalla state corrente fino a game-over (o budget esaurito) usando
 * heuristic AI. Restituisce un reward continuo [0, 1] dal punto di vista di `perspective`:
 *  - 1.0 se vince
 *  - 0.0 se perde
 *  - in caso di timeout/draw, normalizza HP delta (più HP miei rimasti, più HP avversari persi → reward alto)
 *
 * Reward shaping risolve il problema "rollout sempre draw → MCTS non discrimina mosse".
 */
function rollout(initialState: GameState, perspective: FactionId, maxRollouts = 200): number {
  let state = initialState;
  let safety = maxRollouts;
  while (state.phase !== 'game-over' && safety-- > 0) {
    if (state.phase === 'turn-start') {
      const unitId = state.turnOrder[state.currentTurnIdx];
      if (!unitId) break;
      // 2026-05-15 (Bug E propagation): usa aiDecideTurnStart per il transfer
      // impeto→slancio (D-044), necessario in particolare per arcieri/balestrieri.
      const dec = aiDecideTurnStart(state, unitId);
      state = reduce(state, { type: 'START_TURN', slancioDice: dec.slancioDice, impetoToSlancio: dec.impetoToSlancio });
      continue;
    }
    if (state.phase === 'choosing-action') {
      const unitId = state.turnOrder[state.currentTurnIdx];
      if (!unitId) break;
      const ev = aiDecideAction(state, unitId);
      state = reduce(state, ev);
      if (ev.type === 'DECLARE_ATTACK') {
        const diceN = aiDecideAttackerDice(state, unitId);
        state = reduce(state, { type: 'CHOOSE_ATTACKER_DICE', diceN });
        if (ev.isRanged) {
          state = reduce(state, { type: 'RESOLVE_COMBAT' });
        } else {
          const def = aiDecideDefense(state, ev.targetId);
          state = reduce(state, {
            type: 'CHOOSE_DEFENSE',
            defenseType: def.defenseType,
            parryWith: def.parryWith,
            diceN: def.diceN,
          });
          state = reduce(state, { type: 'RESOLVE_COMBAT' });
        }
      }
      continue;
    }
    break;
  }

  // Vittoria/sconfitta netta
  if (state.phase === 'game-over' && state.winner && state.winner !== 'draw') {
    return state.winner === perspective ? 1.0 : 0.0;
  }

  // Reward shaping su HP delta (timeout/draw)
  let myHp = 0;
  let myHpMax = 0;
  let enemyHp = 0;
  let enemyHpMax = 0;
  for (const u of Object.values(state.units)) {
    if (u.faction === perspective) {
      myHp += u.hp;
      myHpMax += u.hpMax;
    } else {
      enemyHp += u.hp;
      enemyHpMax += u.hpMax;
    }
  }
  // Normalizza in [0, 1]: 0.5 = parità di HP, > 0.5 = vantaggio mio
  const myFrac = myHpMax > 0 ? myHp / myHpMax : 0;
  const enemyFrac = enemyHpMax > 0 ? enemyHp / enemyHpMax : 0;
  // reward = 0.5 + (myFrac - enemyFrac) * 0.5 → range [0, 1]
  return 0.5 + (myFrac - enemyFrac) * 0.5;
}

/** Backpropagation: aggiorna visits e reward dal child verso la radice */
function backpropagate(node: MctsNode, reward: number): void {
  let cur: MctsNode | null = node;
  while (cur) {
    cur.visits++;
    cur.totalReward += reward;
    cur = cur.parent;
  }
}

export interface MctsConfig {
  /** Iterazioni totali (default: 500) */
  iterations: number;
  /** Cap rollout depth (eventi). Riduce tempo se rollout lunghi */
  rolloutMaxEvents: number;
}

export const DEFAULT_MCTS: MctsConfig = {
  iterations: 500,
  rolloutMaxEvents: 150,
};

/**
 * Sceglie la mossa migliore per `unitId` nello stato corrente con MCTS.
 * Restituisce il GameEvent della mossa con più visite (robusta a varianza).
 */
export function mctsDecideMove(
  state: GameState,
  unitId: UnitId,
  config: MctsConfig = DEFAULT_MCTS,
): GameEvent {
  const root = makeNode(state, null, null, unitId);
  const myFaction = state.units[unitId]?.faction;
  if (!myFaction) return { type: 'END_TURN' };

  for (let i = 0; i < config.iterations; i++) {
    // 1. Selection: scendi finché non trovi un nodo non completamente espanso
    let node = root;
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      node = ucb1Select(node);
    }
    // 2. Expansion (se non terminale)
    if (node.untriedMoves.length > 0 && node.state.phase !== 'game-over') {
      node = expand(node);
    }
    // 3. Simulation con reward shaping
    const reward = rollout(node.state, myFaction, config.rolloutMaxEvents);
    // 4. Backpropagation
    backpropagate(node, reward);
  }

  // Sceglie il figlio con più visite (più "fidato")
  if (root.children.length === 0) return { type: 'END_TURN' };
  let bestChild = root.children[0];
  for (const c of root.children) {
    if (c.visits > bestChild.visits) bestChild = c;
  }
  return bestChild.moveFromParent ?? { type: 'END_TURN' };
}

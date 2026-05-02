/**
 * Tabular Q-learning AI — passo "B" della pipeline ML.
 *
 * Approccio:
 *  - State encoder: bucket discreto su (impeto, slancio, dadi, dist, HP-self, HP-enemy, phase)
 *  - Q-table: Map<stateKey, number[]> con array di Q-values per le N azioni della phase
 *  - Decisione: ε-greedy (random con ε, argmax altrimenti)
 *  - Update TD(0): Q(s,a) ← Q(s,a) + α [r + γ·max_a' Q(s',a') − Q(s,a)]
 *  - Reward: HP-delta intermedio + ±5 win/loss finale
 *
 * Le azioni sono indicizzate dentro la stessa lista di legalMoves della fase corrente,
 * ma RISTRETTE alle phase strategiche: turn-start, declaring-attack, awaiting-defense.
 * Per le phase non coperte (resolving, choosing-action, ecc.), fallback a heuristic/utility.
 */

import { GameState } from '@core/state';
import { GameEvent } from '@core/events';
import { UnitId } from '@entities/Unit';
import { baseDistance } from '@core/hex/base';
import { findClosestEnemy } from './basicAi';
import { legalMoves } from './legalMoves';

// === STATE ENCODING ===

function bucket(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) if (value <= edges[i]) return i;
  return edges.length;
}

export function encodeState(state: GameState, unitId: UnitId): string {
  const me = state.units[unitId];
  if (!me) return 'X';
  const enemy = findClosestEnemy(state, me);
  const dist = enemy ? baseDistance(me.position, enemy.position) : 99;
  const myHpRatio = me.hp / Math.max(1, me.hpMax);
  const enHpRatio = enemy ? enemy.hp / Math.max(1, enemy.hpMax) : 0;

  const impB = bucket(me.impeto, [0, 10, 20]);
  const slaB = bucket(me.slancio, [0, 5, 10]);
  const dadiB = bucket(me.dadiAzione, [2, 5]);
  const distB = bucket(dist, [1, 4, 9]);
  const hpB = bucket(myHpRatio * 100, [25, 50, 75]);
  const enHpB = bucket(enHpRatio * 100, [25, 50, 75]);

  return `${state.phase}|i${impB}s${slaB}d${dadiB}D${distB}h${hpB}H${enHpB}`;
}

// === Q-TABLE ===

export type QTable = Record<string, number[]>;

export function getQ(table: QTable, key: string, nActions: number): number[] {
  if (!table[key]) table[key] = new Array(nActions).fill(0);
  if (table[key].length < nActions) {
    // expand if action space grew
    while (table[key].length < nActions) table[key].push(0);
  }
  return table[key];
}

// === DECISION ===

export interface QDecisionConfig {
  epsilon: number;
  rng: () => number; // 0..1
}

/** Context passato a runBattle quando modeA/B='qlearning'. */
export interface QContext {
  table: QTable;
  epsilon: number;
  rng: () => number;
  /** Callback chiamata ad ogni decisione presa, per il loop di training */
  onTransition?: (info: { stateKey: string; actionIdx: number; nActions: number; unitId: string }) => void;
}

/**
 * Sceglie un'azione con ε-greedy. Fallback all'azione 0 se la phase non è coperta.
 * Restituisce sia l'evento scelto sia le info per training (stateKey, actionIdx, nActions).
 */
export function qChoose(
  table: QTable,
  state: GameState,
  unitId: UnitId,
  cfg: QDecisionConfig,
): { event: GameEvent; stateKey: string; actionIdx: number; nActions: number } {
  const moves = legalMoves(state, unitId);
  if (moves.length === 0) {
    return { event: { type: 'END_TURN' }, stateKey: '', actionIdx: 0, nActions: 0 };
  }
  const stateKey = encodeState(state, unitId);
  const q = getQ(table, stateKey, moves.length);

  let actionIdx: number;
  if (cfg.rng() < cfg.epsilon) {
    actionIdx = Math.min(moves.length - 1, Math.floor(cfg.rng() * moves.length));
  } else {
    // argmax con tie-break casuale
    let best = q[0];
    let candidates = [0];
    for (let i = 1; i < q.length; i++) {
      if (q[i] > best) {
        best = q[i];
        candidates = [i];
      } else if (q[i] === best) {
        candidates.push(i);
      }
    }
    actionIdx = candidates[Math.min(candidates.length - 1, Math.floor(cfg.rng() * candidates.length))];
  }
  const event = moves[actionIdx];
  if (!event) {
    // safety fallback
    return { event: { type: 'END_TURN' }, stateKey: '', actionIdx: 0, nActions: 0 };
  }
  return { event, stateKey, actionIdx, nActions: moves.length };
}

/** Solo per inferenza (no exploration): argmax sempre. */
export function qDecideMove(table: QTable, state: GameState, unitId: UnitId): GameEvent {
  return qChoose(table, state, unitId, { epsilon: 0, rng: Math.random }).event;
}

// === TD UPDATE ===

export function qUpdate(
  table: QTable,
  prevKey: string,
  prevAction: number,
  reward: number,
  nextKey: string | null,
  nextNActions: number,
  alpha: number,
  gamma: number,
): void {
  if (!prevKey) return;
  const q = table[prevKey];
  if (!q || prevAction < 0 || prevAction >= q.length) return;
  let target = reward;
  if (nextKey && nextNActions > 0) {
    const qNext = getQ(table, nextKey, nextNActions);
    if (qNext.length > 0) {
      const maxQ = qNext.reduce((m, x) => Math.max(m, x), -Infinity);
      if (Number.isFinite(maxQ)) target += gamma * maxQ;
    }
  }
  q[prevAction] += alpha * (target - q[prevAction]);
}

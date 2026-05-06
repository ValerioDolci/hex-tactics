/**
 * Student MLP AI — wrapper SYNC attorno al modello Deep CFR distillato (MLP small).
 *
 * Differenza vs `studentMultiAi.ts` (versione ONNX async):
 *   - SYNC: pesi inline base64, inferenza JS pura (no onnxruntime, no WASM)
 *   - File size più grande (~1 MB inline TS) ma adatto al singlefile / GH Pages mobile
 *   - Modello più piccolo (256×3, 197K params) → leggera perdita di qualità vs ONNX 512×4
 *
 * Riferimento: cfr/distill_export_jsweights.py
 */

import { GameState } from '@core/state';
import { Unit, UnitId } from '@entities/Unit';
import { GameEvent } from '@core/events';
import { buildObsV2, N_FEATURES_TOTAL_V2 } from '@ai/obsFeaturesV2';
import { buildToFeatures, BUILD_FEATURES_DIM } from '@ai/buildFeatures';
import { legalMoves } from '@ai/legalMoves';
import { studentMlpForward, STUDENT_INPUT_DIM, STUDENT_OUTPUT_DIM } from '@ai/studentMlpWeights';

const MAX_ACTIONS = STUDENT_OUTPUT_DIM;

/**
 * Decisione AI con MLP distillato sync.
 *
 * @param state - GameState
 * @param unitId - unità che agisce
 * @param opts.deterministic - true (argmax, default) o false (sample dalla policy softmax)
 */
export function aiDecideStudentMlp(
  state: GameState,
  unitId: UnitId,
  opts: { deterministic?: boolean } = {},
): GameEvent {
  const unit: Unit | undefined = state.units[unitId];
  if (!unit) return { type: 'END_TURN' };

  const moves = legalMoves(state, unitId);
  if (moves.length === 0) return { type: 'END_TURN' };

  const enemy = Object.values(state.units).find(
    (u) => u.faction !== unit.faction && u.alive,
  );
  if (!enemy) return moves[0];

  // Build input vector: obs153 + build_self39 + build_opp39 = 231
  const obs = buildObsV2(state, { agentFaction: unit.faction, agentUnitId: unitId });
  if (obs.length !== N_FEATURES_TOTAL_V2) {
    console.warn(`[studentMlpAi] obs length mismatch: got ${obs.length} expected ${N_FEATURES_TOTAL_V2}, fallback`);
    return moves[0];
  }
  const buildSelf = buildToFeatures(unit);
  const buildOpp = buildToFeatures(enemy);
  if (buildSelf.length !== BUILD_FEATURES_DIM || buildOpp.length !== BUILD_FEATURES_DIM) {
    console.warn(`[studentMlpAi] build features mismatch, fallback`);
    return moves[0];
  }

  const input = new Float32Array(STUDENT_INPUT_DIM);
  for (let i = 0; i < N_FEATURES_TOTAL_V2; i++) input[i] = obs[i];
  for (let i = 0; i < BUILD_FEATURES_DIM; i++) input[N_FEATURES_TOTAL_V2 + i] = buildSelf[i];
  for (let i = 0; i < BUILD_FEATURES_DIM; i++) input[N_FEATURES_TOTAL_V2 + BUILD_FEATURES_DIM + i] = buildOpp[i];

  let logits: Float32Array;
  try {
    logits = studentMlpForward(input);
  } catch (e) {
    console.warn('[studentMlpAi] inferenza fallita, fallback heuristic', e);
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
    return moves[0];
  }

  // Mask invalid actions: solo i primi `moves.length` indici sono legali
  const masked = new Float32Array(MAX_ACTIONS);
  for (let i = 0; i < MAX_ACTIONS; i++) masked[i] = i < moves.length ? logits[i] : -Infinity;

  let actionId: number;
  const deterministic = opts.deterministic ?? true;
  if (deterministic) {
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] > bestVal) {
        bestVal = masked[i];
        best = i;
      }
    }
    actionId = best;
  } else {
    // Softmax + sample
    let mx = -Infinity;
    for (let i = 0; i < MAX_ACTIONS; i++) if (masked[i] > mx) mx = masked[i];
    const probs = new Float32Array(MAX_ACTIONS);
    let sum = 0;
    for (let i = 0; i < MAX_ACTIONS; i++) {
      probs[i] = isFinite(masked[i]) ? Math.exp(masked[i] - mx) : 0;
      sum += probs[i];
    }
    for (let i = 0; i < MAX_ACTIONS; i++) probs[i] /= sum;
    const r = Math.random();
    let cum = 0;
    actionId = 0;
    for (let i = 0; i < MAX_ACTIONS; i++) {
      cum += probs[i];
      if (r <= cum) {
        actionId = i;
        break;
      }
    }
  }

  if (actionId < 0 || actionId >= moves.length) {
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
    const move = moves.find((m) => m.type === 'MOVE');
    if (move) return move;
    return moves[moves.length - 1];
  }

  return moves[actionId];
}

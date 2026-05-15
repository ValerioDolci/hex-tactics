/**
 * Student Multi AI (Expert mode) — wrapper attorno al modello distillato Deep CFR.
 *
 * Pipeline:
 *   1. `buildObsV2` → 153 features dello state
 *   2. `buildToFeatures(unit)` → 39 features build per self e opponent
 *   3. ONNX inference (onnxruntime-web): input 231 → logits 24
 *   4. Mascheramento azioni illegali via legal_moves count
 *   5. Argmax (deterministic) o sample (stochastic)
 *   6. action_id → legalMoves[action_id] → GameEvent
 *
 * Riferimento Python: cfr/distill_multi_student.py (StudentMultiMLP, hidden=512×4).
 *
 * NB: Inferenza è async. Il dispatcher in BattleScene deve essere adattato (await).
 */

import { GameState } from '@core/state';
import { Unit, UnitId } from '@entities/Unit';
import { GameEvent } from '@core/events';
import { buildObsV2, N_FEATURES_TOTAL_V2 } from '@ai/obsFeaturesV2';
import { buildToFeatures, BUILD_FEATURES_DIM } from '@ai/buildFeatures';
import { legalMoves } from '@ai/legalMoves';
import { pickTargetForAction } from '@ai/basicAi';
import { getWeapon } from '@data/weapons';

const MAX_ACTIONS = 24;
const ONNX_PATH = '/student_multi.onnx';

// Cache lazy della sessione ONNX (1 sola init per pagina)
let _sessionPromise: Promise<unknown> | null = null;

/**
 * True quando l'Expert AI è effettivamente utilizzabile (build multi-file con
 * onnxruntime-web bundlato). False in singlefile: il dynamic import qui sotto
 * fallirebbe a runtime perché 'onnxruntime-web' è external nel rollup config.
 */
export const EXPERT_AI_AVAILABLE: boolean = !__SINGLEFILE__;

async function getSession(): Promise<unknown> {
  if (__SINGLEFILE__) {
    throw new Error('Expert AI non disponibile in build singlefile');
  }
  if (!_sessionPromise) {
    _sessionPromise = (async () => {
      // dynamic import per non rompere SSR/test ambienti senza ONNX
      const ort = await import('onnxruntime-web');
      const session = await ort.InferenceSession.create(ONNX_PATH, {
        executionProviders: ['wasm'], // fallback a WASM (compatibile ovunque)
      });
      return { ort, session };
    })();
  }
  return _sessionPromise;
}

/**
 * Pre-carica la sessione ONNX. Da chiamare all'avvio della BattleScene
 * per avere il modello pronto quando arriva il primo turno AI.
 */
export async function preloadStudentMulti(): Promise<void> {
  try {
    await getSession();
  } catch (e) {
    console.warn('[studentMultiAi] preload failed, fallback al primo invocation:', e);
  }
}

/**
 * Decisione AI Expert: usa il modello Deep CFR distillato.
 *
 * Async per via di onnxruntime-web. Il chiamante deve await.
 *
 * @param state - GameState corrente
 * @param unitId - ID dell'unità che deve agire
 * @param opts.deterministic - true (argmax, default) o false (sample da policy)
 * @returns GameEvent scelto
 */
export async function aiDecideExpert(
  state: GameState,
  unitId: UnitId,
  opts: { deterministic?: boolean } = {},
): Promise<GameEvent> {
  const unit: Unit | undefined = state.units[unitId];
  if (!unit) return { type: 'END_TURN' };

  const moves = legalMoves(state, unitId);
  if (moves.length === 0) return { type: 'END_TURN' };

  // Main threat selector NvN-aware con position stabile (Bug A fix).
  const enemy = pickTargetForAction(state, unit, { positionOverride: unit.positionAtTurnStart });
  if (!enemy) {
    // No enemy: fallback prima azione legale
    return moves[0];
  }

  let actionId: number;
  try {
    const { ort, session } = (await getSession()) as { ort: any; session: any };

    // Build inputs (obs centrato sul main threat per skirmish)
    const obsArr = new Float32Array(
      buildObsV2(state, {
        agentFaction: unit.faction,
        agentUnitId: unitId,
        agentEnemyId: enemy.id,
      }),
    );
    if (obsArr.length !== N_FEATURES_TOTAL_V2) {
      throw new Error(
        `obs shape mismatch: got ${obsArr.length} expected ${N_FEATURES_TOTAL_V2}`,
      );
    }
    const buildSelf = buildToFeatures(unit);
    const buildOpp = buildToFeatures(enemy);
    if (buildSelf.length !== BUILD_FEATURES_DIM || buildOpp.length !== BUILD_FEATURES_DIM) {
      throw new Error(
        `build features shape mismatch: ${buildSelf.length}/${buildOpp.length} expected ${BUILD_FEATURES_DIM}`,
      );
    }

    const obsTensor = new ort.Tensor('float32', obsArr, [1, N_FEATURES_TOTAL_V2]);
    const buildSelfTensor = new ort.Tensor('float32', buildSelf, [1, BUILD_FEATURES_DIM]);
    const buildOppTensor = new ort.Tensor('float32', buildOpp, [1, BUILD_FEATURES_DIM]);

    const result = await session.run({
      obs: obsTensor,
      build_self: buildSelfTensor,
      build_opp: buildOppTensor,
    });
    const logits = result.logits.data as Float32Array;
    if (logits.length !== MAX_ACTIONS) {
      throw new Error(`logits shape mismatch: got ${logits.length} expected ${MAX_ACTIONS}`);
    }

    // Mask invalid actions: solo i primi `moves.length` indici sono legali
    // (per construction di legalMoves: ritorna in ordine, MAX_ACTIONS è il cap).
    const masked = new Float32Array(MAX_ACTIONS);
    for (let i = 0; i < MAX_ACTIONS; i++) {
      masked[i] = i < moves.length ? logits[i] : -Infinity;
    }

    // Softmax + argmax/sample
    const deterministic = opts.deterministic ?? true;
    if (deterministic) {
      let bestIdx = 0;
      let bestVal = -Infinity;
      for (let i = 0; i < masked.length; i++) {
        if (masked[i] > bestVal) {
          bestVal = masked[i];
          bestIdx = i;
        }
      }
      actionId = bestIdx;
    } else {
      // Softmax
      let maxLogit = -Infinity;
      for (let i = 0; i < MAX_ACTIONS; i++) {
        if (masked[i] > maxLogit) maxLogit = masked[i];
      }
      let sumExp = 0;
      const probs = new Float32Array(MAX_ACTIONS);
      for (let i = 0; i < MAX_ACTIONS; i++) {
        probs[i] = isFinite(masked[i]) ? Math.exp(masked[i] - maxLogit) : 0;
        sumExp += probs[i];
      }
      for (let i = 0; i < MAX_ACTIONS; i++) probs[i] /= sumExp;
      // Sample
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
  } catch (e) {
    // Fallback: prima azione "utile" (preferenza ATTACK > MOVE > altro)
    console.warn('[studentMultiAi] inferenza fallita, fallback heuristic:', e);
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
    const move = moves.find((m) => m.type === 'MOVE');
    if (move) return move;
    return moves[0];
  }

  // Action masking: se actionId è fuori range, fallback heuristic (preferenza ATTACK > MOVE > altro)
  if (actionId < 0 || actionId >= moves.length) {
    const attack = moves.find((m) => m.type === 'DECLARE_ATTACK');
    if (attack) return attack;
    const move = moves.find((m) => m.type === 'MOVE');
    if (move) return move;
    return moves[moves.length - 1];
  }

  // Safety net per ranged-only: se MOVE selezionato MA esiste un attacco ranged legale,
  // preferisci sparare. Vedi commenti analoghi in studentMlpAi.ts.
  const unitForGuard = state.units[unitId];
  const chosen = moves[actionId];
  if (chosen.type === 'MOVE' && unitForGuard?.weapon) {
    const w = getWeapon(unitForGuard.weapon);
    const isRangedOnly = !!(w && w.range && w.range.distance != null && w.range.reach == null);
    if (isRangedOnly) {
      const rangedAttack = moves.find(
        (m) => m.type === 'DECLARE_ATTACK' && m.isRanged === true,
      );
      if (rangedAttack) return rangedAttack;
    }
  }

  return chosen;
}

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
import { pickTargetForAction } from '@ai/basicAi';
import { studentMlpForward, STUDENT_INPUT_DIM, STUDENT_OUTPUT_DIM } from '@ai/studentMlpWeights';
import { getWeapon } from '@data/weapons';

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

  // 2026-05-14 (Phase 1.3 skirmish): in NvN, scegli il "main threat" via euristica
  // (pickTargetForAction) e passalo a buildObsV2 come `agentEnemyId`. Il modello MLP
  // distillato 1v1 vede così SOLO il main threat — comportamento back-compat con 1v1
  // (collassa al solo enemy) ma sensato in skirmish (non vede un nemico random).
  // 2026-05-15 (Bug A propagation fix): usa positionAtTurnStart per stabilizzare
  // il target durante un turno multi-MOVE.
  const unitForTargeting: Unit = unit.positionAtTurnStart
    ? ({ ...unit, position: unit.positionAtTurnStart } as Unit)
    : unit;
  const enemy = pickTargetForAction(state, unitForTargeting);
  if (!enemy) return moves[0];

  // Build input vector: obs153 + build_self39 + build_opp39 = 231
  const obs = buildObsV2(state, {
    agentFaction: unit.faction,
    agentUnitId: unitId,
    agentEnemyId: enemy.id,
  });
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

  // === Safety net per unità ranged-only ===
  // Il MLP distillato (top-1 ~70% vs teacher) talvolta sceglie MOVE quando un'arma
  // ranged-only (arco/balestra: solo .distance, no .reach) ha già linea di tiro al
  // bersaglio. Per quelle armi, "stare e sparare" è quasi sempre meglio che avvicinarsi
  // (riduce reach del nemico melee a contatto, mantiene il tempo). Se MLP dice MOVE
  // ma esiste un DECLARE_ATTACK ranged legale, preferisci l'attacco.
  //
  // 2026-05-14 fix (bug C): esteso ai casi MOVE→RELOAD e MOVE→END.
  //   - Se arco/balestra scarica + RELOAD legale, preferisci RELOAD (ricaricare > muoversi
  //     a vuoto quando l'unica azione utile è ricaricare per sparare al prossimo turno).
  //   - Se non c'è né ranged-attack né reload legale, END_TURN è meglio di MOVE-spreca-slancio
  //     (specialmente vicino bordo mappa, dove MOVE tende a portare in ritirata inutile).
  //
  // Limitato alle ranged-only: armi mixed (giavellotto/ascia1h thrown, hanno reach)
  // restano governate dal MLP — la decisione "lancio o tengo per melee" è cruciale lì.
  const chosen = moves[actionId];
  if (chosen.type === 'MOVE' && unit.weapon) {
    const w = getWeapon(unit.weapon);
    const isRangedOnly = !!(w && w.range && w.range.distance != null && w.range.reach == null);
    if (isRangedOnly) {
      const rangedAttack = moves.find(
        (m) => m.type === 'DECLARE_ATTACK' && m.isRanged === true,
      );
      if (rangedAttack) return rangedAttack;
      const reload = moves.find((m) => m.type === 'RELOAD');
      if (reload) return reload;
      // Niente attacco né reload: meglio END che muoversi a casaccio (di solito significa
      // bow scarica + slancio sotto cost, oppure in melee threat senza offhand utile).
      const end = moves.find((m) => m.type === 'END_TURN');
      if (end) return end;
    }
  }

  return chosen;
}

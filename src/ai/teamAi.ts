/**
 * Team AI wrapper — adatta l'AI hard/expert (distillati 1v1) a scenari NvN
 * (skirmish, Phase 1.3 — 2026-05-14).
 *
 * Problema: i modelli distillati (studentMlpAi, studentMultiAi/ONNX) vedono nell'obs
 * solo SELF + un singolo ENEMY (training 1v1). In skirmish ci sono N nemici → serve
 * scegliere "quale" enemy mostrare al modello.
 *
 * Soluzione (opzione B del piano skirmish):
 *   - Pre-selezione main threat via euristica `pickTargetForAction` (basicAi):
 *     HP basso × pericolosità arma × prossimità.
 *   - I modelli `studentMlpAi` e `studentMultiAi` accettano ora `agentEnemyId` in
 *     buildObsV2 → l'obs è centrato sul main threat. Internamente questi modelli
 *     chiamano `pickTargetForAction` direttamente.
 *
 * Backward compat: in 1v1 (un solo nemico) main threat = quel nemico → comportamento
 * identico al pre-skirmish.
 *
 * Trade-off accettati:
 *   - L'MLP "ignora" gli alleati e i nemici secondari nell'obs → comportamenti
 *     non-coordinati team (no focus fire emergente, no copertura). Per coordinazione
 *     team vera serve la Phase 3 (retrain CFR multi-agent unit-centric, opzione 3.B).
 *
 * Questo file è il punto di estensione per logica team-level futura (es. coordinamento
 * focus fire, ruoli "tank pulla / arciere supporta", priority list condivisa).
 */
import { GameState } from '@core/state';
import { GameEvent } from '@core/events';
import { UnitId } from '@entities/Unit';
import { aiDecideStudentMlp } from '@ai/studentMlpAi';

/**
 * Decisione AI hard per skirmish (Phase 1.3). Per ora delega direttamente a
 * `aiDecideStudentMlp` che internamente fa target-selection + obs centrato sul
 * main threat. In futuro qui andrà la logica team-level (Phase 3+).
 */
export function aiDecideTeamHard(
  state: GameState,
  unitId: UnitId,
  opts: { deterministic?: boolean } = {},
): GameEvent {
  return aiDecideStudentMlp(state, unitId, opts);
}

/**
 * Persistenza locale: scelte di battaglia (PG selezionati e modalità) in localStorage.
 *
 * Formato semplice JSON. Chiavi prefissate `hexTactics.*`.
 */

const KEY_LAST_SETUP = 'hexTactics.lastSetup';

export interface BattleSetup {
  presetA: string;
  presetB: string;
  modeA: 'human' | 'ai';
  modeB: 'human' | 'ai';
  /** Se presente, ignora `presetA` e usa la build custom (id valido in `hexTactics.customBuilds`). */
  customBuildIdA?: string;
  /** Se presente, ignora `presetB`. */
  customBuildIdB?: string;
  /** Difficoltà AI per fazione A (default 'easy').
   * - 'easy' = basicAi heuristic
   * - 'hard' = DT distillato v14 (sync, ~2 KB)
   * - 'expert' = Deep CFR multi-matchup distilled (ONNX ~3.5 MB, async)
   */
  aiLevelA?: 'easy' | 'hard' | 'expert';
  /** Difficoltà AI per fazione B. */
  aiLevelB?: 'easy' | 'hard' | 'expert';
  /**
   * Skirmish 2026-05-14: array di preset id per ciascuna faction. Se popolati,
   * sovrascrivono `presetA`/`presetB` (1v1) e schierano N unit per faction.
   * Max 10 per faction (Phase 2 target). Per 2v2 MVP: 2 entry per array.
   */
  skirmishA?: string[];
  skirmishB?: string[];
  /** Budget exp speso per faction A (informativo, per UI replay setup) */
  budgetA?: number;
  /** Budget exp speso per faction B (informativo) */
  budgetB?: number;
}

export function saveSetup(setup: BattleSetup): void {
  try {
    localStorage.setItem(KEY_LAST_SETUP, JSON.stringify(setup));
  } catch (e) {
    // ignora (storage non disponibile)
    void e;
  }
}

export function loadSetup(): BattleSetup | null {
  try {
    const s = localStorage.getItem(KEY_LAST_SETUP);
    if (!s) return null;
    return JSON.parse(s) as BattleSetup;
  } catch {
    return null;
  }
}

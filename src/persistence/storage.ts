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
  /** Difficoltà AI per fazione A (default 'easy'). 'hard' usa il DT distillato dal v14. */
  aiLevelA?: 'easy' | 'hard';
  /** Difficoltà AI per fazione B. */
  aiLevelB?: 'easy' | 'hard';
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

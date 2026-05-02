/**
 * Tiri di gioco: parte VARIABILE (dadi) + parte FISSA (bonus).
 *
 * Architettura definita in CLAUDE.md sezione "Architettura tiri".
 * Le difese agiscono in modo diverso sulle due componenti:
 * - Schivata sottrae solo dalla VARIABILE dell'attaccante
 * - Parata sottrae dal totale (variabile + fissa)
 *
 * Questa separazione è strutturale e va preservata fino al risultato finale del tiro.
 */

import { Rng } from '@utils/rng';

/** Un tiro di gioco con le due componenti separate.
 *
 * Architettura post-revisione (V2 regole):
 *   - `variable[]`: risultati grezzi dei d6 tirati
 *   - `variableMod`: modificatore alla SOMMA della parte variabile (es. −impedimento).
 *     Floor 0 sulla variabile effettiva. Se rawSum + variableMod < 0, il |negativo|
 *     diventa una "slancio loss" da applicare al PG che ha tirato (vedi
 *     `variableNegResidue`).
 *   - `fixed`: somma di bonus/malus che NON dipendono dal tiro stocastico
 *     (bonus arma, +1 al tiro skill, carica, scudo passivo, ecc.). Non subisce
 *     floor: può essere negativo.
 */
export interface Roll {
  /** Risultati dei singoli d6 tirati (ordine di tiro) */
  variable: number[];
  /** Somma di tutti i bonus fissi (e malus, in negativo) */
  fixed: number;
  /**
   * Modificatore aggiuntivo alla parte variabile (es. -impedimento).
   * Sommato al rawSum dei dadi prima del floor 0. Se mancante = 0.
   */
  variableMod?: number;
}

/** Crea un Roll vuoto (zero dadi, zero fisso). */
export function emptyRoll(): Roll {
  return { variable: [], fixed: 0, variableMod: 0 };
}

/** Somma raw dei dadi (senza modificatore). */
export function variableRawSum(r: Roll): number {
  let s = 0;
  for (const v of r.variable) s += v;
  return s;
}

/**
 * Somma effettiva della parte variabile (raw + variableMod, floor 0).
 * Questa è la "parte variabile" usata in tutti i confronti (schivata, parata).
 */
export function variableSum(r: Roll): number {
  return Math.max(0, variableRawSum(r) + (r.variableMod ?? 0));
}

/**
 * Residuo negativo della variabile dopo il modificatore.
 * Se rawSum + variableMod < 0, restituisce |val|, da convertire in slancio loss
 * sul PG che ha tirato. Se ≥ 0, restituisce 0.
 */
export function variableNegResidue(r: Roll): number {
  return Math.max(0, -(variableRawSum(r) + (r.variableMod ?? 0)));
}

/** Totale di un tiro (variabile + fissa). La variabile è già flooored a 0. */
export function rollTotal(r: Roll): number {
  return variableSum(r) + r.fixed;
}

/** Tira N d6 e restituisce un Roll con quei dadi e fissa = `fixed`. */
export function makeRoll(rng: Rng, dice: number, fixed: number): Roll {
  const clamped = Math.max(0, dice);
  return {
    variable: rng.rollD6s(clamped),
    fixed,
    variableMod: 0,
  };
}

/** Combina due roll sommando dadi, fissi e variableMod. */
export function combineRolls(a: Roll, b: Roll): Roll {
  return {
    variable: [...a.variable, ...b.variable],
    fixed: a.fixed + b.fixed,
    variableMod: (a.variableMod ?? 0) + (b.variableMod ?? 0),
  };
}

/** Aggiunge un bonus alla parte fissa, ritornando un nuovo Roll. */
export function addFixed(r: Roll, delta: number): Roll {
  return {
    variable: [...r.variable],
    fixed: r.fixed + delta,
    variableMod: r.variableMod ?? 0,
  };
}

/**
 * Aggiunge un modificatore alla parte variabile (es. −impedimento), ritornando
 * un nuovo Roll. NB: il floor 0 e l'eventuale slancio loss vengono calcolati
 * solo al momento del confronto (variableSum / variableNegResidue), non qui.
 */
export function addVariableMod(r: Roll, delta: number): Roll {
  return {
    variable: [...r.variable],
    fixed: r.fixed,
    variableMod: (r.variableMod ?? 0) + delta,
  };
}

/**
 * Sottrae un altro Roll alla parte variabile dell'attaccante (per la schivata).
 * Restituisce { residual, hit }:
 * - residual: variabile_attaccante - totale_difensore
 * - hit: residual > 0 (l'attacco passa la schivata)
 *
 * Caller può poi sommare la fissa dell'attaccante se hit, e quella del difensore
 * va comunque sottratta allo slancio dell'attaccante se miss (vedi combat.ts).
 */
export function subtractFromVariable(attackerRoll: Roll, defenderRoll: Roll): number {
  return variableSum(attackerRoll) - rollTotal(defenderRoll);
}

/**
 * Sottrae l'intero tiro del difensore al tiro completo dell'attaccante (per la parata).
 * Restituisce attaccante_total - difensore_total.
 */
export function subtractFromTotal(attackerRoll: Roll, defenderRoll: Roll): number {
  return rollTotal(attackerRoll) - rollTotal(defenderRoll);
}

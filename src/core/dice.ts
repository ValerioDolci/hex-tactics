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

/** Un tiro di gioco con le due componenti separate. */
export interface Roll {
  /** Risultati dei singoli d6 tirati (ordine di tiro) */
  variable: number[];
  /** Somma di tutti i bonus fissi (e malus, in negativo) */
  fixed: number;
}

/** Crea un Roll vuoto (zero dadi, zero fisso). */
export function emptyRoll(): Roll {
  return { variable: [], fixed: 0 };
}

/** Somma dei dadi nella parte variabile. */
export function variableSum(r: Roll): number {
  let s = 0;
  for (const v of r.variable) s += v;
  return s;
}

/** Totale di un tiro (variabile + fissa). */
export function rollTotal(r: Roll): number {
  return variableSum(r) + r.fixed;
}

/** Tira N d6 e restituisce un Roll con quei dadi e fissa = `fixed`. */
export function makeRoll(rng: Rng, dice: number, fixed: number): Roll {
  const clamped = Math.max(0, dice);
  return {
    variable: rng.rollD6s(clamped),
    fixed,
  };
}

/** Combina due roll sommando dadi e fissi. Utile per attacco PG + arma. */
export function combineRolls(a: Roll, b: Roll): Roll {
  return {
    variable: [...a.variable, ...b.variable],
    fixed: a.fixed + b.fixed,
  };
}

/** Aggiunge un bonus alla parte fissa, ritornando un nuovo Roll. */
export function addFixed(r: Roll, delta: number): Roll {
  return { variable: [...r.variable], fixed: r.fixed + delta };
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

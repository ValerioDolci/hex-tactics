/**
 * RNG seed-able. Mulberry32 — fast, lightweight, deterministic.
 * Riferimento: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 *
 * Ogni `Rng` istanza è uno stream di numeri pseudocasuali con seed iniziale.
 * Usare sempre questo invece di Math.random() per garantire test deterministici e replay.
 */

export interface Rng {
  /** Restituisce un numero pseudocasuale in [0, 1). */
  next(): number;
  /** Restituisce un intero in [min, max] inclusi. */
  nextInt(min: number, max: number): number;
  /** Tira un d6 (1..6). */
  d6(): number;
  /** Tira N d6 e restituisce il vettore dei risultati. */
  rollD6s(n: number): number[];
  /** Restituisce il seed corrente (state) — utile per snapshot/replay. */
  getState(): number;
  /** Imposta lo state. */
  setState(s: number): void;
}

export function createRng(seed: number): Rng {
  let state = seed | 0; // forza int32

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function d6(): number {
    return nextInt(1, 6);
  }

  function rollD6s(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(d6());
    return out;
  }

  return {
    next,
    nextInt,
    d6,
    rollD6s,
    getState: () => state,
    setState: (s: number) => {
      state = s | 0;
    },
  };
}

/**
 * Linea esagonale (raster di esagoni tra due celle).
 * Algoritmo standard: linear interpolation in cube coords + arrotondamento.
 *
 * Usato principalmente per:
 * - Linea di vista (LoS) tra attaccante e bersaglio in attacchi a distanza
 * - Visualizzazione di tracce/raggi di azione
 */

import { Axial, axialRound } from './coords';
import { hexDistance } from './distance';

/**
 * Restituisce gli esagoni attraversati dalla linea da `a` a `b`, inclusi gli estremi.
 * Per due celle adiacenti restituisce 2 elementi; per la stessa cella, 1.
 */
export function hexLine(a: Axial, b: Axial): Axial[] {
  const N = hexDistance(a, b);
  if (N === 0) return [{ ...a }];

  const result: Axial[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Linear interpolation in axial space, poi arrotondiamo all'esagono più vicino.
    const lerped = {
      q: lerp(a.q, b.q, t),
      r: lerp(a.r, b.r, t),
    };
    result.push(axialRound(lerped));
  }
  return result;
}

/**
 * Verifica linea di vista tra `from` e `to` data una funzione che dice se un esagono è bloccato.
 * La linea è bloccata se almeno un esagono intermedio (NON gli estremi) è bloccato.
 *
 * @param from origine (non controllata)
 * @param to destinazione (non controllata)
 * @param isBlocking funzione (hex) → bool, true se l'hex è bloccante
 * @returns true se la linea è libera
 */
export function hasLineOfSight(
  from: Axial,
  to: Axial,
  isBlocking: (hex: Axial) => boolean,
): boolean {
  const path = hexLine(from, to);
  // Salta primo (origine) e ultimo (target): controlla solo gli intermedi.
  for (let i = 1; i < path.length - 1; i++) {
    if (isBlocking(path[i])) return false;
  }
  return true;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

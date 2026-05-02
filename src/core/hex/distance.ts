/**
 * Distanza esagonale e funzioni di vicinato.
 *
 * Riferimento: https://www.redblobgames.com/grids/hexagons/#distances
 * Per pointy-top axial (q, r), la conversione a cube è:
 *   x = q,  z = r,  y = -x - z
 * La distanza cube è (|dx| + |dy| + |dz|) / 2.
 */

import { Axial, axialEquals } from './coords';

/** Distanza esagonale tra due celle axial */
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * I 6 vicini di un esagono pointy-top, ordine standard (E, NE, NW, W, SW, SE).
 * Per axial (q, r):
 *   E: (q+1, r)
 *   NE: (q+1, r-1)
 *   NW: (q, r-1)
 *   W: (q-1, r)
 *   SW: (q-1, r+1)
 *   SE: (q, r+1)
 */
export const NEIGHBOR_DIRS: ReadonlyArray<{ dq: number; dr: number }> = [
  { dq: +1, dr: 0 },
  { dq: +1, dr: -1 },
  { dq: 0, dr: -1 },
  { dq: -1, dr: 0 },
  { dq: -1, dr: +1 },
  { dq: 0, dr: +1 },
];

/** Tutti i vicini di un esagono (anche fuori griglia) */
export function neighbors(hex: Axial): Axial[] {
  return NEIGHBOR_DIRS.map((d) => ({ q: hex.q + d.dq, r: hex.r + d.dr }));
}

/**
 * Tutti gli esagoni entro `range` passi da `center` (incluso il centro).
 * Range 0 = solo center. Range 1 = center + 6 vicini, ecc.
 */
export function hexesInRange(center: Axial, range: number): Axial[] {
  if (range < 0) return [];
  const result: Axial[] = [];
  for (let dq = -range; dq <= range; dq++) {
    const rMin = Math.max(-range, -dq - range);
    const rMax = Math.min(range, -dq + range);
    for (let dr = rMin; dr <= rMax; dr++) {
      result.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return result;
}

/**
 * Verifica se due esagoni sono adiacenti (distanza esattamente 1).
 */
export function areAdjacent(a: Axial, b: Axial): boolean {
  return !axialEquals(a, b) && hexDistance(a, b) === 1;
}

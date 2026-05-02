/**
 * Basetta unità — la "rosa" da 7 esagoni (1 centrale + 6 corona).
 *
 * Le unità in hex-tactics occupano 7 esagoni: l'esagono centrale come ancora,
 * più i 6 vicini. Importante per:
 * - Linea di vista in attacchi a distanza (i 7 centri sono usati per LoS)
 * - Deploy zone iniziali (zone di posizionamento per ogni fazione)
 * - Calcolo distanza minima tra unità (nemico → al più vicino dei 7 esagoni)
 */

import { Axial } from './coords';
import { hexesInRange } from './distance';

/** Restituisce i 7 esagoni della basetta centrata su `center` (range 1) */
export function getBaseHexes(center: Axial): Axial[] {
  return hexesInRange(center, 1);
}

/**
 * Verifica se due basette si sovrappongono (qualunque esagono in comune).
 * Usato per validare deploy o movimento.
 */
export function basesOverlap(centerA: Axial, centerB: Axial): boolean {
  const a = getBaseHexes(centerA);
  const b = getBaseHexes(centerB);
  for (const ha of a) {
    for (const hb of b) {
      if (ha.q === hb.q && ha.r === hb.r) return true;
    }
  }
  return false;
}

/**
 * Distanza in esagoni tra due unità: minimo della distanza tra i loro esagoni di basetta.
 */
export function baseDistance(centerA: Axial, centerB: Axial): number {
  // Per due basette, la distanza tra unità è la distanza tra centri − 2,
  // con floor a 0 (non possono essere sovrapposte se il gioco è valido).
  // Ma calcoliamo esplicitamente per sicurezza/correttezza.
  const a = getBaseHexes(centerA);
  const b = getBaseHexes(centerB);
  let min = Infinity;
  for (const ha of a) {
    for (const hb of b) {
      const dq = ha.q - hb.q;
      const dr = ha.r - hb.r;
      const ds = -dq - dr;
      const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
      if (d < min) min = d;
    }
  }
  return min;
}

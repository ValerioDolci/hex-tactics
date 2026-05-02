/**
 * Logica del round.
 *
 * - `computeTurnOrder` ordina le unità per impeto desc, parità per slancio desc, parità → casuale (RNG seeded)
 * - `endRound` valuta condizioni di game-over e prepara il prossimo round
 */

import { Unit, UnitId } from '@entities/Unit';
import { Rng } from '@utils/rng';
import { canPlay } from './turn';

/**
 * Calcola l'ordine dei turni per un round.
 *
 * Regola (CLAUDE.md §Round):
 *   1. impeto desc
 *   2. parità → slancio desc
 *   3. parità → casuale (per ora; rivalutabile)
 *
 * Vengono incluse solo le unità vive.
 */
export function computeTurnOrder(units: Record<UnitId, Unit>, rng: Rng): UnitId[] {
  const alive = Object.values(units).filter(canPlay);

  // Stable sort: ordiniamo prima per ID per avere un ordine "neutro" iniziale,
  // poi applichiamo le chiavi vere; l'ultimo tiebreaker è uno shuffle deterministico.
  const indexed = alive.map((u, i) => ({ u, idx: i, rand: rng.next() }));
  indexed.sort((a, b) => {
    if (a.u.impeto !== b.u.impeto) return b.u.impeto - a.u.impeto;
    if (a.u.slancio !== b.u.slancio) return b.u.slancio - a.u.slancio;
    return a.rand - b.rand;
  });

  return indexed.map((x) => x.u.id);
}

/**
 * Verifica condizione di game over: una sola fazione ancora viva.
 * Restituisce 'A', 'B', 'draw', oppure null se la partita continua.
 */
export function checkGameOver(units: Record<UnitId, Unit>): 'A' | 'B' | 'draw' | null {
  const aliveByFaction = { A: 0, B: 0 };
  for (const u of Object.values(units)) {
    if (canPlay(u)) {
      if (u.faction === 'A') aliveByFaction.A++;
      else aliveByFaction.B++;
    }
  }
  if (aliveByFaction.A === 0 && aliveByFaction.B === 0) return 'draw';
  if (aliveByFaction.A === 0) return 'B';
  if (aliveByFaction.B === 0) return 'A';
  return null;
}

/**
 * UI scale helpers per rendere i controlli tap-friendly su mobile.
 *
 * Su mobile (rilevato in main.ts via UA + matchMedia pointer:coarse), il design
 * 1280×800 con Scale.FIT è scalato a ~50% sul display fisico (iPhone landscape
 * ~844x390). Tutti i bottoni e font diventano fisicamente piccoli.
 *
 * Soluzione: moltiplicare font/button sizes per `uiScale()` (1.0 desktop, 1.4 mobile)
 * nei componenti UI critici. Restano logical-coordinate-based, quindi su desktop
 * sembra solo "un po' grosso" mentre su mobile diventa cliccabile col dito.
 */

/** Fattore di scala UI corrente. Default 1.0 se non settato (es. test ambiente). */
export function uiScale(): number {
  const w = window as unknown as { HEX_UI_SCALE?: number };
  return w.HEX_UI_SCALE ?? 1.0;
}

/** Helper: scala un valore intero. */
export function s(value: number): number {
  return Math.round(value * uiScale());
}

/** Helper: scala una stringa di font size CSS-like (es. "20px" → "28px" su mobile). */
export function sFont(px: number): string {
  return `${Math.round(px * uiScale())}px`;
}

/**
 * Logica del turno di una singola unità.
 *
 * Sequenza turno (CLAUDE.md §Turno):
 *   1. Recupero dadi azione: ⌊(F+A+V)/2⌋, ma cap 1/turno se impeto = 0
 *   2. Slancio attuale → si somma a impeto, poi azzera (D-029)
 *   3. Tiro slancio: 0-2 d6 + 2 (giocatore sceglie quanti dadi). Risultato → slancio nuovo.
 *   4./5. Movimento + azione in ordine libero
 *   6. End turn
 *
 * Stato limite (CLAUDE.md §Stati limite):
 *   - HP=0 → unità rimossa dalla board (alive=false)
 *   - Impeto=0 → recupero dadi azione capped a 1/turno
 *   - Slancio < 0 → eccesso negativo si sottrae a impeto (slancio resta a 0)
 */

import { Unit } from '@entities/Unit';
import { Rng } from '@utils/rng';
import { makeRoll, rollTotal } from './dice';
import {
  countFlatBonuses,
  countMaxDiceExtra,
  getActualDiceCount,
  getImpedimentTotal,
  makeSlancioContext,
} from './stats';
import { BASE_PG_FIXED } from './combat';
import { getWeapon } from '@data/weapons';

/** Calcola dadi azione recuperati a inizio turno: ⌊(F+A+V)/2⌋, cap 1 se impeto=0 */
export function computeDiceRecovery(unit: Unit): number {
  if (unit.impeto <= 0) return 1;
  const sum = unit.forza + unit.agilita + unit.volonta;
  return Math.floor(sum / 2);
}

/**
 * Calcola il cap massimo dello slancio per il transfer impeto→slancio (D-044).
 *   max = (2 + extraMax_skill) * 6 + BASE_PG_FIXED + flat_bonus_skill
 *
 * NOTA (Valerio): l'impedimento NON entra nel cap. Penalizza il TIRO (variabile della
 * fortuna), ma non lo "spazio massimo" che lo slancio può occupare nel personaggio.
 * Senza questa esclusione, PG con armatura pesante non potrebbero mai usare il transfer
 * impeto→slancio in modo significativo (cap troppo basso).
 */
export function getMaxSlancioRoll(unit: Unit): number {
  const ctx = makeSlancioContext();
  const extraMax = countMaxDiceExtra(unit.skills, ctx);
  const maxDice = 2 + extraMax;
  const flat = countFlatBonuses(unit.skills, ctx);
  return Math.max(0, maxDice * 6 + BASE_PG_FIXED + flat);
}

/**
 * Applica i passi 1-3 dell'inizio turno:
 *   - Recupera dadi azione (cap a dadiAzioneMax)
 *   - Slancio → impeto, slancio azzerato (D-029)
 *   - Tiro slancio nuovo con `slancioDiceN` dadi
 *
 * Restituisce una nuova Unit (immutabile).
 *
 * Floor: impeto può andare anche oltre impetoMax durante la partita
 *        (lo slancio si accumula come impeto buff). Niente cap upper di default.
 */
export function applyTurnStart(
  unit: Unit,
  slancioDiceN: number,
  rng: Rng,
  impetoToSlancio: number = 0,
): Unit {
  // 1. Recupero dadi.
  //    Regola: al PRIMO turno della battaglia (turnsPlayed===0) il PG parte col pool
  //    iniziale (baseline 6) — niente recovery. Dal 2° turno in poi: recovery normale.
  const recovery = unit.turnsPlayed === 0 ? 0 : computeDiceRecovery(unit);
  let newDadi = Math.min(unit.dadiAzioneMax, unit.dadiAzione + recovery);

  // Costo dadi azione del tiro slancio: la scelta del giocatore (clampedDiceN)
  // viene SOTTRATTA. I dadi forced via skill (+1dado) NON sono pagati — sono bonus skill.
  // Eccezione: `applyInitialSlancio` (round 0 setup) tira gratis senza passare di qui.

  // 2. Slancio → impeto
  let newImpeto = unit.impeto + unit.slancio;
  let newSlancio = 0;

  // 3. Tiro slancio: range 0-2 standard, +1dadomax skill può alzare
  const ctx = makeSlancioContext();
  const extraMax = countMaxDiceExtra(unit.skills, ctx);
  const maxSlancioDice = 2 + extraMax;
  // Clamp anche al pool corrente: non puoi tirare più dadi di quelli che hai.
  const clampedDiceN = Math.max(0, Math.min(slancioDiceN, maxSlancioDice, newDadi));

  // SOTTRAGGO i dadi pagati per il tiro slancio (la scelta del giocatore).
  newDadi = Math.max(0, newDadi - clampedDiceN);

  // +1 dado forzato (se skill matcha) — è bonus skill, non si paga.
  const actualDiceN = getActualDiceCount(unit, ctx, clampedDiceN);

  if (actualDiceN > 0) {
    const slancioRoll = makeRoll(rng, actualDiceN, BASE_PG_FIXED);
    // Bonus skill (+1 al tiro)
    slancioRoll.fixed += countFlatBonuses(unit.skills, ctx);
    // V2: imp alla VARIABILE (non alla fissa). Slancio loss da residuo neg.
    slancioRoll.variableMod = (slancioRoll.variableMod ?? 0) - getImpedimentTotal(unit);
    newSlancio = rollTotal(slancioRoll);
  } else {
    // 0 dadi: niente tiro, slancio resta 0
    newSlancio = 0;
  }

  // Slancio non scende mai sotto 0 (eccesso si sottrae a impeto)
  if (newSlancio < 0) {
    newImpeto += newSlancio;
    newSlancio = 0;
  }

  // 4. Transfer impeto → slancio (D-044): subito dopo il tiro, 1:1, gratuita.
  //    Floor scelta volontaria = 0 impeto. Cap superiore slancio = tiro massimo possibile.
  if (impetoToSlancio > 0) {
    const maxRoll = getMaxSlancioRoll(unit);
    const headroom = Math.max(0, maxRoll - newSlancio);
    const transferable = Math.max(0, Math.min(impetoToSlancio, newImpeto, headroom));
    newImpeto -= transferable;
    newSlancio += transferable;
  }

  // 2026-05-05 NEW: cap dinamico impeto = HP_attuali + impeto_iniziale.
  // Evita stallo "fuga reciproca per accumulare impeto all'infinito" (Nash degenere).
  // Più HP perdi → meno cap → snowball pressure narrativa.
  const capImpeto = unit.hp + computeInitialImpeto(unit);
  newImpeto = Math.min(newImpeto, capImpeto);

  return {
    ...unit,
    dadiAzione: newDadi,
    impeto: newImpeto,
    slancio: newSlancio,
    hexMovedThisTurn: 0, // reset all'inizio del turno (regola: 1 hex/turno gratis)
    actionTakenThisTurn: false, // reset: 1 azione per turno
    // Fase 1: snapshot posizione per calcolo carica + reset toggle stance
    positionAtTurnStart: unit.position,
    defensiveToggledThisTurn: false,
    // Increment turn counter (per regola "no recovery al 1° turno")
    turnsPlayed: unit.turnsPlayed + 1,
  };
}

/**
 * 2026-05-04 NEW: Impeto iniziale = MAX teorico tiro slancio (ogni d6 = 6).
 * L'impeto di setup riflette il "potenziale" di iniziativa del PG.
 */
export function computeInitialImpeto(unit: Unit): number {
  const ctx = makeSlancioContext();
  const extraMax = countMaxDiceExtra(unit.skills, ctx);
  const diceN = 2 + extraMax;
  const actualDiceN = getActualDiceCount(unit, ctx, diceN);
  const variableMax = actualDiceN * 6;
  const impediment = getImpedimentTotal(unit);
  const variableFloored = Math.max(0, variableMax - impediment);
  const flat = BASE_PG_FIXED + countFlatBonuses(unit.skills, ctx);
  return Math.max(0, variableFloored + flat);
}

/**
 * D-045: Round 0 di setup. Tira slancio iniziale (sempre 2d, max dadi) PRIMA del round 1.
 * Non recupera dadi azione, non applica slancio→impeto, non consente transfer impeto→slancio.
 *
 * 2026-05-04 NEW:
 *  - Setta impeto / impetoMax al MAX teorico tiro slancio (computeInitialImpeto).
 *  - Setta weaponLoaded=false per armi ranged con reload (archi, balestra) → arrivano
 *    al campo con l'arma scarica.
 */
export function applyInitialSlancio(unit: Unit, rng: Rng): Unit {
  const ctx = makeSlancioContext();
  const extraMax = countMaxDiceExtra(unit.skills, ctx);
  const diceN = 2 + extraMax; // sempre max
  const actualDiceN = getActualDiceCount(unit, ctx, diceN);
  const slancioRoll = makeRoll(rng, actualDiceN, BASE_PG_FIXED);
  slancioRoll.fixed += countFlatBonuses(unit.skills, ctx);
  slancioRoll.variableMod = (slancioRoll.variableMod ?? 0) - getImpedimentTotal(unit);
  const newSlancio = Math.max(0, rollTotal(slancioRoll));
  // Impeto iniziale = max teorico tiro slancio
  const impetoSetup = computeInitialImpeto(unit);
  // Armi ranged con reload partono SCARICHE
  let weaponLoaded = unit.weaponLoaded;
  if (unit.weapon) {
    const w = getWeapon(unit.weapon);
    if (w?.range && (w.range.reload != null || w.range.reloadCostSlancio != null)) {
      weaponLoaded = false;
    }
  }
  return { ...unit, slancio: newSlancio, impeto: impetoSetup, impetoMax: impetoSetup, weaponLoaded };
}

/** Applica una penalty di slancio (es. dopo schivata fallita avversaria) con propagazione a impeto se < 0 */
export function applySlancioPenalty(unit: Unit, penalty: number): Unit {
  let newSlancio = unit.slancio - penalty;
  let newImpeto = unit.impeto;
  if (newSlancio < 0) {
    newImpeto += newSlancio; // sottrae il negativo
    newSlancio = 0;
  }
  return { ...unit, slancio: newSlancio, impeto: newImpeto };
}

/** Verifica se l'unità è viva e può giocare il turno */
export function canPlay(unit: Unit): boolean {
  return unit.alive && unit.hp > 0;
}

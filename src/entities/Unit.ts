/**
 * Tipo runtime di un'unità (PG) sulla board.
 *
 * Stato baseline (vedi CLAUDE.md "Personaggio (baseline)"):
 *   HP 20, F/A/V 2/2/2, impeto 14, slancio 0, dadi azione 6
 *
 * L'unità occupa 7 esagoni (basetta) centrati su `position`. Vedi `getBaseHexes`.
 */

import { Axial } from '@core/hex/coords';
import { AcquiredSkill } from './Skill';

export type FactionId = 'A' | 'B';
export type UnitId = string;

/** ID di un pezzo di equipaggiamento (riferisce a `data/`) */
export type WeaponId = string;
export type ShieldId = string;
export type ArmorId = string;

export interface Unit {
  id: UnitId;
  name: string;
  faction: FactionId;

  /** ID del preset di provenienza (opzionale) — usato dall'AI matchup-aware per scegliere pesi appropriati */
  presetId?: string;

  /** Stat base (acquisto exp può modificarle? per ora baseline fissa 2/2/2) */
  forza: number;
  agilita: number;
  volonta: number;

  /** Punti vita */
  hp: number;
  hpMax: number;

  /** Impeto (iniziativa di base) */
  impeto: number;
  impetoMax: number;

  /** Slancio (modifica iniziativa, costa per movimento, si aggiunge a impeto) */
  slancio: number;

  /** Dadi azione disponibili e tetto massimo */
  dadiAzione: number;
  dadiAzioneMax: number;

  /** Equipaggiamento (riferimenti per ID a data/) */
  weapon?: WeaponId;
  /** Mano secondaria: scudo o seconda arma (per duello) */
  offhand?: WeaponId | ShieldId;
  armor?: ArmorId;

  /** Skill acquistate via character builder */
  skills: AcquiredSkill[];

  /** Posizione del centro della basetta sulla board */
  position: Axial;

  /** Stato vivente (true finché HP > 0) */
  alive: boolean;

  /** Numero di esagoni mossi nel turno corrente (1° gratis, gli altri costano 1 slancio).
   *  Reset a 0 a inizio turno. */
  hexMovedThisTurn: number;

  /** Stato di carica dell'arma equipaggiata. Rilevante per armi con `range.reload` (es. balestra).
   *  Default: true (carica all'inizio). Diventa false dopo un tiro. Si ricarica con azione RELOAD. */
  weaponLoaded: boolean;

  /** Flag "ho già usato la mia azione di turno" (attacco o ricarica).
   *  Le regole base permettono 1 azione per turno (movimento è separato). Reset a false in START_TURN. */
  actionTakenThisTurn: boolean;

  /** Fase 1 — Carica: posizione di inizio turno per calcolare delta_distance.
   *  Permette il calcolo di "quanti hex il PG si è avvicinato al nemico nel turno". */
  positionAtTurnStart?: Axial;

  /** Fase 1 — Posizione difensiva con scudo. Se true: parry.fixed scudo ×2 come RD passive
   *  (sia ranged sia CaC), imp scudo ×2, niente parry attivo. */
  defensiveStance: boolean;

  /** Fase 1 — Cap a 1 toggle/turno per la posizione difensiva. Reset in START_TURN. */
  defensiveToggledThisTurn: boolean;
}

/** Crea un'unità baseline ai valori di default. */
export function createBaselineUnit(params: {
  id: UnitId;
  name: string;
  faction: FactionId;
  position: Axial;
}): Unit {
  return {
    id: params.id,
    name: params.name,
    faction: params.faction,
    forza: 2,
    agilita: 2,
    volonta: 2,
    hp: 20,
    hpMax: 20,
    impeto: 14,
    impetoMax: 14,
    slancio: 0,
    dadiAzione: 6,
    dadiAzioneMax: 9, // pool max accumulabile (regola Valerio: 6 iniziali, 3/turno recovery, cap 9)
    skills: [],
    position: params.position,
    alive: true,
    hexMovedThisTurn: 0,
    defensiveStance: false,
    defensiveToggledThisTurn: false,
    weaponLoaded: true,
    actionTakenThisTurn: false,
  };
}

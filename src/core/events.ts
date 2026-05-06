/**
 * Eventi di gioco — tipi tagged union usati dal reducer.
 *
 * Il reducer (`reduce(state, event) → newState`) consuma questi eventi.
 * Ogni evento è un "comando" di gioco; il reducer valida e applica.
 *
 * Pattern: scrivere il client/AI come producer di eventi, il reducer come consumer puro.
 */

import { Axial } from './hex/coords';
import { UnitId } from '@entities/Unit';
import { Stat } from '@entities/Equipment';

/** Inizio round: calcola turn order, transizione fase a 'turn-start' */
export interface EventStartRound {
  type: 'START_ROUND';
}

/** Inizio turno della unit corrente: applica recovery, slancio→impeto, tiro slancio */
export interface EventStartTurn {
  type: 'START_TURN';
  /** Numero dadi tirati per slancio (0-2 standard, +max via skill) */
  slancioDice: number;
  /**
   * D-044: punti impeto trasferiti a slancio subito dopo il tiro (1:1, gratuita).
   * Default 0. Floor 0 (no impeto negativo per scelta), cap = max tiro slancio possibile.
   */
  impetoToSlancio?: number;
}

/** Movimento unità (deve essere il turno della unit) */
export interface EventMove {
  type: 'MOVE';
  unitId: UnitId;
  targetHex: Axial;
}

/** Dichiarazione di un attacco. Apre fase di scelta dadi privata. */
export interface EventDeclareAttack {
  type: 'DECLARE_ATTACK';
  attackerId: UnitId;
  targetId: UnitId;
  weaponId: string;
  attackModeIdx: number;
  /** Attacco a distanza (ranged) — niente difesa attiva */
  isRanged?: boolean;
  /** Stat scelta se mode.stat è 'either' */
  chosenStat?: Stat;
}

/** Attaccante sceglie quanti dadi per il suo attacco (privato). */
export interface EventChooseAttackerDice {
  type: 'CHOOSE_ATTACKER_DICE';
  diceN: number;
}

/** Difensore sceglie tipo difesa e quanti dadi (privato). */
export interface EventChooseDefense {
  type: 'CHOOSE_DEFENSE';
  defenseType: 'parry' | 'dodge' | 'none';
  /** Per parata: con cosa parare ('weapon' o 'offhand') */
  parryWith?: 'weapon' | 'offhand';
  diceN: number;
}

/** Risolve l'attacco corrente (rivela scelte, tira, applica danni). */
export interface EventResolveCombat {
  type: 'RESOLVE_COMBAT';
}

/** Ricarica l'arma con azione di abilità (difficoltà 7). */
export interface EventReload {
  type: 'RELOAD';
  unitId: UnitId;
  /** Numero di dadi PG scelti (1-2 standard, +max via skill) */
  diceN: number;
}

/** Termina il turno della unit corrente */
export interface EventEndTurn {
  type: 'END_TURN';
}

/** Termina il round, valuta game over e prepara next round */
export interface EventEndRound {
  type: 'END_ROUND';
}

/**
 * Asta nascosta di slancio per attraversare zona di controllo (meccanica A).
 * Stesso evento è emesso da attaccante (in awaiting-attacker-bid) e da difensore
 * (in awaiting-defender-bid). Il reducer determina chi sta biddando in base alla phase.
 * Regola V2 universale (post 2026-05-06): TUTTE le armi melee con reach >= 1
 * attivano la zona di controllo (era "solo lance reach >= 4").
 */
export interface EventBidMovement {
  type: 'BID_MOVEMENT';
  amount: number;
}

/**
 * Posizione difensiva con scudo. Azione GRATUITA, max 1 toggle/turno.
 * Effetto: imp scudo ×2, scudo passive RD ×2 (CaC + ranged), NO parry attivo.
 * Solo scudi veri (non spada lunga reach).
 */
export interface EventToggleDefensive {
  type: 'TOGGLE_DEFENSIVE';
  unitId: UnitId;
}

/**
 * Carica: bonus alla parte FISSA dell'attacco = amount.
 * Costa amount slancio. Disponibile fino a delta_distance verso il nemico.
 * Solo armi mischia + lancio (NO archi/balestre).
 */
export interface EventChooseCarica {
  type: 'CHOOSE_CARICA';
  amount: number;
}

/** Union degli eventi gestiti dal reducer */
export type GameEvent =
  | EventStartRound
  | EventStartTurn
  | EventMove
  | EventDeclareAttack
  | EventChooseAttackerDice
  | EventChooseDefense
  | EventResolveCombat
  | EventReload
  | EventEndTurn
  | EventEndRound
  | EventBidMovement
  | EventToggleDefensive
  | EventChooseCarica;

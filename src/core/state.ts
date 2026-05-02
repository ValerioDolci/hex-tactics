/**
 * GameState — stato globale di una battaglia.
 *
 * Pattern: stato immutabile + reducer (D-003). Il reducer di gioco vivrà in `events.ts` (M5).
 * Per M3 definiamo solo i tipi e il factory `createInitialState`.
 */

import { Unit, UnitId } from '@entities/Unit';
import { applyInitialSlancio } from './turn';
import { createRng } from '@utils/rng';

/** Fase corrente del flusso di gioco */
export type GamePhase =
  | 'turn-start'
  | 'choosing-action'
  | 'declaring-attack'
  | 'awaiting-defense'
  | 'resolving'
  | 'awaiting-attacker-bid'  // Meccanica A: bid attaccante
  | 'awaiting-defender-bid'  // Meccanica A: bid difensore
  | 'awaiting-carica'        // Fase 1: scelta carica
  | 'turn-end'
  | 'round-end'
  | 'game-over';

/** Tipo di una entry di log (umano-leggibile) */
export interface LogEntry {
  round: number;
  turnUnitId: UnitId | null;
  message: string;
}

/** Dati per la fase corrente (accumulati durante una sequenza attacco/difesa) */
export interface PendingAction {
  attackerId: UnitId;
  targetId: UnitId;
  weaponId: string;
  attackModeIdx: number;
  /** Attacco a distanza (ranged) — niente difesa attiva (D-032) */
  isRanged: boolean;
  /** Stat scelta dall'attaccante (se mode.stat = 'either') */
  chosenStat?: 'forza' | 'agilità' | 'volontà';
  /** Numero dadi scelti dall'attaccante (privato fino alla rivelazione) */
  attackerDice?: number;
  /** Decisione del difensore (solo per CaC) */
  defense?: {
    type: 'parry' | 'dodge' | 'none';
    diceN: number;
    /** Per parata: con cosa parare */
    parryWith?: 'weapon' | 'offhand';
  };
  /** Fase 1: bonus carica scelto in awaiting-carica (default 0) */
  caricaAmount?: number;
}

/**
 * Tracking del movimento multi-step con possibili aste di controllo zona (meccanica A).
 * MOVE è decomposto in singoli hex. Per ogni hex contestato (zona-reach >= 4 di un
 * difensore vivo con slancio>0), si apre un'asta nascosta di slancio.
 */
export interface MoveInProgress {
  unitId: UnitId;
  /** Path da pos partenza a pos finale (escluso start). */
  path: import('./hex/coords').Axial[];
  /** Quale hex stiamo per attraversare prossimo (0..len(path)). */
  currentIdx: number;
  /** 1° hex gratis applicato? */
  freeHexUsed: boolean;
  /** Slot per la fase di bid corrente */
  contestedHexIdx?: number;
  defenderId?: UnitId;
  attackerBid?: number;
  defenderBid?: number;
}

export interface GameState {
  round: number;
  /** ID delle unità in ordine di turno corrente (calcolato a inizio round) */
  turnOrder: UnitId[];
  /** Indice nel turnOrder dell'unità che sta giocando ora */
  currentTurnIdx: number;

  units: Record<UnitId, Unit>;
  board: { cols: number; rows: number };
  phase: GamePhase;

  /** Dati per la fase corrente, se attiva */
  pendingAction?: PendingAction;

  /** Meccanica A: tracking movimento multi-step con possibili aste */
  moveInProgress?: MoveInProgress;

  log: LogEntry[];

  /** Stato del RNG (per snapshot e replay) */
  rngSeed: number;

  /** Vincitore (impostato in 'game-over') */
  winner?: 'A' | 'B' | 'draw';
}

/** Factory per creare uno stato iniziale dato il roster e i bounds. */
export function createInitialState(params: {
  units: Unit[];
  board: { cols: number; rows: number };
  rngSeed: number;
}): GameState {
  // D-045: round 0 di setup — ogni unit alive tira slancio iniziale (2d, max dadi, no transfer).
  // Contemporaneo e automatico. Avviene una sola volta al setup del game.
  const rng = createRng(params.rngSeed);
  const unitsMap: Record<UnitId, Unit> = {};
  for (const u of params.units) {
    unitsMap[u.id] = u.alive ? applyInitialSlancio(u, rng) : u;
  }

  return {
    round: 0,
    turnOrder: [],
    currentTurnIdx: 0,
    units: unitsMap,
    board: params.board,
    phase: 'turn-start',
    log: [],
    rngSeed: rng.getState(),
  };
}

/** Helper: restituisce un nuovo stato con un'unità aggiornata. Mantiene immutabilità. */
export function updateUnit(state: GameState, unitId: UnitId, patch: Partial<Unit>): GameState {
  const current = state.units[unitId];
  if (!current) return state;
  return {
    ...state,
    units: { ...state.units, [unitId]: { ...current, ...patch } },
  };
}

/** Helper: aggiunge una entry al log */
export function appendLog(state: GameState, message: string): GameState {
  const turnUnitId =
    state.turnOrder.length > 0 ? state.turnOrder[state.currentTurnIdx] ?? null : null;
  const entry: LogEntry = { round: state.round, turnUnitId, message };
  return { ...state, log: [...state.log, entry] };
}

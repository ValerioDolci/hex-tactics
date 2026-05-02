/**
 * Simulation harness — battaglie AI vs AI in headless.
 *
 * Usa il `core/` (zero Phaser, già testato) e l'AI heuristic per simulare partite
 * deterministiche con seed numerati. Aggrega win-rate, durata, danni medi.
 *
 * Esecuzione:
 *   npx vitest run tests/sim/balance.test.ts --reporter=verbose
 *
 * (è scritto come test vitest per riusare il path alias resolution)
 */

import { createInitialState, GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';
import { Unit } from '@entities/Unit';
import { unitFromPreset, getPreset, PRESETS } from '@data/presets';
import { offsetToAxial } from '@core/hex/coords';
import { baseDistance } from '@core/hex/base';
import {
  aiDecideAction,
  aiDecideAttackerDice,
  aiDecideDefense,
  aiDecideSlancio,
} from '@ai/basicAi';
import { utilityDecideMove } from '@ai/utilityAi';
import { qChoose } from '@ai/qLearningAi';
import { mctsDecideMove, MctsConfig, DEFAULT_MCTS } from '@ai/mctsAi';

export type AiMode = 'heuristic' | 'utility' | 'mcts' | 'qlearning';

export interface AiConfig {
  modeA: AiMode;
  modeB: AiMode;
  mctsConfig?: MctsConfig;
  /** Weights utility per A (default: DEFAULT_WEIGHTS) — usato solo se modeA='utility' */
  weightsA?: import('@ai/utilityAi').UtilityWeights;
  /** Weights utility per B */
  weightsB?: import('@ai/utilityAi').UtilityWeights;
  /** Q-learning shared state (table + epsilon + rng + onTransition callback) */
  qctxA?: import('@ai/qLearningAi').QContext;
  qctxB?: import('@ai/qLearningAi').QContext;
}

/**
 * AI dispatcher: dato un GameState, sceglie l'AI corretta in base alla faction.
 * Le funzioni heuristic ritornano direttamente i sotto-eventi (slancio, attacker dice, defense)
 * mentre utility/mcts ritornano un singolo GameEvent unificato (la mossa scelta a fronte
 * di tutte le legali in fase corrente).
 */
function decideMoveByMode(state: GameState, unitId: string, mode: AiMode, mctsConfig?: MctsConfig, weights?: import('@ai/utilityAi').UtilityWeights, qctx?: import('@ai/qLearningAi').QContext): GameEvent {
  switch (mode) {
    case 'heuristic': {
      // Per heuristic, la chiamata varia in base alla fase
      if (state.phase === 'turn-start') {
        return { type: 'START_TURN', slancioDice: aiDecideSlancio(state, unitId) };
      }
      if (state.phase === 'choosing-action') return aiDecideAction(state, unitId);
      if (state.phase === 'declaring-attack') {
        return { type: 'CHOOSE_ATTACKER_DICE', diceN: aiDecideAttackerDice(state, unitId) };
      }
      if (state.phase === 'awaiting-defense') {
        // Trova il difensore (può essere diverso da unitId — è il target del pendingAction)
        const defId = state.pendingAction?.targetId ?? unitId;
        const def = aiDecideDefense(state, defId);
        return {
          type: 'CHOOSE_DEFENSE',
          defenseType: def.defenseType,
          parryWith: def.parryWith,
          diceN: def.diceN,
        };
      }
      if (state.phase === 'resolving') return { type: 'RESOLVE_COMBAT' };
      return { type: 'END_TURN' };
    }
    case 'utility': {
      return utilityDecideMove(state, unitId, weights);
    }
    case 'mcts': {
      // MCTS solo per la decisione strategica principale (choosing-action).
      // Per le sub-fasi (slancio, dadi attacco, difesa) usa heuristic come fallback,
      // così il branching factor del MCTS resta gestibile.
      if (state.phase === 'choosing-action') {
        return mctsDecideMove(state, unitId, mctsConfig ?? DEFAULT_MCTS);
      }
      // Fallback heuristic per le altre fasi
      return decideMoveByMode(state, unitId, 'heuristic');
    }
    case 'qlearning': {
      // Q-learning per turn-start, declaring-attack, awaiting-defense; heuristic per il resto.
      const qPhase = state.phase === 'turn-start' || state.phase === 'declaring-attack' || state.phase === 'awaiting-defense';
      if (qPhase && qctx) {
        const choice = qChoose(qctx.table, state, unitId, { epsilon: qctx.epsilon, rng: qctx.rng });
        if (qctx.onTransition) qctx.onTransition({ stateKey: choice.stateKey, actionIdx: choice.actionIdx, nActions: choice.nActions, unitId });
        return choice.event;
      }
      return decideMoveByMode(state, unitId, 'heuristic');
    }
  }
}

/** Snapshot leggibile dello stato di una unit */
function unitSnapshot(u: Unit): string {
  return `HP ${u.hp}/${u.hpMax} slan ${u.slancio} imp ${u.impeto} dadi ${u.dadiAzione} pos (${u.position.q},${u.position.r}) ${u.weaponLoaded ? 'CARICO' : 'SCARICO'}`;
}

/** Una entry del trace */
export interface TraceEntry {
  round: number;
  phase: string;
  description: string;
  /** Snapshot delle unit dopo l'evento (chiave = unitId) */
  units?: Record<string, string>;
}

/** Metriche di combattimento estratte dal log per analisi bilanciamento */
export interface CombatStats {
  /** Tentativi di attacco mischia (DECLARE_ATTACK CaC che hanno raggiunto RESOLVE) */
  meleeAttempts: { A: number; B: number };
  rangedAttempts: { A: number; B: number };
  /** Colpi a segno (hit), separati per attaccante */
  hits: { A: number; B: number };
  /** Difese: schivate riuscite (parry/dodge che bloccano) */
  parriesSuccessful: { A: number; B: number };
  parriesFailed: { A: number; B: number };
  dodgesSuccessful: { A: number; B: number };
  dodgesFailed: { A: number; B: number };
  /** Danni inflitti totali (post-RD) */
  damageDealt: { A: number; B: number };
  /** Danni assorbiti dall'armatura */
  damageAbsorbed: { A: number; B: number };
  /** Slancio penalty inflitti per schivate/parate riuscite */
  slancioPenaltyDealt: { A: number; B: number };
  /** Movimenti */
  moves: { A: number; B: number };
  /** Reload attempts/successes */
  reloadsAttempted: { A: number; B: number };
  reloadsSuccessful: { A: number; B: number };
  /** End turn passivi (turno passato senza azione) */
  endTurnsPassive: { A: number; B: number };
  /** Distribuzione scelte slancio dadi (0/1/2) */
  slancioDiceChoices: { A: { d0: number; d1: number; d2: number }; B: { d0: number; d1: number; d2: number } };
  /** Distribuzione scelte difensive (parry/dodge/none) */
  defenseChoices: { A: { parry: number; dodge: number; none: number }; B: { parry: number; dodge: number; none: number } };
  /** Distribuzione dadi attacco scelti (1/2) */
  attackerDiceChoices: { A: { d1: number; d2: number }; B: { d1: number; d2: number } };
}

function emptyCombatStats(): CombatStats {
  const z = (): { A: number; B: number } => ({ A: 0, B: 0 });
  return {
    meleeAttempts: z(),
    rangedAttempts: z(),
    hits: z(),
    parriesSuccessful: z(),
    parriesFailed: z(),
    dodgesSuccessful: z(),
    dodgesFailed: z(),
    damageDealt: z(),
    damageAbsorbed: z(),
    slancioPenaltyDealt: z(),
    moves: z(),
    reloadsAttempted: z(),
    reloadsSuccessful: z(),
    endTurnsPassive: z(),
    slancioDiceChoices: { A: { d0: 0, d1: 0, d2: 0 }, B: { d0: 0, d1: 0, d2: 0 } },
    defenseChoices: { A: { parry: 0, dodge: 0, none: 0 }, B: { parry: 0, dodge: 0, none: 0 } },
    attackerDiceChoices: { A: { d1: 0, d2: 0 }, B: { d1: 0, d2: 0 } },
  };
}

export interface SimResult {
  presetA: string;
  presetB: string;
  seed: number;
  winner: 'A' | 'B' | 'draw' | 'timeout';
  rounds: number;
  unitsHpFinal: { A: number; B: number };
  events: number;
  reloadsAttempted: { A: number; B: number };
  /** Quale fazione ha giocato per prima nel round 1 (utile per indagare bias iniziativa) */
  firstPlayer: 'A' | 'B';
  /** Stat dettagliate del combattimento (per analisi bilanciamento) */
  combatStats: CombatStats;
  /** Trace dettagliato (solo se verbose=true). Una riga per ogni passo significativo. */
  trace?: TraceEntry[];
  /** Log eventi grezzo dal reducer (sempre presente, copia di state.log). */
  rawLog?: { round: number; message: string }[];
}

/** Esegue una singola battaglia 1v1 AI vs AI con seed dato.
 * @param aiConfig se passato, controlla quale AI usa A e B.
 */
export function runBattle(
  presetAId: string,
  presetBId: string,
  seed: number,
  maxRounds = 50,
  verbose = false,
  deployHexDist = 19,
  aiConfig: AiConfig = { modeA: 'heuristic', modeB: 'heuristic' },
): SimResult {
  const presetA = getPreset(presetAId);
  const presetB = getPreset(presetBId);
  if (!presetA || !presetB) throw new Error(`Preset non trovato: ${presetAId}/${presetBId}`);

  const cols = 24;
  const rows = 18;
  const midRow = Math.floor(rows / 2);
  // Posizionamento parametrico sulla riga centrale, simmetrico al centro della mappa
  const halfDist = Math.floor(deployHexDist / 2);
  const cxCenter = Math.floor(cols / 2);
  const colA = Math.max(0, cxCenter - halfDist - 1);
  const colB = Math.min(cols - 1, cxCenter + halfDist);
  const a = unitFromPreset(presetA, 'A', offsetToAxial({ col: colA, row: midRow }));
  const b = unitFromPreset(presetB, 'B', offsetToAxial({ col: colB, row: midRow }));

  let state = createInitialState({
    units: [a, b],
    board: { cols, rows },
    rngSeed: seed,
  });

  let events = 0;
  let reloadsA = 0;
  let reloadsB = 0;
  const stats = emptyCombatStats();
  const trace: TraceEntry[] = [];

  // Mappa unitId → 'A' o 'B' per le stat
  const factionOf = (unitId: string): 'A' | 'B' => (state.units[unitId]?.faction ?? 'A');

  const traceState = (description: string): void => {
    if (!verbose) return;
    const units: Record<string, string> = {};
    for (const u of Object.values(state.units)) units[u.id] = unitSnapshot(u);
    trace.push({
      round: state.round,
      phase: state.phase,
      description,
      units,
    });
  };

  const traceEvent = (ev: GameEvent): void => {
    if (!verbose) return;
    let desc = `EVT ${ev.type}`;
    if (ev.type === 'START_TURN') desc += ` slancioDice=${ev.slancioDice}`;
    if (ev.type === 'MOVE') desc += ` ${ev.unitId} → (${ev.targetHex.q},${ev.targetHex.r})`;
    if (ev.type === 'DECLARE_ATTACK') {
      const dist = baseDistance(state.units[ev.attackerId].position, state.units[ev.targetId].position);
      desc += ` ${ev.attackerId} → ${ev.targetId} con ${ev.weaponId}${ev.isRanged ? ' [RANGED]' : ' [CaC]'} dist=${dist}`;
    }
    if (ev.type === 'CHOOSE_ATTACKER_DICE') desc += ` ${ev.diceN} dadi`;
    if (ev.type === 'CHOOSE_DEFENSE') desc += ` ${ev.defenseType}${ev.parryWith ? `(${ev.parryWith})` : ''} ${ev.diceN} dadi`;
    if (ev.type === 'RELOAD') desc += ` ${ev.unitId} ${ev.diceN} dadi`;
    trace.push({ round: state.round, phase: state.phase, description: `→ ${desc}` });
  };

  const dispatch = (ev: GameEvent): void => {
    traceEvent(ev);
    const before = state;

    // Pre-dispatch tracking (per stat)
    if (ev.type === 'DECLARE_ATTACK') {
      const f = factionOf(ev.attackerId);
      if (ev.isRanged) stats.rangedAttempts[f]++;
      else stats.meleeAttempts[f]++;
    }
    if (ev.type === 'MOVE') stats.moves[factionOf(ev.unitId)]++;
    if (ev.type === 'RELOAD') {
      stats.reloadsAttempted[factionOf(ev.unitId)]++;
      if (ev.unitId === 'A') reloadsA++;
      else reloadsB++;
    }
    // Tracking scelte specifiche
    if (ev.type === 'START_TURN') {
      const f = factionOf(state.turnOrder[state.currentTurnIdx]);
      const key: 'd0' | 'd1' | 'd2' = ev.slancioDice >= 2 ? 'd2' : ev.slancioDice === 1 ? 'd1' : 'd0';
      stats.slancioDiceChoices[f][key]++;
    }
    if (ev.type === 'CHOOSE_ATTACKER_DICE') {
      const f = factionOf(state.turnOrder[state.currentTurnIdx]);
      const key: 'd1' | 'd2' = ev.diceN >= 2 ? 'd2' : 'd1';
      stats.attackerDiceChoices[f][key]++;
    }
    if (ev.type === 'CHOOSE_DEFENSE') {
      // Il difensore è il target del pendingAction
      const defId = state.pendingAction?.targetId;
      if (defId) {
        const f = factionOf(defId);
        stats.defenseChoices[f][ev.defenseType]++;
      }
    }
    if (ev.type === 'END_TURN') {
      // Considera "passive" se l'unità non ha fatto azioni nel turno
      const u = state.units[state.turnOrder[state.currentTurnIdx]];
      if (u && !u.actionTakenThisTurn && u.hexMovedThisTurn === 0) {
        stats.endTurnsPassive[u.faction]++;
      }
    }

    // Snapshot pre-RESOLVE per misurare effetti
    let preResolveAttackerId: string | undefined;
    let preResolveTargetId: string | undefined;
    let preResolveTargetHp: number | undefined;
    let preResolveAttackerSlancio: number | undefined;
    let preResolveAttackerImpeto: number | undefined;
    let preResolveDefenseType: 'parry' | 'dodge' | 'none' | undefined;
    let preResolveIsRanged = false;
    let preResolveReloadUnitId: string | undefined;
    let preResolveWeaponLoadedBefore: boolean | undefined;

    if (ev.type === 'RESOLVE_COMBAT' && before.pendingAction) {
      const pa = before.pendingAction;
      preResolveAttackerId = pa.attackerId;
      preResolveTargetId = pa.targetId;
      preResolveTargetHp = before.units[pa.targetId]?.hp ?? 0;
      preResolveAttackerSlancio = before.units[pa.attackerId]?.slancio ?? 0;
      preResolveAttackerImpeto = before.units[pa.attackerId]?.impeto ?? 0;
      preResolveDefenseType = pa.defense?.type;
      preResolveIsRanged = pa.isRanged;
    }
    if (ev.type === 'RELOAD') {
      preResolveReloadUnitId = ev.unitId;
      preResolveWeaponLoadedBefore = before.units[ev.unitId]?.weaponLoaded ?? false;
    }

    state = reduce(state, ev);
    events++;

    // Post-dispatch tracking
    if (preResolveAttackerId && preResolveTargetId) {
      const af = factionOf(preResolveAttackerId);
      const df = factionOf(preResolveTargetId);
      const targetAfter = state.units[preResolveTargetId];
      const attackerAfter = state.units[preResolveAttackerId];
      const hpLost = (preResolveTargetHp ?? 0) - (targetAfter?.hp ?? 0);
      if (hpLost > 0) {
        stats.hits[af]++;
        stats.damageDealt[af] += hpLost;
      }
      const slancioPenalty = Math.max(0, (preResolveAttackerSlancio ?? 0) - (attackerAfter?.slancio ?? 0));
      const impetoPenalty = Math.max(0, (preResolveAttackerImpeto ?? 0) - (attackerAfter?.impeto ?? 0));
      if (slancioPenalty + impetoPenalty > 0 && hpLost === 0) {
        stats.slancioPenaltyDealt[df] += slancioPenalty + impetoPenalty;
      }
      if (!preResolveIsRanged && preResolveDefenseType) {
        if (preResolveDefenseType === 'parry') {
          if (hpLost > 0) stats.parriesFailed[df]++;
          else stats.parriesSuccessful[df]++;
        } else if (preResolveDefenseType === 'dodge') {
          if (hpLost > 0) stats.dodgesFailed[df]++;
          else stats.dodgesSuccessful[df]++;
        }
      }
    }
    if (preResolveReloadUnitId) {
      const f = factionOf(preResolveReloadUnitId);
      const after = state.units[preResolveReloadUnitId];
      if (!preResolveWeaponLoadedBefore && after?.weaponLoaded) {
        stats.reloadsSuccessful[f]++;
      }
    }

    // Se nuovi log nel reducer (post-reduce), aggiungili al trace
    if (verbose && state.log.length > before.log.length) {
      for (let i = before.log.length; i < state.log.length; i++) {
        const entry = state.log[i];
        trace.push({ round: entry.round, phase: state.phase, description: `  · ${entry.message}` });
      }
    }
    traceState('snapshot dopo evento');
  };

  if (verbose) traceState('STATO INIZIALE');

  // Game loop AI vs AI con cap di sicurezza
  dispatch({ type: 'START_ROUND' });
  const firstPlayer: 'A' | 'B' = (state.units[state.turnOrder[0]]?.faction ?? 'A');
  let safety = maxRounds * 100;

  const modeForFaction = (f: 'A' | 'B'): AiMode => (f === 'A' ? aiConfig.modeA : aiConfig.modeB);
  const weightsForFaction = (f: 'A' | 'B') => (f === 'A' ? aiConfig.weightsA : aiConfig.weightsB);
  const qctxForFaction = (f: 'A' | 'B') => (f === 'A' ? aiConfig.qctxA : aiConfig.qctxB);

  while (state.phase !== 'game-over' && safety-- > 0) {
    if (state.round > maxRounds) break;
    const phase = state.phase;
    const activeUnitId = state.turnOrder[state.currentTurnIdx];
    if (!activeUnitId) break;
    const activeUnit = state.units[activeUnitId];
    if (!activeUnit) break;

    if (phase === 'turn-start' || phase === 'choosing-action' || phase === 'declaring-attack') {
      const ev = decideMoveByMode(state, activeUnitId, modeForFaction(activeUnit.faction), aiConfig.mctsConfig, weightsForFaction(activeUnit.faction), qctxForFaction(activeUnit.faction));
      dispatch(ev);
      continue;
    }
    if (phase === 'awaiting-defense') {
      const defId = state.pendingAction?.targetId ?? activeUnitId;
      const def = state.units[defId];
      if (!def) break;
      const ev = decideMoveByMode(state, defId, modeForFaction(def.faction), aiConfig.mctsConfig, weightsForFaction(def.faction), qctxForFaction(def.faction));
      dispatch(ev);
      continue;
    }
    if (phase === 'resolving') {
      dispatch({ type: 'RESOLVE_COMBAT' });
      continue;
    }
    break;
  }
  if (verbose) trace.push({ round: state.round, phase: state.phase, description: `### FINE (safety=${safety}, events=${events}) winner=${state.winner ?? 'timeout'}` });

  let winner: SimResult['winner'] = 'timeout';
  if (state.phase === 'game-over') winner = state.winner ?? 'draw';

  // Raw log sempre disponibile (può servire anche senza verbose)
  const rawLog = state.log.map((l) => ({ round: l.round, message: l.message }));

  return {
    presetA: presetAId,
    presetB: presetBId,
    seed,
    winner,
    rounds: state.round,
    unitsHpFinal: { A: state.units.A?.hp ?? 0, B: state.units.B?.hp ?? 0 },
    events,
    reloadsAttempted: { A: reloadsA, B: reloadsB },
    firstPlayer,
    combatStats: stats,
    trace: verbose ? trace : undefined,
    rawLog,
  };
}

/** Analisi avanzata di un matchup: aggrega CombatStats su N partite */
export interface MatchupAnalysis {
  presetA: string;
  presetB: string;
  total: number;
  // Outcomes
  winRateA: number;
  winRateB: number;
  drawRate: number;
  timeoutRate: number;
  // Combat
  avgRounds: number;
  avgEvents: number;
  // Hit rate per attaccante (% colpi che passano la difesa)
  hitRateA: number;
  hitRateB: number;
  // Tasso schivata e parata riuscite
  parrySuccessA: number; // % di parate riuscite (su tutti i tentativi)
  parrySuccessB: number;
  dodgeSuccessA: number;
  dodgeSuccessB: number;
  // Damage / round
  avgDamagePerRoundA: number;
  avgDamagePerRoundB: number;
  // Avg attacchi tentati per partita
  avgMeleeAttacksA: number;
  avgMeleeAttacksB: number;
  avgRangedAttacksA: number;
  avgRangedAttacksB: number;
  // Movimenti per partita (mobilità)
  avgMovesA: number;
  avgMovesB: number;
  // Slancio penalty inflitti (potere disruptive)
  avgSlancioPenaltyA: number;
  avgSlancioPenaltyB: number;
  // Reload (per balestra)
  reloadSuccessRateA: number;
  reloadSuccessRateB: number;
  // Turni passivi (nessuna azione, nessun movimento) — indicatore di stallo
  passiveTurnRateA: number;
  passiveTurnRateB: number;
  // Bias iniziativa: % volte che ha vinto chi ha giocato per primo
  firstPlayerWinRate: number;
  // Distribuzione first player (in mirror dovrebbe essere 50/50)
  firstPlayerWasA: number;
}

export function analyzeMatchup(results: SimResult[]): MatchupAnalysis {
  const n = results.length;
  if (n === 0) throw new Error('analyzeMatchup: results vuoto');
  const first = results[0];
  const sumA = (f: (r: SimResult) => number): number => results.reduce((s, r) => s + f(r), 0);
  const safeRate = (num: number, den: number): number => (den > 0 ? num / den : 0);

  const winsA = results.filter((r) => r.winner === 'A').length;
  const winsB = results.filter((r) => r.winner === 'B').length;
  const draws = results.filter((r) => r.winner === 'draw').length;
  const timeouts = results.filter((r) => r.winner === 'timeout').length;

  const meleeA = sumA((r) => r.combatStats.meleeAttempts.A);
  const meleeB = sumA((r) => r.combatStats.meleeAttempts.B);
  const rangedA = sumA((r) => r.combatStats.rangedAttempts.A);
  const rangedB = sumA((r) => r.combatStats.rangedAttempts.B);
  const hitsA = sumA((r) => r.combatStats.hits.A);
  const hitsB = sumA((r) => r.combatStats.hits.B);
  const parryA_S = sumA((r) => r.combatStats.parriesSuccessful.A);
  const parryA_F = sumA((r) => r.combatStats.parriesFailed.A);
  const parryB_S = sumA((r) => r.combatStats.parriesSuccessful.B);
  const parryB_F = sumA((r) => r.combatStats.parriesFailed.B);
  const dodgeA_S = sumA((r) => r.combatStats.dodgesSuccessful.A);
  const dodgeA_F = sumA((r) => r.combatStats.dodgesFailed.A);
  const dodgeB_S = sumA((r) => r.combatStats.dodgesSuccessful.B);
  const dodgeB_F = sumA((r) => r.combatStats.dodgesFailed.B);
  const dmgA = sumA((r) => r.combatStats.damageDealt.A);
  const dmgB = sumA((r) => r.combatStats.damageDealt.B);
  const movesA = sumA((r) => r.combatStats.moves.A);
  const movesB = sumA((r) => r.combatStats.moves.B);
  const slP_A = sumA((r) => r.combatStats.slancioPenaltyDealt.A);
  const slP_B = sumA((r) => r.combatStats.slancioPenaltyDealt.B);
  const relA_A = sumA((r) => r.combatStats.reloadsAttempted.A);
  const relA_S = sumA((r) => r.combatStats.reloadsSuccessful.A);
  const relB_A = sumA((r) => r.combatStats.reloadsAttempted.B);
  const relB_S = sumA((r) => r.combatStats.reloadsSuccessful.B);
  const passA = sumA((r) => r.combatStats.endTurnsPassive.A);
  const passB = sumA((r) => r.combatStats.endTurnsPassive.B);
  const totalRounds = sumA((r) => r.rounds);

  // Bias iniziativa: chi ha giocato primo, quante volte ha vinto?
  const firstWinCount = results.filter((r) => {
    if (r.winner !== 'A' && r.winner !== 'B') return false;
    return r.firstPlayer === r.winner;
  }).length;
  const decisiveResults = results.filter((r) => r.winner === 'A' || r.winner === 'B').length;
  const firstPlayerAWasFirst = results.filter((r) => r.firstPlayer === 'A').length;

  return {
    presetA: first.presetA,
    presetB: first.presetB,
    total: n,
    winRateA: winsA / n,
    winRateB: winsB / n,
    drawRate: draws / n,
    timeoutRate: timeouts / n,
    avgRounds: sumA((r) => r.rounds) / n,
    avgEvents: sumA((r) => r.events) / n,
    hitRateA: safeRate(hitsA, meleeA + rangedA),
    hitRateB: safeRate(hitsB, meleeB + rangedB),
    parrySuccessA: safeRate(parryA_S, parryA_S + parryA_F),
    parrySuccessB: safeRate(parryB_S, parryB_S + parryB_F),
    dodgeSuccessA: safeRate(dodgeA_S, dodgeA_S + dodgeA_F),
    dodgeSuccessB: safeRate(dodgeB_S, dodgeB_S + dodgeB_F),
    avgDamagePerRoundA: safeRate(dmgA, totalRounds),
    avgDamagePerRoundB: safeRate(dmgB, totalRounds),
    avgMeleeAttacksA: meleeA / n,
    avgMeleeAttacksB: meleeB / n,
    avgRangedAttacksA: rangedA / n,
    avgRangedAttacksB: rangedB / n,
    avgMovesA: movesA / n,
    avgMovesB: movesB / n,
    avgSlancioPenaltyA: slP_A / n,
    avgSlancioPenaltyB: slP_B / n,
    reloadSuccessRateA: safeRate(relA_S, relA_A),
    reloadSuccessRateB: safeRate(relB_S, relB_A),
    passiveTurnRateA: safeRate(passA, totalRounds),
    passiveTurnRateB: safeRate(passB, totalRounds),
    firstPlayerWinRate: safeRate(firstWinCount, decisiveResults),
    firstPlayerWasA: safeRate(firstPlayerAWasFirst, n),
  };
}

/** Genera report markdown con analisi e insight di ottimizzazione. */
export function generateOptimizationReport(matchups: MatchupAnalysis[]): string {
  const lines: string[] = [];
  lines.push('# Report di ottimizzazione bilanciamento');
  lines.push('');
  lines.push('## Tabella sintetica');
  lines.push('');
  lines.push('| A | B | Win A | Win B | TO | Round | DPR A | DPR B | Hit A | Hit B | ParrA% | ParrB% | DodgA% | DodgB% | 1stWin% | 1stA% |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of matchups) {
    lines.push(
      `| ${m.presetA} | ${m.presetB} | ${(m.winRateA * 100).toFixed(0)}% | ${(m.winRateB * 100).toFixed(0)}% | ${(m.timeoutRate * 100).toFixed(0)}% | ${m.avgRounds.toFixed(1)} | ${m.avgDamagePerRoundA.toFixed(1)} | ${m.avgDamagePerRoundB.toFixed(1)} | ${(m.hitRateA * 100).toFixed(0)}% | ${(m.hitRateB * 100).toFixed(0)}% | ${(m.parrySuccessA * 100).toFixed(0)}% | ${(m.parrySuccessB * 100).toFixed(0)}% | ${(m.dodgeSuccessA * 100).toFixed(0)}% | ${(m.dodgeSuccessB * 100).toFixed(0)}% | ${(m.firstPlayerWinRate * 100).toFixed(0)}% | ${(m.firstPlayerWasA * 100).toFixed(0)}% |`,
    );
  }
  lines.push('');
  lines.push('Legenda: DPR = Damage Per Round, Hit = % colpi a segno, Parr/Dodg = % difese riuscite, 1stWin% = chi gioca primo vince % volte (50% = niente bias), 1stA% = % volte A è andato primo (50% = niente bias seed)');
  lines.push('');
  lines.push('## Insight automatici');
  lines.push('');
  const insights: string[] = [];
  for (const m of matchups) {
    // Win rate sbilanciato
    if (m.winRateA > 0.7 && m.winRateB < 0.2) {
      insights.push(`⚠ **${m.presetA} vs ${m.presetB}**: A vince ${(m.winRateA * 100).toFixed(0)}%. Sbilanciato.`);
    }
    // Stallo: timeout alto + bassa damage rate
    if (m.timeoutRate > 0.5 && m.avgDamagePerRoundA + m.avgDamagePerRoundB < 1) {
      insights.push(`🔁 **${m.presetA} vs ${m.presetB}**: stallo (TO ${(m.timeoutRate * 100).toFixed(0)}%, DPR totale ${(m.avgDamagePerRoundA + m.avgDamagePerRoundB).toFixed(2)} < 1). Cause: difese troppo forti, hit rate basso.`);
    }
    // Parry power overwhelming
    if (m.parrySuccessA > 0.8 && m.parrySuccessA > 0) {
      insights.push(`🛡 **${m.presetA} vs ${m.presetB}**: ${m.presetA} para ${(m.parrySuccessA * 100).toFixed(0)}% degli attacchi. Parata troppo affidabile.`);
    }
    if (m.parrySuccessB > 0.8 && m.parrySuccessB > 0) {
      insights.push(`🛡 **${m.presetA} vs ${m.presetB}**: ${m.presetB} para ${(m.parrySuccessB * 100).toFixed(0)}% degli attacchi.`);
    }
    // Hit rate basso (attacchi inutili)
    if (m.hitRateA < 0.2 && m.avgMeleeAttacksA + m.avgRangedAttacksA > 2) {
      insights.push(`🎯 **${m.presetA} vs ${m.presetB}**: ${m.presetA} colpisce solo ${(m.hitRateA * 100).toFixed(0)}% (su ${(m.avgMeleeAttacksA + m.avgRangedAttacksA).toFixed(1)} attacchi). Attacchi sprecati.`);
    }
    // Turni passivi
    if (m.passiveTurnRateA > 0.3) {
      insights.push(`💤 **${m.presetA} vs ${m.presetB}**: ${m.presetA} passa il turno senza fare nulla nel ${(m.passiveTurnRateA * 100).toFixed(0)}% dei turni.`);
    }
    // Bias iniziativa: se mirror match, firstPlayerWinRate dovrebbe essere 50%
    if (m.presetA === m.presetB && Math.abs(m.firstPlayerWinRate - 0.5) > 0.15 && (m.winRateA + m.winRateB) > 0.3) {
      const skew = m.firstPlayerWinRate > 0.5 ? 'PRIMO vince' : 'SECONDO vince';
      insights.push(`⚖ **mirror ${m.presetA}**: chi gioca ${skew} ${(m.firstPlayerWinRate * 100).toFixed(0)}% — bias iniziativa significativo.`);
    }
    if (m.presetA === m.presetB && Math.abs(m.firstPlayerWasA - 0.5) > 0.1) {
      insights.push(`🎲 **mirror ${m.presetA}**: A inizia per primo solo ${(m.firstPlayerWasA * 100).toFixed(0)}% delle volte — bias di seed nel turn order.`);
    }
  }
  if (insights.length === 0) lines.push('- (nessun outlier rilevato)');
  for (const i of insights) lines.push(`- ${i}`);
  lines.push('');
  lines.push('## Suggerimenti di ottimizzazione');
  lines.push('');
  lines.push('Basati sui dati sopra. Da decidere quali applicare:');
  lines.push('');
  lines.push('1. **Cap parata residual**: se la parata resterebbe in negativo "estremo" (es. residual < -10), capparla. Riduce stallo Tank vs Tank.');
  lines.push('2. **Costo skill specializzazione granulare**: skill `[oggetto specifico]` 1.5× costo `[classe oggetto]` 1.5× costo `[azione]`. Disincentiva over-specialization.');
  lines.push('3. **Arco minimum range penalty**: malus al tiro arco se distanza < 2 hex (chip dell\'instakill ravvicinato).');
  lines.push('4. **Damage cap per turno**: max danni inflitti in un singolo attacco capped al 50% HP target. Evita oneshot.');
  lines.push('5. **Slancio penalty cap**: limita la propagazione slancio→impeto a max -3 per turno. Evita death-spiral.');
  return lines.join('\n');
}

/** Formatta il trace di una battaglia in markdown leggibile (per file). */
export function formatTrace(result: SimResult): string {
  const lines: string[] = [];
  lines.push(`# Battle Trace: ${result.presetA} (A) vs ${result.presetB} (B)`);
  lines.push(`- seed: ${result.seed}`);
  lines.push(`- winner: ${result.winner}`);
  lines.push(`- rounds: ${result.rounds}`);
  lines.push(`- events: ${result.events}`);
  lines.push(`- HP finali: A=${result.unitsHpFinal.A}, B=${result.unitsHpFinal.B}`);
  lines.push(`- reloads: A=${result.reloadsAttempted.A}, B=${result.reloadsAttempted.B}`);
  lines.push('');
  if (result.trace) {
    lines.push('## Trace passo-passo');
    lines.push('');
    let lastRound = -1;
    for (const t of result.trace) {
      if (t.round !== lastRound) {
        lines.push('');
        lines.push(`### Round ${t.round} (phase=${t.phase})`);
        lastRound = t.round;
      }
      lines.push(t.description);
      if (t.units) {
        for (const [id, snap] of Object.entries(t.units)) {
          lines.push(`    [${id}] ${snap}`);
        }
      }
    }
  } else if (result.rawLog) {
    lines.push('## Raw log eventi');
    lines.push('');
    for (const e of result.rawLog) {
      lines.push(`R${e.round}: ${e.message}`);
    }
  }
  return lines.join('\n');
}

export interface MatchupSummary {
  presetA: string;
  presetB: string;
  total: number;
  winsA: number;
  winsB: number;
  draws: number;
  timeouts: number;
  avgRounds: number;
  avgEvents: number;
  hpA_avg: number;
  hpB_avg: number;
  reloadsA_avg: number;
  reloadsB_avg: number;
}

/** Esegue N simulazioni per una coppia di preset, aggrega le statistiche. */
export function runMatchup(
  presetAId: string,
  presetBId: string,
  n: number,
  seedBase = 1000,
  deployHexDist = 19,
): MatchupSummary {
  const results: SimResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push(runBattle(presetAId, presetBId, seedBase + i, 50, false, deployHexDist));
  }
  const winsA = results.filter((r) => r.winner === 'A').length;
  const winsB = results.filter((r) => r.winner === 'B').length;
  const draws = results.filter((r) => r.winner === 'draw').length;
  const timeouts = results.filter((r) => r.winner === 'timeout').length;
  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  return {
    presetA: presetAId,
    presetB: presetBId,
    total: n,
    winsA,
    winsB,
    draws,
    timeouts,
    avgRounds: avg(results.map((r) => r.rounds)),
    avgEvents: avg(results.map((r) => r.events)),
    hpA_avg: avg(results.map((r) => r.unitsHpFinal.A)),
    hpB_avg: avg(results.map((r) => r.unitsHpFinal.B)),
    reloadsA_avg: avg(results.map((r) => r.reloadsAttempted.A)),
    reloadsB_avg: avg(results.map((r) => r.reloadsAttempted.B)),
  };
}

/** Genera matrice di tutti i matchup tra preset (anche mirror). */
export function runFullMatrix(n = 30, deployHexDist = 19): MatchupSummary[] {
  const ids = PRESETS.map((p) => p.id);
  const out: MatchupSummary[] = [];
  for (const a of ids) {
    for (const b of ids) {
      out.push(runMatchup(a, b, n, 1000, deployHexDist));
    }
  }
  return out;
}

/** Stampa report formattato. */
export function formatReport(summaries: MatchupSummary[]): string {
  const lines: string[] = [];
  lines.push('# Simulation Report (AI vs AI)');
  lines.push('');
  lines.push('| Preset A | Preset B | N | Wins A | Wins B | Draws | TO | Avg Round | Avg HP A | Avg HP B | Reload A | Reload B |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries) {
    lines.push(
      `| ${s.presetA} | ${s.presetB} | ${s.total} | ${s.winsA} (${((s.winsA / s.total) * 100).toFixed(0)}%) | ${s.winsB} (${((s.winsB / s.total) * 100).toFixed(0)}%) | ${s.draws} | ${s.timeouts} | ${s.avgRounds.toFixed(1)} | ${s.hpA_avg.toFixed(1)} | ${s.hpB_avg.toFixed(1)} | ${s.reloadsA_avg.toFixed(1)} | ${s.reloadsB_avg.toFixed(1)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Observation v2 — porting 1:1 di python/hex_tactics/ai/obs_features_v2.py
 *
 * 153 feature in totale (deve matchare N_FEATURES_TOTAL_V2 della versione Python).
 * Layout:
 *   G1 self_stats          (5)
 *   G2 enemy_stats         (5)
 *   G3 equip_self          (21)
 *   G4 equip_enemy         (21)
 *   G5 skills_self_derived (7)
 *   G6 position            (4)
 *   G7 phase_meta          (14)
 *   G8 history_self        (60) — 5 entry × 12 feat
 *   G9 bid_context         (12)
 *   G10 fase1_context      (4)
 *
 * Note:
 *   - La history_self richiederebbe un tracker degli eventi della partita.
 *     Per il primo MVP la passiamo a zero. TODO: implementare HistoryTracker
 *     in BattleScene.dispatch e popolare le ultime 5 entry.
 */

import { GameState } from '@core/state';
import { Unit } from '@entities/Unit';
import { computeLoS } from '@core/ranged';
import { hexDistance } from '@core/hex/distance';
import { baseDistance } from '@core/hex/base';
import { getWeapon } from '@data/weapons';
import {
  countFlatBonuses,
  getImpedimentTotal,
  makeAttackContext,
  makeDodgeContext,
  makeParryContext,
  makeSlancioContext,
} from '@core/stats';
import { RollContext } from '@entities/Skill';

// Vocabolari one-hot (devono matchare l'ordine Python esattamente!)
export const WEAPON_IDS = [
  'pugnale', 'spada', 'spada_lunga', 'mazza', 'ascia_1h', 'ascia_2h',
  'lancia_2m', 'lancia_3m', 'giavellotto', 'arco_corto', 'arco_lungo', 'balestra',
] as const;

export const SHIELD_IDS = ['scudo_piccolo', 'scudo_medio', 'scudo_pesante'] as const;
export const ARMOR_IDS = ['armatura_leggera', 'armatura_media', 'armatura_pesante'] as const;

const WEAPON_TO_IDX: Record<string, number> = Object.fromEntries(
  WEAPON_IDS.map((w, i) => [w, i]),
);
const SHIELD_TO_IDX: Record<string, number> = Object.fromEntries(
  SHIELD_IDS.map((s, i) => [s, i]),
);
const ARMOR_TO_IDX: Record<string, number> = Object.fromEntries(
  ARMOR_IDS.map((a, i) => [a, i]),
);

const PHASES = [
  'turn-start', 'choosing-action', 'declaring-attack',
  'awaiting-defense', 'resolving',
  'awaiting-attacker-bid', 'awaiting-defender-bid',
  'awaiting-carica',
] as const;
const PHASE_TO_ID: Record<string, number> = Object.fromEntries(
  PHASES.map((p, i) => [p, i]),
);

// Layout sizes
const N_SELF = 5;
const N_ENEMY = 5;
const N_EQUIP = 21;
const N_SKILLS_DERIVED = 7;
const N_POSITION = 4;
const N_PHASE_META = 14;
const N_HISTORY_PER_ENTRY = 12;
const HISTORY_LEN = 5;
const N_HISTORY_TOTAL = N_HISTORY_PER_ENTRY * HISTORY_LEN;
const N_BID_CONTEXT = 12;
const N_FASE1_CONTEXT = 4;

export const N_FEATURES_TOTAL_V2 =
  N_SELF + N_ENEMY + 2 * N_EQUIP + N_SKILLS_DERIVED +
  N_POSITION + N_PHASE_META + N_HISTORY_TOTAL +
  N_BID_CONTEXT + N_FASE1_CONTEXT;
// = 5+5+42+7+4+14+60+12+4 = 153

// =====================================================================
// Helpers per ogni gruppo
// =====================================================================

function selfStats(me: Unit | undefined): number[] {
  if (!me) return new Array(N_SELF).fill(0);
  return [
    me.hp / 20,
    me.slancio / 30,
    me.impeto / 30,
    me.dadiAzione / 9,
    me.weaponLoaded ? 1 : 0,
  ];
}

function enemyStats(enemy: Unit | undefined): number[] {
  if (!enemy) return new Array(N_ENEMY).fill(0);
  return [
    enemy.hp / 20,
    enemy.slancio / 30,
    enemy.impeto / 30,
    enemy.dadiAzione / 9,
    enemy.alive ? 1 : 0,
  ];
}

function equipOneHot(unit: Unit | undefined): number[] {
  const out = new Array(N_EQUIP).fill(0);
  if (!unit) return out;
  // Weapon (idx 0..11, idx 12 = null)
  if (unit.weapon && unit.weapon in WEAPON_TO_IDX) {
    out[WEAPON_TO_IDX[unit.weapon]] = 1;
  }
  // offhand: idx 13..15 = SHIELD_IDS, 16 = weapon offhand, 17 = null offhand
  if (unit.offhand) {
    if (unit.offhand in SHIELD_TO_IDX) {
      out[13 + SHIELD_TO_IDX[unit.offhand]] = 1;
    } else if (unit.offhand in WEAPON_TO_IDX) {
      out[16] = 1;
    }
  }
  // Armor (idx 17..19 = ARMOR_IDS, 20 = null)
  // NOTA: il Python ha un offset bug — armor parte da idx 17 SOVRAPPONENDO offhand-null.
  // Replichiamo 1:1 (l'env Python usa lo stesso layout per il modello v14).
  if (unit.armor && unit.armor in ARMOR_TO_IDX) {
    out[17 + ARMOR_TO_IDX[unit.armor]] = 1;
  }
  return out;
}

function skillsDerived(unit: Unit | undefined): number[] {
  if (!unit) return new Array(N_SKILLS_DERIVED).fill(0);
  const imp = getImpedimentTotal(unit);
  // Per i bonus tiro: usiamo un context generico per ogni azione
  const ctxAtk: RollContext = unit.weapon
    ? makeAttackContext(unit.weapon, 'spade', 'forza')
    : { azione: 'attaccare' };
  const ctxPar: RollContext = unit.weapon
    ? makeParryContext(unit.weapon, 'spade')
    : { azione: 'parare' };
  const ctxDod = makeDodgeContext();
  const ctxSla = makeSlancioContext();

  const sumDado = unit.skills
    .filter((s) => s.modifier === '+1dado')
    .reduce((sum, s) => sum + (s.level ?? 1), 0);
  const sumDadomax = unit.skills
    .filter((s) => s.modifier === '+1dadomax')
    .reduce((sum, s) => sum + (s.level ?? 1), 0);

  return [
    imp / 10,
    countFlatBonuses(unit.skills, ctxAtk) / 4,
    countFlatBonuses(unit.skills, ctxPar) / 4,
    countFlatBonuses(unit.skills, ctxDod) / 4,
    countFlatBonuses(unit.skills, ctxSla) / 4,
    sumDado / 4,
    sumDadomax / 4,
  ];
}

function positionFeat(state: GameState, me: Unit | undefined, enemy: Unit | undefined): number[] {
  if (!me || !enemy || !me.alive || !enemy.alive) return new Array(N_POSITION).fill(0);
  const dist = baseDistance(me.position, enemy.position);
  let vis = 0;
  try {
    const los = computeLoS(me, enemy, state.units);
    vis = los.visibility;
  } catch {
    vis = 0;
  }
  return [
    dist / 20,
    vis / 7,
    dist <= 1 ? 1 : 0,
    dist <= 4 ? 1 : 0,
  ];
}

function phaseMeta(state: GameState, agentFaction: 'A' | 'B', enforcePrivacy: boolean): number[] {
  const out = new Array(PHASES.length).fill(0); // 8 phases
  const pid = PHASE_TO_ID[state.phase];
  if (pid !== undefined) out[pid] = 1;
  out.push(state.round / 10);

  const pa = state.pendingAction;
  if (!pa) {
    return out.concat([0, 0, 0, 0, 0]);
  }
  out.push(1); // has_pending
  out.push(pa.isRanged ? 1 : 0);
  out.push(pa.attackModeIdx / 3);
  const attacker = state.units[pa.attackerId];
  const amAttacker = attacker != null && attacker.faction === agentFaction;
  const showAtk = !(enforcePrivacy && state.phase === 'awaiting-defense' && !amAttacker);
  if (showAtk && pa.attackerDice != null) {
    out.push(pa.attackerDice / 3);
  } else {
    out.push(0);
  }
  out.push(amAttacker ? 1 : -1);
  return out;
}

function bidContext(state: GameState, agentFaction: 'A' | 'B'): number[] {
  const out = new Array(N_BID_CONTEXT).fill(0);
  const isBidPhase = state.phase === 'awaiting-attacker-bid' || state.phase === 'awaiting-defender-bid';
  if (!isBidPhase || !state.moveInProgress) return out;

  const mip = state.moveInProgress;
  out[0] = 1; // in_bid_phase
  const atkUnit = state.units[mip.unitId];
  const defUnit = mip.defenderId ? state.units[mip.defenderId] : undefined;
  if (!atkUnit) return out;

  const amAtk = atkUnit.faction === agentFaction;
  const amDef = defUnit != null && defUnit.faction === agentFaction;
  out[1] = amAtk ? 1 : 0;
  out[2] = amDef ? 1 : 0;

  const pathLen = mip.path.length;
  out[3] = pathLen / 10;
  out[4] = mip.currentIdx / 10;
  out[5] = Math.max(0, pathLen - mip.currentIdx) / 10;

  if (defUnit) {
    const wDef = defUnit.weapon ? getWeapon(defUnit.weapon) : null;
    const reach = wDef?.range?.reach ?? 0;
    out[6] = reach / 6;
    out[7] = defUnit.slancio / 30;
  }
  out[8] = atkUnit.slancio / 30;

  if (pathLen > 0) {
    const target = mip.path[pathLen - 1];
    out[9] = hexDistance(atkUnit.position, target) / 10;
  }

  if (mip.contestedHexIdx != null) {
    out[10] = mip.contestedHexIdx / 5;
    if (defUnit && mip.contestedHexIdx >= 0 && mip.contestedHexIdx < pathLen) {
      const contested = mip.path[mip.contestedHexIdx];
      out[11] = hexDistance(defUnit.position, contested) / 6;
    }
  }
  return out;
}

function fase1Context(me: Unit | undefined, enemy: Unit | undefined): number[] {
  const out = new Array(N_FASE1_CONTEXT).fill(0);
  if (me) out[0] = me.defensiveStance ? 1 : 0;
  if (enemy) out[1] = enemy.defensiveStance ? 1 : 0;
  if (me && enemy && me.positionAtTurnStart) {
    const dStart = baseDistance(me.positionAtTurnStart, enemy.position);
    const dNow = baseDistance(me.position, enemy.position);
    const delta = Math.max(0, dStart - dNow);
    out[2] = delta / 10;
    out[3] = Math.max(0, Math.min(delta, me.slancio)) / 10;
  }
  return out;
}

function historyEntryFeat(): number[] {
  // TODO: tracking history nel BattleScene. Per ora zero-padded.
  return new Array(N_HISTORY_PER_ENTRY).fill(0);
}

// =====================================================================
// Main
// =====================================================================

export interface BuildObsOptions {
  agentFaction: 'A' | 'B';
  agentUnitId?: string;
  enforceSimultaneousPrivacy?: boolean;
}

/**
 * Costruisce il vettore di osservazione da 153 feature compatibile col modello v14.
 * NOTA: la history_self è zero-padded perché non abbiamo ancora un tracker.
 */
export function buildObsV2(state: GameState, opts: BuildObsOptions): Float32Array {
  const enforcePrivacy = opts.enforceSimultaneousPrivacy ?? true;
  const agentFaction = opts.agentFaction;

  // Find me + enemy
  let me: Unit | undefined;
  if (opts.agentUnitId) me = state.units[opts.agentUnitId];
  if (!me) {
    for (const u of Object.values(state.units)) {
      if (u.faction === agentFaction) {
        me = u;
        break;
      }
    }
  }
  let enemy: Unit | undefined;
  const otherFac: 'A' | 'B' = agentFaction === 'A' ? 'B' : 'A';
  for (const u of Object.values(state.units)) {
    if (u.faction === otherFac) {
      enemy = u;
      break;
    }
  }

  const out: number[] = [];
  out.push(...selfStats(me));
  out.push(...enemyStats(enemy));
  out.push(...equipOneHot(me));
  out.push(...equipOneHot(enemy));
  out.push(...skillsDerived(me));
  out.push(...positionFeat(state, me, enemy));
  out.push(...phaseMeta(state, agentFaction, enforcePrivacy));

  // history (zero-padded per ora)
  for (let i = 0; i < HISTORY_LEN; i++) {
    out.push(...historyEntryFeat());
  }

  out.push(...bidContext(state, agentFaction));
  out.push(...fase1Context(me, enemy));

  if (out.length !== N_FEATURES_TOTAL_V2) {
    throw new Error(
      `obs_v2 feature count mismatch: got ${out.length}, expected ${N_FEATURES_TOTAL_V2}`,
    );
  }
  return new Float32Array(out);
}

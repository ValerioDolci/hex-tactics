/**
 * AI heuristic base — decision tree per le scelte di una unità AI.
 *
 * Funzioni pure: input GameState (+ unitId), output decisione.
 * Nessuna dipendenza da Phaser. Testabile.
 *
 * Strategia:
 *   - Slancio: tira 2 dadi se ha dadi azione, altrimenti meno.
 *   - Azione: se nemico in mischia → attacca; se in ranged → spara; altrimenti muoviti verso nemico più vicino.
 *   - Dadi attacco: 2 se possibile, soglia HP-aware (più dadi se può uccidere il nemico).
 *   - Difesa: parà se ha arma idonea e attacco temibile, schiva altrimenti, niente se 0 dadi.
 */

import { GameState } from '@core/state';
import { Unit, UnitId } from '@entities/Unit';
import { hexDistance, hexesInRange, neighbors } from '@core/hex/distance';
import { Axial } from '@core/hex/coords';
import { baseDistance, getBaseHexes } from '@core/hex/base';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import { canFireRanged } from '@core/ranged';
import { GameEvent, EventDeclareAttack, EventMove, EventEndTurn } from '@core/events';

/** Trova il nemico più vicino vivo */
function findClosestEnemy(state: GameState, me: Unit): Unit | null {
  const enemies = Object.values(state.units).filter((u) => u.faction !== me.faction && u.alive);
  if (enemies.length === 0) return null;
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = baseDistance(me.position, e.position);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/** Quanti dadi tirare per lo slancio del turno corrente.
 *
 * Strategia:
 * 1. Se sono in mischia (nemico adiacente o in reach), lo slancio non serve per il
 *    movimento → tira 0 e risparmia dadi azione per attacchi.
 * 2. Se l'impedimento totale supera il bonus atteso del tiro slancio (2 fissi + ~3.5/dado),
 *    tirare significa erodere impeto in negativo. Tira 0.
 * 3. Altrimenti: tira il massimo tollerabile per dadi azione disponibili.
 */
export function aiDecideSlancio(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u) return 0;

  // Se ho già un nemico in mischia → niente slancio, risparmia dadi azione
  const enemy = findClosestEnemy(state, u);
  if (enemy && u.weapon) {
    const w = getWeapon(u.weapon);
    const reach = w?.range?.reach ?? 1;
    const dist = baseDistance(u.position, enemy.position);
    if (dist <= reach) return 0;
  }

  // Se l'impedimento mangia il tiro: 2d6+2 medio = 9, ma con imp >= 7 è pura perdita
  const imp = (() => {
    let total = 0;
    if (u.weapon) {
      const w = getWeapon(u.weapon);
      if (w) total += Math.max(0, w.impediment - countImpReductionsForEquip(u, 'weapon'));
    }
    if (u.offhand) {
      const sh = getShield(u.offhand);
      const w = getWeapon(u.offhand);
      const impPiece = sh?.impediment ?? w?.impediment ?? 0;
      total += Math.max(0, impPiece - countImpReductionsForEquip(u, 'offhand'));
    }
    if (u.armor) {
      const a = getArmor(u.armor);
      if (a) total += Math.max(0, a.impediment - countImpReductionsForEquip(u, 'armor'));
    }
    return total;
  })();

  // Se imp >= 7 il 2d6+2 (max 14, medio 9) finisce neutro o negativo. Skip.
  if (imp >= 7) return 0;
  // Se imp 5-6: tira 1 dado (a 1d6+2-imp ~negativo, ma rischio minore)
  if (imp >= 5 && u.dadiAzione >= 2) return 1;
  // Default: 2 dadi se possibile, 1 se pochi, 0 se vuoto
  if (u.dadiAzione >= 4) return 2;
  if (u.dadiAzione >= 2) return 1;
  return 0;
}

/** Helper: conta riduzioni impedimento applicabili a uno specifico equip slot */
function countImpReductionsForEquip(u: Unit, slot: 'weapon' | 'offhand' | 'armor'): number {
  const equipId =
    slot === 'weapon' ? u.weapon : slot === 'offhand' ? u.offhand : u.armor;
  if (!equipId) return 0;
  let category: string | null = null;
  if (slot === 'armor') category = 'armature';
  else {
    const w = getWeapon(equipId);
    const sh = getShield(equipId);
    category = w?.category ?? sh?.category ?? null;
  }
  let count = 0;
  for (const skill of u.skills) {
    if (skill.modifier !== '-1impedimento') continue;
    if (skill.classeOggetto && skill.classeOggetto !== category) continue;
    if (skill.oggettoSpecifico && skill.oggettoSpecifico !== equipId) continue;
    count++;
  }
  return count;
}

/** Decisione azione dopo START_TURN: attacco / movimento / end turn */
export function aiDecideAction(state: GameState, unitId: UnitId): GameEvent {
  const me = state.units[unitId];
  if (!me) return { type: 'END_TURN' };
  const enemy = findClosestEnemy(state, me);
  if (!enemy) return { type: 'END_TURN' };

  const w = me.weapon ? getWeapon(me.weapon) : undefined;
  const dist = baseDistance(me.position, enemy.position);

  // Se ho già usato l'azione del turno, o ho 0 dadi azione, posso solo muovere o passare
  const canAct = !me.actionTakenThisTurn && me.dadiAzione >= 1;

  // Mischia: se in range portata → attacco (se posso ancora agire)
  if (canAct && w) {
    const meleeRange = w.range?.reach ?? 1;
    if (dist <= meleeRange) {
      const attack: EventDeclareAttack = {
        type: 'DECLARE_ATTACK',
        attackerId: me.id,
        targetId: enemy.id,
        weaponId: w.id,
        attackModeIdx: 0, // primo modo (sempre presente)
        chosenStat: w.attackModes[0].stat === 'either' ? 'forza' : w.attackModes[0].stat,
        isRanged: false,
      };
      return attack;
    }

    // Ranged: se l'arma è ranged-capable e il bersaglio è in range
    const can = canFireRanged(me, enemy, w.id, state.units);
    if (can.ok) {
      const attack: EventDeclareAttack = {
        type: 'DECLARE_ATTACK',
        attackerId: me.id,
        targetId: enemy.id,
        weaponId: w.id,
        attackModeIdx: 0,
        chosenStat: w.attackModes[0].stat === 'either' ? 'agilità' : w.attackModes[0].stat,
        isRanged: true,
      };
      return attack;
    }

    // Arma scarica con reload (es. balestra) → ricarica invece di fare nient'altro
    if (w.range?.reload != null && !me.weaponLoaded && me.dadiAzione > 0) {
      const dice = Math.min(2, me.dadiAzione);
      return { type: 'RELOAD', unitId: me.id, diceN: dice };
    }
  }
  // Se non ho più la mia azione di turno (o non avrei niente da fare), prova solo a muovere/passare
  if (!canAct && w) {
    // Eventualmente avvicinati per posizionarti meglio per il prossimo turno
  }

  // Movimento: avvicinati al nemico più vicino. Sceglie l'hex raggiungibile più vicino al nemico.
  // Range disponibile = slancio + (1 se non ho ancora mosso, altrimenti 0)
  const freeHex = me.hexMovedThisTurn === 0 ? 1 : 0;
  const moveRange = me.slancio + freeHex;
  if (moveRange >= 1) {
    const candidate = findBestMoveToward(state, me, enemy, moveRange);
    if (candidate) {
      const move: EventMove = { type: 'MOVE', unitId: me.id, targetHex: candidate };
      return move;
    }
  }

  // Niente da fare: passa turno
  const end: EventEndTurn = { type: 'END_TURN' };
  return end;
}

/** Trova la mossa migliore per avvicinarsi al nemico, rispettando slancio e ostacoli */
function findBestMoveToward(state: GameState, me: Unit, enemy: Unit, moveRange?: number): Axial | null {
  // Default: usa slancio + 1 (compatibilità con chiamate vecchie senza param)
  const range = moveRange ?? me.slancio + 1;
  const reachable = hexesInRange(me.position, range);

  // Esclude posizioni occupate (basetta sovrapposta)
  const blockedSet = new Set<string>();
  for (const u of Object.values(state.units)) {
    if (u.id === me.id || !u.alive) continue;
    for (const h of getBaseHexes(u.position)) blockedSet.add(`${h.q},${h.r}`);
  }

  let best: Axial | null = null;
  let bestScore = Infinity;
  for (const h of reachable) {
    // Il centro destinazione non deve essere in basetta nemica
    if (blockedSet.has(`${h.q},${h.r}`)) continue;
    // La basetta destinazione non deve sovrapporsi
    let overlap = false;
    for (const bh of getBaseHexes(h)) {
      if (blockedSet.has(`${bh.q},${bh.r}`)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    // Verifica bounds della mappa: se centro fuori, scarta (semplificato)
    // (i bounds sono in board.cols/rows in offset; per semplicità accetto qualunque axial qui)
    const score = baseDistance(h, enemy.position);
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/** Quanti dadi spendere per l'attacco. Minimo 1, massimo min(2, dadiAzione). */
export function aiDecideAttackerDice(state: GameState, unitId: UnitId): number {
  const me = state.units[unitId];
  if (!me) return 1;
  // Massimo 2 dadi standard, ma cap dadi disponibili. Min 1 (l'attacco richiede ≥1 dado).
  return Math.max(1, Math.min(2, me.dadiAzione));
}

/** Decisione difesa: tipo + dadi.
 *
 * Strategia (informata sull'attaccante via state.pendingAction):
 * - Schivata morde solo la VARIABILE attaccante. Efficace contro armi a basso "dado":
 *   mazza (0 dadi propri), ascia 2h (1 dado), balestra (0 dadi). NB: la schivata se
 *   riesce blocca anche il fisso → strategicamente la migliore contro armi fisso-puro.
 * - Parata morde TUTTO il tiro. Efficace contro armi a tanti dadi (spada, lancia, arco).
 * - HP basso (<40%): preferisci parata (più garantita, riduce variance).
 * - Senza arma idonea per parare: forzato schivata.
 */
export function aiDecideDefense(state: GameState, defenderId: UnitId): {
  defenseType: 'parry' | 'dodge' | 'none';
  parryWith?: 'weapon' | 'offhand';
  diceN: number;
} {
  const def = state.units[defenderId];
  if (!def || def.dadiAzione <= 0) return { defenseType: 'none', diceN: 0 };

  // Determina sorgente di parata disponibile (preferisci scudo se c'è — ha più fisso)
  let parrySrc: 'weapon' | 'offhand' | null = null;
  let parryFixed = 0;
  if (def.offhand) {
    const sh = getShield(def.offhand);
    const w = getWeapon(def.offhand);
    if (sh) {
      parrySrc = 'offhand';
      parryFixed = sh.parry.fixed;
    } else if (w && w.parry !== null) {
      parrySrc = 'offhand';
      parryFixed = w.parry.fixed;
    }
  }
  if (!parrySrc && def.weapon) {
    const w = getWeapon(def.weapon);
    if (w && w.parry !== null) {
      parrySrc = 'weapon';
      parryFixed = w.parry.fixed;
    }
  }

  const diceN = Math.min(2, def.dadiAzione);

  // Niente parata possibile → schivata
  if (!parrySrc) return { defenseType: 'dodge', diceN };

  // Analizza l'attaccante (se pendingAction disponibile)
  const pa = state.pendingAction;
  if (pa && pa.attackerId !== defenderId) {
    const attacker = state.units[pa.attackerId];
    const weapon = attacker?.weapon ? getWeapon(attacker.weapon) : null;
    const mode = weapon?.attackModes[pa.attackModeIdx];
    if (weapon && mode) {
      const attackerDicePG = pa.attackerDice ?? 2;
      const armDice = mode.diceVariable;
      const totalAttackerDice = attackerDicePG + armDice;
      const armFix = mode.fixedBonus;
      // Parry netto stimato: parryFixed + 2 (PG fix) + ~3.5/dado, vs attaccante variabile
      // Se attaccante ha pochi dadi (fisso puro), schivata blocca tutto il fisso → meglio
      // Se attaccante ha tanti dadi (es. arco lungo 4 dadi), parata morde anche fisso

      // Heuristic: se totalAttackerDice <= 2 (fisso puro o 1 dado) → SCHIVATA
      //            se totalAttackerDice >= 3 e parryFixed >= 6 → PARATA (scudo strong)
      //            se HP basso → PARATA (meno variance)
      if (def.hp <= def.hpMax * 0.35) {
        return { defenseType: 'parry', parryWith: parrySrc, diceN };
      }
      if (totalAttackerDice <= 2 || armFix <= 2) {
        // Attaccante con poco fisso ma forse molti dadi: schiva
        return { defenseType: 'dodge', diceN };
      }
      if (parryFixed >= 6) {
        // Parry forte (scudo medio+): blocca anche fisso alto
        return { defenseType: 'parry', parryWith: parrySrc, diceN };
      }
      // Default: schivata (statisticamente più economica)
      return { defenseType: 'dodge', diceN };
    }
  }

  // Fallback: HP basso o no info → parata se ho scudo, altrimenti schivata
  if (def.hp <= def.hpMax * 0.4) {
    return { defenseType: 'parry', parryWith: parrySrc, diceN };
  }
  if (parrySrc === 'offhand' && def.offhand && getShield(def.offhand)) {
    return { defenseType: 'parry', parryWith: 'offhand', diceN };
  }
  return { defenseType: 'dodge', diceN };
}

/** Mossa di "loop AI": dato uno stato in fase choosing-action e un'unità AI, emette una sequenza di eventi. */
export function aiPlayAction(state: GameState, unitId: UnitId): GameEvent {
  return aiDecideAction(state, unitId);
}

/**
 * Fase 1 — Carica: AI sceglie l'amount massimo (delta_distance limitato da slancio).
 * Strategia greedy: se ho mosso verso il target, sfrutto il bonus al massimo.
 */
export function aiDecideCarica(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u) return 0;
  const pa = state.pendingAction;
  if (!pa) return 0;
  const target = state.units[pa.targetId];
  if (!target || !u.positionAtTurnStart) return 0;
  const dStart = baseDistance(u.positionAtTurnStart, target.position);
  const dNow = baseDistance(u.position, target.position);
  const delta = Math.max(0, dStart - dNow);
  return Math.max(0, Math.min(delta, u.slancio));
}

/**
 * Fase 1 — Asta: AI sceglie ~slancio/4 (min 1 se slancio>0).
 * Stesso algoritmo per attaccante e difensore (mirror del Python `ai_decide_bid_movement`).
 */
export function aiDecideBidMovement(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u || u.slancio <= 0) return 0;
  return Math.max(1, Math.floor(u.slancio / 4));
}

// helpers re-export
export { findBestMoveToward, findClosestEnemy };
// silenzia eventuali helper non utilizzati con import selettivo
void neighbors;
void hexDistance;

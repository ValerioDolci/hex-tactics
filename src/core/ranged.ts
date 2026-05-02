/**
 * Combat a distanza: LoS dai 7 esagoni della basetta + formula tiro ranged.
 *
 * Formula tiro:
 *   1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza/N⌋ − slancio_target
 *   − impedimento_attaccante − scudo_difensore_passivo
 *
 * D-032 (M8): contro attacchi ranged non sono ammesse difese attive (schivata/parata
 *  come azione che spende dadi). Il malus slancio_target rappresenta la "evasività"
 *  dinamica del bersaglio.
 *
 * D-042: lo scudo del difensore offre un bonus passivo (parry.fixed) anche contro
 *  ranged perché copre fisicamente il corpo. NO dadi tirati (è passivo, non un'azione).
 */

import { Axial, axialEquals } from './hex/coords';
import { hexDistance } from './hex/distance';
import { hexLine } from './hex/line';
import { getBaseHexes } from './hex/base';
import { Unit, UnitId } from '@entities/Unit';
import { Rng } from '@utils/rng';
import { Roll, makeRoll, combineRolls } from './dice';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import {
  countFlatBonuses,
  getActualDiceCount,
  getImpedimentTotal,
  makeAttackContext,
} from './stats';
import { BASE_PG_FIXED } from './combat';
import { Stat } from '@entities/Equipment';

export interface LoSResult {
  /** Esagono della basetta attaccante con la migliore LoS */
  fromHex: Axial;
  /** Numero di centri target visti dal fromHex (0..7) */
  visibility: number;
  /** Distanza in esagoni dal fromHex al più vicino esagono target */
  distance: number;
}

/**
 * Calcola la LoS migliore dai 7 esagoni della basetta attaccante verso il target.
 * `units`: tutte le unità presenti — quelle ALTRE (non attaccante, non target) bloccano la LoS
 * se i loro esagoni di basetta sono nel raster.
 */
export function computeLoS(
  attacker: Unit,
  target: Unit,
  units: Record<UnitId, Unit>,
): LoSResult {
  const attackerBase = getBaseHexes(attacker.position);
  const targetBase = getBaseHexes(target.position);

  // Raccoglie tutti gli hex bloccanti (basette di altre unità vive)
  const blocking = new Set<string>();
  for (const u of Object.values(units)) {
    if (u.id === attacker.id || u.id === target.id) continue;
    if (!u.alive) continue;
    for (const h of getBaseHexes(u.position)) blocking.add(`${h.q},${h.r}`);
  }

  // Per ogni hex della basetta attaccante: visibility e distanza minima al target
  const candidates: { from: Axial; visibility: number; distance: number }[] = [];
  for (const from of attackerBase) {
    let visibility = 0;
    for (const to of targetBase) {
      const path = hexLine(from, to);
      let blocked = false;
      for (let i = 1; i < path.length - 1; i++) {
        const h = path[i];
        if (attackerBase.some((b) => axialEquals(b, h))) continue;
        if (targetBase.some((b) => axialEquals(b, h))) continue;
        if (blocking.has(`${h.q},${h.r}`)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) visibility++;
    }
    let minDist = Infinity;
    for (const to of targetBase) {
      const d = hexDistance(from, to);
      if (d < minDist) minDist = d;
    }
    candidates.push({ from, visibility, distance: minDist });
  }

  // Sceglie il from con max visibility; tiebreak con min distance.
  candidates.sort((a, b) => {
    if (a.visibility !== b.visibility) return b.visibility - a.visibility;
    return a.distance - b.distance;
  });
  const best = candidates[0];
  return { fromHex: best.from, visibility: best.visibility, distance: best.distance };
}

/**
 * Verifica se un attacco ranged è possibile (visibilità > 0 e distanza <= range arma).
 * Restituisce { ok, reason? }.
 */
export function canFireRanged(
  attacker: Unit,
  target: Unit,
  weaponId: string,
  units: Record<UnitId, Unit>,
): { ok: boolean; reason?: string; los?: LoSResult } {
  const w = getWeapon(weaponId);
  if (!w) return { ok: false, reason: 'arma non trovata' };
  if (!w.range || (w.range.distance == null && w.range.throw == null)) {
    return { ok: false, reason: 'arma non utilizzabile a distanza' };
  }
  // Armi con ricarica (balestra): non sparabili se scariche
  if (w.range.reload != null && !attacker.weaponLoaded) {
    return { ok: false, reason: `${w.name} è scarica — serve ricarica` };
  }
  const maxRange = w.range.distance ?? w.range.throw ?? 0;
  const los = computeLoS(attacker, target, units);
  if (los.visibility <= 0) return { ok: false, reason: 'nessuna linea di vista', los };
  if (los.distance > maxRange) return { ok: false, reason: `fuori range (${los.distance} > ${maxRange})`, los };
  return { ok: true, los };
}

/**
 * Compone il Roll di un attacco ranged.
 * Formula: 1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza/N⌋ − slancio_target − impedimento
 */
export function composeRangedAttackRoll(
  attacker: Unit,
  weaponId: string,
  attackModeIdx: number,
  chosenStat: Stat | undefined,
  diceN: number,
  target: Unit,
  los: LoSResult,
  rng: Rng,
  options: { caricaAmount?: number } = {},
): Roll {
  const w = getWeapon(weaponId);
  if (!w) throw new Error(`Weapon ${weaponId} not found`);
  const mode = w.attackModes[attackModeIdx];
  if (!mode) throw new Error(`Mode ${attackModeIdx} not found for ${weaponId}`);

  const stat: Stat | undefined = mode.stat === 'either' ? chosenStat : mode.stat;
  const ctx = makeAttackContext(w.id, w.category, stat);

  // Dadi PG (con +1 dado forzato)
  const pgDiceN = getActualDiceCount(attacker, ctx, diceN);
  const pgRoll = makeRoll(rng, pgDiceN, BASE_PG_FIXED);

  // Dadi arma
  const weaponRoll = makeRoll(rng, mode.diceVariable, mode.fixedBonus);

  let combined = combineRolls(pgRoll, weaponRoll);

  // Bonus visibilità
  combined.fixed += los.visibility;

  // Malus distanza: ⌊distanza / N_arma⌋
  const N = w.range?.rangedDivisor ?? 3;
  combined.fixed -= Math.floor(los.distance / N);

  // Malus slancio target
  combined.fixed -= target.slancio;

  // Bonus passivo scudo del difensore (D-042 + Fase 1): lo scudo copre passivamente il corpo
  // anche contro attacchi a distanza. Sottrae il parry.fixed dello scudo (NO dadi tirati).
  // Fase 1: in posizione difensiva il bonus passive raddoppia.
  if (target.offhand) {
    const shield = getShield(target.offhand);
    if (shield) {
      const multiplier = target.defensiveStance ? 2 : 1;
      combined.fixed -= shield.parry.fixed * multiplier;
    }
  }

  // RD armatura del difensore (D-043): contro ranged il "tiro È il danno" — single application.
  // L'armatura ferma passivamente il colpo, sottratta al tiro. Il damage stage NON applicherà
  // di nuovo RD per ranged (vedi reducer RESOLVE_COMBAT).
  if (target.armor) {
    const armor = getArmor(target.armor);
    if (armor) {
      combined.fixed -= armor.damageReduction;
    }
  }

  // +1 al tiro skill
  combined.fixed += countFlatBonuses(attacker.skills, ctx);

  // Impedimento attaccante
  combined.fixed -= getImpedimentTotal(attacker);

  // Fase 1: bonus carica (per giavellotti / armi da lancio)
  if (options.caricaAmount && options.caricaAmount > 0) {
    combined.fixed += options.caricaAmount;
  }

  return combined;
}

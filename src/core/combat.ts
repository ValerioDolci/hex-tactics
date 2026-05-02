/**
 * Combat math: composizione tiri, risoluzione difese, applicazione danni.
 *
 * Riferimento regole: CLAUDE.md sezione "Attacco corpo a corpo (CaC) e difese attive".
 *
 * Schema generale di un attacco con difesa:
 *   1. attaccante sceglie diceN, difensore sceglie tipo difesa + diceN (simultaneamente, privato)
 *   2. attaccante compone il suo Roll (PG dadi + arma dadi + bonus + skill - impedimento)
 *   3. difensore compone il suo Roll (1-2 d6 + 2 + bonus + skill - impedimento)
 *   4. risoluzione:
 *      - dodge: subtractFromVariable
 *      - parry: subtractFromTotal
 *   5. se hit: applica danni (con riduzione armatura)
 *      se miss: differenza sottratta allo slancio dell'attaccante
 */

import { Rng } from '@utils/rng';
import { Roll, makeRoll, combineRolls, subtractFromVariable, subtractFromTotal, variableNegResidue } from './dice';
import { Unit } from '@entities/Unit';
import { Weapon, Shield, AttackMode, Stat, RollSpec } from '@entities/Equipment';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import {
  getImpedimentTotal,
  countFlatBonuses,
  getActualDiceCount,
  makeAttackContext,
  makeDodgeContext,
  makeParryContext,
} from './stats';
import { RollContext } from '@entities/Skill';

/** Bonus base PG per ogni tiro (regole base: "1-2 d6 +2") */
export const BASE_PG_FIXED = 2;

/** Risultato della risoluzione di un'azione difensiva */
export interface CombatResult {
  /** L'attacco va a segno (true) o è schivato/parato (false)? */
  hit: boolean;
  /** Se hit: danno applicabile prima della riduzione armatura. Se miss: 0. */
  rawDamage: number;
  /** Slancio penalty da applicare all'attaccante in caso di miss (dodge: |residual|, parry: |residual|) */
  slancioPenaltyToAttacker: number;
  /**
   * Slancio loss aggiuntiva da applicare all'attaccante perché la sua variabile
   * (post-impedimento) è andata sotto 0. Sempre cumulativa con `slancioPenaltyToAttacker`.
   * Regola V2: se imp_atk > rawSum dadi → variabile floored a 0, slancio_atk -= |negativo|.
   */
  slancioLossAttackerImp: number;
  /** Slancio loss equivalente per il difensore (imp del difensore vs suoi dadi). */
  slancioLossDefenderImp: number;
  /** Roll dell'attaccante (per log) */
  attackerRoll: Roll;
  /** Roll del difensore (per log) */
  defenderRoll: Roll;
}

/**
 * Compone il Roll d'attacco di un'unità con un'arma in un certo modo.
 *
 * @param attacker l'unità attaccante
 * @param weaponId ID arma
 * @param attackModeIdx index del modo di attacco scelto (0 default)
 * @param chosenStat se mode.stat è 'either', il giocatore deve specificare quale stat usare per match skill
 * @param diceN numero di dadi PG scelto dal giocatore (1 o 2 standard, +max via skill)
 * @param rng generatore casuale
 */
/**
 * Helper Fase 1: RD passive dello scudo offhand quando il difensore è in posizione
 * difensiva (parry.fixed × 2 applicato sia CaC sia ranged).
 * Senza stance: ritorna 0 (lo scudo passive ranged D-042 è gestito separatamente in ranged.ts).
 */
export function getShieldPassiveRdCac(target: Unit): number {
  if (!target.offhand) return 0;
  const sh = getShield(target.offhand);
  if (!sh) return 0;
  if (target.defensiveStance) return sh.parry.fixed * 2;
  return 0; // senza stance: niente RD CaC dallo scudo
}

export function composeAttackRoll(
  attacker: Unit,
  weaponId: string,
  attackModeIdx: number,
  chosenStat: Stat | undefined,
  diceN: number,
  rng: Rng,
  options: { target?: Unit; caricaAmount?: number } = {},
): Roll {
  const weapon = getWeapon(weaponId);
  if (!weapon) throw new Error(`Weapon ${weaponId} not found`);
  const mode = weapon.attackModes[attackModeIdx];
  if (!mode) throw new Error(`Attack mode ${attackModeIdx} not found for ${weaponId}`);

  const stat: Stat | undefined = mode.stat === 'either' ? chosenStat : mode.stat;
  const ctx = makeAttackContext(weapon.id, weapon.category, stat);

  // Dadi PG (con +1 dado forzato)
  const pgDiceN = getActualDiceCount(attacker, ctx, diceN);
  const pgRoll = makeRoll(rng, pgDiceN, BASE_PG_FIXED);

  // Dadi arma (in aggiunta)
  const weaponRoll = makeRoll(rng, mode.diceVariable, mode.fixedBonus);

  // Combina
  let combined = combineRolls(pgRoll, weaponRoll);

  // D-047: armi con bonus condizionato a stat (notazione "X/Y" — es. spada `1D6+2/+2`):
  // se l'attaccante usa ≥2 dadi PG, può assegnare un dado a forza e uno ad agilità,
  // attivando ENTRAMBI i bonus fissi dell'arma. Si rileva: 2 modes con stat 'forza'/'agilità'
  // (non 'either') → si aggiunge il fixedBonus del mode "non scelto".
  // (Skill-bonus delle stat non si addiziona perché il ctx ha solo una stat per match skill;
  // ma il bonus ARMA condizionato sì, è una regola di composizione dell'arma stessa.)
  if (diceN >= 2 && weapon.attackModes.length >= 2 && mode.stat !== 'either') {
    const otherMode = weapon.attackModes.find(
      (m, i) =>
        i !== attackModeIdx &&
        m.stat !== 'either' &&
        m.stat !== mode.stat,
    );
    if (otherMode) {
      combined.fixed += otherMode.fixedBonus;
    }
  }

  // +1 al tiro skill matchanti
  combined.fixed += countFlatBonuses(attacker.skills, ctx);

  // V2: Impedimento sottratto alla VARIABILE (non più alla fissa).
  // Se la variabile va sotto 0, viene floored a 0 e |negativo| → slancio loss
  // (gestito nel resolve, via variableNegResidue del Roll).
  combined.variableMod = (combined.variableMod ?? 0) - getImpedimentTotal(attacker);

  // Fase 1: bonus carica (alla fissa)
  if (options.caricaAmount && options.caricaAmount > 0) {
    combined.fixed += options.caricaAmount;
  }

  // Fase 1: target in defensive stance → sottrai scudo passive RD (CaC)
  if (options.target) {
    combined.fixed -= getShieldPassiveRdCac(options.target);
  }

  return combined;
}

/** Compone il Roll di schivata del difensore */
export function composeDodgeRoll(defender: Unit, diceN: number, rng: Rng): Roll {
  const ctx = makeDodgeContext();
  const actualDice = getActualDiceCount(defender, ctx, diceN);
  let roll = makeRoll(rng, actualDice, BASE_PG_FIXED);
  roll.fixed += countFlatBonuses(defender.skills, ctx);
  // V2: imp alla VARIABILE (non più fissa). Slancio loss in caso di residuo neg.
  roll.variableMod = (roll.variableMod ?? 0) - getImpedimentTotal(defender);
  return roll;
}

/**
 * Compone il Roll di parata. L'oggetto usato per parare può essere:
 * - L'arma equipaggiata (deve avere `parry !== null`)
 * - Lo scudo nell'offhand
 * - Una seconda arma nell'offhand
 *
 * Se nessuno è disponibile/idoneo, restituisce null.
 */
export function composeParryRoll(
  defender: Unit,
  parryWith: 'weapon' | 'offhand',
  diceN: number,
  rng: Rng,
): Roll | null {
  const itemId = parryWith === 'weapon' ? defender.weapon : defender.offhand;
  if (!itemId) return null;

  const weapon = getWeapon(itemId);
  const shield = getShield(itemId);
  let parrySpec: RollSpec | null = null;
  let category: Weapon['category'] | Shield['category'] | null = null;

  if (weapon) {
    parrySpec = weapon.parry;
    category = weapon.category;
  } else if (shield) {
    parrySpec = shield.parry;
    category = shield.category;
  }
  if (!parrySpec || !category) return null;

  const ctx = makeParryContext(itemId, category);
  const actualDice = getActualDiceCount(defender, ctx, diceN);

  // PG dadi (1-2 d6 +2 base) + arma/scudo dadi+fixed
  const pgRoll = makeRoll(rng, actualDice, BASE_PG_FIXED);
  const itemRoll = makeRoll(rng, parrySpec.dice, parrySpec.fixed);
  let combined = combineRolls(pgRoll, itemRoll);

  combined.fixed += countFlatBonuses(defender.skills, ctx);
  // V2: imp alla VARIABILE (non più fissa).
  combined.variableMod = (combined.variableMod ?? 0) - getImpedimentTotal(defender);
  return combined;
}

/**
 * Risolve un attacco contro una schivata.
 *
 * Regole:
 *   residual = variabile_attaccante − totale_difensore
 *   se residual <= 0 → schivato; |residual| → slancio penalty all'attaccante
 *   se residual > 0  → si somma anche la fissa attaccante e si applicano danni col rimanente
 */
export function resolveDodge(attackerRoll: Roll, dodgeRoll: Roll): CombatResult {
  const residual = subtractFromVariable(attackerRoll, dodgeRoll);
  // V2: slancio loss da imp variabile sopra il floor
  const slancioLossAttackerImp = variableNegResidue(attackerRoll);
  const slancioLossDefenderImp = variableNegResidue(dodgeRoll);
  if (residual <= 0) {
    return {
      hit: false,
      rawDamage: 0,
      slancioPenaltyToAttacker: Math.abs(residual),
      slancioLossAttackerImp,
      slancioLossDefenderImp,
      attackerRoll,
      defenderRoll: dodgeRoll,
    };
  }
  // Hit: somma anche la fissa attaccante
  const damage = residual + attackerRoll.fixed;
  return {
    hit: damage > 0,
    rawDamage: Math.max(0, damage),
    slancioPenaltyToAttacker: 0,
    slancioLossAttackerImp,
    slancioLossDefenderImp,
    attackerRoll,
    defenderRoll: dodgeRoll,
  };
}

/**
 * Risolve un attacco contro una parata.
 *
 * Regole:
 *   residual = totale_attaccante − totale_difensore
 *   se residual <= 0 → parato; |residual| → slancio penalty all'attaccante
 *   se residual > 0  → si applicano danni col rimanente
 */
export function resolveParry(attackerRoll: Roll, parryRoll: Roll): CombatResult {
  const residual = subtractFromTotal(attackerRoll, parryRoll);
  const slancioLossAttackerImp = variableNegResidue(attackerRoll);
  const slancioLossDefenderImp = variableNegResidue(parryRoll);
  if (residual <= 0) {
    return {
      hit: false,
      rawDamage: 0,
      slancioPenaltyToAttacker: Math.abs(residual),
      slancioLossAttackerImp,
      slancioLossDefenderImp,
      attackerRoll,
      defenderRoll: parryRoll,
    };
  }
  return {
    hit: true,
    rawDamage: residual,
    slancioPenaltyToAttacker: 0,
    slancioLossAttackerImp,
    slancioLossDefenderImp,
    attackerRoll,
    defenderRoll: parryRoll,
  };
}

/**
 * Risolve un attacco senza difesa attiva (difensore non spende dadi).
 * Tutti i danni passano (dopo armor RD).
 */
export function resolveNoDefense(attackerRoll: Roll): CombatResult {
  // V2: usa rollTotal che applica floor 0 sulla variabile post-modificatore
  const total = attackerRoll.fixed + Math.max(0,
    attackerRoll.variable.reduce((a, b) => a + b, 0) + (attackerRoll.variableMod ?? 0));
  const slancioLossAttackerImp = variableNegResidue(attackerRoll);
  return {
    hit: total > 0,
    rawDamage: Math.max(0, total),
    slancioPenaltyToAttacker: 0,
    slancioLossAttackerImp,
    slancioLossDefenderImp: 0,
    attackerRoll,
    defenderRoll: { variable: [], fixed: 0, variableMod: 0 },
  };
}

/**
 * Applica i danni a un'unità tenendo conto della riduzione danno dell'armatura.
 * Restituisce il danno effettivo applicato (per log).
 */
export function applyDamageWithArmor(target: Unit, rawDamage: number): { effectiveDamage: number; newHp: number } {
  let rd = 0;
  if (target.armor) {
    const armor = getArmor(target.armor);
    if (armor) rd = armor.damageReduction;
  }
  const effective = Math.max(0, rawDamage - rd);
  const newHp = Math.max(0, target.hp - effective);
  return { effectiveDamage: effective, newHp };
}

/** Helper: restituisce il modo di attacco di un'arma per index */
export function getAttackMode(weaponId: string, modeIdx: number): AttackMode | null {
  const w = getWeapon(weaponId);
  if (!w) return null;
  return w.attackModes[modeIdx] ?? null;
}

/** Re-export utilità contesto */
export { makeAttackContext, makeDodgeContext, makeParryContext };

/** Type re-export per consumer del module */
export type { RollContext };

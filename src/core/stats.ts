/**
 * Calcolo di stat derivate del PG: impedimento totale, modificatori dalle skill.
 *
 * Tutto puro — input → output, niente side effects.
 */

import { Unit } from '@entities/Unit';
import { EquipCategory, Stat } from '@entities/Equipment';
import {
  AcquiredSkill,
  RollContext,
  skillMatchesContext,
  skillMatchesEquip,
} from '@entities/Skill';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';

/**
 * Calcola l'impedimento totale di un'unità sommando i pezzi di equipaggiamento,
 * applicando le skill `-1 impedimento` per pezzo (con specializzazioni).
 * Floor 0 per pezzo (D-018).
 */
export function getImpedimentTotal(unit: Unit): number {
  const equipPieces: { id: string; category: EquipCategory; impediment: number }[] = [];

  if (unit.weapon) {
    const w = getWeapon(unit.weapon);
    if (w) equipPieces.push({ id: w.id, category: w.category, impediment: w.impediment });
  }
  if (unit.offhand) {
    const w = getWeapon(unit.offhand);
    const s = getShield(unit.offhand);
    if (w) equipPieces.push({ id: w.id, category: w.category, impediment: w.impediment });
    else if (s) {
      // Fase 1: posizione difensiva raddoppia imp dello scudo
      const shieldImp = unit.defensiveStance ? s.impediment * 2 : s.impediment;
      equipPieces.push({ id: s.id, category: s.category, impediment: shieldImp });
    }
  }
  if (unit.armor) {
    const a = getArmor(unit.armor);
    if (a) equipPieces.push({ id: a.id, category: a.category, impediment: a.impediment });
  }

  let total = 0;
  for (const piece of equipPieces) {
    // D-046: somma `level` di ogni skill -1imp che matcha il pezzo (default 1 se mancante)
    const reduction = unit.skills
      .filter((s) => s.modifier === '-1impedimento' && skillMatchesEquip(s, piece))
      .reduce((sum, s) => sum + (s.level ?? 1), 0);
    total += Math.max(0, piece.impediment - reduction);
  }
  return total;
}

/** Somma dei livelli di skill `+1 dado` (forzato) matchanti il contesto. D-046. */
export function countForcedExtraDice(skills: AcquiredSkill[], ctx: RollContext): number {
  return skills
    .filter((s) => s.modifier === '+1dado' && skillMatchesContext(s, ctx))
    .reduce((sum, s) => sum + (s.level ?? 1), 0);
}

/** Somma dei livelli di skill `+1 dado massimo` (opzionali) matchanti il contesto. D-046. */
export function countMaxDiceExtra(skills: AcquiredSkill[], ctx: RollContext): number {
  return skills
    .filter((s) => s.modifier === '+1dadomax' && skillMatchesContext(s, ctx))
    .reduce((sum, s) => sum + (s.level ?? 1), 0);
}

/** Somma dei livelli di skill `+1 al tiro` matchanti il contesto (somma alla parte fissa). D-046. */
export function countFlatBonuses(skills: AcquiredSkill[], ctx: RollContext): number {
  return skills
    .filter((s) => s.modifier === '+1tiro' && skillMatchesContext(s, ctx))
    .reduce((sum, s) => sum + (s.level ?? 1), 0);
}

/**
 * Restituisce il range di dadi che il giocatore può scegliere per un'azione.
 * Default base: standard min..standard max (es. 1..2 per attacchi standard, 0..2 per slancio).
 * Skill `+1 dado massimo` alza il `max`.
 *
 * @param standardMin minimo standard per quell'azione
 * @param standardMax massimo standard per quell'azione
 */
export function getDiceChoiceRange(
  unit: Unit,
  ctx: RollContext,
  standardMin: number,
  standardMax: number,
): { min: number; max: number } {
  const extraMax = countMaxDiceExtra(unit.skills, ctx);
  return {
    min: standardMin,
    max: standardMax + extraMax,
  };
}

/**
 * Calcola quanti dadi tirare effettivamente dato il numero scelto.
 * Aggiunge i dadi forzati da `+1 dado` (ogni acquisto = +1).
 */
export function getActualDiceCount(unit: Unit, ctx: RollContext, chosen: number): number {
  const forced = countForcedExtraDice(unit.skills, ctx);
  return chosen + forced;
}

/** Wrapper conveniente: contesto base per attacco con un'arma */
export function makeAttackContext(
  weaponId: string,
  weaponCategory: EquipCategory,
  stat?: Stat,
): RollContext {
  return {
    azione: 'attaccare',
    stat,
    classeOggetto: weaponCategory,
    oggettoSpecifico: weaponId,
  };
}

export function makeParryContext(
  itemId: string,
  itemCategory: EquipCategory,
): RollContext {
  return {
    azione: 'parare',
    classeOggetto: itemCategory,
    oggettoSpecifico: itemId,
  };
}

/**
 * Dodge è per design un'azione di agilità. Settiamo stat='agilità' nel ctx
 * per permettere il match con skill specializzate `[schivare][agilità]`.
 */
export function makeDodgeContext(): RollContext {
  return { azione: 'schivare', stat: 'agilità' };
}

/**
 * Slancio è per design un tiro di agilità (mobilità/iniziativa).
 * Settiamo stat='agilità' nel ctx per permettere il match con skill specializzate
 * `[slancio][agilità]`.
 */
export function makeSlancioContext(): RollContext {
  return { azione: 'slancio', stat: 'agilità' };
}

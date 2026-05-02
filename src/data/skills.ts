/**
 * Catalogo skill: i 4 modificatori base con i loro costi, e le liste delle parole
 * di specializzazione disponibili nel character builder.
 *
 * Il character builder legge da qui le opzioni; il combat engine consulta gli
 * `AcquiredSkill` del PG per applicare i modificatori in tempo reale.
 */

import { SkillModifier, ActionType, SKILL_COSTS } from '@entities/Skill';
import { Stat, EquipCategory, WeaponCategory } from '@entities/Equipment';

/** Etichette user-friendly */
export const MODIFIER_LABELS: Record<SkillModifier, string> = {
  '-1impedimento': '−1 impedimento',
  '+1tiro': '+1 al tiro',
  '+1dado': '+1 dado',
  '+1dadomax': '+1 dado massimo',
};

/** Ri-export per comodità (i costi vivono in Skill.ts) */
export { SKILL_COSTS };

/** Liste delle parole di specializzazione disponibili nel builder */

export const SKILL_ABILITA: ReadonlyArray<Stat> = ['forza', 'agilità', 'volontà'] as const;

export const SKILL_AZIONI: ReadonlyArray<ActionType> = [
  'attaccare',
  'parare',
  'schivare',
  'slancio',
  'ricaricare',
] as const;

/** Categorie di equipaggiamento usabili come specializzazione "classe oggetto" */
export const SKILL_CLASSI_OGGETTO: ReadonlyArray<EquipCategory> = [
  'pugnali',
  'spade',
  'mazze',
  'asce',
  'lance',
  'archi',
  'balestre',
  'giavellotti',
  'scudi',
  'armature',
] as const;

/**
 * Per la specializzazione "oggetto specifico", il character builder dovrà
 * popolare la lista a runtime dagli ID di WEAPONS/SHIELDS/ARMORS.
 * Qui non duplichiamo la lista per non doverla mantenere allineata.
 */

/** Costo di un singolo acquisto, dato il modificatore (le specializzazioni non variano il costo per ora) */
export function skillCost(mod: SkillModifier): number {
  return SKILL_COSTS[mod];
}

/** Riferimento PG da 2000 exp ("personaggio sensato") — vedi CLAUDE.md */
export const REFERENCE_PG_EXP = 2000;

/** Categoria-helpers: le categorie weapon (esposte per UI/filter) */
export const WEAPON_CATEGORIES: ReadonlyArray<WeaponCategory> = [
  'pugnali',
  'spade',
  'mazze',
  'asce',
  'lance',
  'archi',
  'balestre',
  'giavellotti',
] as const;

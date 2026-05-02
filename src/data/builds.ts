/**
 * Character Builder data + helpers.
 *
 * Una `CharacterBuild` rappresenta una configurazione personalizzata di un PG:
 * arma + offhand + armatura + skill. Persistita in localStorage.
 *
 * Si differenzia da `PresetSpec` perché NON ha description editorialista e
 * il suo nome è scelto dall'utente.
 */

import { Unit, FactionId, createBaselineUnit } from '@entities/Unit';
import { AcquiredSkill, validateSkillSet } from '@entities/Skill';
import { Axial } from '@core/hex/coords';
import { getWeapon, WEAPONS } from '@data/weapons';
import { getShield, SHIELDS } from '@data/shields';
import { getArmor, ARMORS } from '@data/armors';

/** Una build personalizzata salvata. */
export interface CharacterBuild {
  /** ID generato (timestamp + suffisso) */
  id: string;
  /** Nome fornito dall'utente */
  name: string;
  /** ID arma principale (obbligatoria) */
  weaponId: string;
  /** ID offhand: arma o scudo. undefined = mano vuota */
  offhandId?: string;
  /** ID armatura. undefined = nessuna */
  armorId?: string;
  /** Skill acquistate */
  skills: Omit<AcquiredSkill, 'id'>[];
}

const STORAGE_KEY = 'hexTactics.customBuilds';
const EXP_BUDGET = 2000;

/** Genera un ID unique-ish per una build. */
export function generateBuildId(): string {
  return `build-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Legge tutte le build salvate. */
export function loadAllBuilds(): CharacterBuild[] {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return [];
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

/** Salva una build (insert/update by id). */
export function saveBuild(build: CharacterBuild): void {
  try {
    const all = loadAllBuilds();
    const idx = all.findIndex((b) => b.id === build.id);
    if (idx >= 0) {
      all[idx] = build;
    } else {
      all.push(build);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignora
  }
}

/** Rimuove una build per ID. */
export function deleteBuild(id: string): void {
  try {
    const all = loadAllBuilds().filter((b) => b.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignora
  }
}

/** Risultato di validazione build. */
export interface BuildValidation {
  valid: boolean;
  totalCost: number;
  budgetLeft: number;
  errors: string[];
  warnings: string[];
}

/** Valida una build: equip esistenti, skill set valido, costo ≤ 2000. */
export function validateBuild(build: CharacterBuild): BuildValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Arma principale obbligatoria
  if (!build.weaponId) {
    errors.push('Arma principale mancante');
  } else if (!getWeapon(build.weaponId)) {
    errors.push(`Arma '${build.weaponId}' non trovata`);
  }

  // Offhand: deve esistere se specificata
  if (build.offhandId) {
    const isWeapon = !!getWeapon(build.offhandId);
    const isShield = !!getShield(build.offhandId);
    if (!isWeapon && !isShield) {
      errors.push(`Offhand '${build.offhandId}' non trovata`);
    }
  }

  // Armatura: deve esistere se specificata
  if (build.armorId && !getArmor(build.armorId)) {
    errors.push(`Armatura '${build.armorId}' non trovata`);
  }

  // Skill set valido
  const skillsWithIds: AcquiredSkill[] = build.skills.map((s, i) => ({ ...s, id: `tmp-${i}` }));
  const skillVal = validateSkillSet(skillsWithIds);
  errors.push(...skillVal.errors);

  // Costo totale ≤ budget
  if (skillVal.totalCost > EXP_BUDGET) {
    errors.push(`Costo skill troppo alto: ${skillVal.totalCost} / ${EXP_BUDGET} exp`);
  }

  // Warning semantici: skill con specializzazione su equipaggiamento NON posseduto.
  // È un soft hint perché l'equip può cambiare in futuro o si può comprare skill "in anticipo".
  const equippedCategories = collectEquippedCategories(build);
  const equippedIds = collectEquippedIds(build);
  for (const s of build.skills) {
    if (s.classeOggetto && !equippedCategories.has(s.classeOggetto)) {
      warnings.push(
        `La skill "${describeSkillShort(s)}" specializza su [${s.classeOggetto}] ma non hai equipaggiamento di quella classe`,
      );
    }
    if (s.oggettoSpecifico && !equippedIds.has(s.oggettoSpecifico)) {
      warnings.push(
        `La skill "${describeSkillShort(s)}" specializza su "${s.oggettoSpecifico}" ma non lo hai equipaggiato`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    totalCost: skillVal.totalCost,
    budgetLeft: EXP_BUDGET - skillVal.totalCost,
    errors,
    warnings,
  };
}

/** Estrae le categorie di equipaggiamento posseduto (es. {'spade', 'armature'}) */
function collectEquippedCategories(build: CharacterBuild): Set<string> {
  const cats = new Set<string>();
  if (build.weaponId) {
    const w = getWeapon(build.weaponId);
    if (w) cats.add(w.category);
  }
  if (build.offhandId) {
    const w = getWeapon(build.offhandId);
    const s = getShield(build.offhandId);
    if (w) cats.add(w.category);
    else if (s) cats.add(s.category);
  }
  if (build.armorId) {
    const a = getArmor(build.armorId);
    if (a) cats.add(a.category);
  }
  return cats;
}

/** Estrae gli ID di equipaggiamento posseduto */
function collectEquippedIds(build: CharacterBuild): Set<string> {
  const ids = new Set<string>();
  if (build.weaponId) ids.add(build.weaponId);
  if (build.offhandId) ids.add(build.offhandId);
  if (build.armorId) ids.add(build.armorId);
  return ids;
}

/** Descrizione compatta di una skill per i warning (senza "(X exp)") */
function describeSkillShort(s: Pick<AcquiredSkill, 'modifier' | 'level' | 'abilita' | 'azione' | 'classeOggetto' | 'oggettoSpecifico'>): string {
  const sign = s.modifier === '-1impedimento' ? '−' : '+';
  const base =
    s.modifier === '-1impedimento'
      ? `${sign}${s.level} imp`
      : s.modifier === '+1tiro'
        ? `${sign}${s.level} al tiro`
        : s.modifier === '+1dado'
          ? `${sign}${s.level} dado`
          : `${sign}${s.level} dado max`;
  const specs: string[] = [];
  if (s.azione) specs.push(s.azione);
  if (s.abilita) specs.push(s.abilita);
  if (s.classeOggetto) specs.push(s.classeOggetto);
  if (s.oggettoSpecifico) specs.push(s.oggettoSpecifico);
  const specStr = specs.length > 0 ? ` [${specs.join(', ')}]` : '';
  return `${base}${specStr}`;
}

/** Crea una `Unit` da una `CharacterBuild`, fazione e posizione. */
export function unitFromBuild(
  build: CharacterBuild,
  faction: FactionId,
  position: Axial,
): Unit {
  const u = createBaselineUnit({
    id: `${faction}-${build.id}`,
    name: build.name || 'Custom',
    faction,
    position,
  });
  u.weapon = build.weaponId;
  u.offhand = build.offhandId;
  u.armor = build.armorId;
  u.skills = build.skills.map((s, i) => ({ ...s, id: `${u.id}-skill-${i}` }));
  // Niente presetId — è una build custom
  return u;
}

/** Build di default per nuovo personaggio (vuoto, da personalizzare). */
export function defaultBuild(): CharacterBuild {
  return {
    id: generateBuildId(),
    name: '',
    weaponId: 'spada',
    offhandId: undefined,
    armorId: 'armatura_leggera',
    skills: [],
  };
}

/** Lista di tutte le armi disponibili (id + nome). */
export function listAllWeapons(): { id: string; name: string }[] {
  return Object.values(WEAPONS).map((w) => ({ id: w.id, name: w.name }));
}

/** Lista di tutti gli scudi (id + nome). */
export function listAllShields(): { id: string; name: string }[] {
  return Object.values(SHIELDS).map((s) => ({ id: s.id, name: s.name }));
}

/** Lista di tutte le armature. */
export function listAllArmors(): { id: string; name: string }[] {
  return Object.values(ARMORS).map((a) => ({ id: a.id, name: a.name }));
}

/** Helper per descrivere una skill in italiano (per UI). */
export function describeSkill(s: Omit<AcquiredSkill, 'id'>): string {
  const sign = s.modifier === '-1impedimento' ? '−' : '+';
  const base =
    s.modifier === '-1impedimento'
      ? `${sign}${s.level} imp`
      : s.modifier === '+1tiro'
        ? `${sign}${s.level} al tiro`
        : s.modifier === '+1dado'
          ? `${sign}${s.level} dado`
          : `${sign}${s.level} dado max`;
  const specs: string[] = [];
  if (s.azione) specs.push(s.azione);
  if (s.abilita) specs.push(s.abilita);
  if (s.classeOggetto) specs.push(s.classeOggetto);
  if (s.oggettoSpecifico) specs.push(s.oggettoSpecifico);
  const specStr = specs.length > 0 ? ` [${specs.join(', ')}]` : '';
  return `${base}${specStr} (${s.cost} exp)`;
}

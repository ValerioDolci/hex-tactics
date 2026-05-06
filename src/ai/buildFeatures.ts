/**
 * Build features encoder — porting 1:1 di python/cfr/build_features.py.
 *
 * Trasforma una Unit in un vettore numerico fisso (39 dim) che caratterizza
 * la build (weapon/offhand/armor + skills aggregate).
 *
 * Usato da `studentMultiAi.ts` per costruire l'input dello student multi-matchup
 * (input totale = obs153 + buildSelf39 + buildOpp39 = 231 dim).
 */

import { Unit } from '@entities/Unit';

// Vocabolari (ordine fisso — DEVE matchare python/cfr/build_features.py)
const WEAPON_VOCAB = [
  'pugnale', 'spada', 'spada_lunga', 'mazza',
  'ascia_1h', 'ascia_2h',
  'lancia_2m', 'lancia_3m', 'giavellotto',
  'arco_corto', 'arco_lungo', 'balestra',
] as const;

const SHIELD_VOCAB = ['scudo_piccolo', 'scudo_medio', 'scudo_pesante'] as const;
const OFFHAND_WEAPON_VOCAB = ['pugnale', 'spada'] as const;
const ARMOR_VOCAB = ['armatura_leggera', 'armatura_media', 'armatura_pesante'] as const;

const SKILL_AZIONI = ['attaccare', 'parare', 'schivare', 'slancio'] as const;
const SKILL_CLASSI = [
  'spade', 'scudi', 'armature', 'lance', 'asce', 'archi', 'balestre', 'giavellotti',
] as const;

const SKILL_MODIFIER_KEYS = ['-1impedimento', '+1tiro', '+1dado', '+1dadomax'] as const;

// Layout (DEVE matchare Python build_features.BUILD_FEATURES_DIM):
// 12 (weapon) + 3 (shield) + 1 (no_shield) + 1 (offhand_weapon) + 3 (armor) + 1 (no_armor)
// + 1 (thrown_count) + 1 (has_backup) + 4 (modifier counts) + 4 (azione counts) + 8 (classe counts)
// = 39
export const BUILD_FEATURES_DIM = 39;

function oneHot(value: string | null | undefined, vocab: readonly string[]): number[] {
  const v = new Array(vocab.length).fill(0);
  if (value == null) return v;
  const idx = vocab.indexOf(value);
  if (idx >= 0) v[idx] = 1;
  return v;
}

/**
 * Encoda una Unit nel suo vettore di build features (39 dim).
 * NB: lavora sui dati di equipaggiamento + skill, non sullo stato runtime
 * (HP, slancio ecc. sono catturati separatamente da `buildObsV2`).
 */
export function buildToFeatures(unit: Unit): Float32Array {
  const parts: number[] = [];

  // Weapon one-hot (12)
  parts.push(...oneHot(unit.weapon ?? null, WEAPON_VOCAB));

  // Shield (3) + no_shield flag (1)
  const isShield = unit.offhand != null && (SHIELD_VOCAB as readonly string[]).includes(unit.offhand);
  parts.push(...oneHot(isShield ? unit.offhand! : null, SHIELD_VOCAB));
  parts.push(unit.offhand ? 0 : 1);

  // Offhand-as-weapon (1) — pugnale o spada offhand
  const hasOffWeapon = unit.offhand != null && (OFFHAND_WEAPON_VOCAB as readonly string[]).includes(unit.offhand);
  parts.push(hasOffWeapon ? 1 : 0);

  // Armor (3) + no_armor flag (1)
  parts.push(...oneHot(unit.armor ?? null, ARMOR_VOCAB));
  parts.push(unit.armor ? 0 : 1);

  // Thrown inventory count (1)
  const nThrown = unit.thrownInventory?.length ?? 0;
  parts.push(nThrown);

  // Has backup weapon (1)
  parts.push(unit.backupWeapon ? 1 : 0);

  // Skill aggregates
  const modifCount: Record<string, number> = {
    '-1impedimento': 0, '+1tiro': 0, '+1dado': 0, '+1dadomax': 0,
  };
  const azioneCount: Record<string, number> = {};
  for (const a of SKILL_AZIONI) azioneCount[a] = 0;
  const classeCount: Record<string, number> = {};
  for (const c of SKILL_CLASSI) classeCount[c] = 0;

  for (const s of unit.skills ?? []) {
    if (s.modifier in modifCount) modifCount[s.modifier] += s.level;
    if (s.azione && s.azione in azioneCount) azioneCount[s.azione] += s.level;
    if (s.classeOggetto && s.classeOggetto in classeCount) classeCount[s.classeOggetto] += s.level;
  }

  parts.push(...SKILL_MODIFIER_KEYS.map((k) => modifCount[k]));
  parts.push(...SKILL_AZIONI.map((a) => azioneCount[a]));
  parts.push(...SKILL_CLASSI.map((c) => classeCount[c]));

  if (parts.length !== BUILD_FEATURES_DIM) {
    throw new Error(
      `buildToFeatures: shape mismatch, got ${parts.length} expected ${BUILD_FEATURES_DIM}`,
    );
  }

  return new Float32Array(parts);
}

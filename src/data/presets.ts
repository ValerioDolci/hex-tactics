/**
 * Preset di personaggi predefiniti — usati nell'MVP al posto del character builder full.
 *
 * Ogni preset rispecchia un archetipo con equipaggiamento e skill bilanciate
 * intorno al riferimento di 2000 exp ("PG sensato" — vedi CLAUDE.md).
 *
 * In post-MVP polish: il character builder UI permetterà creazione libera; questi
 * preset rimangono come "build di esempio" / quickstart.
 */

import { Unit, FactionId, createBaselineUnit } from '@entities/Unit';
import { AcquiredSkill } from '@entities/Skill';
import { Axial } from '@core/hex/coords';

export interface PresetSpec {
  id: string;
  name: string;
  description: string;
  weapon?: string;
  offhand?: string;
  armor?: string;
  skills: Omit<AcquiredSkill, 'id'>[];
}

/** Crea un Unit dato un PresetSpec, fazione e posizione. */
export function unitFromPreset(
  spec: PresetSpec,
  faction: FactionId,
  position: Axial,
  customName?: string,
): Unit {
  const u = createBaselineUnit({
    id: `${faction}-${spec.id}`,
    name: customName ?? spec.name,
    faction,
    position,
  });
  u.weapon = spec.weapon;
  u.offhand = spec.offhand;
  u.armor = spec.armor;
  u.skills = spec.skills.map((s, i) => ({ ...s, id: `${u.id}-skill-${i}` }));
  u.presetId = spec.id;
  return u;
}

export const PRESETS: PresetSpec[] = [
  {
    id: 'spadaccino',
    name: 'Spadaccino',
    description:
      'Spada lunga a 2 mani + armatura media (no scudo). Build offensiva-bilanciata (2000 exp, D-046): imp 0 con -3imp generico + -3imp [spade] + -3imp [armature]; +2 tiro [attaccare/spade], +1 tiro [slancio/agilità].',
    weapon: 'spada_lunga',
    offhand: undefined,
    armor: 'armatura_media',
    skills: [
      // -3imp generico (700 exp): spada_lunga 3, armatura_media 3
      { modifier: '-1impedimento', level: 3, cost: 700 },
      // -3imp [spade] (350 exp): spada_lunga 3 → 0
      { modifier: '-1impedimento', level: 3, classeOggetto: 'spade', cost: 350 },
      // -3imp [armature] (350 exp): armatura_media 3 → 0
      { modifier: '-1impedimento', level: 3, classeOggetto: 'armature', cost: 350 },
      // +2 tiro [attaccare/spade] lv2 2 spec (450)
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'spade', cost: 450 },
      // +1 tiro [slancio/agilità] (150 exp, 2 spec)
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      // Total: 2000 exp ✓
    ],
  },
  {
    id: 'arciere',
    name: 'Arciere',
    description:
      'Arco lungo + pugnale (offhand, para) + armatura leggera. Specializzato distanza (2000 exp, D-046): -3imp + -3imp [archi] azzerano; +2 tiro [attaccare/archi], +1 tiro [slancio/agilità], +1 dadomax [slancio/agilità].',
    weapon: 'arco_lungo',
    offhand: 'pugnale',
    armor: 'armatura_leggera',
    skills: [
      // -3imp generico (700 exp): arco 3, pugnale 0, armatura 0
      { modifier: '-1impedimento', level: 3, cost: 700 },
      // -3imp [archi] (350 exp): arco 3 → 0
      { modifier: '-1impedimento', level: 3, classeOggetto: 'archi', cost: 350 },
      // +2 tiro [attaccare/archi] (450 exp, 2 spec, lv2)
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'archi', cost: 450 },
      // +1 tiro [slancio/agilità] (150 exp, 2 spec)
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      // +1 dadomax [slancio/agilità] (300 exp, 2 spec, base 1200/4)
      { modifier: '+1dadomax', level: 1, azione: 'slancio', abilita: 'agilità', cost: 300 },
      // Total: 1950 exp (50 avanzati)
    ],
  },
  {
    id: 'tank',
    name: 'Tank',
    description:
      'Mazza + scudo medio + armatura media. Specialista parata + slancio (2000 exp, D-046): -3imp generico + -3imp [scudi] + -3imp [armature] azzerano; +1 tiro [parare/scudi], +1 tiro [slancio/agilità], +1 dadomax [slancio/agilità].',
    weapon: 'mazza',
    offhand: 'scudo_medio',
    armor: 'armatura_media',
    skills: [
      // -3imp generico (700 exp): mazza 0, scudo 3, armatura 3
      { modifier: '-1impedimento', level: 3, cost: 700 },
      // -3imp [scudi] (350): scudo 3 → 0
      { modifier: '-1impedimento', level: 3, classeOggetto: 'scudi', cost: 350 },
      // -3imp [armature] (350): armatura 3 → 0
      { modifier: '-1impedimento', level: 3, classeOggetto: 'armature', cost: 350 },
      // +1 tiro [parare/scudi] (150 exp)
      { modifier: '+1tiro', level: 1, azione: 'parare', classeOggetto: 'scudi', cost: 150 },
      // +1 tiro [slancio/agilità] (150 exp)
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      // +1 dadomax [slancio/agilità] (300 exp)
      { modifier: '+1dadomax', level: 1, azione: 'slancio', abilita: 'agilità', cost: 300 },
      // Total: 2000 exp ✓
    ],
  },
];

export function getPreset(id: string): PresetSpec | undefined {
  return PRESETS.find((p) => p.id === id);
}

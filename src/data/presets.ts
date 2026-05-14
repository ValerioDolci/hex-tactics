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
  /**
   * Inventario armi da lancio single-use. Quando il PG lancia l'arma equipaggiata,
   * la prossima viene estratta da qui. Se vuoto, fallback a `backupWeapon`.
   */
  thrownInventory?: string[];
  /**
   * Arma di backup estratta quando `thrownInventory` è vuoto. Se anche questa
   * manca, il PG resta disarmato dopo aver lanciato l'arma equipaggiata.
   */
  backupWeapon?: string;
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
  if (spec.thrownInventory && spec.thrownInventory.length > 0) {
    u.thrownInventory = [...spec.thrownInventory];
  }
  if (spec.backupWeapon) {
    u.backupWeapon = spec.backupWeapon;
  }
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

  // ── Build distillate dalla sessione overnight 2026-05-06 (CFR equilibrium) ──
  // Tutti i 4 preset sotto sono testati con Deep CFR (vedi DEEP_CFR_RESULTS_2026-05-06.md).
  {
    id: 'lanciere',
    name: 'Lanciere',
    description:
      'Lancia 2m + scudo piccolo + armatura media + 2 lance di riserva da scagliare + spada backup. Reach 4 (zona di controllo) e lancio 2 hex. Dominante vs no-scudo (lanciere stomp spadaccino +33 wr%).',
    weapon: 'lancia_2m',
    offhand: 'scudo_piccolo',
    armor: 'armatura_media',
    thrownInventory: ['lancia_2m', 'lancia_2m'],
    backupWeapon: 'spada',
    skills: [
      { modifier: '-1impedimento', level: 3, cost: 700 },
      { modifier: '-1impedimento', level: 3, classeOggetto: 'armature', cost: 350 },
      { modifier: '-1impedimento', level: 3, classeOggetto: 'scudi', cost: 350 },
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'lance', cost: 450 },
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      // Total: 2000 exp ✓
    ],
  },
  {
    id: 'giavellottiere',
    name: 'Giavellottiere',
    description:
      'Giavellotto + scudo piccolo + armor media + 3 giavellotti throw + spada backup. Lancio 3 hex (più lungo del lanciere). Stomp record vs balestra (+37.5 wr%) per la finestra ricarica 7 dell\'avversario.',
    weapon: 'giavellotto',
    offhand: 'scudo_piccolo',
    armor: 'armatura_media',
    thrownInventory: ['giavellotto', 'giavellotto', 'giavellotto'],
    backupWeapon: 'spada',
    skills: [
      { modifier: '-1impedimento', level: 3, cost: 700 },
      { modifier: '-1impedimento', level: 3, classeOggetto: 'armature', cost: 350 },
      { modifier: '-1impedimento', level: 3, classeOggetto: 'scudi', cost: 350 },
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'giavellotti', cost: 450 },
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      // Total: 2000 exp ✓
    ],
  },
  {
    id: 'ascia1h_lanciatore',
    name: 'Ascia 1h lanciatore',
    description:
      'Ascia 1h + scudo piccolo + armor media + 2 ascie throw + spada backup. Lancio 1 hex (range minore del lanciere/giav). Bilanciato vs tank (≈0), ma dominato dai thrower con range maggiore.',
    weapon: 'ascia_1h',
    offhand: 'scudo_piccolo',
    armor: 'armatura_media',
    thrownInventory: ['ascia_1h', 'ascia_1h'],
    backupWeapon: 'spada',
    skills: [
      { modifier: '-1impedimento', level: 3, cost: 700 },
      { modifier: '-1impedimento', level: 3, classeOggetto: 'armature', cost: 350 },
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'asce', cost: 450 },
      { modifier: '+1tiro', level: 1, azione: 'slancio', abilita: 'agilità', cost: 150 },
      { modifier: '+1dadomax', level: 1, azione: 'slancio', abilita: 'agilità', cost: 300 },
      // Total: 1950 exp (50 avanzati)
    ],
  },
  {
    id: 'balestriere',
    name: 'Balestriere',
    description:
      'Balestra +15 fisso (no dadi arma) + pugnale offhand + armor leggera. Ricarica 7 turni: un solo colpo poi setup lungo. Stallo vs tank scudo medio (80% draw), perde sistematicamente vs throwers.',
    weapon: 'balestra',
    offhand: 'pugnale',
    armor: 'armatura_leggera',
    skills: [
      { modifier: '-1impedimento', level: 3, cost: 700 },
      { modifier: '+1tiro', level: 2, azione: 'attaccare', classeOggetto: 'balestre', cost: 450 },
      { modifier: '+1tiro', level: 2, azione: 'slancio', abilita: 'agilità', cost: 300 },
      { modifier: '+1dadomax', level: 1, azione: 'slancio', abilita: 'agilità', cost: 300 },
      // Total: 1750 exp (250 avanzati — preset semplice, exp non saturo)
    ],
  },
];

/**
 * Costo exp totale di un preset = somma di .cost di tutte le skill acquistate.
 * Usato nello SkirmishSetupScene per il budget di team-building.
 */
export function presetCost(spec: PresetSpec): number {
  return spec.skills.reduce((sum, s) => sum + (s.cost ?? 0), 0);
}

export function getPreset(id: string): PresetSpec | undefined {
  return PRESETS.find((p) => p.id === id);
}

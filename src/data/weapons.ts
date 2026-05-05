/**
 * Database delle armi (sorgente: `TAB_armi.docx` + interpretazione confermata da Valerio).
 *
 * Nota sulla notazione "/" della tabella:
 *   - Spada `1D6+2/+2`: due modi → +2 con Forza, +2 con Agilità
 *   - Spada lunga 1h/2h `1D6+2/+6`: due modi → +2 a 1 mano, +6 a 2 mani (stat libera)
 *   - Lancia 1h/2h `2D6` (no /): un modo unico, stat libera
 *
 * Ranges convertiti in esagoni (1 esagono = 0.5 m, D-013).
 * N_arma per malus distanza: D-012 (prima draft).
 */

import { Weapon } from '@entities/Equipment';

export const WEAPONS: Record<string, Weapon> = {
  pugnale: {
    id: 'pugnale',
    name: 'Pugnale',
    category: 'pugnali',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 1, fixedBonus: 2 }],
    parry: { dice: 1, fixed: 0 }, // 1D6+0
    impediment: 0,
    // V2: reach 1 (= 0.5m, default armi melee). Triggera asta zona controllo.
    range: { reach: 1, throw: 1, rangedDivisor: 1 }, // Lancio 0.5m → 1 hex; reach mischia 1
  },
  spada: {
    id: 'spada',
    name: 'Spada',
    category: 'spade',
    attackModes: [
      { label: 'Forza', stat: 'forza', diceVariable: 1, fixedBonus: 2 },
      { label: 'Agilità', stat: 'agilità', diceVariable: 1, fixedBonus: 2 },
    ],
    parry: { dice: 1, fixed: 2 }, // 1D6+2
    impediment: 3,
    range: { reach: 1 }, // V2: reach 1 (default 0.5m), attiva asta zona controllo
  },
  spada_lunga: {
    id: 'spada_lunga',
    name: 'Spada lunga',
    category: 'spade',
    attackModes: [
      { label: '1 mano', stat: 'either', diceVariable: 1, fixedBonus: 2 },
      { label: '2 mani', stat: 'either', diceVariable: 1, fixedBonus: 6, isTwoHanded: true },
    ],
    parry: { dice: 1, fixed: 6 }, // 1d6+6, stesso valore per entrambe le impugnature
    impediment: 6,
    range: { reach: 2 }, // Portata 1m → 2 hex
  },
  mazza: {
    id: 'mazza',
    name: 'Mazza',
    category: 'mazze',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 0, fixedBonus: 9 }], // +9 fisso, niente dadi arma
    parry: { dice: 0, fixed: 3 }, // +3 fisso
    impediment: 3,
    range: { reach: 1 }, // V2
  },
  ascia_1h: {
    id: 'ascia_1h',
    name: 'Ascia 1h',
    category: 'asce',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 1, fixedBonus: 6 }],
    parry: { dice: 0, fixed: 3 },
    impediment: 3,
    range: { reach: 1, throw: 1, rangedDivisor: 1 }, // V2: reach 1; Lancio 0.5m → 1 hex
  },
  ascia_2h: {
    id: 'ascia_2h',
    name: 'Ascia 2h',
    category: 'asce',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 1, fixedBonus: 15, isTwoHanded: true }],
    parry: { dice: 0, fixed: 3 },
    impediment: 6,
    range: { reach: 1 }, // V2
  },
  lancia_2m: {
    id: 'lancia_2m',
    name: 'Lancia 2m (1h/2h)',
    category: 'lance',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 2, fixedBonus: 0 }], // 2D6, stesso bonus 1h/2h
    parry: { dice: 0, fixed: 3 },
    impediment: 3,
    range: { throw: 2, reach: 4, rangedDivisor: 2 }, // Lancio 1m=2hex, Portata 2m=4hex
  },
  lancia_3m: {
    id: 'lancia_3m',
    name: 'Lancia 3m (2h)',
    category: 'lance',
    // Fix lancia 3m: ATK +0 → +4 (era bug numerico, fissa totale -4 dopo imp).
    // Math: 1d PG + 2d arma + 2 PG + 4 arma - 6 imp = 3d6 +0 medio 10.5
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 2, fixedBonus: 4, isTwoHanded: true }],
    parry: { dice: 0, fixed: 1 },
    impediment: 6,
    range: { reach: 6 }, // Portata 3m=6hex
  },
  giavellotto: {
    id: 'giavellotto',
    name: 'Giavellotto',
    category: 'giavellotti',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 0, fixedBonus: 6 }],
    parry: { dice: 0, fixed: 1 },
    impediment: 3,
    range: { throw: 3, reach: 2, rangedDivisor: 3 }, // Lancio 1.5m=3hex, Portata 1m=2hex
  },
  arco_corto: {
    id: 'arco_corto',
    name: 'Arco corto',
    category: 'archi',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 1, fixedBonus: 6 }],
    parry: null, // archi non parano
    impediment: 3,
    // 2026-05-04: rangedDivisor 3→2 (malus -1 ogni 2 hex), reload via slancio
    range: { distance: 3, rangedDivisor: 2, reloadCostSlancio: 6 },
  },
  arco_lungo: {
    id: 'arco_lungo',
    name: 'Arco lungo',
    category: 'archi',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 2, fixedBonus: 6, isTwoHanded: true }],
    parry: null,
    impediment: 6,
    // 2026-05-04: rangedDivisor 5→2, reload via slancio costo 9 (alto = arco lungo richiede setup)
    range: { distance: 4, rangedDivisor: 2, reloadCostSlancio: 9 },
  },
  balestra: {
    id: 'balestra',
    name: 'Balestra',
    category: 'balestre',
    attackModes: [{ label: 'default', stat: 'either', diceVariable: 0, fixedBonus: 15 }],
    parry: null,
    impediment: 3,
    // 2026-05-04: rangedDivisor 3→2, reload via slancio costo 12 (massimo = bilanciamento +15 fisso)
    range: { distance: 2, rangedDivisor: 2, reload: 7, reloadCostSlancio: 12 },
  },
};

export type WeaponId = keyof typeof WEAPONS;

export function getWeapon(id: string): Weapon | undefined {
  return WEAPONS[id];
}

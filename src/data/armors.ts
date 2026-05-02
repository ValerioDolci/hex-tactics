/**
 * Database delle armature (sorgente: TAB_armi.docx).
 *
 * RD = riduzione danno applicata ai colpi subiti.
 */

import { Armor } from '@entities/Equipment';

export const ARMORS: Record<string, Armor> = {
  armatura_leggera: {
    id: 'armatura_leggera',
    name: 'Armatura leggera',
    category: 'armature',
    damageReduction: 3,
    impediment: 3,
  },
  armatura_media: {
    id: 'armatura_media',
    name: 'Armatura media',
    category: 'armature',
    damageReduction: 6,
    impediment: 6,
  },
  armatura_pesante: {
    id: 'armatura_pesante',
    name: 'Armatura pesante',
    category: 'armature',
    damageReduction: 12,  // Tweak D3: 9→12 (specialist, imp 9 resta)
    impediment: 9,
  },
};

export function getArmor(id: string): Armor | undefined {
  return ARMORS[id];
}

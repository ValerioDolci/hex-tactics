/**
 * Database degli scudi (sorgente: TAB_armi.docx).
 *
 * I "1D6" della parte variabile sono rappresentati come placeholder:
 * un singolo elemento `[0]` indica "tira 1 d6 quando si usa". Il combat module
 * sostituisce gli zero placeholder con tiri reali al momento.
 */

import { Shield } from '@entities/Equipment';

export const SHIELDS: Record<string, Shield> = {
  scudo_piccolo: {
    id: 'scudo_piccolo',
    name: 'Scudo piccolo',
    category: 'scudi',
    attackFixedBonus: 4,
    parry: { dice: 1, fixed: 4 }, // 1D6+4
    impediment: 3,
  },
  scudo_medio: {
    id: 'scudo_medio',
    name: 'Scudo medio',
    category: 'scudi',
    attackFixedBonus: 8,
    parry: { dice: 1, fixed: 8 }, // 1D6+8
    impediment: 6,
  },
  scudo_pesante: {
    id: 'scudo_pesante',
    name: 'Scudo pesante',
    category: 'scudi',
    attackFixedBonus: 8,
    parry: { dice: 1, fixed: 12 }, // 1D6+12
    impediment: 9,
  },
};

export function getShield(id: string): Shield | undefined {
  return SHIELDS[id];
}

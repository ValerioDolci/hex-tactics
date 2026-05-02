/**
 * Tipi runtime per l'equipaggiamento (Weapon / Shield / Armor).
 *
 * I valori effettivi sono in `src/data/{weapons,shields,armors}.ts`,
 * popolati seguendo `TAB_armi.docx`.
 *
 * Convenzioni:
 * - Le distanze (range) sono in **esagoni** (1 esagono = 0.5 m, vedi D-013)
 * - I "dice" qui sono i dadi che l'arma AGGIUNGE ai 1-2 d6 base del PG (D-004 + D-D)
 * - I "fixed" sono i bonus fissi dell'arma alla parte fissa del tiro
 */

/** Stat usata in un tiro */
export type Stat = 'forza' | 'agilità' | 'volontà';

/**
 * Specifica di un tiro (non un risultato): "tira N dadi e somma F fisso".
 * Diverso da `Roll` che è il risultato concreto dopo il tiro.
 * Usata per parry/attack delle armi e di altri item.
 */
export interface RollSpec {
  dice: number;
  fixed: number;
}

/**
 * Modo di attacco di un'arma.
 *
 * Per armi a impugnatura unica con scelta forza/agilità (es. Spada): più modi con stat differenti.
 * Per armi 1h/2h (es. Spada lunga): più modi con `mode` differente, stat 'either' (libera scelta).
 * Per armi a modo unico: una sola entry, stat 'either'.
 */
export interface AttackMode {
  /** Etichetta per UI (es. "Forza", "Agilità", "1 mano", "2 mani") */
  label: string;
  /** Stat richiesta. 'either' = il giocatore sceglie quale stat applicare */
  stat: Stat | 'either';
  /** Numero di dadi che l'arma aggiunge al tiro d'attacco */
  diceVariable: number;
  /** Bonus fisso dell'arma all'attacco */
  fixedBonus: number;
}

/** Categorie di equipaggiamento per matching specializzazioni delle skill */
export type WeaponCategory =
  | 'pugnali'
  | 'spade'
  | 'mazze'
  | 'asce'
  | 'lance'
  | 'archi'
  | 'balestre'
  | 'giavellotti';

/** Descrittore di un'arma (data record, immutabile). */
export interface Weapon {
  id: string;
  name: string;
  category: WeaponCategory;
  /** 1+ modi di attacco; il giocatore sceglie quando attacca */
  attackModes: AttackMode[];
  /** Contributo dell'arma alla parata. `null` = arma non parabile (archi, balestre). */
  parry: RollSpec | null;
  /** Impedimento dell'arma */
  impediment: number;
  /** Range opzionale (in esagoni) per armi a distanza/lancio/portata */
  range?: WeaponRange;
}

export interface WeaponRange {
  /** Distanza massima per arma da tiro (archi, balestre) */
  distance?: number;
  /** Distanza massima per il lancio di un'arma da mischia */
  throw?: number;
  /** Portata CaC esteso (lancia, spada lunga…) */
  reach?: number;
  /** Divisore N_arma per il malus distanza */
  rangedDivisor?: number;
  /** Turni di ricarica (es. balestra 7) */
  reload?: number;
}

export type ShieldCategory = 'scudi';

export interface Shield {
  id: string;
  name: string;
  category: ShieldCategory;
  /** Contributo del scudo all'attacco (improvvisato), parte fissa */
  attackFixedBonus: number;
  /** Contributo alla parata */
  parry: RollSpec;
  impediment: number;
}

export type ArmorCategory = 'armature';

export interface Armor {
  id: string;
  name: string;
  category: ArmorCategory;
  /** Riduzione danno applicata ai colpi subiti */
  damageReduction: number;
  impediment: number;
}

/** Helper: tutte le categorie possibili per match specializzazioni skill */
export type EquipCategory = WeaponCategory | ShieldCategory | ArmorCategory;

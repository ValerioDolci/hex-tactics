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
  /**
   * 2026-05-05: il modo richiede 2 mani. Se true, il PG può attingere fino a 1
   * dado in più dalla sua riserva (cap PG da 1-2 a 1-3). NON modifica bonus fissi
   * o dadi arma — solo aumenta il cap dei dadi PG selezionabili.
   */
  isTwoHanded?: boolean;
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
  /**
   * LEGACY: campo descrittivo per categorizzare armi 'da tiro' (archi, balestre).
   * NOT a hard max range — le armi non hanno gittata massima nel design.
   * Il malus distanza è gestito da `rangedDivisor` (-1 ogni N hex).
   */
  distance?: number;
  /**
   * LEGACY: indica capacità di lancio per armi da mischia. NON è hard max range.
   */
  throw?: number;
  /** Portata CaC esteso (lancia, spada lunga…) */
  reach?: number;
  /** Divisore N_arma per il malus distanza (-1 ogni N hex) */
  rangedDivisor?: number;
  /**
   * LEGACY (pre-2026-05-04): difficoltà tiro abilità per ricarica. Usato come fallback.
   */
  reload?: number;
  /**
   * 2026-05-04: costo slancio fisso per ricaricare/incoccare. Sostituisce la prova
   * abilità. Se settato → reload paga slancio invece di tirare dadi.
   * arco_corto=6, arco_lungo=9, balestra=12.
   */
  reloadCostSlancio?: number;
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

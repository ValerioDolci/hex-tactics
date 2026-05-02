/**
 * Skill acquistate dal giocatore (acquisto a punti exp).
 *
 * Vedi CLAUDE.md sezione "Skill system" per regole.
 *
 * Modificatori base (lv1):
 *   -1 impedimento     100 exp
 *   +1 al tiro         600 exp
 *   +1 dado          3600 exp   (tiri sempre 1 dado in più)
 *   +1 dado massimo  1200 exp   (tetto dei dadi tirabili +1, opzionale)
 *
 * D-046 — Costi con livelli + specializzazioni:
 *   - Lv N totale = base * (2^N - 1)
 *     Es. -1imp: lv1=100, lv2=300, lv3=700, lv4=1500, lv5=3100, lv6=6300
 *   - Ogni specializzazione DIMEZZA il costo (cumulativamente):
 *       1 spec → /2, 2 spec → /4, 3 spec → /8, 4 spec → /16
 *   - Es. -3imp [scudi] (1 spec) lv3 = 700/2 = 350
 *   - Es. +1tiro [attaccare][spade] (2 spec) lv1 = 600/4 = 150
 *
 * Vincolo unicità: non puoi acquistare la stessa skill identica più volte allo stesso livello.
 * Devi salire di livello (skill diventa lv N+1) o cambiare specializzazione.
 *
 * Specializzazioni (max 1 parola per lista, 4 liste):
 *   abilità (forza/agilità/volontà)
 *   azione (attaccare/parare/schivare/slancio/ricaricare)
 *   classe oggetto (spade/scudi/...)
 *   oggetto specifico (id arma/scudo/armatura)
 *
 * Effetto del livello: una skill di livello N equivale a "N volte" il modifier base
 * (es. -3imp toglie 3 punti dal pezzo applicabile; +2tiro [parare] = +2 fissa al parry).
 */

import { Stat, EquipCategory } from './Equipment';

/** Tipo del modificatore */
export type SkillModifier = '-1impedimento' | '+1tiro' | '+1dado' | '+1dadomax';

/** Tipo dell'azione (per specializzazione "azioni") */
export type ActionType = 'attaccare' | 'parare' | 'schivare' | 'slancio' | 'ricaricare';

/**
 * Una skill acquistata da un PG.
 * Specializzazioni opzionali: se assente, lo skill si applica universalmente.
 *
 * D-046: il livello determina sia il costo (raddoppio) sia l'effetto (-N imp, +N al tiro, ecc.).
 */
export interface AcquiredSkill {
  /** ID univoco dell'acquisto (per cumulative tracking) */
  id: string;
  modifier: SkillModifier;
  /** Livello della skill (default 1). Skill di lv N applica l'effetto N volte. */
  level: number;
  /** Specializzazione "abilità" (max 1) */
  abilita?: Stat;
  /** Specializzazione "azione" (max 1) */
  azione?: ActionType;
  /** Specializzazione "classe oggetto" (max 1, es. 'spade' / 'archi') */
  classeOggetto?: EquipCategory;
  /** Specializzazione "oggetto specifico" (max 1, id dell'item) */
  oggettoSpecifico?: string;
  /** Costo exp pagato all'acquisto (calcolato da computeSkillCost). */
  cost: number;
}

/** Costi base per modificatore (in exp), livello 1, no specializzazioni */
export const SKILL_COSTS: Record<SkillModifier, number> = {
  '-1impedimento': 100,
  '+1tiro': 600,
  '+1dado': 3600,
  '+1dadomax': 1200,
};

/** Conta quante specializzazioni ha una skill (0..4). */
export function countSpecializations(skill: Pick<AcquiredSkill, 'abilita' | 'azione' | 'classeOggetto' | 'oggettoSpecifico'>): number {
  let n = 0;
  if (skill.abilita) n++;
  if (skill.azione) n++;
  if (skill.classeOggetto) n++;
  if (skill.oggettoSpecifico) n++;
  return n;
}

/**
 * D-046: calcola il costo cumulativo di una skill al livello N con specCount specializzazioni.
 *   total = base * (2^level - 1) / (2^specCount)
 * Arrotondato per eccesso (Math.ceil) per evitare costi frazionari.
 */
export function computeSkillCost(modifier: SkillModifier, level: number, specCount: number): number {
  if (level < 1) return 0;
  const base = SKILL_COSTS[modifier];
  const levelMultiplier = Math.pow(2, level) - 1; // lv1=1, lv2=3, lv3=7, lv4=15...
  const specDivisor = Math.pow(2, specCount); // 0=1, 1=2, 2=4, 3=8, 4=16
  return Math.ceil((base * levelMultiplier) / specDivisor);
}

/**
 * D-046: chiave canonica per identificare la "stessa skill" ai fini dell'unicità.
 * Due skill con stessa chiave NON possono coesistere: o sale il livello, o cambia spec.
 */
export function skillKey(s: Pick<AcquiredSkill, 'modifier' | 'abilita' | 'azione' | 'classeOggetto' | 'oggettoSpecifico'>): string {
  return [s.modifier, s.abilita ?? '', s.azione ?? '', s.classeOggetto ?? '', s.oggettoSpecifico ?? ''].join('|');
}

/**
 * Valida un set di skill: niente duplicati per chiave, costi totali corretti.
 * @returns { valid, totalCost, errors }
 */
export function validateSkillSet(skills: AcquiredSkill[]): { valid: boolean; totalCost: number; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  let totalCost = 0;
  for (const s of skills) {
    const key = skillKey(s);
    if (seen.has(key)) {
      errors.push(`Skill duplicata (stessa chiave + stesso livello implicito): ${key}`);
    }
    seen.add(key);
    const expected = computeSkillCost(s.modifier, s.level, countSpecializations(s));
    if (s.cost !== expected) {
      errors.push(`Costo errato per ${key} lv${s.level}: dichiarato ${s.cost}, atteso ${expected}`);
    }
    totalCost += expected;
  }
  return { valid: errors.length === 0, totalCost, errors };
}

/**
 * Contesto di un tiro, usato per matchare le specializzazioni delle skill.
 * Usato da combat.ts e ranged.ts per calcolare i modificatori applicabili.
 */
export interface RollContext {
  azione: ActionType;
  /** Stat usata nel tiro (se rilevante: attacco/parata) */
  stat?: Stat;
  /** Categoria dell'item usato (arma/scudo/armatura) */
  classeOggetto?: EquipCategory;
  /** ID specifico dell'item usato */
  oggettoSpecifico?: string;
}

/**
 * Verifica se una skill matcha il contesto di un tiro.
 * Tutte le specializzazioni presenti devono matchare; quelle assenti sono "any".
 */
export function skillMatchesContext(skill: AcquiredSkill, ctx: RollContext): boolean {
  if (skill.azione && skill.azione !== ctx.azione) return false;
  if (skill.abilita && skill.abilita !== ctx.stat) return false;
  if (skill.classeOggetto && skill.classeOggetto !== ctx.classeOggetto) return false;
  if (skill.oggettoSpecifico && skill.oggettoSpecifico !== ctx.oggettoSpecifico) return false;
  return true;
}

/**
 * Verifica se una skill `−1 impedimento` si applica a uno specifico pezzo di equipaggiamento.
 * Logica: `azione`/`abilita` sono ignorate (impedimento è del pezzo, non di un'azione).
 * Solo `classeOggetto` e `oggettoSpecifico` contano.
 *
 * Senza specializzazioni → si applica a tutti i pezzi.
 * Con `classeOggetto` → solo i pezzi di quella categoria.
 * Con `oggettoSpecifico` → solo a quel pezzo specifico.
 */
export function skillMatchesEquip(
  skill: AcquiredSkill,
  equip: { id: string; category: EquipCategory },
): boolean {
  if (skill.classeOggetto && skill.classeOggetto !== equip.category) return false;
  if (skill.oggettoSpecifico && skill.oggettoSpecifico !== equip.id) return false;
  return true;
}

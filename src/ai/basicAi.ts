/**
 * AI heuristic base — decision tree per le scelte di una unità AI.
 *
 * Funzioni pure: input GameState (+ unitId), output decisione.
 * Nessuna dipendenza da Phaser. Testabile.
 *
 * Strategia:
 *   - Slancio: tira 2 dadi se ha dadi azione, altrimenti meno.
 *   - Azione: se nemico in mischia → attacca; se in ranged → spara; altrimenti muoviti verso nemico più vicino.
 *   - Dadi attacco: 2 se possibile, soglia HP-aware (più dadi se può uccidere il nemico).
 *   - Difesa: parà se ha arma idonea e attacco temibile, schiva altrimenti, niente se 0 dadi.
 */

import { GameState } from '@core/state';
import { Unit, UnitId } from '@entities/Unit';
import { hexDistance, hexesInRange, neighbors } from '@core/hex/distance';
import { Axial, axialToOffset } from '@core/hex/coords';
import { baseDistance, getBaseHexes } from '@core/hex/base';
import { hexLine } from '@core/hex/line';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import { canFireRanged } from '@core/ranged';
import { countFlatBonuses, makeSlancioContext } from '@core/stats';
import { getMaxSlancioRoll } from '@core/turn';
import { GameEvent, EventDeclareAttack, EventMove, EventEndTurn } from '@core/events';

/** Trova il nemico più vicino vivo */
function findClosestEnemy(state: GameState, me: Unit): Unit | null {
  const enemies = Object.values(state.units).filter((u) => u.faction !== me.faction && u.alive);
  if (enemies.length === 0) return null;
  let best: Unit | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = baseDistance(me.position, e.position);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/**
 * Scoring "main threat" per skirmish (NvN, Phase 1.2 — 2026-05-14).
 *
 * Priorità di un nemico:
 *   - basso HP residuo → più finishable (focus fire)
 *   - alto danno potenziale arma → più pericoloso
 *   - bassa distanza → più imminente
 *
 * Formula: (danger_arma / hp_left) × (1 / max(1, dist)).
 *
 * `danger_arma` = primo modo arma: fixedBonus + diceVariable × 3.5 (EV d6).
 * Per disarmato → 1 (epsilon).
 */
function threatScore(me: Unit, enemy: Unit): number {
  const dist = baseDistance(me.position, enemy.position);
  const hpLeft = Math.max(1, enemy.hp);
  const w = enemy.weapon ? getWeapon(enemy.weapon) : null;
  let danger = 1;
  if (w && w.attackModes.length > 0) {
    const m = w.attackModes[0];
    danger = (m.fixedBonus ?? 0) + (m.diceVariable ?? 0) * 3.5;
    if (danger < 1) danger = 1;
  }
  return (danger / hpLeft) * (1 / Math.max(1, dist));
}

/**
 * Sceglie il bersaglio "migliore" per un'azione in NvN.
 *
 * Strategia:
 *   1. Se ci sono nemici in melee range (`reach` arma corrente), preferisci tra
 *      quelli — già si possono colpire al volo, non vale la pena ignorarli.
 *   2. Altrimenti scegli il main threat globale (scoring).
 *
 * Backward compatible col 1v1: se c'è UN solo nemico vivo restituisce quello.
 */
export function pickTargetForAction(state: GameState, me: Unit): Unit | null {
  const enemies = Object.values(state.units).filter((u) => u.faction !== me.faction && u.alive);
  if (enemies.length === 0) return null;
  if (enemies.length === 1) return enemies[0];
  // Prima fascia: in melee range della mia arma
  const w = me.weapon ? getWeapon(me.weapon) : null;
  const reach = w?.range?.reach ?? 0;
  if (reach >= 1) {
    const inMelee = enemies.filter((e) => baseDistance(me.position, e.position) <= reach);
    if (inMelee.length > 0) {
      return inMelee.reduce((best, u) => (threatScore(me, u) > threatScore(me, best) ? u : best));
    }
  }
  // Fallback: main threat globale (peso anche al ranged shot più value)
  return enemies.reduce((best, u) => (threatScore(me, u) > threatScore(me, best) ? u : best));
}

/** Quanti dadi tirare per lo slancio del turno corrente.
 *
 * Strategia:
 * 1. Se sono in mischia (nemico adiacente o in reach), lo slancio non serve per il
 *    movimento → tira 0 e risparmia dadi azione per attacchi.
 * 2. Se l'impedimento totale supera il bonus atteso del tiro slancio (2 fissi + ~3.5/dado),
 *    tirare significa erodere impeto in negativo. Tira 0.
 * 3. Altrimenti: tira il massimo tollerabile per dadi azione disponibili.
 */
export function aiDecideSlancio(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u) return 0;

  // Se ho già un nemico in mischia con la MIA arma melee → niente slancio,
  // risparmia dadi azione per attaccare.
  //
  // 2026-05-15 (Bug B fix): check valido SOLO per armi melee-capable (reach >= 1).
  // Per armi ranged-only (arco, balestra: reach=undefined) lasciar fluire la logica
  // standard: se un nemico melee è adiacente, l'arciere DEVE scappare (max slancio
  // possibile), non risparmiare dadi. Senza questo fix, `reach ?? 1` faceva passare
  // la condizione `dist <= 1` per arco a contatto, e l'arciere restava bloccato a
  // sla=0 mentre il tank lo macellava (vedi diag tank+tank vs arc+arc).
  const enemy = findClosestEnemy(state, u);
  if (enemy && u.weapon) {
    const w = getWeapon(u.weapon);
    const reach = w?.range?.reach ?? 0; // 0 = no melee capability
    const dist = baseDistance(u.position, enemy.position);
    if (reach >= 1 && dist <= reach) return 0;
  }

  // Se l'impedimento mangia il tiro: 2d6+2 medio = 9, ma con imp >= 7 è pura perdita
  const imp = (() => {
    let total = 0;
    if (u.weapon) {
      const w = getWeapon(u.weapon);
      if (w) total += Math.max(0, w.impediment - countImpReductionsForEquip(u, 'weapon'));
    }
    if (u.offhand) {
      const sh = getShield(u.offhand);
      const w = getWeapon(u.offhand);
      const impPiece = sh?.impediment ?? w?.impediment ?? 0;
      total += Math.max(0, impPiece - countImpReductionsForEquip(u, 'offhand'));
    }
    if (u.armor) {
      const a = getArmor(u.armor);
      if (a) total += Math.max(0, a.impediment - countImpReductionsForEquip(u, 'armor'));
    }
    return total;
  })();

  // Se imp >= 7 il 2d6+2 (max 14, medio 9) finisce neutro o negativo. Skip.
  if (imp >= 7) return 0;
  // Se imp 5-6: tira 1 dado (a 1d6+2-imp ~negativo, ma rischio minore)
  if (imp >= 5 && u.dadiAzione >= 2) return 1;
  // Default: 2 dadi se possibile, 1 se pochi, 0 se vuoto
  if (u.dadiAzione >= 4) return 2;
  if (u.dadiAzione >= 2) return 1;
  return 0;
}

/**
 * Decisione completa per START_TURN: numero dadi slancio + transfer impeto→slancio.
 *
 * 2026-05-15 (Bug E fix): l'AI heuristic non usava MAI il transfer impeto→slancio
 * (D-044). Conseguenza: arcieri con arco scarico (cost 9 sla per ricaricare) e
 * impeto alto (40+) non riuscivano mai a ricaricare nel round 1, perché 2d6+2
 * tira mediamente 9 ma serve un'esca per essere sicuri. Risultato: arcieri morti
 * in mischia senza aver mai sparato.
 *
 * Logica:
 *   1. slancioDice via aiDecideSlancio (esistente).
 *   2. Se l'arma è ranged scarica con reloadCostSlancio:
 *      - Stima slancio post-tiro = slancioDice * 3.5 (avg d6) + 2 + flat - imp
 *      - Se < reloadCostSlancio e impeto > 0:
 *        transfer = min(impeto, reloadCost - estimate, max_slancio_headroom)
 */
export function aiDecideTurnStart(state: GameState, unitId: UnitId): {
  slancioDice: number;
  impetoToSlancio: number;
} {
  const slancioDice = aiDecideSlancio(state, unitId);
  const u = state.units[unitId];
  if (!u) return { slancioDice, impetoToSlancio: 0 };
  if (u.impeto <= 0) return { slancioDice, impetoToSlancio: 0 };
  if (!u.weapon) return { slancioDice, impetoToSlancio: 0 };
  const w = getWeapon(u.weapon);
  if (!w?.range?.reloadCostSlancio || u.weaponLoaded) {
    return { slancioDice, impetoToSlancio: 0 };
  }
  // Arma ranged scarica con cost-slancio reload. Stima slancio post-tiro:
  let imp = 0;
  if (u.weapon) imp += Math.max(0, (getWeapon(u.weapon)?.impediment ?? 0) - countImpReductionsForEquip(u, 'weapon'));
  if (u.offhand) {
    const sh = getShield(u.offhand);
    const ow = getWeapon(u.offhand);
    imp += Math.max(0, (sh?.impediment ?? ow?.impediment ?? 0) - countImpReductionsForEquip(u, 'offhand'));
  }
  if (u.armor) imp += Math.max(0, (getArmor(u.armor)?.impediment ?? 0) - countImpReductionsForEquip(u, 'armor'));
  const flatBonus = countFlatBonuses(u.skills, makeSlancioContext());
  // Slancio post-tiro avg = slancioDice * 3.5 (avg d6) + 2 (BASE_PG_FIXED) + flat_skill - imp
  const slancioEstimateAvg = slancioDice * 3.5 + 2 + flatBonus - imp;
  const need = w.range.reloadCostSlancio - slancioEstimateAvg;
  if (need <= 0) return { slancioDice, impetoToSlancio: 0 };
  // Cap headroom: max teorico tiro slancio
  const maxRoll = getMaxSlancioRoll(u);
  const headroom = Math.max(0, maxRoll - slancioEstimateAvg);
  const transfer = Math.max(0, Math.min(Math.ceil(need), u.impeto, headroom));
  return { slancioDice, impetoToSlancio: transfer };
}

/** Helper: conta riduzioni impedimento applicabili a uno specifico equip slot */
function countImpReductionsForEquip(u: Unit, slot: 'weapon' | 'offhand' | 'armor'): number {
  const equipId =
    slot === 'weapon' ? u.weapon : slot === 'offhand' ? u.offhand : u.armor;
  if (!equipId) return 0;
  let category: string | null = null;
  if (slot === 'armor') category = 'armature';
  else {
    const w = getWeapon(equipId);
    const sh = getShield(equipId);
    category = w?.category ?? sh?.category ?? null;
  }
  let count = 0;
  for (const skill of u.skills) {
    if (skill.modifier !== '-1impedimento') continue;
    if (skill.classeOggetto && skill.classeOggetto !== category) continue;
    if (skill.oggettoSpecifico && skill.oggettoSpecifico !== equipId) continue;
    count++;
  }
  return count;
}

/** Decisione azione dopo START_TURN: attacco / movimento / end turn */
export function aiDecideAction(state: GameState, unitId: UnitId): GameEvent {
  const me = state.units[unitId];
  if (!me) return { type: 'END_TURN' };
  // 2026-05-14 (Phase 1.2 skirmish): target = main threat (HP basso × pericolosità arma
  // × prossimità), con preferenza per nemici già in melee range. In 1v1 ricade su
  // l'unico nemico → comportamento identico al pre-skirmish.
  //
  // 2026-05-15 (Bug A fix): usiamo `positionAtTurnStart` invece di `position` corrente
  // per il target picking. Senza, in skirmish 4+ il main_threat può cambiare ad ogni
  // MOVE (perché il scoring dipende da distanza), e l'unit oscilla avanti/indietro
  // bruciando slancio. Esempio dal dump 4v4 r7: A3_Arciere oscilla 8 volte tra (8,12)
  // e (9,12) e finisce con sla=0. Freezando il riferimento a positionAtTurnStart, il
  // target resta stabile per tutto il turno.
  const meForTargeting: Unit = me.positionAtTurnStart
    ? { ...me, position: me.positionAtTurnStart }
    : me;
  const enemy = pickTargetForAction(state, meForTargeting);
  if (!enemy) return { type: 'END_TURN' };

  const w = me.weapon ? getWeapon(me.weapon) : undefined;
  const dist = baseDistance(me.position, enemy.position);

  // Se ho già usato l'azione del turno, o ho 0 dadi azione, posso solo muovere o passare
  const canAct = !me.actionTakenThisTurn && me.dadiAzione >= 1;

  // V2 D-049: solo armi con `range.reach` esplicito sono melee-capable (le ranged-only
  // come archi/balestra hanno solo .distance, niente reach → niente attacco mischia).
  const meleeCapable = w?.range?.reach != null;
  // Threat in mischia: nemico melee con slancio>0 → ranged vietato.
  const inMeleeThreat = (() => {
    const enemies = Object.values(state.units).filter((u) => u.faction !== me.faction && u.alive);
    return enemies.some((e) => baseDistance(me.position, e.position) <= 1 && e.slancio > 0);
  })();
  // Mischia: se in range portata → attacco (se posso ancora agire)
  if (canAct && w && meleeCapable) {
    const meleeRange = w.range?.reach ?? 0;
    if (dist <= meleeRange) {
      const attack: EventDeclareAttack = {
        type: 'DECLARE_ATTACK',
        attackerId: me.id,
        targetId: enemy.id,
        weaponId: w.id,
        attackModeIdx: 0, // primo modo (sempre presente)
        chosenStat: w.attackModes[0].stat === 'either' ? 'forza' : w.attackModes[0].stat,
        isRanged: false,
      };
      return attack;
    }
  }

  // Ranged: se l'arma è ranged-capable e il bersaglio è in range. Bloccato se in melee threat.
  if (canAct && w && !inMeleeThreat) {
    const can = canFireRanged(me, enemy, w.id, state.units);
    if (can.ok) {
      const attack: EventDeclareAttack = {
        type: 'DECLARE_ATTACK',
        attackerId: me.id,
        targetId: enemy.id,
        weaponId: w.id,
        attackModeIdx: 0,
        chosenStat: w.attackModes[0].stat === 'either' ? 'agilità' : w.attackModes[0].stat,
        isRanged: true,
      };
      return attack;
    }
  }
  // Arma scarica con reload (cost-slancio o legacy) → ricarica anche in mischia.
  // 2026-05-04 fix: include reloadCostSlancio (nuovo path) accanto a reload legacy.
  // 2026-05-14 fix (bug B): per il path reloadCostSlancio verifica anche che lo
  // slancio sia sufficiente. Senza, l'heuristic ripropone RELOAD ad ogni turno e
  // il reducer lo rifiuta → loop simulazione fino al safety cap (timeout 90%
  // nel mirror arciere-vs-arciere).
  if (
    canAct &&
    w &&
    w.range &&
    (w.range.reload != null || w.range.reloadCostSlancio != null) &&
    !me.weaponLoaded &&
    me.dadiAzione > 0 &&
    (w.range.reloadCostSlancio == null || me.slancio >= w.range.reloadCostSlancio)
  ) {
    const dice = Math.min(2, me.dadiAzione);
    return { type: 'RELOAD', unitId: me.id, diceN: dice };
  }
  // Se non ho più la mia azione di turno (o non avrei niente da fare), prova solo a muovere/passare
  if (!canAct && w) {
    // Eventualmente avvicinati per posizionarti meglio per il prossimo turno
  }

  // Movimento: avvicinati al nemico più vicino. Sceglie l'hex raggiungibile più vicino al nemico.
  // Range disponibile = slancio + (1 se non ho ancora mosso, altrimenti 0)
  const freeHex = me.hexMovedThisTurn === 0 ? 1 : 0;
  const moveRange = me.slancio + freeHex;
  if (moveRange >= 1) {
    const candidate = findBestMoveToward(state, me, enemy, moveRange);
    if (candidate) {
      const move: EventMove = { type: 'MOVE', unitId: me.id, targetHex: candidate };
      return move;
    }
  }

  // Niente da fare: passa turno
  const end: EventEndTurn = { type: 'END_TURN' };
  return end;
}

/** Trova la mossa migliore per avvicinarsi al nemico, rispettando slancio e ostacoli.
 *
 *  CRITICO: oltre a verificare che il TARGET sia valido (basetta non in overlap),
 *  simula l'intero path (hexLine) per garantire che ogni step intermedio sia libero.
 *  Senza questo controllo, advanceMovement nel reducer fermerebbe il MOVE a metà
 *  e il prossimo aiDecideAction riproporrebbe lo stesso MOVE → LOOP.
 */
function findBestMoveToward(state: GameState, me: Unit, enemy: Unit, moveRange?: number): Axial | null {
  const range = moveRange ?? me.slancio + 1;
  const reachable = hexesInRange(me.position, range);

  // Set di hex bloccati (basetta di altre unità vive)
  const blockedSet = new Set<string>();
  for (const u of Object.values(state.units)) {
    if (u.id === me.id || !u.alive) continue;
    for (const h of getBaseHexes(u.position)) blockedSet.add(`${h.q},${h.r}`);
  }

  /** True se la basetta centrata in `h` si sovrappone a unità altre. */
  const baseOverlap = (h: Axial): boolean => {
    for (const bh of getBaseHexes(h)) {
      if (blockedSet.has(`${bh.q},${bh.r}`)) return true;
    }
    return false;
  };

  /**
   * 2026-05-15 (skirmish bug fix): l'INTERA basetta del target deve stare DENTRO
   * i bounds della board. Senza questo check, in skirmish multi-unit le unità
   * "schivano" gli alleati uscendo dalla mappa (es. arciere A1 si trovava a r=-64
   * dopo 70 round, slancio 0, mai più capace di tornare in range del nemico).
   * legalMoves.legalActionMoves già fa questo check, basicAi non lo faceva → in
   * 1v1 non si notava (target sempre verso interno mappa), in skirmish sì.
   */
  const inBoardBounds = (h: Axial): boolean => {
    for (const bh of getBaseHexes(h)) {
      const off = axialToOffset(bh);
      if (off.col < 0 || off.col >= state.board.cols) return false;
      if (off.row < 0 || off.row >= state.board.rows) return false;
    }
    return true;
  };

  /** True se il path da `from` a `to` è interamente valido (niente overlap step-by-step). */
  const pathIsClear = (from: Axial, to: Axial): boolean => {
    const fullLine = hexLine(from, to);
    // Skip primo (start) e ultimo (target già controllato sopra). Verifica intermedi.
    for (let i = 1; i < fullLine.length; i++) {
      if (baseOverlap(fullLine[i])) return false;
    }
    return true;
  };

  let best: Axial | null = null;
  let bestScore = Infinity;
  for (const h of reachable) {
    if (h.q === me.position.q && h.r === me.position.r) continue;
    if (blockedSet.has(`${h.q},${h.r}`)) continue;
    if (baseOverlap(h)) continue;
    if (!inBoardBounds(h)) continue;
    // CRITICO: il path INTERO deve essere libero (no blocco mid-step)
    if (!pathIsClear(me.position, h)) continue;
    const score = baseDistance(h, enemy.position);
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/** Quanti dadi spendere per l'attacco. Minimo 1, massimo min(2, dadiAzione). */
export function aiDecideAttackerDice(state: GameState, unitId: UnitId): number {
  const me = state.units[unitId];
  if (!me) return 1;
  // Massimo 2 dadi standard, ma cap dadi disponibili. Min 1 (l'attacco richiede ≥1 dado).
  return Math.max(1, Math.min(2, me.dadiAzione));
}

/** Decisione difesa: tipo + dadi.
 *
 * Strategia V2 (regole imp su variabile):
 * - Schivata morde solo la VARIABILE attaccante (post-impedimento).
 *   Ora che l'imp morde la variabile, la schivata è ancora più efficace contro PG
 *   ingombri: variabile_atk_effettiva = dadi − imp. Floor 0.
 * - Parata morde TUTTO il tiro. Efficace contro armi a tanti dadi.
 * - HP basso (<40%): preferisci parata (più garantita).
 * - Senza arma idonea per parare: forzato schivata.
 */
export function aiDecideDefense(state: GameState, defenderId: UnitId): {
  defenseType: 'parry' | 'dodge' | 'none';
  parryWith?: 'weapon' | 'offhand';
  diceN: number;
} {
  const def = state.units[defenderId];
  if (!def || def.dadiAzione <= 0) return { defenseType: 'none', diceN: 0 };

  // Determina sorgente di parata disponibile (preferisci scudo se c'è — ha più fisso)
  let parrySrc: 'weapon' | 'offhand' | null = null;
  let parryFixed = 0;
  if (def.offhand) {
    const sh = getShield(def.offhand);
    const w = getWeapon(def.offhand);
    if (sh) {
      parrySrc = 'offhand';
      parryFixed = sh.parry.fixed;
    } else if (w && w.parry !== null) {
      parrySrc = 'offhand';
      parryFixed = w.parry.fixed;
    }
  }
  if (!parrySrc && def.weapon) {
    const w = getWeapon(def.weapon);
    if (w && w.parry !== null) {
      parrySrc = 'weapon';
      parryFixed = w.parry.fixed;
    }
  }

  const diceN = Math.min(2, def.dadiAzione);

  // Niente parata possibile → schivata
  if (!parrySrc) return { defenseType: 'dodge', diceN };

  // Analizza l'attaccante (se pendingAction disponibile)
  const pa = state.pendingAction;
  if (pa && pa.attackerId !== defenderId) {
    const attacker = state.units[pa.attackerId];
    const weapon = attacker?.weapon ? getWeapon(attacker.weapon) : null;
    const mode = weapon?.attackModes[pa.attackModeIdx];
    if (weapon && mode) {
      const attackerDicePG = pa.attackerDice ?? 2;
      const armDice = mode.diceVariable;
      const totalAttackerDice = attackerDicePG + armDice;
      const armFix = mode.fixedBonus;

      // V2: stima impedimento attaccante per pesare l'efficacia della schivata.
      // Più imp → variabile_atk_effettiva minore → schivata vince più spesso.
      const attacker = state.units[pa.attackerId];
      let attackerImp = 0;
      if (attacker) {
        // riuso countImpReductionsForEquip: total piece imp - reduction
        if (attacker.weapon) {
          const w = getWeapon(attacker.weapon);
          if (w) attackerImp += Math.max(0, w.impediment - countImpReductionsForEquip(attacker, 'weapon'));
        }
        if (attacker.offhand) {
          const w = getWeapon(attacker.offhand);
          const sh = getShield(attacker.offhand);
          const piece = sh?.impediment ?? w?.impediment ?? 0;
          attackerImp += Math.max(0, piece - countImpReductionsForEquip(attacker, 'offhand'));
        }
        if (attacker.armor) {
          const a = getArmor(attacker.armor);
          if (a) attackerImp += Math.max(0, a.impediment - countImpReductionsForEquip(attacker, 'armor'));
        }
      }
      // Variabile attaccante attesa = totalAttackerDice * 3.5 - imp (post-floor 0).
      // Se imp ≥ 3.5 * totalDice (in attesa), la variabile è praticamente azzerata
      // → schivata blocca tutto a colpo sicuro.
      const expectedAttackerVar = Math.max(0, totalAttackerDice * 3.5 - attackerImp);

      // HP basso → parata (più garantita)
      if (def.hp <= def.hpMax * 0.35) {
        return { defenseType: 'parry', parryWith: parrySrc, diceN };
      }
      // Variabile attaccante stimata molto bassa (≤ 4) → schivata quasi sicura
      if (expectedAttackerVar <= 4) {
        return { defenseType: 'dodge', diceN };
      }
      // Armi a fisso puro (mazza, balestra) → schivata cancella il fisso se vince
      if (totalAttackerDice <= 2 || armFix <= 2) {
        return { defenseType: 'dodge', diceN };
      }
      // Parry forte (scudo medio+) e attaccante "puro dadi" → parata morde tutto
      if (parryFixed >= 6) {
        return { defenseType: 'parry', parryWith: parrySrc, diceN };
      }
      // Default V2: schivata (è ora più efficace nella maggioranza dei casi)
      return { defenseType: 'dodge', diceN };
    }
  }

  // Fallback: HP basso o no info → parata se ho scudo, altrimenti schivata
  if (def.hp <= def.hpMax * 0.4) {
    return { defenseType: 'parry', parryWith: parrySrc, diceN };
  }
  if (parrySrc === 'offhand' && def.offhand && getShield(def.offhand)) {
    return { defenseType: 'parry', parryWith: 'offhand', diceN };
  }
  return { defenseType: 'dodge', diceN };
}

/** Mossa di "loop AI": dato uno stato in fase choosing-action e un'unità AI, emette una sequenza di eventi. */
export function aiPlayAction(state: GameState, unitId: UnitId): GameEvent {
  return aiDecideAction(state, unitId);
}

/**
 * Fase 1 — Carica: AI sceglie l'amount massimo (delta_distance limitato da slancio).
 * Strategia greedy: se ho mosso verso il target, sfrutto il bonus al massimo.
 */
export function aiDecideCarica(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u) return 0;
  const pa = state.pendingAction;
  if (!pa) return 0;
  const target = state.units[pa.targetId];
  if (!target || !u.positionAtTurnStart) return 0;
  const dStart = baseDistance(u.positionAtTurnStart, target.position);
  const dNow = baseDistance(u.position, target.position);
  const delta = Math.max(0, dStart - dNow);
  return Math.max(0, Math.min(delta, u.slancio));
}

/**
 * V2 — Asta: ora si attiva su TUTTE le armi melee (era solo lance reach >= 4).
 * L'AI deve gestire molte più aste per turno → bid medio basso (preserva slancio).
 *
 * Strategia:
 * - Se mover (passare): bid basso (~slancio/6, min 1) — basta superare bid difensore zero/basso.
 * - Se difensore (bloccare): bid medio (~slancio/3, min 1) — costa di più ma stoppa.
 * - Distinguiamo via state.moveInProgress: se unitId == mover → ruolo mover; else difensore.
 */
export function aiDecideBidMovement(state: GameState, unitId: UnitId): number {
  const u = state.units[unitId];
  if (!u || u.slancio <= 0) return 0;
  const mip = state.moveInProgress;
  const isMover = mip ? mip.unitId === unitId : false;
  if (isMover) {
    // Mover: bid leggero, vuole risparmiare slancio per aste future / azioni
    return Math.max(1, Math.floor(u.slancio / 6));
  }
  // Difensore: bid più alto per fermare il movimento
  return Math.max(1, Math.floor(u.slancio / 3));
}

// helpers re-export
export { findBestMoveToward, findClosestEnemy };
// silenzia eventuali helper non utilizzati con import selettivo
void neighbors;
void hexDistance;

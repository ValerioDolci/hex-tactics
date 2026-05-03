"""
AI heuristic — port di src/ai/basicAi.ts.

Funzioni pure (input GameState + unitId, output evento). Decision tree:
  - Slancio: 0 se in mischia, 0 se imp>=7, 1 se imp 5-6, 2 default.
  - Azione: attacco mischia → ranged → muovi → end.
  - Dadi atk: min(2, dadiAzione).
  - Difesa: parry/dodge in base a totale dadi atk + parry fixed + HP.
"""

from __future__ import annotations

from typing import Literal, Optional

from hex_tactics.core.events import (
    EventBidMovement,
    EventDeclareAttack,
    EventEndTurn,
    EventMove,
    EventReload,
    GameEvent,
)
from hex_tactics.core.hex import Axial, hexes_in_range
from hex_tactics.core.hex import base_distance, get_base_hexes
from hex_tactics.core.ranged import can_fire_ranged
from hex_tactics.core.state import GameState
from hex_tactics.data.armors import get_armor
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.unit import Unit


def find_closest_enemy(state: GameState, me: Unit) -> Optional[Unit]:
    """Nemico vivo più vicino (base_distance)."""
    best: Optional[Unit] = None
    best_dist = float("inf")
    for u in state.units.values():
        if u.faction == me.faction or not u.alive:
            continue
        d = base_distance(me.position, u.position)
        if d < best_dist:
            best_dist = d
            best = u
    return best


def _count_imp_reductions_for_equip(u: Unit, slot: Literal["weapon", "offhand", "armor"]) -> int:
    equip_id = u.weapon if slot == "weapon" else u.offhand if slot == "offhand" else u.armor
    if equip_id is None:
        return 0

    category: Optional[str]
    if slot == "armor":
        category = "armature"
    else:
        w = get_weapon(equip_id)
        sh = get_shield(equip_id)
        category = w.category if w is not None else (sh.category if sh is not None else None)

    count = 0
    for skill in u.skills:
        if skill.modifier != "-1impedimento":
            continue
        if skill.classe_oggetto is not None and skill.classe_oggetto != category:
            continue
        if skill.oggetto_specifico is not None and skill.oggetto_specifico != equip_id:
            continue
        count += skill.level  # ATTENZIONE: TS uses count++ (lv-blind) → vedi nota sotto
    return count


# NB DIVERGENZA POTENZIALE TS↔Py:
# Nel TS `countImpReductionsForEquip` fa `count++` (1 per skill matchante, ignorando level).
# Il TS è un bug minore (D-046 con level non viene rispettato in questo helper AI).
# Per parità totale, lo replichiamo come "count++" ignorando il level.


def _count_imp_reductions_for_equip_ts_compat(u: Unit, slot: Literal["weapon", "offhand", "armor"]) -> int:
    """Replica fedele del TS: count++ per ogni skill matchante (ignorando level).

    Bug minore TS noto, ma necessario per parità output. La logica "corretta" D-046
    usa skill.level → ma è applicata in get_impediment_total, non qui.
    """
    equip_id = u.weapon if slot == "weapon" else u.offhand if slot == "offhand" else u.armor
    if equip_id is None:
        return 0

    category: Optional[str]
    if slot == "armor":
        category = "armature"
    else:
        w = get_weapon(equip_id)
        sh = get_shield(equip_id)
        category = w.category if w is not None else (sh.category if sh is not None else None)

    count = 0
    for skill in u.skills:
        if skill.modifier != "-1impedimento":
            continue
        if skill.classe_oggetto is not None and skill.classe_oggetto != category:
            continue
        if skill.oggetto_specifico is not None and skill.oggetto_specifico != equip_id:
            continue
        count += 1  # ← TS bug-compat: ignora level
    return count


def ai_decide_slancio(state: GameState, unit_id: str) -> int:
    """Quanti dadi tirare per lo slancio del turno corrente."""
    u = state.units.get(unit_id)
    if u is None:
        return 0

    enemy = find_closest_enemy(state, u)
    if enemy is not None and u.weapon is not None:
        w = get_weapon(u.weapon)
        reach = w.range.reach if (w is not None and w.range is not None and w.range.reach is not None) else 1
        dist = base_distance(u.position, enemy.position)
        if dist <= reach:
            return 0

    # Calcolo impedimento "AI-style" — replica TS bug-compat
    imp = 0
    if u.weapon is not None:
        w = get_weapon(u.weapon)
        if w is not None:
            imp += max(0, w.impediment - _count_imp_reductions_for_equip_ts_compat(u, "weapon"))
    if u.offhand is not None:
        sh = get_shield(u.offhand)
        w = get_weapon(u.offhand)
        imp_piece = sh.impediment if sh is not None else (w.impediment if w is not None else 0)
        imp += max(0, imp_piece - _count_imp_reductions_for_equip_ts_compat(u, "offhand"))
    if u.armor is not None:
        a = get_armor(u.armor)
        if a is not None:
            imp += max(0, a.impediment - _count_imp_reductions_for_equip_ts_compat(u, "armor"))

    if imp >= 7:
        return 0
    if imp >= 5 and u.dadi_azione >= 2:
        return 1
    if u.dadi_azione >= 4:
        return 2
    if u.dadi_azione >= 2:
        return 1
    return 0


def find_best_move_toward(
    state: GameState, me: Unit, enemy: Unit, move_range: Optional[int] = None
) -> Optional[Axial]:
    """Mossa migliore per avvicinarsi al nemico, rispettando slancio + ostacoli."""
    range_ = move_range if move_range is not None else (me.slancio + 1)
    reachable = hexes_in_range(me.position, range_)

    blocked: set[tuple[int, int]] = set()
    for u in state.units.values():
        if u.id == me.id or not u.alive:
            continue
        for h in get_base_hexes(u.position):
            blocked.add((h.q, h.r))

    best: Optional[Axial] = None
    best_score = float("inf")
    for h in reachable:
        if (h.q, h.r) in blocked:
            continue
        # Basetta destinazione non sovrapposta
        overlap = False
        for bh in get_base_hexes(h):
            if (bh.q, bh.r) in blocked:
                overlap = True
                break
        if overlap:
            continue
        score = base_distance(h, enemy.position)
        if score < best_score:
            best_score = score
            best = h
    return best


def ai_decide_action(state: GameState, unit_id: str) -> GameEvent:
    """Decisione azione dopo START_TURN: attacco / movimento / end."""
    me = state.units.get(unit_id)
    if me is None:
        return EventEndTurn()
    enemy = find_closest_enemy(state, me)
    if enemy is None:
        return EventEndTurn()

    w = get_weapon(me.weapon) if me.weapon is not None else None
    dist = base_distance(me.position, enemy.position)
    can_act = (not me.action_taken_this_turn) and me.dadi_azione >= 1

    # V2 D-049: solo armi con `range.reach` esplicito sono melee-capable (le ranged-only
    # come archi/balestra hanno solo .distance, niente reach → niente attacco mischia).
    melee_capable = w is not None and w.range is not None and w.range.reach is not None
    # Threat in mischia: nemico melee con slancio>0 → ranged vietato.
    in_melee_threat = any(
        u.faction != me.faction and u.alive
        and base_distance(me.position, u.position) <= 1 and u.slancio > 0
        for u in state.units.values()
    )

    # Mischia: solo se l'arma è melee-capable
    if can_act and w is not None and melee_capable:
        melee_range = w.range.reach if w.range.reach is not None else 0
        if dist <= melee_range:
            stat = w.attack_modes[0].stat
            chosen = "forza" if stat == "either" else stat
            return EventDeclareAttack(
                attacker_id=me.id,
                target_id=enemy.id,
                weapon_id=w.id,
                attack_mode_idx=0,
                chosen_stat=chosen,  # type: ignore[arg-type]
                is_ranged=False,
            )

    # Ranged: bloccato se in melee threat
    if can_act and w is not None and not in_melee_threat:
        can = can_fire_ranged(me, enemy, w.id, state.units)
        if can.ok:
            stat = w.attack_modes[0].stat
            chosen = "agilità" if stat == "either" else stat
            return EventDeclareAttack(
                attacker_id=me.id,
                target_id=enemy.id,
                weapon_id=w.id,
                attack_mode_idx=0,
                chosen_stat=chosen,  # type: ignore[arg-type]
                is_ranged=True,
            )

    # Reload (balestra scarica) — anche in mischia (azione difensiva)
    if (
        can_act
        and w is not None
        and w.range is not None
        and w.range.reload is not None
        and not me.weapon_loaded
        and me.dadi_azione > 0
    ):
        dice = min(2, me.dadi_azione)
        return EventReload(unit_id=me.id, dice_n=dice)

    # Movimento
    free_hex = 1 if me.hex_moved_this_turn == 0 else 0
    move_range = me.slancio + free_hex
    if move_range >= 1:
        cand = find_best_move_toward(state, me, enemy, move_range)
        if cand is not None:
            return EventMove(unit_id=me.id, target_hex=cand)

    return EventEndTurn()


def ai_decide_attacker_dice(state: GameState, unit_id: str) -> int:
    """Dadi atk: min(2, dadiAzione), almeno 1."""
    me = state.units.get(unit_id)
    if me is None:
        return 1
    return max(1, min(2, me.dadi_azione))


def ai_decide_defense(state: GameState, defender_id: str) -> dict:
    """Decisione difesa: tipo + dadi. Ritorna dict TS-compat con keys camelCase."""
    d = state.units.get(defender_id)
    if d is None or d.dadi_azione <= 0:
        return {"defenseType": "none", "diceN": 0, "parryWith": None}

    parry_src: Optional[Literal["weapon", "offhand"]] = None
    parry_fixed = 0
    if d.offhand is not None:
        sh = get_shield(d.offhand)
        w_off = get_weapon(d.offhand)
        if sh is not None:
            parry_src = "offhand"
            parry_fixed = sh.parry.fixed
        elif w_off is not None and w_off.parry is not None:
            parry_src = "offhand"
            parry_fixed = w_off.parry.fixed
    if parry_src is None and d.weapon is not None:
        w = get_weapon(d.weapon)
        if w is not None and w.parry is not None:
            parry_src = "weapon"
            parry_fixed = w.parry.fixed

    dice_n = min(2, d.dadi_azione)

    if parry_src is None:
        return {"defenseType": "dodge", "diceN": dice_n, "parryWith": None}

    pa = state.pending_action
    if pa is not None and pa.attacker_id != defender_id:
        attacker = state.units.get(pa.attacker_id)
        weapon = get_weapon(attacker.weapon) if (attacker is not None and attacker.weapon) else None
        mode = (
            weapon.attack_modes[pa.attack_mode_idx]
            if (weapon is not None and 0 <= pa.attack_mode_idx < len(weapon.attack_modes))
            else None
        )
        if weapon is not None and mode is not None:
            attacker_dice_pg = pa.attacker_dice if pa.attacker_dice is not None else 2
            arm_dice = mode.dice_variable
            total_attacker_dice = attacker_dice_pg + arm_dice
            arm_fix = mode.fixed_bonus

            if d.hp <= d.hp_max * 0.35:
                return {"defenseType": "parry", "parryWith": parry_src, "diceN": dice_n}
            if total_attacker_dice <= 2 or arm_fix <= 2:
                return {"defenseType": "dodge", "diceN": dice_n, "parryWith": None}
            if parry_fixed >= 6:
                return {"defenseType": "parry", "parryWith": parry_src, "diceN": dice_n}
            return {"defenseType": "dodge", "diceN": dice_n, "parryWith": None}

    # Fallback: HP basso o no info
    if d.hp <= d.hp_max * 0.4:
        return {"defenseType": "parry", "parryWith": parry_src, "diceN": dice_n}
    if parry_src == "offhand" and d.offhand is not None and get_shield(d.offhand) is not None:
        return {"defenseType": "parry", "parryWith": "offhand", "diceN": dice_n}
    return {"defenseType": "dodge", "diceN": dice_n, "parryWith": None}


def ai_decide_bid_movement(state: GameState, unit_id: str) -> EventBidMovement:
    """Decide la puntata per asta movimento (meccanica A).

    Strategia: bidda ~slancio//4, con minimo 1 se slancio>0.
    Difensore: stesso (vuole minacciare ma non bruciare).
    """
    u = state.units.get(unit_id)
    if u is None or u.slancio <= 0:
        return EventBidMovement(amount=0)
    return EventBidMovement(amount=max(1, u.slancio // 4))


__all__ = [
    "ai_decide_slancio",
    "ai_decide_action",
    "ai_decide_attacker_dice",
    "ai_decide_defense",
    "ai_decide_bid_movement",
    "find_closest_enemy",
    "find_best_move_toward",
]

"""
Utility AI — port di src/ai/utilityAi.ts.

Per ogni mossa legale calcola un punteggio di utilità (input → score), sceglie max.
Deterministico e parametrizzabile (cambi i pesi → personalità diversa).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from hex_tactics.core.events import (
    EventBidMovement,
    EventChooseAttackerDice,
    EventChooseCarica,
    EventChooseDefense,
    EventDeclareAttack,
    EventEndTurn,
    EventMove,
    EventReload,
    EventStartTurn,
    EventToggleDefensive,
    GameEvent,
)
from hex_tactics.core.hex import base_distance
from hex_tactics.core.ranged import can_fire_ranged
from hex_tactics.core.state import GameState
from hex_tactics.core.stats import (
    count_flat_bonuses,
    get_impediment_total,
    make_attack_context,
    make_dodge_context,
    make_parry_context,
)
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon

from .basic_ai import find_closest_enemy
from .legal_moves import legal_moves


@dataclass(frozen=True)
class UtilityWeights:
    damage_dealt: float = 1.0
    damage_avoided: float = 0.8
    close_distance: float = 0.5
    self_hp: float = 0.3
    save_dice: float = 0.1
    wasted_move: float = -0.2


DEFAULT_WEIGHTS = UtilityWeights()


def utility_decide_move(
    state: GameState, unit_id: str, weights: UtilityWeights = DEFAULT_WEIGHTS
) -> GameEvent:
    """Sceglie la mossa con utility max. Tie-break: prima nella lista legalMoves."""
    moves = legal_moves(state, unit_id)
    if not moves:
        return EventEndTurn()

    best_move: GameEvent = moves[0]
    best_score = -math.inf
    for m in moves:
        s = score_move(state, unit_id, m, weights)
        if s > best_score:
            best_score = s
            best_move = m
    return best_move


def score_move(
    state: GameState, unit_id: str, move: GameEvent, w: UtilityWeights
) -> float:
    me = state.units.get(unit_id)
    if me is None:
        return -math.inf
    enemy = find_closest_enemy(state, me)

    t = move.type

    if t == "START_TURN":
        return _score_start_turn(state, me, enemy, move, w)  # type: ignore[arg-type]

    if t == "DECLARE_ATTACK":
        return _score_declare_attack(state, me, enemy, move, w)  # type: ignore[arg-type]

    if t == "CHOOSE_ATTACKER_DICE":
        return _score_choose_attacker_dice(me, move, w)  # type: ignore[arg-type]

    if t == "CHOOSE_DEFENSE":
        return _score_choose_defense(state, me, move, w)  # type: ignore[arg-type]

    if t == "MOVE":
        return _score_move(state, me, enemy, move, w)  # type: ignore[arg-type]

    if t == "RELOAD":
        return 3 - move.dice_n * w.save_dice  # type: ignore[attr-defined]

    if t == "END_TURN":
        return 0.1

    if t == "BID_MOVEMENT":
        return _score_bid_movement(state, me, enemy, move, w)  # type: ignore[arg-type]

    if t == "CHOOSE_CARICA":
        # Carica: bonus al damage, costa slancio. Strategia greedy: prendi max disponibile.
        return float(move.amount)  # type: ignore[attr-defined]

    if t == "TOGGLE_DEFENSIVE":
        # Stance: utile se nemico ha arma ranged + io non sto attaccando. Score moderato.
        if enemy is None:
            return 0.5
        from hex_tactics.data.weapons import get_weapon as _gw
        ew = _gw(enemy.weapon) if enemy.weapon else None
        is_ranged_enemy = (ew is not None and ew.range is not None
                          and (ew.range.distance is not None or ew.range.throw is not None))
        # Se nemico ranged e io già in mischia → no stance (preferisci attaccare)
        # Se nemico ranged e dist > reach → stance utile
        if is_ranged_enemy:
            from hex_tactics.core.hex import base_distance
            d = base_distance(me.position, enemy.position)
            return 1.5 if d > 2 else 0.3
        return 0.2  # vs melee, stance bassa utility

    return 0.0


def _score_bid_movement(state, me, enemy, move, w) -> float:
    """Score per BID_MOVEMENT.

    Strategia greedy:
      - Attaccante: bidda poco (1-2) se vuole muoversi senza spendere troppo,
        molto (slancio/2) se è cruciale (es. avvicinarsi per attaccare con HP basso)
      - Difensore: bidda quanto basta per "minacciare" l'attaccante (es. slancio/3),
        ma sempre meno di slancio attuale per non azzerare risorsa

    Per ora euristica semplice: bidda max(1, slancio/4) se ha senso.
    Se slancio=0, bidda 0 (forzato).

    Penalità per puntate molto alte (per non bruciare slancio inutilmente).
    """
    if me is None:
        return 0.0
    bid = move.amount
    sla = me.slancio

    if sla == 0:
        return 1.0 if bid == 0 else -10.0

    # Score: prefer bid ~slancio/4, penalty per estremi
    target = max(1, sla // 4)
    diff = abs(bid - target)
    # Score 1.0 per target, decrescente
    return 1.0 - 0.2 * diff


def _score_start_turn(state: GameState, me, enemy, move: EventStartTurn, w: UtilityWeights) -> float:
    transfer = move.impeto_to_slancio
    if enemy is None or me.weapon is None:
        return 1.0 if (move.slancio_dice == 2 and transfer == 0) else 0.0
    weapon = get_weapon(me.weapon)
    reach = (
        weapon.range.reach if (weapon is not None and weapon.range is not None and weapon.range.reach is not None) else 1
    )
    dist = base_distance(me.position, enemy.position)

    # Minaccia ranged?
    ranged_threat_damage = 0.0
    enemy_weapon = get_weapon(enemy.weapon) if enemy.weapon is not None else None
    if (
        enemy_weapon is not None
        and enemy_weapon.range is not None
        and (enemy_weapon.range.distance is not None or enemy_weapon.range.throw is not None)
    ):
        can = can_fire_ranged(enemy, me, enemy_weapon.id, state.units)
        if can.ok and can.los is not None:
            mode = enemy_weapon.attack_modes[0]
            enemy_dice_pg = 2
            expected_var = (enemy_dice_pg + mode.dice_variable) * 3.5
            ranged_div = enemy_weapon.range.ranged_divisor if enemy_weapon.range.ranged_divisor else 3
            expected_fixed = (
                2 + mode.fixed_bonus + can.los.visibility - (can.los.distance // ranged_div)
            )
            ranged_threat_damage = max(0.0, expected_var + expected_fixed)

    if ranged_threat_damage > 5:
        expected_slancio = 9.0 if move.slancio_dice == 2 else (5.5 if move.slancio_dice == 1 else 0.0)
        total_slancio_gain = expected_slancio + transfer
        return total_slancio_gain * 0.5 - transfer * 0.05

    my_init = me.impeto + me.slancio
    enemy_init = enemy.impeto + enemy.slancio
    init_deficit = enemy_init - my_init
    has_shield = me.offhand is not None and get_shield(me.offhand) is not None
    severe_deficit = init_deficit >= 10

    slancio_cost = move.slancio_dice
    budget_after = me.dadi_azione - slancio_cost
    low_budget = budget_after < 4
    budget_penalty = -1.5 if low_budget else 0.0

    if severe_deficit and not has_shield:
        if move.slancio_dice == 2:
            useful_transfer = min(transfer, max(0, init_deficit - 5))
            return 2.5 + useful_transfer * 0.15 + budget_penalty
        return (1.0 if move.slancio_dice == 1 else 0.0) + budget_penalty

    if transfer > 0:
        return -2.0
    if dist <= reach:
        return 2.0 if move.slancio_dice == 0 else (-1.0 + budget_penalty)
    return (2.0 if move.slancio_dice == 2 else (1.0 if move.slancio_dice == 1 else 0.0)) + budget_penalty


def _score_declare_attack(state: GameState, me, enemy, move: EventDeclareAttack, w: UtilityWeights) -> float:
    if enemy is None:
        return -1.0
    target = state.units.get(move.target_id)
    if target is None:
        return -1.0
    weapon = get_weapon(move.weapon_id)
    if weapon is None:
        return -1.0
    mode = weapon.attack_modes[move.attack_mode_idx]

    expected_attacker_var = (2 + mode.dice_variable) * 3.5
    expected_fixed = 2 + mode.fixed_bonus

    # D-047: dual-stat → +bonus altro mode con 2d
    if mode.stat != "either" and len(weapon.attack_modes) >= 2:
        for i, m_other in enumerate(weapon.attack_modes):
            if i == move.attack_mode_idx:
                continue
            if m_other.stat == "either":
                continue
            if m_other.stat != mode.stat:
                expected_fixed += m_other.fixed_bonus
                break

    expected_dmg = expected_attacker_var + expected_fixed
    finish_bonus = 5.0 if target.hp <= expected_dmg else 0.0
    ranged_penalty = (
        -1.0 if (move.is_ranged and base_distance(me.position, target.position) <= 2) else 0.0
    )
    return w.damage_dealt * (expected_dmg / 5) + finish_bonus + ranged_penalty


def _score_choose_attacker_dice(me, move: EventChooseAttackerDice, w: UtilityWeights) -> float:
    weapon = get_weapon(me.weapon) if me.weapon is not None else None
    is_dual_stat = (
        weapon is not None
        and len(weapon.attack_modes) >= 2
        and any(m.stat == "forza" for m in weapon.attack_modes)
        and any(m.stat == "agilità" for m in weapon.attack_modes)
    )
    budget_after = me.dadi_azione - move.dice_n
    budget_penalty = -1.5 if budget_after < 2 else 0.0

    if is_dual_stat:
        return (
            (2.5 - w.save_dice * 1) if move.dice_n == 2 else (0.8 - w.save_dice * 0.5)
        ) + budget_penalty
    return (
        (1.5 - w.save_dice * 1) if move.dice_n == 2 else (1.0 - w.save_dice * 0.5)
    ) + budget_penalty


def _score_choose_defense(state: GameState, me, move: EventChooseDefense, w: UtilityWeights) -> float:
    pa = state.pending_action
    if pa is None:
        return 0.0
    attacker = state.units.get(pa.attacker_id)
    if attacker is None or attacker.weapon is None:
        return -2.0 if move.defense_type == "none" else 0.0
    w_att = get_weapon(attacker.weapon)
    if w_att is None or pa.attack_mode_idx >= len(w_att.attack_modes):
        return -2.0 if move.defense_type == "none" else 0.0
    mode = w_att.attack_modes[pa.attack_mode_idx]

    attacker_dice_pg = pa.attacker_dice if pa.attacker_dice is not None else 2
    arm_dice = mode.dice_variable
    arm_fix = mode.fixed_bonus

    attacker_stat = "forza" if mode.stat == "either" else mode.stat
    ctx_attack = make_attack_context(w_att.id, w_att.category, attacker_stat)  # type: ignore[arg-type]
    att_flat_skill = count_flat_bonuses(attacker.skills, ctx_attack)
    att_imp = get_impediment_total(attacker)
    expected_attacker_var = (attacker_dice_pg + arm_dice) * 3.5
    expected_attacker_fixed = 2 + arm_fix + att_flat_skill - att_imp
    expected_attacker_total = expected_attacker_var + expected_attacker_fixed

    my_imp = get_impediment_total(me)
    base_fix = 2
    SLANCIO_COST_FACTOR = 0.3

    if move.defense_type == "dodge":
        ctx_dodge = make_dodge_context()
        dodge_flat_skill = count_flat_bonuses(me.skills, ctx_dodge)
        dodge_fixed = base_fix + dodge_flat_skill - my_imp
        expected_dodge_total = move.dice_n * 3.5 + dodge_fixed
        variable_margin = expected_dodge_total - expected_attacker_var

        if variable_margin >= 0:
            fixed_avoided_bonus = max(0.0, expected_attacker_fixed) * 0.3
            return (
                w.damage_avoided * (variable_margin + fixed_avoided_bonus)
                - move.dice_n * w.save_dice * 0.5
            )
        expected_damage_subita = expected_attacker_total - expected_dodge_total
        slancio_cost = expected_damage_subita * SLANCIO_COST_FACTOR
        return (
            -w.damage_avoided * (expected_damage_subita + slancio_cost)
            - move.dice_n * w.save_dice * 0.5
        )

    if move.defense_type == "parry":
        item_id = me.weapon if move.parry_with == "weapon" else me.offhand
        if item_id is None:
            return -1.0
        w_def = get_weapon(item_id)
        sh_def = get_shield(item_id)
        # NB: replico il `??` JS (nullish), NON `or` Python (falsy).
        # Per la mazza parry.dice=0: TS usa 0, Py-or userebbe fallback. Errato.
        if w_def is not None and w_def.parry is not None:
            parry_dice = w_def.parry.dice
            parry_fixed = w_def.parry.fixed
        elif sh_def is not None:
            parry_dice = sh_def.parry.dice
            parry_fixed = sh_def.parry.fixed
        else:
            parry_dice = 0
            parry_fixed = 0
        cat = (
            w_def.category if w_def is not None else (sh_def.category if sh_def is not None else None)
        )
        if cat is None:
            return -1.0
        ctx_parry = make_parry_context(item_id, cat)  # type: ignore[arg-type]
        parry_flat_skill = count_flat_bonuses(me.skills, ctx_parry)
        expected_parry_total = (
            (move.dice_n + parry_dice) * 3.5 + base_fix + parry_fixed + parry_flat_skill - my_imp
        )
        total_margin = expected_parry_total - expected_attacker_total
        expected_damage_subita = 0.0 if total_margin >= 0 else -total_margin
        slancio_cost = expected_damage_subita * SLANCIO_COST_FACTOR
        hp_bonus = 0.5 if (me.hp / me.hp_max < 0.4) else 0.0
        return (
            -w.damage_avoided * (expected_damage_subita + slancio_cost)
            - move.dice_n * w.save_dice * 0.5
            + hp_bonus
        )

    # 'none'
    none_dmg = max(0.0, expected_attacker_total)
    none_slancio = none_dmg * SLANCIO_COST_FACTOR
    return -w.damage_avoided * (none_dmg + none_slancio) - 1.0


def _score_move(state: GameState, me, enemy, move: EventMove, w: UtilityWeights) -> float:
    if enemy is None:
        return -1.0
    dist_now = base_distance(me.position, enemy.position)
    dist_after = base_distance(move.target_hex, enemy.position)

    my_weapon = get_weapon(me.weapon) if me.weapon is not None else None
    has_ranged = my_weapon is not None and my_weapon.range is not None and (
        my_weapon.range.distance is not None or my_weapon.range.throw is not None
    )
    melee_reach = (
        my_weapon.range.reach if (my_weapon is not None and my_weapon.range is not None and my_weapon.range.reach is not None) else 1
    )
    ranged_max = 0
    if my_weapon is not None and my_weapon.range is not None:
        ranged_max = my_weapon.range.distance if my_weapon.range.distance is not None else (
            my_weapon.range.throw if my_weapon.range.throw is not None else 0
        )
    is_ranged_only = (
        has_ranged
        and my_weapon is not None
        and my_weapon.attack_modes[0].dice_variable >= 1
        and ranged_max >= 3
    )

    if is_ranged_only:
        sweet_spot_min = 2
        sweet_spot_max = max(2, ranged_max)
        if dist_after < sweet_spot_min:
            kite_score = -1.5
        elif dist_after > sweet_spot_max:
            kite_score = -1.0
        else:
            kite_score = 1.0
        if dist_now <= melee_reach and dist_after > dist_now:
            kite_score += 1.5
        return kite_score

    closer = dist_now - dist_after
    aggression_bonus = (
        2.0 if (not me.action_taken_this_turn and dist_after <= 1) else 0.0
    )
    return w.close_distance * closer + aggression_bonus


__all__ = ["UtilityWeights", "DEFAULT_WEIGHTS", "utility_decide_move", "score_move"]

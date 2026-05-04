"""
Generatore mosse legali — port di src/ai/legalMoves.ts.

Discretizzazione intelligente per controllare il branching (per Utility/MCTS):
- MOVE: top 3 hex verso nemico + top 2 hex più lontani (ritirata) — non TUTTI raggiungibili
- DECLARE_ATTACK: per ogni mode dell'arma; un solo target (nemico più vicino)
- CHOOSE_DEFENSE: {none, dodge1, dodge2, parry1×slot, parry2×slot}
"""

from __future__ import annotations

from typing import List

from hex_tactics.core.events import (
    EventBidMovement,
    EventChooseAttackerDice,
    EventChooseCarica,
    EventChooseDefense,
    EventDeclareAttack,
    EventEndTurn,
    EventMove,
    EventReload,
    EventResolveCombat,
    EventStartTurn,
    EventToggleDefensive,
    GameEvent,
)
from hex_tactics.core.hex import Axial, hexes_in_range
from hex_tactics.core.hex import base_distance, get_base_hexes

# Cython accelerator per MOVE filtering (~10× su inner loop)
try:
    from hex_tactics.core._hex_fast import (
        filter_move_candidates as _fmc_c,
        hexes_in_range_qr as _hir_qr,
    )
    _HAS_CYTHON_FILTER = True
except ImportError:
    _HAS_CYTHON_FILTER = False
from hex_tactics.core.ranged import can_fire_ranged
from hex_tactics.core.state import GameState
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.unit import Unit

from .basic_ai import find_closest_enemy


def legal_moves(state: GameState, unit_id: str) -> List[GameEvent]:
    """Mosse legali per la phase corrente."""
    phase = state.phase
    unit = state.units.get(unit_id)
    if unit is None or not unit.alive:
        return []

    if phase == "turn-start":
        return _legal_slancio_moves(state, unit_id)
    if phase == "choosing-action":
        return _legal_action_moves(state, unit)
    if phase == "declaring-attack":
        return _legal_attacker_dice_moves(state, unit)
    if phase == "awaiting-defense":
        return _legal_defense_moves(state, unit)
    if phase == "resolving":
        return [EventResolveCombat()]
    if phase in ("awaiting-attacker-bid", "awaiting-defender-bid"):
        return _legal_bid_moves(state, unit)
    if phase == "awaiting-carica":
        return _legal_carica_moves(state, unit)
    return []


def _legal_slancio_moves(state: GameState, unit_id: str) -> List[GameEvent]:
    base: List[GameEvent] = [
        EventStartTurn(slancio_dice=0),
        EventStartTurn(slancio_dice=1),
        EventStartTurn(slancio_dice=2),
    ]
    me = state.units.get(unit_id)
    if me is None or me.impeto < 3:
        return base
    transfers = [t for t in (3, 6, 9) if t <= me.impeto]
    for t in transfers:
        base.append(EventStartTurn(slancio_dice=2, impeto_to_slancio=t))
    return base


# Memoize cache for _legal_action_moves output (90% del tempo CFR)
# Key: tuple di unit + enemy state. Naive eviction al cap.
_LAM_CACHE: dict = {}
_LAM_CACHE_MAX = 100000


def _legal_action_moves(state: GameState, unit: Unit) -> List[GameEvent]:
    enemy = find_closest_enemy(state, unit)
    # Build cache key
    others_blocked = tuple(
        (u.id, u.position) for u in state.units.values()
        if u.id != unit.id and u.alive
    )
    cache_key = (
        unit.id,
        unit.position, unit.slancio, unit.hex_moved_this_turn,
        unit.action_taken_this_turn, unit.dadi_azione,
        unit.weapon_loaded, unit.defensive_stance, unit.defensive_toggled_this_turn,
        unit.weapon, unit.offhand,
        enemy.id if enemy is not None else None,
        enemy.position if enemy is not None else None,
        enemy.slancio if enemy is not None else None,
        enemy.alive if enemy is not None else None,
        others_blocked,
    )
    cached = _LAM_CACHE.get(cache_key)
    if cached is not None:
        return cached

    moves: List[GameEvent] = []
    weapon = get_weapon(unit.weapon) if unit.weapon is not None else None

    # ATTACCO (V2 D-049)
    if enemy is not None and weapon is not None and not unit.action_taken_this_turn and unit.dadi_azione >= 1:
        dist = base_distance(unit.position, enemy.position)
        # V2 D-049: solo armi con reach esplicito sono melee-capable
        melee_capable = weapon.range is not None and weapon.range.reach is not None
        melee_range = weapon.range.reach if (weapon.range is not None and weapon.range.reach is not None) else 0
        # Threat in mischia: nemico (anche altro) melee con slancio>0 → ranged vietato
        in_melee_threat = any(
            u.faction != unit.faction and u.alive
            and base_distance(unit.position, u.position) <= 1 and u.slancio > 0
            for u in state.units.values()
        )
        if melee_capable and dist <= melee_range:
            for mi, mode in enumerate(weapon.attack_modes):
                stat = "forza" if mode.stat == "either" else mode.stat
                moves.append(
                    EventDeclareAttack(
                        attacker_id=unit.id,
                        target_id=enemy.id,
                        weapon_id=weapon.id,
                        attack_mode_idx=mi,
                        chosen_stat=stat,  # type: ignore[arg-type]
                        is_ranged=False,
                    )
                )
        # Ranged: bloccato se in melee threat
        if not in_melee_threat:
            can = can_fire_ranged(unit, enemy, weapon.id, state.units)
            if can.ok:
                for mi, mode in enumerate(weapon.attack_modes):
                    stat = "agilità" if mode.stat == "either" else mode.stat
                    moves.append(
                        EventDeclareAttack(
                            attacker_id=unit.id,
                            target_id=enemy.id,
                            weapon_id=weapon.id,
                            attack_mode_idx=mi,
                            chosen_stat=stat,  # type: ignore[arg-type]
                            is_ranged=True,
                        )
                    )

    # D-051: ATTACCO OFFHAND (arma o scudo) per ogni nemico melee
    if (
        unit.offhand
        and not unit.action_taken_this_turn
        and unit.dadi_azione >= 1
        and enemy is not None
    ):
        from hex_tactics.data.shields import get_shield
        off_w = get_weapon(unit.offhand)
        off_s = get_shield(unit.offhand)
        dist = base_distance(unit.position, enemy.position)
        if off_w is not None and off_w.range is not None and off_w.range.reach is not None:
            melee_range_off = off_w.range.reach
            if dist <= melee_range_off:
                for mi, mode in enumerate(off_w.attack_modes):
                    stat = "forza" if mode.stat == "either" else mode.stat
                    moves.append(
                        EventDeclareAttack(
                            attacker_id=unit.id,
                            target_id=enemy.id,
                            weapon_id=off_w.id,  # weapon_id = offhand id
                            attack_mode_idx=mi,
                            chosen_stat=stat,  # type: ignore[arg-type]
                            is_ranged=False,
                        )
                    )
        elif off_s is not None and dist <= 1 and not unit.defensive_stance:
            # Bludgeon con scudo: 1 modo, no dadi arma. NO se in stance.
            moves.append(
                EventDeclareAttack(
                    attacker_id=unit.id,
                    target_id=enemy.id,
                    weapon_id=off_s.id,  # shield id (reducer detect e usa composeShieldAttackRoll)
                    attack_mode_idx=0,
                    chosen_stat=None,
                    is_ranged=False,
                )
            )

    # RELOAD
    if (
        weapon is not None
        and weapon.range is not None
        and weapon.range.reload is not None
        and not unit.weapon_loaded
        and not unit.action_taken_this_turn
        and unit.dadi_azione >= 1
    ):
        moves.append(EventReload(unit_id=unit.id, dice_n=1))
        if unit.dadi_azione >= 2:
            moves.append(EventReload(unit_id=unit.id, dice_n=2))

    # MOVE — discretizzazione
    free_hex = 1 if unit.hex_moved_this_turn == 0 else 0
    move_range = unit.slancio + free_hex
    if move_range >= 1 and enemy is not None:
        unit_pos_q = unit.position.q
        unit_pos_r = unit.position.r
        enemy_pos = enemy.position
        # blocked come set di (q,r) tuple
        blocked: set[tuple[int, int]] = set()
        for u in state.units.values():
            if u.id == unit.id or not u.alive:
                continue
            for h in get_base_hexes(u.position):
                blocked.add((h.q, h.r))
        # legal_centers come set di (q, r) tuple per Cython
        legal_centers_qr = {(h.q, h.r) for h in state.board._legal_base_centers}

        if _HAS_CYTHON_FILTER:
            # Cython hot path: candidates as (q,r) tuple list, filter+distance in C
            candidates_qr = _hir_qr(unit_pos_q, unit_pos_r, move_range)
            filtered = _fmc_c(
                candidates_qr,
                unit_pos_q, unit_pos_r,
                enemy_pos.q, enemy_pos.r,
                blocked,
                legal_centers_qr,
            )
            # filtered = list of (q, r, base_dist) tuples
            valid = [(Axial(q=q, r=r), d) for (q, r, d) in filtered]
        else:
            candidates = hexes_in_range(unit.position, move_range)
            valid: list[tuple[Axial, int]] = []
            valid_append = valid.append
            for h in candidates:
                if h.q == unit_pos_q and h.r == unit_pos_r:
                    continue
                if (h.q, h.r) not in legal_centers_qr:
                    continue
                base_target = get_base_hexes(h)
                if any((bh.q, bh.r) in blocked for bh in base_target):
                    continue
                valid_append((h, base_distance(h, enemy_pos)))
        valid.sort(key=lambda x: x[1])
        # Top 3 vicini + top 2 più lontani (ritirata) — esclusi duplicati con top 3
        closer = valid[:3]
        farther_candidates = valid[-2:]
        farther = [x for x in farther_candidates if x not in closer]
        for h, _ in [*closer, *farther]:
            moves.append(EventMove(unit_id=unit.id, target_hex=h))

    # Fase 1: TOGGLE_DEFENSIVE (azione gratuita, max 1/turno, solo con scudo offhand)
    if not unit.defensive_toggled_this_turn and unit.offhand is not None:
        from hex_tactics.data.shields import get_shield as _gs
        if _gs(unit.offhand) is not None:
            moves.append(EventToggleDefensive(unit_id=unit.id))

    # END_TURN sempre
    moves.append(EventEndTurn())

    # Cache result (naive eviction al cap)
    if len(_LAM_CACHE) >= _LAM_CACHE_MAX:
        _LAM_CACHE.clear()
    _LAM_CACHE[cache_key] = moves
    return moves


def _legal_attacker_dice_moves(state: GameState, unit: Unit) -> List[GameEvent]:
    moves: List[GameEvent] = []
    if unit.dadi_azione >= 1:
        moves.append(EventChooseAttackerDice(dice_n=1))
    if unit.dadi_azione >= 2:
        moves.append(EventChooseAttackerDice(dice_n=2))
    return moves


def _legal_defense_moves(state: GameState, unit: Unit) -> List[GameEvent]:
    moves: List[GameEvent] = [EventChooseDefense(defense_type="none", dice_n=0)]

    # Dodge
    for n in range(1, min(2, unit.dadi_azione) + 1):
        moves.append(EventChooseDefense(defense_type="dodge", dice_n=n))

    # Parry per slot
    def _try_parry(slot: str) -> None:
        eid = unit.weapon if slot == "weapon" else unit.offhand
        if eid is None:
            return
        w = get_weapon(eid)
        sh = get_shield(eid)
        can_parry = (w is not None and w.parry is not None) or sh is not None
        if not can_parry:
            return
        for n in range(1, min(2, unit.dadi_azione) + 1):
            moves.append(EventChooseDefense(defense_type="parry", parry_with=slot, dice_n=n))  # type: ignore[arg-type]

    _try_parry("weapon")
    _try_parry("offhand")

    return moves


def _legal_carica_moves(state, unit) -> List[GameEvent]:
    """Carica options. Discretizzo a {0, 1, 3, max_disponibile} per limit branching."""
    if state.pending_action is None:
        return [EventChooseCarica(amount=0)]
    pa = state.pending_action
    target = state.units.get(pa.target_id)
    if target is None:
        return [EventChooseCarica(amount=0)]
    from hex_tactics.core.hex import base_distance
    delta = 0
    if unit.position_at_turn_start is not None:
        d_start = base_distance(unit.position_at_turn_start, target.position)
        d_now = base_distance(unit.position, target.position)
        delta = max(0, d_start - d_now)
    max_carica = max(0, min(delta, unit.slancio))
    candidates = sorted(set([0, 1, 3, max_carica]))
    candidates = [c for c in candidates if 0 <= c <= max_carica]
    return [EventChooseCarica(amount=c) for c in candidates]


def _legal_bid_moves(state, unit) -> List[GameEvent]:
    """Bid options: discretizzo per limitare branching action space.

    Range possibile: 0..unit.slancio. Discretizziamo a {0, 1, 2, 4, slancio_max}
    rimovendo duplicati e fuori range. Max 5 opzioni.
    """
    max_sla = max(0, unit.slancio)
    candidates = sorted(set([0, 1, 2, 4, max_sla]))
    # Rimuovi duplicati e fuori range
    candidates = [c for c in candidates if 0 <= c <= max_sla]
    return [EventBidMovement(amount=c) for c in candidates]


__all__ = ["legal_moves"]

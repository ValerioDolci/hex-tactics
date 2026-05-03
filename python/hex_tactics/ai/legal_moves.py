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


def _legal_action_moves(state: GameState, unit: Unit) -> List[GameEvent]:
    moves: List[GameEvent] = []
    enemy = find_closest_enemy(state, unit)
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
        candidates = hexes_in_range(unit.position, move_range)
        blocked: set[tuple[int, int]] = set()
        for u in state.units.values():
            if u.id == unit.id or not u.alive:
                continue
            for h in get_base_hexes(u.position):
                blocked.add((h.q, h.r))

        valid: list[tuple[Axial, int]] = []
        for h in candidates:
            if h.q == unit.position.q and h.r == unit.position.r:
                continue
            overlap = False
            for bh in get_base_hexes(h):
                if (bh.q, bh.r) in blocked:
                    overlap = True
                    break
            if overlap:
                continue
            valid.append((h, base_distance(h, enemy.position)))
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

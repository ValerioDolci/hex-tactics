"""
GameState — port di src/core/state.ts.

Pattern: stato + reducer puro (D-003).
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

from hex_tactics.entities.unit import Unit

from .rng import create_rng
from .turn import apply_initial_slancio


GamePhase = Literal[
    "turn-start",
    "choosing-action",
    "declaring-attack",
    "awaiting-defense",
    "resolving",
    "awaiting-attacker-bid",
    "awaiting-defender-bid",
    "awaiting-carica",  # Fase 1: scelta bonus carica tra DECLARE_ATTACK e CHOOSE_ATTACKER_DICE
    "turn-end",
    "round-end",
    "game-over",
]


@dataclass(frozen=True)
class LogEntry:
    round: int
    turn_unit_id: Optional[str]
    message: str


@dataclass
class PendingAction:
    """Dati accumulati durante una sequenza attacco/difesa."""

    attacker_id: str
    target_id: str
    weapon_id: str
    attack_mode_idx: int
    is_ranged: bool
    chosen_stat: Optional[str] = None  # 'forza' | 'agilità' | 'volontà' | None
    attacker_dice: Optional[int] = None
    defense_type: Optional[Literal["parry", "dodge", "none"]] = None
    defense_dice_n: Optional[int] = None
    defense_parry_with: Optional[Literal["weapon", "offhand"]] = None
    # Fase 1: bonus carica scelto in awaiting-carica
    carica_amount: int = 0


@dataclass
class MoveInProgress:
    """Tracking del movimento multi-step con possibili aste di controllo zona.

    Meccanica A: il MOVE è decomposto in singoli hex. Per ogni hex, se è in
    zona-reach di un difensore vivo con arma da mischia e slancio>0, si apre
    un'asta nascosta di slancio. Solo se atk_bid >= def_bid, il movimento procede.
    """

    unit_id: str
    path: list  # List[Axial] da pos partenza a pos finale (escluso start)
    current_idx: int  # quale hex stiamo per attraversare prossimo (0..len(path))
    free_hex_used: bool  # 1° hex gratis applicato?
    # Slot per la fase di bid corrente
    contested_hex_idx: Optional[int] = None
    defender_id: Optional[str] = None
    attacker_bid: Optional[int] = None
    defender_bid: Optional[int] = None


@dataclass
class Board:
    cols: int
    rows: int

    def __post_init__(self):
        # Pre-compute set di tutti gli axial validi nel board (one-shot al boot).
        from hex_tactics.core.hex import (
            Axial, offset_to_axial, Offset, get_base_hexes,
        )
        self._valid_hexes = frozenset(
            offset_to_axial(Offset(col=c, row=r))
            for r in range(self.rows)
            for c in range(self.cols)
        )
        # Pre-compute set di axial CENTRI tali che TUTTI i 7 hex della loro
        # basetta sono in board. Permette il check "unit may stand here as
        # base-center" in O(1) invece di 7 lookup is_within_bounds.
        self._legal_base_centers = frozenset(
            h for h in self._valid_hexes
            if all(bh in self._valid_hexes for bh in get_base_hexes(h))
        )

    def is_within_bounds(self, hex_pos) -> bool:
        """True se l'esagono (Axial) è dentro la board. O(1) set lookup."""
        return hex_pos in self._valid_hexes

    def is_legal_base_center(self, hex_pos) -> bool:
        """True se i 7 hex della basetta centrata in `hex_pos` sono tutti in board.

        O(1) set lookup. Pre-computed.
        """
        return hex_pos in self._legal_base_centers


@dataclass
class LastResolution:
    """Risultato dell'ultimo RESOLVE_COMBAT, per UI animazione dadi."""
    attacker_name: str
    attacker_dice: List[int]
    attacker_fixed: int
    defender_name: str
    defender_dice: List[int]
    defender_fixed: int
    is_ranged: bool


@dataclass
class GameState:
    round: int
    turn_order: List[str]
    current_turn_idx: int
    units: Dict[str, Unit]
    board: Board
    phase: GamePhase
    log: List[LogEntry]
    rng_seed: int  # state corrente RNG (per snapshot/replay)
    pending_action: Optional[PendingAction] = None
    move_in_progress: Optional[MoveInProgress] = None
    winner: Optional[Literal["A", "B", "draw"]] = None
    last_resolution: Optional[LastResolution] = None


def create_initial_state(
    units: List[Unit], board: Board, rng_seed: int
) -> GameState:
    """Factory — D-045: ogni unit alive tira slancio iniziale (2d max, no transfer)."""
    rng = create_rng(rng_seed)
    units_map: Dict[str, Unit] = {}
    for u in units:
        units_map[u.id] = apply_initial_slancio(u, rng) if u.alive else u

    return GameState(
        round=0,
        turn_order=[],
        current_turn_idx=0,
        units=units_map,
        board=board,
        phase="turn-start",
        log=[],
        rng_seed=rng.get_state(),
        pending_action=None,
        winner=None,
    )


def update_unit(state: GameState, unit_id: str, **patch) -> GameState:
    """Restituisce nuovo state con un'unità aggiornata.

    Replica `updateUnit` TS (immutabilità via shallow clone). Patch usa kw args
    con i nomi snake_case dei campi Unit.
    """
    current = state.units.get(unit_id)
    if current is None:
        return state
    new_unit = copy.copy(current)
    for k, v in patch.items():
        setattr(new_unit, k, v)
    new_units = dict(state.units)
    new_units[unit_id] = new_unit
    return _state_with(state, units=new_units)


def append_log(state: GameState, message: str) -> GameState:
    """Aggiunge entry al log."""
    turn_unit_id = (
        state.turn_order[state.current_turn_idx]
        if state.turn_order and 0 <= state.current_turn_idx < len(state.turn_order)
        else None
    )
    entry = LogEntry(round=state.round, turn_unit_id=turn_unit_id, message=message)
    new_log = [*state.log, entry]
    return _state_with(state, log=new_log)


def _state_with(state: GameState, **changes) -> GameState:
    """Replica del TS spread `{...state, k: v}`."""
    new = copy.copy(state)
    for k, v in changes.items():
        setattr(new, k, v)
    return new


__all__ = [
    "GamePhase",
    "LogEntry",
    "PendingAction",
    "MoveInProgress",
    "Board",
    "GameState",
    "create_initial_state",
    "update_unit",
    "append_log",
]

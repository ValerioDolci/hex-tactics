"""
Logica del round — port di src/core/round.ts.

- compute_turn_order: impeto desc, parità slancio desc, parità casuale (RNG seeded)
- check_game_over: 'A' | 'B' | 'draw' | None
"""

from __future__ import annotations

from typing import List, Literal, Mapping, Optional

from hex_tactics.entities.unit import Unit

from .rng import Rng
from .turn import can_play


def compute_turn_order(units: Mapping[str, Unit], rng: Rng) -> List[str]:
    """Ordine turni del round.

    Regola (CLAUDE.md §Round):
      1. impeto desc
      2. parità → slancio desc
      3. parità → casuale (rng.next() come tiebreak)

    Solo unità vive. RNG consumato 1× per ogni unità viva (parità con TS).
    """
    alive = [u for u in units.values() if can_play(u)]
    indexed = [(u, i, rng.next()) for i, u in enumerate(alive)]

    # TS: sort comparator (impeto desc, slancio desc, rand asc)
    indexed.sort(key=lambda t: (-t[0].impeto, -t[0].slancio, t[2]))
    return [t[0].id for t in indexed]


GameOverResult = Literal["A", "B", "draw"]


def check_game_over(units: Mapping[str, Unit]) -> Optional[GameOverResult]:
    """Game over se una sola fazione è ancora viva. None = continua.

    A=B=0 → 'draw'; A=0 → 'B'; B=0 → 'A'.
    """
    alive_a = 0
    alive_b = 0
    for u in units.values():
        if can_play(u):
            if u.faction == "A":
                alive_a += 1
            else:
                alive_b += 1
    if alive_a == 0 and alive_b == 0:
        return "draw"
    if alive_a == 0:
        return "B"
    if alive_b == 0:
        return "A"
    return None


__all__ = ["compute_turn_order", "check_game_over"]

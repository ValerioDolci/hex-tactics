"""
Tiri di gioco — port di src/core/dice.ts.

Architettura: parte VARIABILE (dadi) + parte FISSA (bonus).
- Schivata sottrae solo dalla VARIABILE dell'attaccante
- Parata sottrae dal totale (variabile + fissa)

Questa separazione è strutturale (vedi CLAUDE.md "Architettura tiri").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .rng import Rng


@dataclass
class Roll:
    """Tiro di gioco con le due componenti separate.

    V2:
      - `variable`: dadi grezzi
      - `variable_mod`: modificatore alla somma variabile (es. -impedimento). Floor 0.
      - `fixed`: bonus/malus indipendenti dal tiro stocastico (no floor).

    Mutabile per allineamento con TS (combat compone in-place).
    """

    variable: List[int] = field(default_factory=list)
    fixed: int = 0
    variable_mod: int = 0


def empty_roll() -> Roll:
    return Roll(variable=[], fixed=0, variable_mod=0)


def variable_raw_sum(r: Roll) -> int:
    """Somma raw dei dadi (senza modificatore)."""
    return sum(r.variable)


def variable_sum(r: Roll) -> int:
    """Somma variabile effettiva (raw + variable_mod, floor 0)."""
    return max(0, sum(r.variable) + r.variable_mod)


def variable_neg_residue(r: Roll) -> int:
    """|negativo| del residuo variabile. Da convertire in slancio loss sul PG."""
    return max(0, -(sum(r.variable) + r.variable_mod))


def roll_total(r: Roll) -> int:
    """Totale (variabile floored + fissa)."""
    return variable_sum(r) + r.fixed


def make_roll(rng: Rng, dice: int, fixed: int) -> Roll:
    """Tira N d6 (clampato ≥0) e restituisce un Roll."""
    clamped = max(0, dice)
    return Roll(variable=rng.roll_d6s(clamped), fixed=fixed, variable_mod=0)


def combine_rolls(a: Roll, b: Roll) -> Roll:
    """Combina due roll sommando dadi, fissi, variable_mod."""
    return Roll(
        variable=[*a.variable, *b.variable],
        fixed=a.fixed + b.fixed,
        variable_mod=a.variable_mod + b.variable_mod,
    )


def add_fixed(r: Roll, delta: int) -> Roll:
    return Roll(variable=list(r.variable), fixed=r.fixed + delta, variable_mod=r.variable_mod)


def add_variable_mod(r: Roll, delta: int) -> Roll:
    """V2: aggiunge un modificatore alla parte variabile (es. -imp)."""
    return Roll(variable=list(r.variable), fixed=r.fixed, variable_mod=r.variable_mod + delta)


def subtract_from_variable(attacker_roll: Roll, defender_roll: Roll) -> int:
    """Per la schivata: variabile_atk (post-mod, floored) - totale_def."""
    return variable_sum(attacker_roll) - roll_total(defender_roll)


def subtract_from_total(attacker_roll: Roll, defender_roll: Roll) -> int:
    """Per la parata: totale_atk (post-floor variabile) - totale_def."""
    return roll_total(attacker_roll) - roll_total(defender_roll)


__all__ = [
    "Roll",
    "empty_roll",
    "variable_raw_sum",
    "variable_sum",
    "variable_neg_residue",
    "roll_total",
    "make_roll",
    "combine_rolls",
    "add_fixed",
    "add_variable_mod",
    "subtract_from_variable",
    "subtract_from_total",
]

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

    Mutabile per allineamento con TS (combat compone in-place via `combined.fixed += ...`).
    """

    variable: List[int] = field(default_factory=list)
    fixed: int = 0


def empty_roll() -> Roll:
    return Roll(variable=[], fixed=0)


def variable_sum(r: Roll) -> int:
    return sum(r.variable)


def roll_total(r: Roll) -> int:
    return variable_sum(r) + r.fixed


def make_roll(rng: Rng, dice: int, fixed: int) -> Roll:
    """Tira N d6 (clampato ≥0) e restituisce un Roll con quei dadi e fissa = `fixed`."""
    clamped = max(0, dice)
    return Roll(variable=rng.roll_d6s(clamped), fixed=fixed)


def combine_rolls(a: Roll, b: Roll) -> Roll:
    """Combina due roll sommando dadi e fissi (utile per attacco PG + arma)."""
    return Roll(variable=[*a.variable, *b.variable], fixed=a.fixed + b.fixed)


def add_fixed(r: Roll, delta: int) -> Roll:
    return Roll(variable=list(r.variable), fixed=r.fixed + delta)


def subtract_from_variable(attacker_roll: Roll, defender_roll: Roll) -> int:
    """Per la schivata: variabile_atk - totale_def."""
    return variable_sum(attacker_roll) - roll_total(defender_roll)


def subtract_from_total(attacker_roll: Roll, defender_roll: Roll) -> int:
    """Per la parata: totale_atk - totale_def."""
    return roll_total(attacker_roll) - roll_total(defender_roll)


__all__ = [
    "Roll",
    "empty_roll",
    "variable_sum",
    "roll_total",
    "make_roll",
    "combine_rolls",
    "add_fixed",
    "subtract_from_variable",
    "subtract_from_total",
]

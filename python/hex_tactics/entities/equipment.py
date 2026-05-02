"""
Tipi runtime equipment — port di src/entities/Equipment.ts.

Convenzioni:
- Distanze (range) in esagoni (1 esagono = 0.5 m, D-013)
- `dice_variable` = dadi che l'arma AGGIUNGE ai 1-2 d6 base del PG (D-004)
- `fixed_bonus` = bonus alla parte fissa del tiro
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Union

# Stat di un PG
Stat = Literal["forza", "agilità", "volontà"]

# Categoria item per matching skill
WeaponCategory = Literal[
    "pugnali", "spade", "mazze", "asce", "lance", "archi", "balestre", "giavellotti"
]
ShieldCategory = Literal["scudi"]
ArmorCategory = Literal["armature"]
EquipCategory = Union[WeaponCategory, ShieldCategory, ArmorCategory]

# Stat in un attack mode (può essere 'either' = scelta libera del giocatore)
ModeStat = Union[Stat, Literal["either"]]


@dataclass(frozen=True)
class RollSpec:
    """Spec di tiro: 'tira N dadi e somma F fisso'. Diverso da Roll (risultato)."""

    dice: int
    fixed: int


@dataclass(frozen=True)
class AttackMode:
    """Un modo di attacco di un'arma.

    - Armi a impugnatura unica con scelta forza/agilità (Spada): 2 modi con stat differenti
    - Armi 1h/2h (Spada lunga): 2 modi con `label` differente, stat='either'
    - Armi a modo unico: 1 entry, stat='either'
    """

    label: str
    stat: ModeStat
    dice_variable: int
    fixed_bonus: int


@dataclass(frozen=True)
class WeaponRange:
    """Range di un'arma. Tutti i campi opzionali (default None = arma non lo possiede)."""

    distance: Optional[int] = None
    """Distanza max per arma da tiro (archi, balestre)."""
    throw: Optional[int] = None
    """Distanza max per il lancio di un'arma da mischia."""
    reach: Optional[int] = None
    """Portata CaC esteso (lancia, spada lunga…)."""
    ranged_divisor: Optional[int] = None
    """Divisore N_arma per il malus distanza."""
    reload: Optional[int] = None
    """Turni di ricarica (es. balestra 7)."""


@dataclass(frozen=True)
class Weapon:
    id: str
    name: str
    category: WeaponCategory
    attack_modes: tuple[AttackMode, ...]
    parry: Optional[RollSpec]  # None = arma non parabile (archi, balestre)
    impediment: int
    range: Optional[WeaponRange] = None


@dataclass(frozen=True)
class Shield:
    id: str
    name: str
    category: ShieldCategory
    attack_fixed_bonus: int
    parry: RollSpec
    impediment: int


@dataclass(frozen=True)
class Armor:
    id: str
    name: str
    category: ArmorCategory
    damage_reduction: int
    impediment: int


__all__ = [
    "Stat",
    "WeaponCategory",
    "ShieldCategory",
    "ArmorCategory",
    "EquipCategory",
    "ModeStat",
    "RollSpec",
    "AttackMode",
    "WeaponRange",
    "Weapon",
    "Shield",
    "Armor",
]

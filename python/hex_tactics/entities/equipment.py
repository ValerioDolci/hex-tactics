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

    `is_two_handed` (2026-05-05): se True il PG può tirare fino a 1 dado in più
    dalla sua riserva (cap PG: 1-2 → 1-3). NON modifica bonus arma o dadi arma —
    solo aumenta il cap dei dadi PG selezionabili.
    """

    label: str
    stat: ModeStat
    dice_variable: int
    fixed_bonus: int
    is_two_handed: bool = False


@dataclass(frozen=True)
class WeaponRange:
    """Range di un'arma. Tutti i campi opzionali (default None = arma non lo possiede)."""

    distance: Optional[int] = None
    """LEGACY: campo descrittivo per categorizzare armi 'da tiro' (archi, balestre).
    NOT a hard max range — le armi non hanno gittata massima nel design.
    Il malus distanza è gestito da `ranged_divisor` (-1 ogni N hex)."""
    throw: Optional[int] = None
    """Indica capacità di lancio per armi da mischia (pugnale, ascia 1h, giavellotto).
    Anche qui NON è hard max — solo flag/legacy descriptor."""
    reach: Optional[int] = None
    """Portata CaC esteso (lancia, spada lunga…)."""
    ranged_divisor: Optional[int] = None
    """Divisore N_arma per il malus distanza."""
    reload: Optional[int] = None
    """LEGACY (pre-2026-05-04): difficoltà tiro abilità per ricarica. Usato solo come fallback."""
    reload_cost_slancio: Optional[int] = None
    """Costo slancio fisso per ricaricare/incoccare. Sostituisce la prova abilità.
    Se settato → reload paga slancio invece di tirare dadi.
    arco_corto=6, arco_lungo=9, balestra=12 (default proposti)."""


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

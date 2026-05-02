"""Database scudi — port di src/data/shields.ts."""

from __future__ import annotations

from typing import Optional

from hex_tactics.entities.equipment import RollSpec, Shield


SHIELDS: dict[str, Shield] = {
    "scudo_piccolo": Shield(
        id="scudo_piccolo",
        name="Scudo piccolo",
        category="scudi",
        attack_fixed_bonus=4,
        parry=RollSpec(dice=1, fixed=4),
        impediment=3,
    ),
    "scudo_medio": Shield(
        id="scudo_medio",
        name="Scudo medio",
        category="scudi",
        attack_fixed_bonus=8,
        parry=RollSpec(dice=1, fixed=8),
        impediment=6,
    ),
    "scudo_pesante": Shield(
        id="scudo_pesante",
        name="Scudo pesante",
        category="scudi",
        attack_fixed_bonus=8,
        parry=RollSpec(dice=1, fixed=12),
        impediment=9,
    ),
}


def get_shield(id_: str) -> Optional[Shield]:
    return SHIELDS.get(id_)


__all__ = ["SHIELDS", "get_shield"]

"""Database armature — port di src/data/armors.ts.

RD = riduzione danno applicata ai colpi subiti.
"""

from __future__ import annotations

from typing import Optional

from hex_tactics.entities.equipment import Armor


ARMORS: dict[str, Armor] = {
    "armatura_leggera": Armor(
        id="armatura_leggera",
        name="Armatura leggera",
        category="armature",
        damage_reduction=3,
        impediment=3,
    ),
    "armatura_media": Armor(
        id="armatura_media",
        name="Armatura media",
        category="armature",
        damage_reduction=6,
        impediment=6,
    ),
    "armatura_pesante": Armor(
        id="armatura_pesante",
        name="Armatura pesante",
        category="armature",
        damage_reduction=9,
        impediment=9,
    ),
}


def get_armor(id_: str) -> Optional[Armor]:
    return ARMORS.get(id_)


__all__ = ["ARMORS", "get_armor"]

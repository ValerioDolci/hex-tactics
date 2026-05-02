"""Catalogo skill — port di src/data/skills.ts.

I 4 modificatori base con costi, e le liste di parole di specializzazione.
"""

from __future__ import annotations

from typing import Tuple

from hex_tactics.entities.equipment import EquipCategory, Stat, WeaponCategory
from hex_tactics.entities.skill import ActionType, SKILL_COSTS, SkillModifier


MODIFIER_LABELS: dict[str, str] = {
    "-1impedimento": "−1 impedimento",
    "+1tiro": "+1 al tiro",
    "+1dado": "+1 dado",
    "+1dadomax": "+1 dado massimo",
}


SKILL_ABILITA: Tuple[Stat, ...] = ("forza", "agilità", "volontà")

SKILL_AZIONI: Tuple[ActionType, ...] = (
    "attaccare",
    "parare",
    "schivare",
    "slancio",
    "ricaricare",
)

SKILL_CLASSI_OGGETTO: Tuple[EquipCategory, ...] = (
    "pugnali",
    "spade",
    "mazze",
    "asce",
    "lance",
    "archi",
    "balestre",
    "giavellotti",
    "scudi",
    "armature",
)

WEAPON_CATEGORIES: Tuple[WeaponCategory, ...] = (
    "pugnali",
    "spade",
    "mazze",
    "asce",
    "lance",
    "archi",
    "balestre",
    "giavellotti",
)


def skill_cost(mod: SkillModifier) -> int:
    """Costo lv1 senza spec (le spec scalano via compute_skill_cost)."""
    return SKILL_COSTS[mod]


REFERENCE_PG_EXP = 2000


__all__ = [
    "MODIFIER_LABELS",
    "SKILL_ABILITA",
    "SKILL_AZIONI",
    "SKILL_CLASSI_OGGETTO",
    "WEAPON_CATEGORIES",
    "SKILL_COSTS",
    "REFERENCE_PG_EXP",
    "skill_cost",
]

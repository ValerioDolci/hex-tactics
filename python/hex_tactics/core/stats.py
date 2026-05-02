"""
Stat derivate del PG: impedimento totale, modificatori da skill — port di src/core/stats.ts.

Funzioni pure (input → output, niente side effects).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from hex_tactics.data.armors import get_armor
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.equipment import EquipCategory, Stat
from hex_tactics.entities.skill import (
    AcquiredSkill,
    RollContext,
    skill_matches_context,
    skill_matches_equip,
)
from hex_tactics.entities.unit import Unit


def get_impediment_total(unit: Unit) -> int:
    """Impedimento totale: somma equip, applicando skill `-1impedimento` per pezzo (D-018, D-046).

    Floor 0 per pezzo (un equip a 0 imp resta a 0).
    """
    equip_pieces: list[tuple[str, EquipCategory, int]] = []  # (id, category, impediment)

    if unit.weapon:
        w = get_weapon(unit.weapon)
        if w is not None:
            equip_pieces.append((w.id, w.category, w.impediment))
    if unit.offhand:
        w = get_weapon(unit.offhand)
        s = get_shield(unit.offhand)
        if w is not None:
            equip_pieces.append((w.id, w.category, w.impediment))
        elif s is not None:
            # Fase 1: posizione difensiva raddoppia imp dello scudo
            shield_imp = s.impediment * 2 if unit.defensive_stance else s.impediment
            equip_pieces.append((s.id, s.category, shield_imp))
    if unit.armor:
        a = get_armor(unit.armor)
        if a is not None:
            equip_pieces.append((a.id, a.category, a.impediment))

    total = 0
    for (eid, ecat, eimp) in equip_pieces:
        # D-046: somma level di ogni skill -1imp che matcha il pezzo
        reduction = sum(
            s.level
            for s in unit.skills
            if s.modifier == "-1impedimento" and skill_matches_equip(s, eid, ecat)
        )
        total += max(0, eimp - reduction)
    return total


def count_forced_extra_dice(skills: List[AcquiredSkill], ctx: RollContext) -> int:
    """Somma livelli di `+1dado` (forzati) matchanti il contesto. D-046."""
    return sum(
        s.level for s in skills if s.modifier == "+1dado" and skill_matches_context(s, ctx)
    )


def count_max_dice_extra(skills: List[AcquiredSkill], ctx: RollContext) -> int:
    """Somma livelli di `+1dadomax` (opzionali) matchanti il contesto. D-046."""
    return sum(
        s.level for s in skills if s.modifier == "+1dadomax" and skill_matches_context(s, ctx)
    )


def count_flat_bonuses(skills: List[AcquiredSkill], ctx: RollContext) -> int:
    """Somma livelli di `+1tiro` matchanti il contesto (alla parte fissa). D-046."""
    return sum(s.level for s in skills if s.modifier == "+1tiro" and skill_matches_context(s, ctx))


@dataclass(frozen=True)
class DiceChoiceRange:
    min: int
    max: int


def get_dice_choice_range(
    unit: Unit, ctx: RollContext, standard_min: int, standard_max: int
) -> DiceChoiceRange:
    """Range di dadi scegliebile dal giocatore. `+1dadomax` alza il max."""
    extra_max = count_max_dice_extra(unit.skills, ctx)
    return DiceChoiceRange(min=standard_min, max=standard_max + extra_max)


def get_actual_dice_count(unit: Unit, ctx: RollContext, chosen: int) -> int:
    """Dadi effettivi: scelti + forzati da `+1dado`."""
    return chosen + count_forced_extra_dice(unit.skills, ctx)


# ---------------------------------------------------------------------------
# Helpers per costruire RollContext
# ---------------------------------------------------------------------------


def make_attack_context(
    weapon_id: str, weapon_category: EquipCategory, stat: Optional[Stat] = None
) -> RollContext:
    return RollContext(
        azione="attaccare",
        stat=stat,
        classe_oggetto=weapon_category,
        oggetto_specifico=weapon_id,
    )


def make_parry_context(item_id: str, item_category: EquipCategory) -> RollContext:
    return RollContext(
        azione="parare",
        classe_oggetto=item_category,
        oggetto_specifico=item_id,
    )


def make_dodge_context() -> RollContext:
    """Dodge = azione di agilità (per match con skill `[schivare][agilità]`)."""
    return RollContext(azione="schivare", stat="agilità")


def make_slancio_context() -> RollContext:
    """Slancio = tiro di agilità (per match con skill `[slancio][agilità]`)."""
    return RollContext(azione="slancio", stat="agilità")


__all__ = [
    "get_impediment_total",
    "count_forced_extra_dice",
    "count_max_dice_extra",
    "count_flat_bonuses",
    "get_dice_choice_range",
    "get_actual_dice_count",
    "make_attack_context",
    "make_parry_context",
    "make_dodge_context",
    "make_slancio_context",
    "DiceChoiceRange",
]

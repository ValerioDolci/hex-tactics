"""
Skill acquistate — port di src/entities/Skill.ts.

Vedi CLAUDE.md "Skill system" + D-046 per costi:
  total = base * (2^level - 1) / (2^specCount), arrotondato per eccesso

Modificatori base lv1 (no spec):
  -1 impedimento     100 exp
  +1 al tiro         600 exp
  +1 dado          3600 exp
  +1 dado massimo  1200 exp
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Literal, Optional

from .equipment import EquipCategory, Stat

SkillModifier = Literal["-1impedimento", "+1tiro", "+1dado", "+1dadomax"]
ActionType = Literal["attaccare", "parare", "schivare", "slancio", "ricaricare"]


# Costi base lv1, no spec
SKILL_COSTS: dict[str, int] = {
    "-1impedimento": 100,
    "+1tiro": 600,
    "+1dado": 3600,
    "+1dadomax": 1200,
}


@dataclass(frozen=True)
class AcquiredSkill:
    """Una skill acquistata da un PG.

    Spec opzionali: assenti → applicazione universale.
    `level` determina sia il costo (D-046 raddoppio) che l'effetto (-N imp, +N al tiro, ecc.).
    """

    id: str
    modifier: SkillModifier
    level: int
    cost: int
    abilita: Optional[Stat] = None
    azione: Optional[ActionType] = None
    classe_oggetto: Optional[EquipCategory] = None
    oggetto_specifico: Optional[str] = None


def count_specializations(skill: AcquiredSkill) -> int:
    """0..4 specializzazioni presenti."""
    n = 0
    if skill.abilita is not None:
        n += 1
    if skill.azione is not None:
        n += 1
    if skill.classe_oggetto is not None:
        n += 1
    if skill.oggetto_specifico is not None:
        n += 1
    return n


def compute_skill_cost(modifier: SkillModifier, level: int, spec_count: int) -> int:
    """D-046: total = base * (2^level - 1) / (2^specCount), arrotondato per eccesso (Math.ceil).

    - lv1: 1× base; lv2: 3×; lv3: 7×; lv4: 15×; lvN: (2^N - 1)×
    - 0 spec: /1; 1 spec: /2; 2: /4; 3: /8; 4: /16
    """
    if level < 1:
        return 0
    base = SKILL_COSTS[modifier]
    level_multiplier = (2 ** level) - 1
    spec_divisor = 2 ** spec_count
    return math.ceil((base * level_multiplier) / spec_divisor)


def skill_key(skill: AcquiredSkill) -> str:
    """Chiave canonica per identificare 'la stessa skill' (D-046).

    Due skill con stessa chiave non possono coesistere: o sale di livello,
    o cambia spec.
    """
    return "|".join(
        [
            skill.modifier,
            skill.abilita or "",
            skill.azione or "",
            skill.classe_oggetto or "",
            skill.oggetto_specifico or "",
        ]
    )


@dataclass
class SkillSetValidation:
    valid: bool
    total_cost: int
    errors: List[str]


def validate_skill_set(skills: List[AcquiredSkill]) -> SkillSetValidation:
    """Valida un set: niente duplicati per chiave, costi totali corretti."""
    errors: List[str] = []
    seen: set[str] = set()
    total_cost = 0
    for s in skills:
        key = skill_key(s)
        if key in seen:
            errors.append(f"Skill duplicata (stessa chiave + stesso livello implicito): {key}")
        seen.add(key)
        expected = compute_skill_cost(s.modifier, s.level, count_specializations(s))
        if s.cost != expected:
            errors.append(
                f"Costo errato per {key} lv{s.level}: dichiarato {s.cost}, atteso {expected}"
            )
        total_cost += expected
    return SkillSetValidation(valid=len(errors) == 0, total_cost=total_cost, errors=errors)


@dataclass(frozen=True)
class RollContext:
    """Contesto di un tiro per matchare specializzazioni delle skill."""

    azione: ActionType
    stat: Optional[Stat] = None
    classe_oggetto: Optional[EquipCategory] = None
    oggetto_specifico: Optional[str] = None


def skill_matches_context(skill: AcquiredSkill, ctx: RollContext) -> bool:
    """Tutte le spec presenti nella skill devono matchare; quelle assenti = any."""
    if skill.azione is not None and skill.azione != ctx.azione:
        return False
    if skill.abilita is not None and skill.abilita != ctx.stat:
        return False
    if skill.classe_oggetto is not None and skill.classe_oggetto != ctx.classe_oggetto:
        return False
    if skill.oggetto_specifico is not None and skill.oggetto_specifico != ctx.oggetto_specifico:
        return False
    return True


def skill_matches_equip(skill: AcquiredSkill, equip_id: str, equip_category: EquipCategory) -> bool:
    """Match per skill `−1 impedimento` su uno specifico pezzo.

    `azione`/`abilita` ignorate (l'imp è del pezzo, non dell'azione).
    Solo `classe_oggetto` e `oggetto_specifico` contano.
    """
    if skill.classe_oggetto is not None and skill.classe_oggetto != equip_category:
        return False
    if skill.oggetto_specifico is not None and skill.oggetto_specifico != equip_id:
        return False
    return True


__all__ = [
    "SkillModifier",
    "ActionType",
    "SKILL_COSTS",
    "AcquiredSkill",
    "RollContext",
    "SkillSetValidation",
    "count_specializations",
    "compute_skill_cost",
    "skill_key",
    "validate_skill_set",
    "skill_matches_context",
    "skill_matches_equip",
]

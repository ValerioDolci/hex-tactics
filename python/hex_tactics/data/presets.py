"""Preset PG predefiniti — port di src/data/presets.ts.

3 archetipi bilanciati ~2000 exp post-D-046.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from hex_tactics.core.hex import Axial
from hex_tactics.entities.skill import AcquiredSkill
from hex_tactics.entities.unit import FactionId, Unit, create_baseline_unit


@dataclass(frozen=True)
class PresetSkillSpec:
    """AcquiredSkill senza ID (assegnato in `unit_from_preset`)."""

    modifier: str
    level: int
    cost: int
    abilita: Optional[str] = None
    azione: Optional[str] = None
    classe_oggetto: Optional[str] = None
    oggetto_specifico: Optional[str] = None


@dataclass(frozen=True)
class PresetSpec:
    id: str
    name: str
    description: str
    weapon: Optional[str]
    offhand: Optional[str]
    armor: Optional[str]
    skills: tuple[PresetSkillSpec, ...]
    # 2026-05-05: inventario armi da lancio + backup
    thrown_inventory: tuple[str, ...] = ()
    backup_weapon: Optional[str] = None


def unit_from_preset(
    spec: PresetSpec,
    faction: FactionId,
    position: Axial,
    custom_name: Optional[str] = None,
) -> Unit:
    """Crea un Unit dato un PresetSpec, fazione e posizione."""
    u = create_baseline_unit(
        id=f"{faction}-{spec.id}",
        name=custom_name if custom_name is not None else spec.name,
        faction=faction,
        position=position,
    )
    u.weapon = spec.weapon
    u.offhand = spec.offhand
    u.armor = spec.armor
    u.thrown_inventory = list(spec.thrown_inventory)
    u.backup_weapon = spec.backup_weapon
    u.skills = [
        AcquiredSkill(
            id=f"{u.id}-skill-{i}",
            modifier=s.modifier,  # type: ignore[arg-type]
            level=s.level,
            cost=s.cost,
            abilita=s.abilita,  # type: ignore[arg-type]
            azione=s.azione,  # type: ignore[arg-type]
            classe_oggetto=s.classe_oggetto,  # type: ignore[arg-type]
            oggetto_specifico=s.oggetto_specifico,
        )
        for i, s in enumerate(spec.skills)
    ]
    u.preset_id = spec.id
    return u


PRESETS: tuple[PresetSpec, ...] = (
    PresetSpec(
        id="spadaccino",
        name="Spadaccino",
        description=(
            "Spada lunga a 2 mani + armatura media (no scudo). Build offensiva-bilanciata "
            "(2000 exp, D-046): imp 0 con -3imp generico + -3imp [spade] + -3imp [armature]; "
            "+2 tiro [attaccare/spade], +1 tiro [slancio/agilità]."
        ),
        weapon="spada_lunga",
        offhand=None,
        armor="armatura_media",
        skills=(
            PresetSkillSpec(modifier="-1impedimento", level=3, cost=700),
            PresetSkillSpec(modifier="-1impedimento", level=3, classe_oggetto="spade", cost=350),
            PresetSkillSpec(modifier="-1impedimento", level=3, classe_oggetto="armature", cost=350),
            PresetSkillSpec(
                modifier="+1tiro", level=2, azione="attaccare", classe_oggetto="spade", cost=450
            ),
            PresetSkillSpec(
                modifier="+1tiro", level=1, azione="slancio", abilita="agilità", cost=150
            ),
            # Total 2000 ✓
        ),
    ),
    PresetSpec(
        id="arciere",
        name="Arciere",
        description=(
            "Arco lungo + pugnale (offhand, para) + armatura leggera. Specializzato distanza "
            "(2000 exp, D-046): -3imp + -3imp [archi] azzerano; +2 tiro [attaccare/archi], "
            "+1 tiro [slancio/agilità], +1 dadomax [slancio/agilità]."
        ),
        weapon="arco_lungo",
        offhand="pugnale",
        armor="armatura_leggera",
        skills=(
            PresetSkillSpec(modifier="-1impedimento", level=3, cost=700),
            PresetSkillSpec(modifier="-1impedimento", level=3, classe_oggetto="archi", cost=350),
            PresetSkillSpec(
                modifier="+1tiro", level=2, azione="attaccare", classe_oggetto="archi", cost=450
            ),
            PresetSkillSpec(
                modifier="+1tiro", level=1, azione="slancio", abilita="agilità", cost=150
            ),
            PresetSkillSpec(
                modifier="+1dadomax", level=1, azione="slancio", abilita="agilità", cost=300
            ),
            # Total 1950 (50 avanzati)
        ),
    ),
    PresetSpec(
        id="tank",
        name="Tank",
        description=(
            "Mazza + scudo medio + armatura media. Specialista parata + slancio "
            "(2000 exp, D-046): -3imp generico + -3imp [scudi] + -3imp [armature] azzerano; "
            "+1 tiro [parare/scudi], +1 tiro [slancio/agilità], +1 dadomax [slancio/agilità]."
        ),
        weapon="mazza",
        offhand="scudo_medio",
        armor="armatura_media",
        skills=(
            PresetSkillSpec(modifier="-1impedimento", level=3, cost=700),
            PresetSkillSpec(modifier="-1impedimento", level=3, classe_oggetto="scudi", cost=350),
            PresetSkillSpec(modifier="-1impedimento", level=3, classe_oggetto="armature", cost=350),
            PresetSkillSpec(
                modifier="+1tiro", level=1, azione="parare", classe_oggetto="scudi", cost=150
            ),
            PresetSkillSpec(
                modifier="+1tiro", level=1, azione="slancio", abilita="agilità", cost=150
            ),
            PresetSkillSpec(
                modifier="+1dadomax", level=1, azione="slancio", abilita="agilità", cost=300
            ),
            # Total 2000 ✓
        ),
    ),
)


def get_preset(id_: str) -> Optional[PresetSpec]:
    for p in PRESETS:
        if p.id == id_:
            return p
    return None


__all__ = ["PresetSpec", "PresetSkillSpec", "PRESETS", "unit_from_preset", "get_preset"]

"""
Random PG generator — campiona personaggi entro budget exp 2000.

Regole:
  - Stat 2/2/2 fisse (CLAUDE.md baseline, char builder MVP)
  - 1 weapon (mandatory) + offhand opzionale (weapon o scudo) + armor opzionale
  - Skill random entro budget rimanente

Skill generation:
  - Pool: 4 modifier × varie spec (4 abilità + 5 azioni + 10 categorie + null)
  - Vincolo unicità: stessa chiave canonica può apparire 1 volta sola
  - Strategia: PRIMA azzera l'impedimento dei pezzi (skill mirate),
    POI investe in +1tiro mirate, +1dadomax/+1dado opzionali
  - Variabilità: random scelte per esplorare lo spazio dei build
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import List, Optional

from hex_tactics.core.hex import Axial
from hex_tactics.data.armors import ARMORS
from hex_tactics.data.shields import SHIELDS
from hex_tactics.data.weapons import WEAPONS
from hex_tactics.entities.skill import (
    AcquiredSkill,
    SKILL_COSTS,
    compute_skill_cost,
    count_specializations,
    skill_key,
)
from hex_tactics.entities.unit import Unit, create_baseline_unit


# Pool ID
WEAPON_IDS = list(WEAPONS.keys())
SHIELD_IDS = list(SHIELDS.keys())
ARMOR_IDS = list(ARMORS.keys())

ABILITA_OPTIONS = ["forza", "agilità", "volontà"]
AZIONI_OPTIONS = ["attaccare", "parare", "schivare", "slancio", "ricaricare"]
CATEGORIE_OPTIONS = list({w.category for w in WEAPONS.values()}) + ["scudi", "armature"]


@dataclass
class PGBuild:
    weapon: Optional[str]
    offhand: Optional[str]
    armor: Optional[str]
    skills: List[AcquiredSkill]
    total_exp_spent: int
    seed: int


def _random_equipment(rng: random.Random) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Random selection of weapon (mandatory), offhand (opzionale), armor (opzionale).

    Distribuzioni:
      weapon: uniform su 12 ID
      offhand: 50% null, 25% shield uniform, 25% pugnale (la sola weapon usata in offhand)
      armor: 25% null, 35% leggera, 25% media, 15% pesante
    """
    weapon = rng.choice(WEAPON_IDS)

    r = rng.random()
    if r < 0.5:
        offhand = None
    elif r < 0.75:
        offhand = rng.choice(SHIELD_IDS)
    else:
        # Solo pugnale come offhand-weapon (semplifica)
        offhand = "pugnale" if weapon != "pugnale" else None

    r = rng.random()
    if r < 0.25:
        armor = None
    elif r < 0.60:
        armor = "armatura_leggera"
    elif r < 0.85:
        armor = "armatura_media"
    else:
        armor = "armatura_pesante"

    return weapon, offhand, armor


def _random_skill(rng: random.Random, max_level: int = 4) -> tuple[str, int, dict]:
    """Random skill spec. Ritorna (modifier, level, spec_dict) — costo NON calcolato."""
    modifier = rng.choices(
        ["-1impedimento", "+1tiro", "+1dado", "+1dadomax"],
        weights=[0.45, 0.40, 0.05, 0.10],  # imp riduzione e tiro più probabili
    )[0]
    level = rng.randint(1, max_level)
    spec: dict = {}
    # 30% chance per ogni spec di essere presente
    if rng.random() < 0.30:
        spec["abilita"] = rng.choice(ABILITA_OPTIONS)
    if rng.random() < 0.50:
        spec["azione"] = rng.choice(AZIONI_OPTIONS)
    if rng.random() < 0.40:
        spec["classe_oggetto"] = rng.choice(CATEGORIE_OPTIONS)
    # oggetto_specifico raro, lo skip
    return modifier, level, spec


def generate_random_pg(
    rng: random.Random,
    budget: int = 2000,
    max_skills: int = 10,
    seed: int = 0,
) -> PGBuild:
    """Genera un PG random entro budget exp.

    Strategia:
      1. Equipment random
      2. Itera generazione skill random; per ogni skill calcola costo, accetta se entro budget
      3. Stop dopo `max_skills` o quando 5 fallimenti consecutivi (budget esaurito)
    """
    weapon, offhand, armor = _random_equipment(rng)

    skills: List[AcquiredSkill] = []
    seen_keys: set[str] = set()
    spent = 0
    consecutive_fails = 0
    skill_idx = 0

    while len(skills) < max_skills and consecutive_fails < 10:
        modifier, level, spec = _random_skill(rng)
        # Builds AcquiredSkill candidate
        spec_count = sum(1 for k in ("abilita", "azione", "classe_oggetto", "oggetto_specifico") if spec.get(k) is not None)
        cost = compute_skill_cost(modifier, level, spec_count)

        if spent + cost > budget:
            consecutive_fails += 1
            continue

        candidate = AcquiredSkill(
            id=f"random-{seed}-{skill_idx}",
            modifier=modifier,  # type: ignore
            level=level,
            cost=cost,
            abilita=spec.get("abilita"),  # type: ignore
            azione=spec.get("azione"),  # type: ignore
            classe_oggetto=spec.get("classe_oggetto"),  # type: ignore
            oggetto_specifico=None,
        )
        key = skill_key(candidate)
        if key in seen_keys:
            consecutive_fails += 1
            continue

        seen_keys.add(key)
        skills.append(candidate)
        spent += cost
        consecutive_fails = 0
        skill_idx += 1

    return PGBuild(
        weapon=weapon, offhand=offhand, armor=armor,
        skills=skills, total_exp_spent=spent, seed=seed,
    )


def unit_from_random_pg(
    build: PGBuild,
    faction: str,
    position: Axial,
    name_prefix: str = "RandomPG",
) -> Unit:
    """Crea un Unit da un PGBuild."""
    u = create_baseline_unit(
        id=f"{faction}-{name_prefix}-{build.seed}",
        name=f"{name_prefix}-{build.seed}",
        faction=faction,  # type: ignore
        position=position,
    )
    u.weapon = build.weapon
    u.offhand = build.offhand
    u.armor = build.armor
    u.skills = list(build.skills)
    return u


def describe_build(build: PGBuild) -> str:
    """Descrizione human-readable di un PGBuild."""
    parts = [
        f"weapon={build.weapon or '∅'}",
        f"offhand={build.offhand or '∅'}",
        f"armor={build.armor or '∅'}",
        f"skills={len(build.skills)}",
        f"exp={build.total_exp_spent}/2000",
    ]
    return "PG[" + ", ".join(parts) + "]"


__all__ = [
    "PGBuild",
    "generate_random_pg",
    "unit_from_random_pg",
    "describe_build",
]

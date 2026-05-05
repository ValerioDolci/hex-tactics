"""
Database armi — port di src/data/weapons.ts.

Sorgente: TAB_armi.docx + interpretazione confermata da Valerio.
Notazione "/" della tabella:
  - Spada `1D6+2/+2`: 2 modi → +2 con Forza, +2 con Agilità
  - Spada lunga 1h/2h `1D6+2/+6`: 2 modi → +2 a 1h, +6 a 2h (stat libera)
  - Lancia 1h/2h `2D6` (no /): un modo unico, stat libera

Range in esagoni (1 hex = 0.5 m, D-013). N_arma = D-012 prima draft.
"""

from __future__ import annotations

from typing import Optional

from hex_tactics.entities.equipment import AttackMode, RollSpec, Weapon, WeaponRange


WEAPONS: dict[str, Weapon] = {
    "pugnale": Weapon(
        id="pugnale",
        name="Pugnale",
        category="pugnali",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=1, fixed_bonus=2),
        ),
        parry=RollSpec(dice=1, fixed=0),
        impediment=0,
        # V2: reach 1 (= 0.5m, default armi melee). Triggera asta zona controllo.
        range=WeaponRange(reach=1, throw=1, ranged_divisor=1),  # Lancio 0.5m → 1 hex; reach mischia 1
    ),
    "spada": Weapon(
        id="spada",
        name="Spada",
        category="spade",
        attack_modes=(
            AttackMode(label="Forza", stat="forza", dice_variable=1, fixed_bonus=2),
            AttackMode(label="Agilità", stat="agilità", dice_variable=1, fixed_bonus=2),
        ),
        parry=RollSpec(dice=1, fixed=2),
        impediment=3,
        range=WeaponRange(reach=1),  # V2: reach 1 (default 0.5m), attiva asta zona controllo
    ),
    "spada_lunga": Weapon(
        id="spada_lunga",
        name="Spada lunga",
        category="spade",
        attack_modes=(
            AttackMode(label="1 mano", stat="either", dice_variable=1, fixed_bonus=2),
            AttackMode(label="2 mani", stat="either", dice_variable=1, fixed_bonus=6, is_two_handed=True),
        ),
        parry=RollSpec(dice=1, fixed=6),
        impediment=6,
        range=WeaponRange(reach=2),  # Portata 1m → 2 hex
    ),
    "mazza": Weapon(
        id="mazza",
        name="Mazza",
        category="mazze",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=0, fixed_bonus=9),
        ),
        parry=RollSpec(dice=0, fixed=3),
        impediment=3,
        range=WeaponRange(reach=1),  # V2
    ),
    "ascia_1h": Weapon(
        id="ascia_1h",
        name="Ascia 1h",
        category="asce",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=1, fixed_bonus=6),
        ),
        parry=RollSpec(dice=0, fixed=3),
        impediment=3,
        range=WeaponRange(reach=1, throw=1, ranged_divisor=1),  # V2: reach 1; Lancio 0.5m → 1 hex
    ),
    "ascia_2h": Weapon(
        id="ascia_2h",
        name="Ascia 2h",
        category="asce",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=1, fixed_bonus=15, is_two_handed=True),
        ),
        parry=RollSpec(dice=0, fixed=3),
        impediment=6,
        range=WeaponRange(reach=1),  # V2
    ),
    "lancia_2m": Weapon(
        id="lancia_2m",
        name="Lancia 2m (1h/2h)",
        category="lance",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=2, fixed_bonus=0),
        ),
        parry=RollSpec(dice=0, fixed=3),
        impediment=3,
        range=WeaponRange(throw=2, reach=4, ranged_divisor=2),
    ),
    "lancia_3m": Weapon(
        id="lancia_3m",
        name="Lancia 3m (2h)",
        category="lance",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=2, fixed_bonus=4, is_two_handed=True),  # M-3 fix (era 0)
        ),
        parry=RollSpec(dice=0, fixed=1),
        impediment=6,
        range=WeaponRange(reach=6),
    ),
    "giavellotto": Weapon(
        id="giavellotto",
        name="Giavellotto",
        category="giavellotti",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=0, fixed_bonus=6),
        ),
        parry=RollSpec(dice=0, fixed=1),
        impediment=3,
        range=WeaponRange(throw=3, reach=2, ranged_divisor=3),
    ),
    "arco_corto": Weapon(
        id="arco_corto",
        name="Arco corto",
        category="archi",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=1, fixed_bonus=6),
        ),
        parry=None,
        impediment=3,
        range=WeaponRange(distance=3, ranged_divisor=2, reload_cost_slancio=6),
    ),
    "arco_lungo": Weapon(
        id="arco_lungo",
        name="Arco lungo",
        category="archi",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=2, fixed_bonus=6, is_two_handed=True),
        ),
        parry=None,
        impediment=6,
        range=WeaponRange(distance=4, ranged_divisor=2, reload_cost_slancio=9),
    ),
    "balestra": Weapon(
        id="balestra",
        name="Balestra",
        category="balestre",
        attack_modes=(
            AttackMode(label="default", stat="either", dice_variable=0, fixed_bonus=15),
        ),
        parry=None,
        impediment=3,
        range=WeaponRange(distance=2, ranged_divisor=2, reload=7, reload_cost_slancio=12),
    ),
}


def get_weapon(id_: str) -> Optional[Weapon]:
    return WEAPONS.get(id_)


__all__ = ["WEAPONS", "get_weapon"]

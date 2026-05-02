"""
Combat math — port di src/core/combat.ts.

Schema generale:
  1. atk sceglie diceN, def sceglie tipo+diceN (simultaneamente, privato)
  2. atk compone Roll (PG dadi + arma dadi + bonus + skill - imp)
  3. def compone Roll (1-2 d6 + 2 + bonus + skill - imp)
  4. risoluzione:
     - dodge: subtract_from_variable
     - parry: subtract_from_total
  5. hit → applica danni (con armor RD); miss → diff sottratta a slancio atk
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from hex_tactics.data.armors import get_armor
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.equipment import AttackMode, Stat
from hex_tactics.entities.unit import Unit

from .dice import (
    Roll,
    combine_rolls,
    empty_roll,
    make_roll,
    subtract_from_total,
    subtract_from_variable,
    variable_neg_residue,
)
from .rng import Rng
from .stats import (
    count_flat_bonuses,
    get_actual_dice_count,
    get_impediment_total,
    make_attack_context,
    make_dodge_context,
    make_parry_context,
)


BASE_PG_FIXED = 2  # Bonus base PG per ogni tiro ("1-2 d6 +2")


@dataclass
class CombatResult:
    """Risultato di una risoluzione (dodge/parry/no-defense)."""

    hit: bool
    raw_damage: int  # prima della riduzione armatura
    slancio_penalty_to_attacker: int  # se miss: |residual|; se hit: 0
    attacker_roll: Roll
    defender_roll: Roll
    # V2: slancio loss da imp variabile (residuo neg della parte variabile post-mod).
    # Sempre cumulativo a slancio_penalty_to_attacker.
    slancio_loss_attacker_imp: int = 0
    slancio_loss_defender_imp: int = 0


def get_shield_passive_rd(target: Unit) -> int:
    """RD passive dello scudo offhand (D-042 ranged + Fase 1 stance per CaC).

    Senza stance: scudo passive = scudo.parry.fixed (solo vs ranged, già in compose_ranged)
    Con stance: scudo passive = scudo.parry.fixed * 2, applicato sia ranged sia CaC.
    Ritorna il bonus RD applicabile in stance (per CaC questo è il valore).
    """
    if target.offhand is None:
        return 0
    sh = get_shield(target.offhand)
    if sh is None:
        return 0
    if target.defensive_stance:
        return sh.parry.fixed * 2
    return 0  # senza stance, no RD CaC (solo ranged in compose_ranged)


def compose_attack_roll(
    attacker: Unit,
    weapon_id: str,
    attack_mode_idx: int,
    chosen_stat: Optional[Stat],
    dice_n: int,
    rng: Rng,
    *,
    target: Optional[Unit] = None,
    carica_amount: int = 0,
) -> Roll:
    """Compone il Roll d'attacco di un PG con un'arma in un certo modo.

    Ordine RNG (cruciale per parità):
      1. dadi PG (con +1 dado forzato applicato)
      2. dadi arma (in aggiunta)

    Fase 1 NEW:
      - carica_amount: bonus alla fissa (deciso in awaiting-carica)
      - target: se fornito e in defensive_stance, sottrae shield_passive (CaC RD)
    """
    weapon = get_weapon(weapon_id)
    if weapon is None:
        raise ValueError(f"Weapon {weapon_id} not found")
    if attack_mode_idx >= len(weapon.attack_modes) or attack_mode_idx < 0:
        raise ValueError(f"Attack mode {attack_mode_idx} not found for {weapon_id}")
    mode = weapon.attack_modes[attack_mode_idx]

    stat: Optional[Stat] = chosen_stat if mode.stat == "either" else mode.stat  # type: ignore[assignment]
    ctx = make_attack_context(weapon.id, weapon.category, stat)

    # Dadi PG (con +1 dado forzato via skill)
    pg_dice_n = get_actual_dice_count(attacker, ctx, dice_n)
    pg_roll = make_roll(rng, pg_dice_n, BASE_PG_FIXED)

    # Dadi arma (in aggiunta)
    weapon_roll = make_roll(rng, mode.dice_variable, mode.fixed_bonus)

    combined = combine_rolls(pg_roll, weapon_roll)

    # D-047: armi a notazione "X/Y" con stat condizionata (Spada: 2 modes 'forza'/'agilità')
    # Se atk usa ≥2 dadi PG, può attivare ENTRAMBI i bonus fissi (un dado per stat).
    # Detection: ≥2 modes, mode corrente NON è 'either', altro mode con stat≠current e ≠'either'.
    if dice_n >= 2 and len(weapon.attack_modes) >= 2 and mode.stat != "either":
        for i, m in enumerate(weapon.attack_modes):
            if i == attack_mode_idx:
                continue
            if m.stat == "either":
                continue
            if m.stat != mode.stat:
                combined.fixed += m.fixed_bonus
                break

    # +1 al tiro (skill flat bonus)
    combined.fixed += count_flat_bonuses(attacker.skills, ctx)

    # V2: Impedimento sottratto alla VARIABILE (non più alla fissa).
    # Se la variabile va sotto 0, viene floored a 0 e |negativo| → slancio loss
    # (gestito nel resolve, via variable_neg_residue del Roll).
    combined.variable_mod -= get_impediment_total(attacker)

    # Fase 1: carica bonus (alla fissa)
    combined.fixed += carica_amount

    # Fase 1: target in stance → sottrai scudo passive RD (CaC)
    if target is not None:
        combined.fixed -= get_shield_passive_rd(target)

    return combined


def compose_dodge_roll(defender: Unit, dice_n: int, rng: Rng) -> Roll:
    """Roll di schivata del difensore."""
    ctx = make_dodge_context()
    actual_dice = get_actual_dice_count(defender, ctx, dice_n)
    roll = make_roll(rng, actual_dice, BASE_PG_FIXED)
    roll.fixed += count_flat_bonuses(defender.skills, ctx)
    # V2: imp alla VARIABILE (non più fissa). Slancio loss in caso di residuo neg.
    roll.variable_mod -= get_impediment_total(defender)
    return roll


ParryWith = Literal["weapon", "offhand"]


def compose_parry_roll(
    defender: Unit, parry_with: ParryWith, dice_n: int, rng: Rng
) -> Optional[Roll]:
    """Compone il Roll di parata. Restituisce None se l'item non è parabile."""
    item_id = defender.weapon if parry_with == "weapon" else defender.offhand
    if item_id is None:
        return None

    weapon = get_weapon(item_id)
    shield = get_shield(item_id)
    parry_spec = None
    category = None

    if weapon is not None:
        parry_spec = weapon.parry  # può essere None (archi/balestre)
        category = weapon.category
    elif shield is not None:
        parry_spec = shield.parry
        category = shield.category

    if parry_spec is None or category is None:
        return None

    ctx = make_parry_context(item_id, category)
    actual_dice = get_actual_dice_count(defender, ctx, dice_n)

    pg_roll = make_roll(rng, actual_dice, BASE_PG_FIXED)
    item_roll = make_roll(rng, parry_spec.dice, parry_spec.fixed)
    combined = combine_rolls(pg_roll, item_roll)

    combined.fixed += count_flat_bonuses(defender.skills, ctx)
    # V2: imp alla VARIABILE (non più fissa).
    combined.variable_mod -= get_impediment_total(defender)
    return combined


def resolve_dodge(attacker_roll: Roll, dodge_roll: Roll) -> CombatResult:
    """Schivata: residual = variabile_atk - totale_def.

    residual ≤ 0 → schivato; |residual| → slancio penalty all'atk.
    residual > 0 → si somma anche la fissa atk al residual e si applicano danni.
    """
    residual = subtract_from_variable(attacker_roll, dodge_roll)
    # V2: slancio loss da imp variabile sopra il floor
    slancio_loss_attacker_imp = variable_neg_residue(attacker_roll)
    slancio_loss_defender_imp = variable_neg_residue(dodge_roll)
    if residual <= 0:
        return CombatResult(
            hit=False,
            raw_damage=0,
            slancio_penalty_to_attacker=abs(residual),
            attacker_roll=attacker_roll,
            defender_roll=dodge_roll,
            slancio_loss_attacker_imp=slancio_loss_attacker_imp,
            slancio_loss_defender_imp=slancio_loss_defender_imp,
        )
    damage = residual + attacker_roll.fixed
    return CombatResult(
        hit=damage > 0,
        raw_damage=max(0, damage),
        slancio_penalty_to_attacker=0,
        attacker_roll=attacker_roll,
        defender_roll=dodge_roll,
        slancio_loss_attacker_imp=slancio_loss_attacker_imp,
        slancio_loss_defender_imp=slancio_loss_defender_imp,
    )


def resolve_parry(attacker_roll: Roll, parry_roll: Roll) -> CombatResult:
    """Parata: residual = totale_atk - totale_def.

    residual ≤ 0 → parato; |residual| → slancio penalty all'atk.
    residual > 0 → si applicano danni col rimanente.
    """
    residual = subtract_from_total(attacker_roll, parry_roll)
    slancio_loss_attacker_imp = variable_neg_residue(attacker_roll)
    slancio_loss_defender_imp = variable_neg_residue(parry_roll)
    if residual <= 0:
        return CombatResult(
            hit=False,
            raw_damage=0,
            slancio_penalty_to_attacker=abs(residual),
            attacker_roll=attacker_roll,
            defender_roll=parry_roll,
            slancio_loss_attacker_imp=slancio_loss_attacker_imp,
            slancio_loss_defender_imp=slancio_loss_defender_imp,
        )
    return CombatResult(
        hit=True,
        raw_damage=residual,
        slancio_penalty_to_attacker=0,
        attacker_roll=attacker_roll,
        defender_roll=parry_roll,
        slancio_loss_attacker_imp=slancio_loss_attacker_imp,
        slancio_loss_defender_imp=slancio_loss_defender_imp,
    )


def resolve_no_defense(attacker_roll: Roll) -> CombatResult:
    """Difensore non spende dadi. Tutti i danni passano (dopo armor RD)."""
    # V2: applica floor 0 sulla variabile post-modificatore.
    total = attacker_roll.fixed + max(
        0, sum(attacker_roll.variable) + attacker_roll.variable_mod
    )
    slancio_loss_attacker_imp = variable_neg_residue(attacker_roll)
    return CombatResult(
        hit=total > 0,
        raw_damage=max(0, total),
        slancio_penalty_to_attacker=0,
        attacker_roll=attacker_roll,
        defender_roll=empty_roll(),
        slancio_loss_attacker_imp=slancio_loss_attacker_imp,
        slancio_loss_defender_imp=0,
    )


@dataclass(frozen=True)
class DamageApplied:
    effective_damage: int
    new_hp: int


def apply_damage_with_armor(target: Unit, raw_damage: int) -> DamageApplied:
    """Applica danni con armor RD. Restituisce danno effettivo + nuovo HP."""
    rd = 0
    if target.armor:
        a = get_armor(target.armor)
        if a is not None:
            rd = a.damage_reduction
    effective = max(0, raw_damage - rd)
    new_hp = max(0, target.hp - effective)
    return DamageApplied(effective_damage=effective, new_hp=new_hp)


def get_attack_mode(weapon_id: str, mode_idx: int) -> Optional[AttackMode]:
    w = get_weapon(weapon_id)
    if w is None:
        return None
    if mode_idx < 0 or mode_idx >= len(w.attack_modes):
        return None
    return w.attack_modes[mode_idx]


__all__ = [
    "BASE_PG_FIXED",
    "CombatResult",
    "DamageApplied",
    "ParryWith",
    "compose_attack_roll",
    "compose_dodge_roll",
    "compose_parry_roll",
    "resolve_dodge",
    "resolve_parry",
    "resolve_no_defense",
    "apply_damage_with_armor",
    "get_attack_mode",
]

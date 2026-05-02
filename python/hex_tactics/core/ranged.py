"""
Combat a distanza — port di src/core/ranged.ts.

Formula tiro:
  1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza/N⌋ − slancio_target
  − impedimento_atk − scudo_difensore_passivo (D-042) − armor_RD_passivo (D-043)

D-032: contro ranged niente difese attive (no schivata/parata che spendono dadi).
D-042: scudo offre fixed bonus passivo anche contro ranged.
D-043: armor RD applicata al tiro (single application: il damage stage NON la riapplica).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Optional

from hex_tactics.data.armors import get_armor
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.equipment import Stat
from hex_tactics.entities.unit import Unit

from .combat import BASE_PG_FIXED
from .dice import Roll, combine_rolls, make_roll
from .hex import Axial, axial_equals, get_base_hexes, hex_distance, hex_line
from .rng import Rng
from .stats import (
    count_flat_bonuses,
    get_actual_dice_count,
    get_impediment_total,
    make_attack_context,
)


@dataclass(frozen=True)
class LoSResult:
    from_hex: Axial
    visibility: int  # 0..7
    distance: int  # esagoni dal from_hex al più vicino target


def compute_los(
    attacker: Unit, target: Unit, units: Mapping[str, Unit]
) -> LoSResult:
    """LoS migliore dai 7 esagoni della basetta atk verso il target.

    Le altre unità vive bloccano la LoS quando i loro esagoni di basetta
    sono nel raster (escludendo gli estremi e gli hex propri di atk/target).

    Tiebreak: max visibility, poi min distance.
    """
    attacker_base = get_base_hexes(attacker.position)
    target_base = get_base_hexes(target.position)

    blocking: set[tuple[int, int]] = set()
    for u in units.values():
        if u.id == attacker.id or u.id == target.id:
            continue
        if not u.alive:
            continue
        for h in get_base_hexes(u.position):
            blocking.add((h.q, h.r))

    candidates: list[tuple[Axial, int, int]] = []  # (from, visibility, distance)
    atk_base_set = {(h.q, h.r) for h in attacker_base}
    tgt_base_set = {(h.q, h.r) for h in target_base}

    for from_hex in attacker_base:
        visibility = 0
        for to_hex in target_base:
            path = hex_line(from_hex, to_hex)
            blocked = False
            for i in range(1, len(path) - 1):
                h = path[i]
                key = (h.q, h.r)
                if key in atk_base_set:
                    continue
                if key in tgt_base_set:
                    continue
                if key in blocking:
                    blocked = True
                    break
            if not blocked:
                visibility += 1

        min_dist = math.inf
        for to_hex in target_base:
            d = hex_distance(from_hex, to_hex)
            if d < min_dist:
                min_dist = d
        candidates.append((from_hex, visibility, int(min_dist)))

    # max visibility, tiebreak min distance
    # Nota: TS sort è stable; con stesso comparator, il primo elemento "best" è
    # quello con (visibility più alta, dist più bassa). Replica fedele.
    candidates.sort(key=lambda c: (-c[1], c[2]))
    best_from, best_vis, best_dist = candidates[0]
    return LoSResult(from_hex=best_from, visibility=best_vis, distance=best_dist)


@dataclass(frozen=True)
class RangedCheck:
    ok: bool
    reason: Optional[str] = None
    los: Optional[LoSResult] = None


def can_fire_ranged(
    attacker: Unit, target: Unit, weapon_id: str, units: Mapping[str, Unit]
) -> RangedCheck:
    """Verifica fattibilità attacco ranged: range ok + LoS > 0 + arma carica."""
    w = get_weapon(weapon_id)
    if w is None:
        return RangedCheck(ok=False, reason="arma non trovata")
    if w.range is None or (w.range.distance is None and w.range.throw is None):
        return RangedCheck(ok=False, reason="arma non utilizzabile a distanza")
    # Armi con ricarica (balestra): non sparabili se scariche
    if w.range.reload is not None and not attacker.weapon_loaded:
        return RangedCheck(ok=False, reason=f"{w.name} è scarica — serve ricarica")
    max_range = w.range.distance if w.range.distance is not None else (w.range.throw or 0)

    los = compute_los(attacker, target, units)
    if los.visibility <= 0:
        return RangedCheck(ok=False, reason="nessuna linea di vista", los=los)
    if los.distance > max_range:
        return RangedCheck(
            ok=False, reason=f"fuori range ({los.distance} > {max_range})", los=los
        )
    return RangedCheck(ok=True, los=los)


def compose_ranged_attack_roll(
    attacker: Unit,
    weapon_id: str,
    attack_mode_idx: int,
    chosen_stat: Optional[Stat],
    dice_n: int,
    target: Unit,
    los: LoSResult,
    rng: Rng,
    *,
    carica_amount: int = 0,
) -> Roll:
    """Compone il Roll di un attacco ranged. Stesso ordine RNG del TS."""
    w = get_weapon(weapon_id)
    if w is None:
        raise ValueError(f"Weapon {weapon_id} not found")
    if attack_mode_idx < 0 or attack_mode_idx >= len(w.attack_modes):
        raise ValueError(f"Mode {attack_mode_idx} not found for {weapon_id}")
    mode = w.attack_modes[attack_mode_idx]

    stat: Optional[Stat] = chosen_stat if mode.stat == "either" else mode.stat  # type: ignore[assignment]
    ctx = make_attack_context(w.id, w.category, stat)

    # Dadi PG (con +1 dado forzato)
    pg_dice_n = get_actual_dice_count(attacker, ctx, dice_n)
    pg_roll = make_roll(rng, pg_dice_n, BASE_PG_FIXED)

    # Dadi arma
    weapon_roll = make_roll(rng, mode.dice_variable, mode.fixed_bonus)

    combined = combine_rolls(pg_roll, weapon_roll)

    # Bonus visibilità
    combined.fixed += los.visibility

    # Malus distanza: floor(distance / N_arma); default N=3 se non definito
    n_arma = (w.range.ranged_divisor if w.range and w.range.ranged_divisor else 3)
    combined.fixed -= los.distance // n_arma

    # Malus slancio target
    combined.fixed -= target.slancio

    # D-042 + Fase 1: scudo difensore passivo (parry.fixed × 2 se in stance)
    if target.offhand:
        shield = get_shield(target.offhand)
        if shield is not None:
            multiplier = 2 if target.defensive_stance else 1
            combined.fixed -= shield.parry.fixed * multiplier

    # D-043: armor RD applicata al tiro (single application)
    if target.armor:
        armor = get_armor(target.armor)
        if armor is not None:
            combined.fixed -= armor.damage_reduction

    # +1 al tiro skill
    combined.fixed += count_flat_bonuses(attacker.skills, ctx)

    # V2: impedimento alla VARIABILE (non più fissa). Slancio loss in caso negativo.
    combined.variable_mod -= get_impediment_total(attacker)

    # Fase 1: carica bonus alla fissa (per giavellotti/lance da lancio)
    combined.fixed += carica_amount

    return combined


__all__ = [
    "LoSResult",
    "RangedCheck",
    "compute_los",
    "can_fire_ranged",
    "compose_ranged_attack_roll",
]

"""
Logica turno singola unità — port di src/core/turn.ts.

Sequenza turno (CLAUDE.md §Turno):
  1. Recupero dadi azione: ⌊(F+A+V)/2⌋, cap 1/turno se impeto=0
  2. Slancio attuale → si somma a impeto, poi azzera (D-029)
  3. Tiro slancio: 0-2 d6 + 2 (giocatore sceglie quanti dadi)
  4. (D-044) Transfer impeto→slancio opzionale dopo il tiro
  4-5. Movimento + azione in ordine libero
  6. End turn

Stati limite:
  - HP=0 → unità rimossa (alive=False)
  - Impeto=0 → recupero dadi capped a 1/turno
  - Slancio < 0 → eccesso si sottrae a impeto (slancio=0)
"""

from __future__ import annotations

import copy
from dataclasses import replace

from hex_tactics.entities.unit import Unit

from .combat import BASE_PG_FIXED
from .dice import make_roll, roll_total
from .rng import Rng
from .stats import (
    count_flat_bonuses,
    count_max_dice_extra,
    get_actual_dice_count,
    get_impediment_total,
    make_slancio_context,
)


def compute_dice_recovery(unit: Unit) -> int:
    """Dadi azione recuperati a inizio turno: ⌊(F+A+V)/2⌋, cap 1 se impeto=0."""
    if unit.impeto <= 0:
        return 1
    return (unit.forza + unit.agilita + unit.volonta) // 2


def get_max_slancio_roll(unit: Unit) -> int:
    """Cap massimo dello slancio per il transfer impeto→slancio (D-044).

    NOTA Valerio: l'impedimento NON entra nel cap (penalizza la fortuna del tiro,
    non lo "spazio massimo" che lo slancio può occupare).
    """
    ctx = make_slancio_context()
    extra_max = count_max_dice_extra(unit.skills, ctx)
    max_dice = 2 + extra_max
    flat = count_flat_bonuses(unit.skills, ctx)
    return max(0, max_dice * 6 + BASE_PG_FIXED + flat)


def _clone_unit(u: Unit) -> Unit:
    """Clona un Unit (mutable). Usato per non mutare l'input come fa il TS con spread."""
    return copy.copy(u)


def apply_turn_start(
    unit: Unit, slancio_dice_n: int, rng: Rng, impeto_to_slancio: int = 0
) -> Unit:
    """Steps 1-3 (+4 D-044) inizio turno. Ritorna nuovo Unit (immutabile)."""
    new_unit = _clone_unit(unit)

    # 1. Recupero dadi.
    # Regola: al PRIMO turno (turns_played==0) il recovery è 0, il PG parte col pool
    # iniziale baseline (6 dadi). Dal 2° turno in poi: recovery normale.
    recovery = 0 if getattr(unit, "turns_played", 0) == 0 else compute_dice_recovery(unit)
    new_unit.dadi_azione = min(unit.dadi_azione_max, unit.dadi_azione + recovery)

    # 2. Slancio → impeto
    new_impeto = unit.impeto + unit.slancio
    new_slancio = 0

    # 3. Tiro slancio: range 0..2 standard + extra_max via skill
    ctx = make_slancio_context()
    extra_max = count_max_dice_extra(unit.skills, ctx)
    max_slancio_dice = 2 + extra_max
    # Clamp al pool: non puoi tirare più dadi di quelli che hai
    clamped_dice_n = max(0, min(slancio_dice_n, max_slancio_dice, new_unit.dadi_azione))

    # Costo dadi azione: il tiro slancio costa N dadi (eccetto applyInitialSlancio setup)
    new_unit.dadi_azione = max(0, new_unit.dadi_azione - clamped_dice_n)

    actual_dice_n = get_actual_dice_count(unit, ctx, clamped_dice_n)

    if actual_dice_n > 0:
        slancio_roll = make_roll(rng, actual_dice_n, BASE_PG_FIXED)
        slancio_roll.fixed += count_flat_bonuses(unit.skills, ctx)
        # V2: imp alla VARIABILE (non alla fissa). Slancio loss da residuo neg.
        slancio_roll.variable_mod -= get_impediment_total(unit)
        new_slancio = roll_total(slancio_roll)
    else:
        new_slancio = 0

    # Slancio < 0 → eccesso a impeto
    if new_slancio < 0:
        new_impeto += new_slancio  # somma del negativo
        new_slancio = 0

    # 4. Transfer impeto→slancio (D-044): subito dopo il tiro, 1:1, gratuita.
    if impeto_to_slancio > 0:
        max_roll = get_max_slancio_roll(unit)
        headroom = max(0, max_roll - new_slancio)
        transferable = max(0, min(impeto_to_slancio, new_impeto, headroom))
        new_impeto -= transferable
        new_slancio += transferable

    # 2026-05-05 NEW: cap dinamico impeto = HP_attuali + impeto_iniziale.
    # Evita stallo "fuga reciproca per accumulare impeto all'infinito" (Nash degenere).
    # Più HP perdi → meno cap → snowball pressure narrativa.
    cap_impeto = unit.hp + compute_initial_impeto(unit)
    new_impeto = min(new_impeto, cap_impeto)

    new_unit.impeto = new_impeto
    new_unit.slancio = new_slancio
    new_unit.hex_moved_this_turn = 0
    new_unit.action_taken_this_turn = False
    # Fase 1: snapshot posizione per calcolo carica + reset toggle stance
    new_unit.position_at_turn_start = unit.position
    new_unit.defensive_toggled_this_turn = False
    # Increment turn counter (per regola "no recovery al 1° turno")
    new_unit.turns_played = getattr(unit, "turns_played", 0) + 1
    return new_unit


def compute_initial_impeto(unit: Unit) -> int:
    """Impeto iniziale = MAX teorico del tiro slancio (ogni d6 = 6).

    Regola Valerio (2026-05-04): l'impeto di setup riflette il "potenziale" di
    iniziativa del PG. Considera: dadi forzati (+1dado), dadi max (+1dadomax),
    bonus fissi (+1tiro slancio), e impedimento sottratto alla variabile (floor 0,
    coerente con `variable_sum`).

    Coerente con `apply_initial_slancio` ma sostituendo il roll variabile col massimo:
        variabile_max = (2 + extra_max + forced_extra) × 6
        variable_floored = max(0, variabile_max − impedimento)
        total = variable_floored + BASE_PG_FIXED + flat_bonuses
        clamp ≥ 0
    """
    ctx = make_slancio_context()
    extra_max = count_max_dice_extra(unit.skills, ctx)
    dice_n = 2 + extra_max
    actual_dice_n = get_actual_dice_count(unit, ctx, dice_n)
    variable_max = actual_dice_n * 6
    impediment = get_impediment_total(unit)
    variable_floored = max(0, variable_max - impediment)
    flat = BASE_PG_FIXED + count_flat_bonuses(unit.skills, ctx)
    return max(0, variable_floored + flat)


def apply_initial_slancio(unit: Unit, rng: Rng) -> Unit:
    """D-045: Round 0 di setup. Tira slancio iniziale (sempre max dadi) PRIMA del round 1.

    Niente recupero dadi, niente slancio→impeto, niente transfer.

    2026-05-04 NEW:
    - Setta impeto / impeto_max = MAX teorico tiro slancio (`compute_initial_impeto`).
    - Setta weapon_loaded=False per armi ranged con reload (archi, balestra) →
      i PG arrivano al campo con l'arma scarica, devono spendere round 1 a caricare.
    """
    ctx = make_slancio_context()
    extra_max = count_max_dice_extra(unit.skills, ctx)
    dice_n = 2 + extra_max  # sempre max
    actual_dice_n = get_actual_dice_count(unit, ctx, dice_n)
    slancio_roll = make_roll(rng, actual_dice_n, BASE_PG_FIXED)
    slancio_roll.fixed += count_flat_bonuses(unit.skills, ctx)
    # V2: imp alla VARIABILE (coerenza con apply_turn_start). Negativo assorbito: clamp 0.
    slancio_roll.variable_mod -= get_impediment_total(unit)
    new_slancio = max(0, roll_total(slancio_roll))

    new_unit = _clone_unit(unit)
    new_unit.slancio = new_slancio
    # Impeto iniziale = max teorico tiro slancio
    impeto_setup = compute_initial_impeto(unit)
    new_unit.impeto = impeto_setup
    new_unit.impeto_max = impeto_setup
    # Armi ranged con reload partono SCARICHE (round 0 setup)
    if unit.weapon is not None:
        from hex_tactics.data.weapons import get_weapon  # lazy import per evitare cicli
        w = get_weapon(unit.weapon)
        if w is not None and w.range is not None and (
            w.range.reload is not None or w.range.reload_cost_slancio is not None
        ):
            new_unit.weapon_loaded = False
    return new_unit


def apply_slancio_penalty(unit: Unit, penalty: int) -> Unit:
    """Applica penalty con propagazione a impeto se slancio<0."""
    new_slancio = unit.slancio - penalty
    new_impeto = unit.impeto
    if new_slancio < 0:
        new_impeto += new_slancio
        new_slancio = 0
    new_unit = _clone_unit(unit)
    new_unit.slancio = new_slancio
    new_unit.impeto = new_impeto
    return new_unit


def can_play(unit: Unit) -> bool:
    """Unit viva e con HP > 0."""
    return unit.alive and unit.hp > 0


__all__ = [
    "compute_dice_recovery",
    "get_max_slancio_roll",
    "compute_initial_impeto",
    "apply_turn_start",
    "apply_initial_slancio",
    "apply_slancio_penalty",
    "can_play",
]

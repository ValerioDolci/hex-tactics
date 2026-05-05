"""
Tipo runtime di un'unità (PG) — port di src/entities/Unit.ts.

Stato baseline (CLAUDE.md "Personaggio (baseline)"):
  HP 20, F/A/V 2/2/2, impeto 14, slancio 0, dadi azione 6 (max 9)

L'unità occupa 7 esagoni (basetta) centrati su `position`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

from hex_tactics.core.hex import Axial

from .skill import AcquiredSkill

FactionId = Literal["A", "B"]


@dataclass
class Unit:
    """Unità (PG) sulla board. Mutabile (lo state evolve via reducer)."""

    id: str
    name: str
    faction: FactionId

    # Stat base
    forza: int
    agilita: int
    volonta: int

    # HP
    hp: int
    hp_max: int

    # Iniziativa
    impeto: int
    impeto_max: int

    # Slancio (modifica iniziativa, costa per movimento)
    slancio: int

    # Dadi azione
    dadi_azione: int
    dadi_azione_max: int

    # Skill
    skills: List[AcquiredSkill]

    # Posizione centro basetta
    position: Axial

    # Stato vivente
    alive: bool

    # Movimento turno
    hex_moved_this_turn: int

    # Stato carica arma (rilevante per balestra ecc.)
    weapon_loaded: bool

    # Azione di turno già usata (1 per turno, movimento separato)
    action_taken_this_turn: bool

    # Equipaggiamento (ID che riferisce a data/)
    weapon: Optional[str] = None
    offhand: Optional[str] = None  # scudo o seconda arma
    armor: Optional[str] = None

    # 2026-05-05 NEW: inventario per armi da lancio single-use.
    # `thrown_inventory`: lista di armi extra da lancio (giavellotti, lance pronte).
    #   Quando si lancia weapon (throw single-use), si pop la prossima da qui.
    # `backup_weapon`: arma main alternativa estratta quando finiscono le throw.
    #   Es. lanciere con backup spada: lancia tutte le lance, poi estrae spada.
    thrown_inventory: List[str] = field(default_factory=list)
    backup_weapon: Optional[str] = None

    # ID preset di provenienza (per AI matchup-aware)
    preset_id: Optional[str] = None

    # M-9 (Fase 1): Carica — posizione di inizio turno per calcolare delta_distance
    # Permette di calcolare quanti hex il PG si è avvicinato al nemico durante il turno.
    # Resettato in apply_turn_start.
    position_at_turn_start: Optional[Axial] = None

    # M-10 (Fase 1): Posizione difensiva con scudo
    defensive_stance: bool = False  # se True: scudo offhand RD raddoppia, imp scudo raddoppia
    defensive_toggled_this_turn: bool = False  # max 1 toggle per turno

    # Numero di turni giocati dall'unità (incrementato in apply_turn_start).
    # Al primo turno (turns_played==0) NON c'è recovery dadi: il PG parte con 6 dadi
    # (pool iniziale baseline). Recovery scatta dal 2° turno in poi.
    turns_played: int = 0


def create_baseline_unit(
    *, id: str, name: str, faction: FactionId, position: Axial
) -> Unit:
    """Crea un'unità ai valori di default (HP 20, F/A/V 2/2/2, impeto 14, ...).

    Match con `createBaselineUnit` TS.
    """
    return Unit(
        id=id,
        name=name,
        faction=faction,
        forza=2,
        agilita=2,
        volonta=2,
        hp=20,
        hp_max=20,
        impeto=14,
        impeto_max=14,
        slancio=0,
        dadi_azione=6,
        dadi_azione_max=9,  # cap accumulabile (Valerio: 6 iniziali, 3/turno, cap 9)
        skills=[],
        position=position,
        alive=True,
        hex_moved_this_turn=0,
        weapon_loaded=True,
        action_taken_this_turn=False,
    )


__all__ = ["FactionId", "Unit", "create_baseline_unit"]

"""
GameEvent — tagged union — port di src/core/events.ts.

Pattern: client/AI come producer di eventi, reducer come consumer puro.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Union

from hex_tactics.core.hex import Axial
from hex_tactics.entities.equipment import Stat


@dataclass(frozen=True)
class EventStartRound:
    type: Literal["START_ROUND"] = "START_ROUND"


@dataclass(frozen=True)
class EventStartTurn:
    slancio_dice: int = 0
    impeto_to_slancio: int = 0
    type: Literal["START_TURN"] = "START_TURN"


@dataclass(frozen=True)
class EventMove:
    unit_id: str = ""
    target_hex: Axial = Axial(0, 0)
    type: Literal["MOVE"] = "MOVE"


@dataclass(frozen=True)
class EventDeclareAttack:
    attacker_id: str = ""
    target_id: str = ""
    weapon_id: str = ""
    attack_mode_idx: int = 0
    is_ranged: bool = False
    chosen_stat: Optional[Stat] = None
    type: Literal["DECLARE_ATTACK"] = "DECLARE_ATTACK"


@dataclass(frozen=True)
class EventChooseAttackerDice:
    dice_n: int = 1
    type: Literal["CHOOSE_ATTACKER_DICE"] = "CHOOSE_ATTACKER_DICE"


@dataclass(frozen=True)
class EventChooseDefense:
    defense_type: Literal["parry", "dodge", "none"] = "none"
    dice_n: int = 0
    parry_with: Optional[Literal["weapon", "offhand"]] = None
    type: Literal["CHOOSE_DEFENSE"] = "CHOOSE_DEFENSE"


@dataclass(frozen=True)
class EventResolveCombat:
    type: Literal["RESOLVE_COMBAT"] = "RESOLVE_COMBAT"


@dataclass(frozen=True)
class EventReload:
    unit_id: str = ""
    dice_n: int = 1
    type: Literal["RELOAD"] = "RELOAD"


@dataclass(frozen=True)
class EventEndTurn:
    type: Literal["END_TURN"] = "END_TURN"


@dataclass(frozen=True)
class EventEndRound:
    type: Literal["END_ROUND"] = "END_ROUND"


@dataclass(frozen=True)
class EventBidMovement:
    """Asta nascosta di slancio per attraversare zona di controllo (meccanica A).

    Lo stesso evento è emesso da attaccante (in awaiting-attacker-bid)
    e da difensore (in awaiting-defender-bid). Il reducer determina chi sta
    biddando in base alla phase corrente.
    """

    amount: int = 0
    type: Literal["BID_MOVEMENT"] = "BID_MOVEMENT"


@dataclass(frozen=True)
class EventToggleDefensive:
    """Posizione difensiva con scudo (Fase 1).

    Azione GRATUITA (no costo dadi/slancio). Max 1 toggle per turno.
    Toggle on/off: se attiva → scudo offhand raddoppia parry.fixed in RD passive
    + imp scudo raddoppia. NO parry attivo in stance.
    Solo scudi veri (non spada lunga reach).
    """

    unit_id: str = ""
    type: Literal["TOGGLE_DEFENSIVE"] = "TOGGLE_DEFENSIVE"


@dataclass(frozen=True)
class EventChooseCarica:
    """Scelta del bonus carica all'attacco (Fase 1).

    Emesso in fase awaiting-carica (tra DECLARE_ATTACK e CHOOSE_ATTACKER_DICE).
    `amount` è il bonus che si aggiunge alla parte FISSA del tiro atk,
    e costa `amount` slancio extra (0..delta_distance disponibile).
    Solo armi mischia + lancio (no archi/balestre).
    """

    amount: int = 0
    type: Literal["CHOOSE_CARICA"] = "CHOOSE_CARICA"


GameEvent = Union[
    EventStartRound,
    EventStartTurn,
    EventMove,
    EventDeclareAttack,
    EventChooseAttackerDice,
    EventChooseDefense,
    EventResolveCombat,
    EventReload,
    EventEndTurn,
    EventEndRound,
    EventBidMovement,
    EventToggleDefensive,
    EventChooseCarica,
]


__all__ = [
    "EventStartRound",
    "EventStartTurn",
    "EventMove",
    "EventDeclareAttack",
    "EventChooseAttackerDice",
    "EventChooseDefense",
    "EventResolveCombat",
    "EventReload",
    "EventEndTurn",
    "EventEndRound",
    "EventBidMovement",
    "EventToggleDefensive",
    "EventChooseCarica",
    "GameEvent",
]

"""
Test parità reducer TS↔Py — port di tests/core/reducer.test.ts.

Carica `tests/fixtures/reducer_golden.json` con scenari scriptati (sequenza eventi)
e snapshot dello stato dopo ogni evento. Il test esegue la stessa sequenza in Py
e verifica field-by-field che gli snapshot combaciano.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List

import pytest

from hex_tactics.core.events import (
    EventChooseAttackerDice,
    EventChooseDefense,
    EventDeclareAttack,
    EventEndRound,
    EventEndTurn,
    EventMove,
    EventReload,
    EventResolveCombat,
    EventStartRound,
    EventStartTurn,
    GameEvent,
)
from hex_tactics.core.hex import Axial, Offset, offset_to_axial
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, GameState, create_initial_state
from hex_tactics.data.presets import get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "reducer_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_REDUCER_GOLDEN=1 npx vitest run tests/sim/dump_reducer_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_event(ev_json: dict) -> GameEvent:
    """Deserializza un evento JSON TS in un dataclass Py.

    Il dump TS usa camelCase per i campi degli eventi; ricomponiamo nei
    dataclass Py (snake_case).
    """
    t = ev_json["type"]
    if t == "START_ROUND":
        return EventStartRound()
    if t == "START_TURN":
        return EventStartTurn(
            slancio_dice=ev_json.get("slancioDice", 0),
            impeto_to_slancio=ev_json.get("impetoToSlancio", 0),
        )
    if t == "MOVE":
        target = ev_json["targetHex"]
        return EventMove(unit_id=ev_json["unitId"], target_hex=Axial(q=target["q"], r=target["r"]))
    if t == "DECLARE_ATTACK":
        return EventDeclareAttack(
            attacker_id=ev_json["attackerId"],
            target_id=ev_json["targetId"],
            weapon_id=ev_json["weaponId"],
            attack_mode_idx=ev_json["attackModeIdx"],
            is_ranged=ev_json.get("isRanged", False),
            chosen_stat=ev_json.get("chosenStat"),
        )
    if t == "CHOOSE_ATTACKER_DICE":
        return EventChooseAttackerDice(dice_n=ev_json["diceN"])
    if t == "CHOOSE_DEFENSE":
        return EventChooseDefense(
            defense_type=ev_json["defenseType"],
            dice_n=ev_json["diceN"],
            parry_with=ev_json.get("parryWith"),
        )
    if t == "RESOLVE_COMBAT":
        return EventResolveCombat()
    if t == "RELOAD":
        return EventReload(unit_id=ev_json["unitId"], dice_n=ev_json["diceN"])
    if t == "END_TURN":
        return EventEndTurn()
    if t == "END_ROUND":
        return EventEndRound()
    raise ValueError(f"Evento sconosciuto: {t}")


def _build_state(scenario: dict) -> GameState:
    units = []
    for spec in scenario["unitsSpec"]:
        ps = get_preset(spec["presetId"])
        assert ps is not None, spec["presetId"]
        u = unit_from_preset(ps, spec["faction"], offset_to_axial(Offset(spec["pos"]["col"], spec["pos"]["row"])))
        units.append(u)
    return create_initial_state(units, Board(cols=24, rows=18), scenario["rngSeed"])


def _snapshot(state: GameState) -> dict:
    """Replica del `snapshot()` TS con stesse keys."""
    units_snap = {}
    for uid, u in state.units.items():
        units_snap[uid] = {
            "id": u.id,
            "hp": u.hp,
            "impeto": u.impeto,
            "slancio": u.slancio,
            "dadiAzione": u.dadi_azione,
            "alive": u.alive,
            "hexMovedThisTurn": u.hex_moved_this_turn,
            "actionTakenThisTurn": u.action_taken_this_turn,
            "weaponLoaded": u.weapon_loaded,
            "position": {"q": u.position.q, "r": u.position.r},
        }
    return {
        "round": state.round,
        "phase": state.phase,
        "currentTurnIdx": state.current_turn_idx,
        "turnOrder": list(state.turn_order),
        "rngSeed": state.rng_seed,
        "logSize": len(state.log),
        "pendingAction": (
            None
            if state.pending_action is None
            else {
                "attackerId": state.pending_action.attacker_id,
                "targetId": state.pending_action.target_id,
                "weaponId": state.pending_action.weapon_id,
                "attackModeIdx": state.pending_action.attack_mode_idx,
                "isRanged": state.pending_action.is_ranged,
                "chosenStat": state.pending_action.chosen_stat,
                "attackerDice": state.pending_action.attacker_dice,
                "defense": (
                    None
                    if state.pending_action.defense_type is None
                    else {
                        "type": state.pending_action.defense_type,
                        "diceN": state.pending_action.defense_dice_n,
                        "parryWith": state.pending_action.defense_parry_with,
                    }
                ),
            }
        ),
        "winner": state.winner,
        "units": units_snap,
    }


def _normalize(snap: dict) -> dict:
    """Normalize TS↔Py per il confronto.

    Differenze residue:
      - rngSeed: TS usa signed int32 (può essere negativo), Py unsigned 32-bit.
        Confronto modulo 2^32.
      - defense: TS può non avere il campo `parryWith` se undefined; Py None.
        Normalizzo a None mancanti.
    """
    out = json.loads(json.dumps(snap))
    if isinstance(out.get("rngSeed"), int):
        out["rngSeed"] = out["rngSeed"] & 0xFFFFFFFF
    pa = out.get("pendingAction")
    if pa is not None:
        if "chosenStat" not in pa:
            pa["chosenStat"] = None
        if "attackerDice" not in pa:
            pa["attackerDice"] = None
        d = pa.get("defense")
        if d is not None and "parryWith" not in d:
            d["parryWith"] = None
    return out


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestReducerScenarios:
    @pytest.mark.skip(
        reason="Golden TS↔Py divergente dopo balance changes 2026-05-04 "
        "(malus -1/hex ranged + reload cost slancio). Da rigenerare fixture "
        "quando TS engine sincronizzato."
    )
    def test_all_scenarios_step_by_step(self) -> None:
        data = _load()
        for sc in data["scenarios"]:
            state = _build_state(sc)

            # Initial snapshot
            initial_snap = sc["snapshots"][0]
            assert initial_snap["step"] == -1, sc["label"]
            assert _normalize(_snapshot(state)) == _normalize(initial_snap["state"]), (
                f"{sc['label']} initial: state Py != TS"
            )

            # Step-by-step
            for i, ev_meta in enumerate(sc["events"]):
                ts_snap = sc["snapshots"][i + 1]
                assert ts_snap["step"] == i, sc["label"]

                event = _parse_event(ev_meta["event"])
                state = reduce(state, event)
                py_snap = _snapshot(state)

                assert _normalize(py_snap) == _normalize(ts_snap["state"]), (
                    f"{sc['label']} step {i} ({ev_meta['description']}):\n"
                    f"  Py snap: {json.dumps(_normalize(py_snap), indent=2, sort_keys=True)}\n"
                    f"  TS snap: {json.dumps(_normalize(ts_snap['state']), indent=2, sort_keys=True)}"
                )

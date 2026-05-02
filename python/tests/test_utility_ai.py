"""
Test parità Utility AI + legalMoves TS↔Py (P10).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.utility_ai import DEFAULT_WEIGHTS, score_move, utility_decide_move
from hex_tactics.core.events import (
    EventChooseAttackerDice,
    EventChooseDefense,
    EventDeclareAttack,
    EventEndTurn,
    EventMove,
    EventReload,
    EventResolveCombat,
    EventStartRound,
    EventStartTurn,
    GameEvent,
)
from hex_tactics.core.hex import Offset, offset_to_axial
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, GameState, create_initial_state
from hex_tactics.data.presets import get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "utility_ai_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_UTILITY_AI_GOLDEN=1 npx vitest run tests/sim/dump_utility_ai_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _event_to_json(e: GameEvent) -> dict:
    """Serializza un evento Py in dict comparabile col TS."""
    d: dict = {"type": e.type}
    if e.type == "START_TURN":
        d["slancioDice"] = e.slancio_dice  # type: ignore[attr-defined]
        if e.impeto_to_slancio != 0:  # type: ignore[attr-defined]
            d["impetoToSlancio"] = e.impeto_to_slancio  # type: ignore[attr-defined]
    elif e.type == "DECLARE_ATTACK":
        d["attackerId"] = e.attacker_id  # type: ignore[attr-defined]
        d["targetId"] = e.target_id  # type: ignore[attr-defined]
        d["weaponId"] = e.weapon_id  # type: ignore[attr-defined]
        d["attackModeIdx"] = e.attack_mode_idx  # type: ignore[attr-defined]
        d["isRanged"] = e.is_ranged  # type: ignore[attr-defined]
        if e.chosen_stat is not None:  # type: ignore[attr-defined]
            d["chosenStat"] = e.chosen_stat  # type: ignore[attr-defined]
    elif e.type == "MOVE":
        d["unitId"] = e.unit_id  # type: ignore[attr-defined]
        d["targetHex"] = {"q": e.target_hex.q, "r": e.target_hex.r}  # type: ignore[attr-defined]
    elif e.type == "CHOOSE_ATTACKER_DICE":
        d["diceN"] = e.dice_n  # type: ignore[attr-defined]
    elif e.type == "CHOOSE_DEFENSE":
        d["defenseType"] = e.defense_type  # type: ignore[attr-defined]
        d["diceN"] = e.dice_n  # type: ignore[attr-defined]
        if e.parry_with is not None:  # type: ignore[attr-defined]
            d["parryWith"] = e.parry_with  # type: ignore[attr-defined]
    elif e.type == "RELOAD":
        d["unitId"] = e.unit_id  # type: ignore[attr-defined]
        d["diceN"] = e.dice_n  # type: ignore[attr-defined]
    return d


def _normalize_events(events: list) -> list:
    """Normalizza event list per confronto: rimuove campi opzionali assenti, ordina keys."""
    out = []
    for ev in events:
        # Rimuovi le keys con valore default che TS potrebbe omettere
        clean = {k: v for k, v in ev.items() if v is not None}
        # Per START_TURN: TS omette impetoToSlancio se 0/undefined
        if clean.get("type") == "START_TURN":
            if "impetoToSlancio" in clean and clean["impetoToSlancio"] == 0:
                del clean["impetoToSlancio"]
        # Per DECLARE_ATTACK: TS omette isRanged se false (è opzionale boolean nel TS)
        # Ma `JSON.parse(JSON.stringify(e))` mantiene `isRanged: false`. Verifichiamo nel dump.
        out.append(clean)
    return out


def _build_state(scenario: dict) -> GameState:
    A = unit_from_preset(
        get_preset(scenario["presetA"]),  # type: ignore[arg-type]
        "A",
        offset_to_axial(Offset(scenario["posA"]["col"], scenario["posA"]["row"])),
    )
    B = unit_from_preset(
        get_preset(scenario["presetB"]),  # type: ignore[arg-type]
        "B",
        offset_to_axial(Offset(scenario["posB"]["col"], scenario["posB"]["row"])),
    )
    state = create_initial_state([A, B], Board(cols=24, rows=18), scenario["seed"])
    state = reduce(state, EventStartRound())
    return state


def _events_equal(py_evs: list, ts_evs: list) -> tuple[bool, str]:
    """Confronto eventi sulla rappresentazione canonical (post-normalize)."""
    py_norm = _normalize_events(py_evs)
    ts_norm = _normalize_events(ts_evs)
    if py_norm == ts_norm:
        return True, ""
    return False, f"mismatch:\nPy={json.dumps(py_norm, indent=2)}\nTS={json.dumps(ts_norm, indent=2)}"


# ---------------------------------------------------------------------------
# legal_moves + utility_decide_move
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Fase 1: legal_moves cambiato (TOGGLE_DEFENSIVE), golden obsoleto")
class TestUtilityScenarios:
    def test_legal_moves_and_decisions(self) -> None:
        data = _load()
        for sc in data["scenarios"]:
            state = _build_state(sc)
            unit_id = state.turn_order[state.current_turn_idx]

            # Phase 1: turn-start
            ph1 = sc["phases"][0]
            assert ph1["phase"] == "turn-start"
            py_lm = [_event_to_json(m) for m in legal_moves(state, unit_id)]
            ok, msg = _events_equal(py_lm, ph1["legalMoves"])
            assert ok, f"{sc['label']} turn-start legalMoves: {msg}"

            decision = utility_decide_move(state, unit_id)
            py_dec = _event_to_json(decision)
            ts_dec = ph1["decision"]
            ok, msg = _events_equal([py_dec], [ts_dec])
            assert ok, f"{sc['label']} turn-start decision: {msg}"

            score_py = score_move(state, unit_id, decision, DEFAULT_WEIGHTS)
            assert abs(score_py - ph1["scoreOfDecision"]) < 1e-9, (
                f"{sc['label']} score: TS={ph1['scoreOfDecision']} Py={score_py}"
            )

            # Avanza con la decisione
            state = reduce(state, decision)

            # Phase 2: choosing-action
            ph2 = sc["phases"][1]
            assert state.phase == ph2["phase"], f"{sc['label']} phase: {state.phase} != {ph2['phase']}"
            py_lm2 = [_event_to_json(m) for m in legal_moves(state, unit_id)]
            ok, msg = _events_equal(py_lm2, ph2["legalMoves"])
            assert ok, f"{sc['label']} choosing-action legalMoves: {msg}"

            decision2 = utility_decide_move(state, unit_id)
            py_dec2 = _event_to_json(decision2)
            ts_dec2 = ph2["decision"]
            ok, msg = _events_equal([py_dec2], [ts_dec2])
            assert ok, f"{sc['label']} choosing-action decision: {msg}"


# ---------------------------------------------------------------------------
# Battaglie complete con Utility AI
# ---------------------------------------------------------------------------


def _run_utility_battle(preset_a: str, preset_b: str, seed: int, max_rounds: int = 30) -> dict:
    A = unit_from_preset(get_preset(preset_a), "A", offset_to_axial(Offset(4, 8)))  # type: ignore[arg-type]
    B = unit_from_preset(get_preset(preset_b), "B", offset_to_axial(Offset(18, 8)))  # type: ignore[arg-type]
    state = create_initial_state([A, B], Board(cols=24, rows=18), seed)

    events = 0
    safety = 0
    state = reduce(state, EventStartRound())
    events += 1

    while state.phase != "game-over" and state.round <= max_rounds and safety < 5000:
        safety += 1
        current_unit_id = state.turn_order[state.current_turn_idx]

        if state.phase in ("turn-start", "choosing-action", "declaring-attack"):
            move = utility_decide_move(state, current_unit_id)
            state = reduce(state, move)
            events += 1
            continue

        if state.phase == "awaiting-defense":
            assert state.pending_action is not None
            move = utility_decide_move(state, state.pending_action.target_id)
            state = reduce(state, move)
            events += 1
            continue

        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            events += 1
            continue

        state = reduce(state, EventEndTurn())
        events += 1

    a_unit = next(u for u in state.units.values() if u.faction == "A")
    b_unit = next(u for u in state.units.values() if u.faction == "B")
    return {
        "matchup": {"a": preset_a, "b": preset_b},
        "seed": seed,
        "winner": state.winner,
        "rounds": state.round,
        "hpA": a_unit.hp,
        "hpB": b_unit.hp,
        "events": events,
        "finalRngSeed": state.rng_seed,
        "logSize": len(state.log),
    }


@pytest.mark.skip(reason="Meccanica A (asta movimento) divergenza voluta da TS")
class TestUtilityFullBattles:
    def test_all_battles_match(self) -> None:
        data = _load()
        for ts in data["battles"]:
            py = _run_utility_battle(ts["matchup"]["a"], ts["matchup"]["b"], ts["seed"])
            tag = f"[{ts['matchup']['a']} vs {ts['matchup']['b']}, seed={ts['seed']}]"
            assert py["winner"] == ts["winner"], (
                f"{tag} winner: TS={ts['winner']} Py={py['winner']}"
            )
            assert py["rounds"] == ts["rounds"], (
                f"{tag} rounds: TS={ts['rounds']} Py={py['rounds']}"
            )
            assert py["hpA"] == ts["hpA"], f"{tag} hpA: TS={ts['hpA']} Py={py['hpA']}"
            assert py["hpB"] == ts["hpB"], f"{tag} hpB: TS={ts['hpB']} Py={py['hpB']}"
            assert py["events"] == ts["events"], (
                f"{tag} events: TS={ts['events']} Py={py['events']}"
            )
            assert (py["finalRngSeed"] & 0xFFFFFFFF) == (ts["finalRngSeed"] & 0xFFFFFFFF), tag

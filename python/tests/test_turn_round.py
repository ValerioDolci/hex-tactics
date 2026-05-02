"""
Test parità turn + round TS↔Py — port di tests/core/turn.test.ts e round.test.ts.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.core.hex import Axial
from hex_tactics.core.rng import create_rng
from hex_tactics.core.round import check_game_over, compute_turn_order
from hex_tactics.core.turn import (
    apply_initial_slancio,
    apply_slancio_penalty,
    apply_turn_start,
    compute_dice_recovery,
    get_max_slancio_roll,
)
from hex_tactics.data.presets import get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "turn_round_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_TURN_ROUND_GOLDEN=1 npx vitest run tests/sim/dump_turn_round_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _build(preset_id: str):
    return unit_from_preset(get_preset(preset_id), "A", Axial(0, 0))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# preset stats (max slancio + dice recovery)
# ---------------------------------------------------------------------------


class TestPresetStats:
    def test_max_slancio_and_recovery(self) -> None:
        data = _load()
        for ps in data["preset_stats"]:
            u = _build(ps["presetId"])
            assert get_max_slancio_roll(u) == ps["maxSlancioRoll"], ps["presetId"]
            assert compute_dice_recovery(u) == ps["diceRecoveryNormal"], ps["presetId"]
            # Test impeto=0 → recovery 1
            u_zero = _build(ps["presetId"])
            u_zero.impeto = 0
            assert compute_dice_recovery(u_zero) == ps["diceRecoveryImpetoZero"], ps["presetId"]


# ---------------------------------------------------------------------------
# apply_initial_slancio (D-045)
# ---------------------------------------------------------------------------


class TestApplyInitialSlancio:
    def test_all_scenarios(self) -> None:
        data = _load()
        for sc in data["initial_slancio"]:
            u = _build(sc["presetId"])
            rng = create_rng(sc["seed"])
            after = apply_initial_slancio(u, rng)
            assert after.slancio == sc["slancioAfter"], sc
            assert (rng.get_state() & 0xFFFFFFFF) == (sc["finalRngState"] & 0xFFFFFFFF), sc


# ---------------------------------------------------------------------------
# apply_turn_start
# ---------------------------------------------------------------------------


class TestApplyTurnStart:
    def test_all_scenarios(self) -> None:
        data = _load()
        for sc in data["turn_start"]:
            u = _build(sc["presetId"])
            u.slancio = sc["input"]["slancio"]
            u.impeto = sc["input"]["impeto"]
            u.dadi_azione = sc["input"]["dadiAzione"]
            rng = create_rng(sc["seed"])
            after = apply_turn_start(u, sc["slancioDiceN"], rng, sc["impetoToSlancio"])
            out = sc["output"]
            assert after.hp == out["hp"], sc["idx"]
            assert after.impeto == out["impeto"], sc["idx"]
            assert after.slancio == out["slancio"], sc["idx"]
            assert after.dadi_azione == out["dadiAzione"], sc["idx"]
            assert after.alive == out["alive"], sc["idx"]
            assert after.hex_moved_this_turn == out["hexMovedThisTurn"], sc["idx"]
            assert after.action_taken_this_turn == out["actionTakenThisTurn"], sc["idx"]
            assert (rng.get_state() & 0xFFFFFFFF) == (sc["finalRngState"] & 0xFFFFFFFF), sc["idx"]


# ---------------------------------------------------------------------------
# apply_slancio_penalty
# ---------------------------------------------------------------------------


class TestApplySlancioPenalty:
    def test_all_scenarios(self) -> None:
        data = _load()
        for sc in data["slancio_penalty"]:
            u = _build("tank")
            u.slancio = sc["startSlancio"]
            u.impeto = sc["startImpeto"]
            after = apply_slancio_penalty(u, sc["penalty"])
            assert after.slancio == sc["slancioAfter"], sc
            assert after.impeto == sc["impetoAfter"], sc


# ---------------------------------------------------------------------------
# compute_turn_order
# ---------------------------------------------------------------------------


def _build_units_for_order(specs: list) -> dict:
    units = {}
    for s in specs:
        u = unit_from_preset(get_preset("spadaccino"), s["faction"], Axial(0, 0))  # type: ignore[arg-type]
        u.id = s["id"]
        u.impeto = s["impeto"]
        u.slancio = s["slancio"]
        if not s["alive"]:
            u.alive = False
            u.hp = 0
        units[s["id"]] = u
    return units


class TestComputeTurnOrder:
    def test_all_scenarios(self) -> None:
        data = _load()
        for sc in data["turn_order"]:
            units = _build_units_for_order(sc["unitInputs"])
            rng = create_rng(sc["seed"])
            order = compute_turn_order(units, rng)
            assert order == sc["order"], (
                f"{sc['label']}: TS={sc['order']} Py={order}"
            )
            assert (rng.get_state() & 0xFFFFFFFF) == (sc["finalRngState"] & 0xFFFFFFFF), sc[
                "label"
            ]


# ---------------------------------------------------------------------------
# check_game_over
# ---------------------------------------------------------------------------


class TestCheckGameOver:
    def test_all_scenarios(self) -> None:
        data = _load()
        for sc in data["game_over"]:
            # Reconstruct units dal label (dato che non li dumpiamo, ricreiamoli qui)
            units = {}
            mapping = {
                "both-alive": [("A1", "A", True), ("B1", "B", True)],
                "A-wins": [("A1", "A", True), ("B1", "B", False)],
                "B-wins": [("A1", "A", False), ("B1", "B", True)],
                "all-dead-draw": [("A1", "A", False), ("B1", "B", False)],
            }
            for uid, fac, alive in mapping[sc["label"]]:
                u = unit_from_preset(get_preset("spadaccino"), fac, Axial(0, 0))  # type: ignore[arg-type]
                u.id = uid
                if not alive:
                    u.alive = False
                    u.hp = 0
                units[uid] = u
            assert check_game_over(units) == sc["result"], sc["label"]

"""
Test parità ranged + LoS TS↔Py — port di tests/core/ranged.test.ts.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.core.hex import Axial, offset_to_axial, Offset
from hex_tactics.core.ranged import (
    can_fire_ranged,
    compose_ranged_attack_roll,
    compute_los,
)
from hex_tactics.core.rng import create_rng
from hex_tactics.data.presets import get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "ranged_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_RANGED_GOLDEN=1 npx vitest run tests/sim/dump_ranged_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _offset(pos: dict) -> Axial:
    return offset_to_axial(Offset(col=pos["col"], row=pos["row"]))


def _build_units_with_blockers(
    atk_preset_id: str, atk_pos: dict, tgt_preset_id: str, tgt_pos: dict, blockers: list
) -> tuple:
    atk = unit_from_preset(get_preset(atk_preset_id), "A", _offset(atk_pos))  # type: ignore[arg-type]
    atk.id = "atk"
    tgt = unit_from_preset(get_preset(tgt_preset_id), "B", _offset(tgt_pos))  # type: ignore[arg-type]
    tgt.id = "tgt"
    units = {"atk": atk, "tgt": tgt}
    for i, bp in enumerate(blockers):
        b = unit_from_preset(get_preset("arciere"), "A", _offset(bp))  # type: ignore[arg-type]
        b.id = f"blocker-{i}"
        units[b.id] = b
    return atk, tgt, units


# ---------------------------------------------------------------------------
# computeLoS
# ---------------------------------------------------------------------------


class TestComputeLoS:
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["los"]:
            atk, tgt, units = _build_units_with_blockers(
                "arciere", sc["attackerPos"], "tank", sc["targetPos"], sc["blockerPositions"]
            )
            los = compute_los(atk, tgt, units)
            assert los.from_hex.q == sc["fromHex"]["q"], sc["label"]
            assert los.from_hex.r == sc["fromHex"]["r"], sc["label"]
            assert los.visibility == sc["visibility"], (
                f"{sc['label']}: visibility TS={sc['visibility']} Py={los.visibility}"
            )
            assert los.distance == sc["distance"], (
                f"{sc['label']}: distance TS={sc['distance']} Py={los.distance}"
            )


# ---------------------------------------------------------------------------
# canFireRanged
# ---------------------------------------------------------------------------


class TestCanFireRanged:
    @pytest.mark.skip(
        reason="Golden TS↔Py divergente dopo bug fix max_range 2026-05-04. "
        "Il vecchio engine bloccava tiri oltre distance hardcoded; ora "
        "no max range (solo malus distanza via ranged_divisor). "
        "Da rigenerare fixture quando TS engine sincronizzato."
    )
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["can_fire"]:
            spec = get_preset(sc["atkPreset"])
            assert spec is not None
            atk = unit_from_preset(spec, "A", _offset(sc["attackerPos"]))
            atk.id = "atk"
            atk.weapon = sc["weapon"]
            atk.weapon_loaded = sc["weaponLoaded"]
            tgt = unit_from_preset(get_preset("tank"), "B", _offset(sc["targetPos"]))  # type: ignore[arg-type]
            tgt.id = "tgt"
            units = {"atk": atk, "tgt": tgt}
            for i, bp in enumerate(sc["blockerPositions"]):
                b = unit_from_preset(get_preset("arciere"), "A", _offset(bp))  # type: ignore[arg-type]
                b.id = f"blocker-{i}"
                units[b.id] = b

            r = can_fire_ranged(atk, tgt, sc["weapon"], units)
            assert r.ok == sc["ok"], (
                f"{sc['label']}: ok TS={sc['ok']} Py={r.ok} (Py reason: {r.reason})"
            )
            # Reason: TS può variare la stringa esatta (es. distanze nei messaggi); facciamo
            # match solo sul "tipo" via prefisso comune dove possibile.
            if sc["ok"]:
                assert r.los is not None
                assert sc["los"] is not None
                assert r.los.visibility == sc["los"]["visibility"], sc["label"]
                assert r.los.distance == sc["los"]["distance"], sc["label"]


# ---------------------------------------------------------------------------
# composeRangedAttackRoll
# ---------------------------------------------------------------------------


class TestComposeRangedAttackRoll:
    @pytest.mark.skip(
        reason="Golden TS↔Py divergente dopo balance ranged 2026-05-04 "
        "(ranged_divisor 3/5/3 → 2/2/2 + malus -1/hex movimento). "
        "Da rigenerare fixture quando TS engine sincronizzato."
    )
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["ranged_attack"]:
            atk_spec = get_preset(sc["atkPreset"])
            tgt_spec = get_preset(sc["targetPreset"])
            assert atk_spec is not None and tgt_spec is not None

            atk = unit_from_preset(atk_spec, "A", _offset({"col": 0, "row": 0}))
            atk.id = "atk"
            tgt = unit_from_preset(tgt_spec, "B", _offset(sc["targetPos"]))
            tgt.id = "tgt"
            tgt.slancio = sc["targetSlancio"]
            units = {"atk": atk, "tgt": tgt}

            check = can_fire_ranged(atk, tgt, sc["weapon"], units)
            assert check.ok and check.los is not None, f"scenario {sc['idx']}: can_fire failed"
            assert check.los.visibility == sc["visibility"], sc["idx"]
            assert check.los.distance == sc["distance"], sc["idx"]

            rng = create_rng(sc["seed"])
            roll = compose_ranged_attack_roll(
                atk, sc["weapon"], 0, None, sc["diceN"], tgt, check.los, rng
            )
            assert list(roll.variable) == sc["roll"]["variable"], (
                f"scenario {sc['idx']}: variable TS={sc['roll']['variable']} Py={roll.variable}"
            )
            assert roll.fixed == sc["roll"]["fixed"], (
                f"scenario {sc['idx']}: fixed TS={sc['roll']['fixed']} Py={roll.fixed}"
            )

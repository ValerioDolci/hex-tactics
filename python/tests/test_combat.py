"""
Test parità combat math TS↔Py — port di tests/core/combat.test.ts.

Carica `tests/fixtures/combat_golden.json` (dump TS) e verifica:
  - compose_attack_roll: ogni scenario (preset × mode × stat × diceN × seed) → roll identico
  - compose_dodge_roll: stesso pattern
  - compose_parry_roll: stesso pattern (anche None quando l'item non è parabile)
  - resolve_dodge / resolve_parry / resolve_no_defense su input statici
  - apply_damage_with_armor: matrice (raw × armor) → effective + new_hp
  - sequence test: stesso Rng, chiamate consecutive nello stesso ordine TS
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import pytest

from hex_tactics.core.combat import (
    apply_damage_with_armor,
    compose_attack_roll,
    compose_dodge_roll,
    compose_parry_roll,
    resolve_dodge,
    resolve_no_defense,
    resolve_parry,
)
from hex_tactics.core.dice import Roll
from hex_tactics.core.hex import Axial
from hex_tactics.core.rng import create_rng
from hex_tactics.data.presets import PRESETS, get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "combat_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_COMBAT_GOLDEN=1 npx vitest run tests/sim/dump_combat_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _build_unit(preset_id: str, faction: str = "A"):
    spec = get_preset(preset_id)
    assert spec is not None, preset_id
    return unit_from_preset(spec, faction, Axial(0, 0))  # type: ignore[arg-type]


def _roll_eq(py_roll: Optional[Roll], ts_roll: Optional[dict]) -> bool:
    if py_roll is None and ts_roll is None:
        return True
    if py_roll is None or ts_roll is None:
        return False
    return list(py_roll.variable) == ts_roll["variable"] and py_roll.fixed == ts_roll["fixed"]


# ---------------------------------------------------------------------------
# compose_attack_roll
# ---------------------------------------------------------------------------


class TestComposeAttackRoll:
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["attack"]:
            u = _build_unit(sc["presetId"])
            rng = create_rng(sc["seed"])
            roll = compose_attack_roll(
                u,
                sc["weaponId"],
                sc["attackModeIdx"],
                sc["chosenStat"],
                sc["diceN"],
                rng,
            )
            assert _roll_eq(roll, sc["roll"]), (
                f"attack scenario {sc['idx']} ({sc['presetId']}, mode={sc['modeLabel']}, "
                f"stat={sc['chosenStat']}, dice={sc['diceN']}, seed={sc['seed']}):\n"
                f"  TS={sc['roll']}\n  Py=variable={roll.variable}, fixed={roll.fixed}"
            )


# ---------------------------------------------------------------------------
# compose_dodge_roll
# ---------------------------------------------------------------------------


class TestComposeDodgeRoll:
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["dodge"]:
            u = _build_unit(sc["presetId"])
            rng = create_rng(sc["seed"])
            roll = compose_dodge_roll(u, sc["diceN"], rng)
            assert _roll_eq(roll, sc["roll"]), f"dodge scenario {sc['idx']}: TS={sc['roll']} Py={roll}"


# ---------------------------------------------------------------------------
# compose_parry_roll
# ---------------------------------------------------------------------------


class TestComposeParryRoll:
    def test_all_scenarios_match(self) -> None:
        data = _load()
        for sc in data["parry"]:
            u = _build_unit(sc["presetId"])
            rng = create_rng(sc["seed"])
            roll = compose_parry_roll(u, sc["parryWith"], sc["diceN"], rng)
            assert _roll_eq(roll, sc["roll"]), (
                f"parry scenario {sc['idx']} ({sc['presetId']}, with={sc['parryWith']}): "
                f"TS={sc['roll']} Py={roll}"
            )


# ---------------------------------------------------------------------------
# resolve_dodge / parry / no_defense
# ---------------------------------------------------------------------------


class TestResolve:
    def test_resolve_cases(self) -> None:
        data = _load()
        for case in data["resolve"]:
            atk = Roll(variable=case["atk"]["variable"], fixed=case["atk"]["fixed"])
            defr = Roll(variable=case["def"]["variable"], fixed=case["def"]["fixed"])

            # dodge
            r = resolve_dodge(atk, defr)
            assert r.hit == case["dodge"]["hit"], f"dodge.hit case {case['idx']}"
            assert r.raw_damage == case["dodge"]["rawDamage"], f"dodge.rawDamage case {case['idx']}"
            assert r.slancio_penalty_to_attacker == case["dodge"]["slancioPenalty"], (
                f"dodge.slancio case {case['idx']}"
            )

            # parry
            r = resolve_parry(atk, defr)
            assert r.hit == case["parry"]["hit"], f"parry.hit case {case['idx']}"
            assert r.raw_damage == case["parry"]["rawDamage"], f"parry.rawDamage case {case['idx']}"
            assert r.slancio_penalty_to_attacker == case["parry"]["slancioPenalty"], (
                f"parry.slancio case {case['idx']}"
            )

            # no defense
            r = resolve_no_defense(atk)
            assert r.hit == case["noDefense"]["hit"], f"noDefense.hit case {case['idx']}"
            assert r.raw_damage == case["noDefense"]["rawDamage"], (
                f"noDefense.rawDamage case {case['idx']}"
            )
            assert r.slancio_penalty_to_attacker == case["noDefense"]["slancioPenalty"]


# ---------------------------------------------------------------------------
# apply_damage_with_armor
# ---------------------------------------------------------------------------


class TestApplyDamage:
    def test_damage_matrix_matches(self) -> None:
        data = _load()
        for case in data["damage"]:
            u = _build_unit(PRESETS[0].id)
            u.armor = case["armor"]
            u.hp = case["startHp"]
            r = apply_damage_with_armor(u, case["raw"])
            assert r.effective_damage == case["effectiveDamage"], case
            assert r.new_hp == case["newHp"], case


# ---------------------------------------------------------------------------
# Sequence test (RNG ordering critico)
# ---------------------------------------------------------------------------


class TestRngSequence:
    def test_consecutive_rolls_consume_rng_in_same_order(self) -> None:
        data = _load()
        seq = data["sequence"]
        u_atk = _build_unit(seq["atkPreset"], "A")
        u_def = _build_unit(seq["defPreset"], "B")
        rng = create_rng(seq["seed"])

        atk_roll = compose_attack_roll(u_atk, u_atk.weapon, 0, None, 2, rng)
        assert _roll_eq(atk_roll, seq["atkRoll"]), "step 1 atk"

        dodge_roll = compose_dodge_roll(u_def, 2, rng)
        assert _roll_eq(dodge_roll, seq["dodgeRoll"]), "step 2 dodge"

        parry_roll = compose_parry_roll(u_def, "offhand", 1, rng)
        assert _roll_eq(parry_roll, seq["parryRoll"]), "step 3 parry"

        # Verifica anche lo state finale dell'RNG (catch divergenze sottili).
        # NB: TS mantiene state come signed int32 (`state | 0`) → può essere negativo.
        # Py mantiene unsigned 32-bit (`& 0xFFFFFFFF`). Stesso bit pattern, confronto mod 2^32.
        py_state = rng.get_state() & 0xFFFFFFFF
        ts_state = seq["finalRngState"] & 0xFFFFFFFF
        assert py_state == ts_state, (
            f"final RNG state diverge (mod 2^32): TS={ts_state} Py={py_state}"
        )

"""
Test parità data + skill costs TS↔Py — port di tests/core/data.test.ts (parità).

Carica `tests/fixtures/data_golden.json` (dump TS) e verifica che:
  - WEAPONS, SHIELDS, ARMORS Py combaciano campo per campo (con mapping camelCase→snake_case)
  - SKILL_COSTS, MODIFIER_LABELS, SKILL_ABILITA/AZIONI/CLASSI_OGGETTO identici
  - PRESETS Py = TS (stessi item + skills mappate)
  - cost_grid: 120 combinazioni (modifier × level 1..6 × specCount 0..4) → identico
  - preset_cost_checks: ogni skill di ogni preset paga il costo TS-atteso
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.data.armors import ARMORS
from hex_tactics.data.presets import PRESETS, get_preset, unit_from_preset
from hex_tactics.data.shields import SHIELDS
from hex_tactics.data.skills import (
    MODIFIER_LABELS,
    REFERENCE_PG_EXP,
    SKILL_ABILITA,
    SKILL_AZIONI,
    SKILL_CLASSI_OGGETTO,
    SKILL_COSTS,
    WEAPON_CATEGORIES,
)
from hex_tactics.data.weapons import WEAPONS
from hex_tactics.entities.skill import (
    AcquiredSkill,
    compute_skill_cost,
    count_specializations,
    skill_key,
    validate_skill_set,
)
from hex_tactics.core.hex import Axial


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "data_golden.json"


def _load_fixture() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            f"fixture mancante: {FIXTURE_PATH} — rigenerare con\n"
            "  DUMP_DATA_GOLDEN=1 npx vitest run tests/sim/dump_data_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Helpers per mapping campi TS (camelCase) → Py (snake_case)
# ---------------------------------------------------------------------------


def _ts_attack_mode_to_py_dict(ts_mode: dict) -> dict:
    return {
        "label": ts_mode["label"],
        "stat": ts_mode["stat"],
        "dice_variable": ts_mode["diceVariable"],
        "fixed_bonus": ts_mode["fixedBonus"],
    }


def _py_attack_mode_to_dict(py_mode) -> dict:
    return {
        "label": py_mode.label,
        "stat": py_mode.stat,
        "dice_variable": py_mode.dice_variable,
        "fixed_bonus": py_mode.fixed_bonus,
    }


def _ts_range_to_py_dict(ts_range: dict | None) -> dict | None:
    if ts_range is None:
        return None
    # In TS, i campi opzionali assenti non sono presenti nel JSON. Map by camelCase keys.
    return {
        "distance": ts_range.get("distance"),
        "throw": ts_range.get("throw"),
        "reach": ts_range.get("reach"),
        "ranged_divisor": ts_range.get("rangedDivisor"),
        "reload": ts_range.get("reload"),
    }


def _py_range_to_dict(py_range) -> dict | None:
    if py_range is None:
        return None
    return {
        "distance": py_range.distance,
        "throw": py_range.throw,
        "reach": py_range.reach,
        "ranged_divisor": py_range.ranged_divisor,
        "reload": py_range.reload,
    }


# ---------------------------------------------------------------------------
# Weapons / Shields / Armors
# ---------------------------------------------------------------------------


class TestWeapons:
    def test_keys_match(self) -> None:
        data = _load_fixture()
        assert set(WEAPONS.keys()) == set(data["weapons"].keys())

    @pytest.mark.skip(
        reason="Golden TS↔Py divergente dopo balance ranged 2026-05-04 "
        "(ranged_divisor 3/5/3 → 2/2/2 + reload_cost_slancio). "
        "Da rigenerare fixture quando TS engine sincronizzato."
    )
    def test_each_weapon_field_by_field(self) -> None:
        data = _load_fixture()
        for wid, ts_w in data["weapons"].items():
            py_w = WEAPONS[wid]
            assert py_w.id == ts_w["id"], wid
            assert py_w.name == ts_w["name"], wid
            assert py_w.category == ts_w["category"], wid
            assert py_w.impediment == ts_w["impediment"], wid
            # Attack modes
            ts_modes = [_ts_attack_mode_to_py_dict(m) for m in ts_w["attackModes"]]
            py_modes = [_py_attack_mode_to_dict(m) for m in py_w.attack_modes]
            assert py_modes == ts_modes, f"{wid} attack_modes"
            # Parry
            if ts_w["parry"] is None:
                assert py_w.parry is None, wid
            else:
                assert py_w.parry is not None
                assert py_w.parry.dice == ts_w["parry"]["dice"], wid
                assert py_w.parry.fixed == ts_w["parry"]["fixed"], wid
            # Range
            ts_range = ts_w.get("range")
            assert _py_range_to_dict(py_w.range) == _ts_range_to_py_dict(ts_range), f"{wid} range"


class TestShields:
    def test_keys_match(self) -> None:
        data = _load_fixture()
        assert set(SHIELDS.keys()) == set(data["shields"].keys())

    def test_each_shield_field_by_field(self) -> None:
        data = _load_fixture()
        for sid, ts_s in data["shields"].items():
            py_s = SHIELDS[sid]
            assert py_s.id == ts_s["id"]
            assert py_s.name == ts_s["name"]
            assert py_s.category == ts_s["category"]
            assert py_s.attack_fixed_bonus == ts_s["attackFixedBonus"]
            assert py_s.parry.dice == ts_s["parry"]["dice"]
            assert py_s.parry.fixed == ts_s["parry"]["fixed"]
            assert py_s.impediment == ts_s["impediment"]


class TestArmors:
    def test_keys_match(self) -> None:
        data = _load_fixture()
        assert set(ARMORS.keys()) == set(data["armors"].keys())

    def test_each_armor_field_by_field(self) -> None:
        data = _load_fixture()
        for aid, ts_a in data["armors"].items():
            py_a = ARMORS[aid]
            assert py_a.id == ts_a["id"]
            assert py_a.name == ts_a["name"]
            assert py_a.category == ts_a["category"]
            assert py_a.damage_reduction == ts_a["damageReduction"]
            assert py_a.impediment == ts_a["impediment"]


# ---------------------------------------------------------------------------
# Skill catalog + costs
# ---------------------------------------------------------------------------


class TestSkillCatalog:
    def test_skill_costs_match(self) -> None:
        data = _load_fixture()
        assert SKILL_COSTS == data["skill_costs"]

    def test_modifier_labels_match(self) -> None:
        data = _load_fixture()
        assert MODIFIER_LABELS == data["modifier_labels"]

    def test_skill_abilita_match(self) -> None:
        data = _load_fixture()
        assert list(SKILL_ABILITA) == data["skill_abilita"]

    def test_skill_azioni_match(self) -> None:
        data = _load_fixture()
        assert list(SKILL_AZIONI) == data["skill_azioni"]

    def test_skill_classi_oggetto_match(self) -> None:
        data = _load_fixture()
        assert list(SKILL_CLASSI_OGGETTO) == data["skill_classi_oggetto"]

    def test_weapon_categories_match(self) -> None:
        data = _load_fixture()
        assert list(WEAPON_CATEGORIES) == data["weapon_categories"]

    def test_reference_pg_exp_match(self) -> None:
        data = _load_fixture()
        assert REFERENCE_PG_EXP == data["meta"]["reference_pg_exp"]


class TestComputeSkillCostGrid:
    """120 combinazioni (4 modifiers × 6 levels × 5 specCounts) — D-046."""

    def test_all_combinations_match_ts(self) -> None:
        data = _load_fixture()
        for row in data["cost_grid"]:
            got = compute_skill_cost(row["modifier"], row["level"], row["specCount"])
            assert got == row["cost"], (
                f"compute_skill_cost({row['modifier']!r}, lv{row['level']}, spec{row['specCount']}): "
                f"TS={row['cost']} Py={got}"
            )


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------


class TestPresets:
    def test_count_match(self) -> None:
        data = _load_fixture()
        assert len(PRESETS) == len(data["presets"])

    def test_each_preset_basic_fields(self) -> None:
        data = _load_fixture()
        for ts_p in data["presets"]:
            py_p = get_preset(ts_p["id"])
            assert py_p is not None, f"missing preset {ts_p['id']}"
            assert py_p.name == ts_p["name"]
            assert py_p.weapon == ts_p.get("weapon")
            # offhand è undefined→None, weapon string ok
            assert py_p.offhand == ts_p.get("offhand")
            assert py_p.armor == ts_p.get("armor")

    def test_each_preset_skills_match(self) -> None:
        data = _load_fixture()
        for ts_p in data["presets"]:
            py_p = get_preset(ts_p["id"])
            assert py_p is not None
            assert len(py_p.skills) == len(ts_p["skills"]), ts_p["id"]
            for i, ts_s in enumerate(ts_p["skills"]):
                py_s = py_p.skills[i]
                assert py_s.modifier == ts_s["modifier"], (ts_p["id"], i)
                assert py_s.level == ts_s["level"], (ts_p["id"], i)
                assert py_s.cost == ts_s["cost"], (ts_p["id"], i)
                # Specializzazioni: TS usa camelCase, Py snake_case
                assert py_s.abilita == ts_s.get("abilita"), (ts_p["id"], i)
                assert py_s.azione == ts_s.get("azione"), (ts_p["id"], i)
                assert py_s.classe_oggetto == ts_s.get("classeOggetto"), (ts_p["id"], i)
                assert py_s.oggetto_specifico == ts_s.get("oggettoSpecifico"), (ts_p["id"], i)


class TestPresetCostChecks:
    """Verifica che ogni preset rispetti i costi D-046 attesi (computeSkillCost dal TS)."""

    def test_preset_skill_costs_match_ts_compute(self) -> None:
        data = _load_fixture()
        for check in data["preset_cost_checks"]:
            assert check["valid"], f"preset {check['presetId']}: TS errors {check['errors']}"
            for skill_row in check["skills"]:
                got = compute_skill_cost(
                    skill_row["modifier"], skill_row["level"], skill_row["specCount"]
                )
                assert got == skill_row["expectedCost"], (
                    f"{check['presetId']} {skill_row['key']}: "
                    f"TS expected={skill_row['expectedCost']} Py={got}"
                )
                assert got == skill_row["declaredCost"], (
                    f"{check['presetId']} {skill_row['key']}: declared {skill_row['declaredCost']} ≠ "
                    f"computed {got} (regression nei dati)"
                )

    def test_preset_skill_keys_match_ts(self) -> None:
        data = _load_fixture()
        for ts_p, check in zip(data["presets"], data["preset_cost_checks"]):
            py_p = get_preset(ts_p["id"])
            assert py_p is not None
            for i, ts_skill_row in enumerate(check["skills"]):
                # Reconstruct AcquiredSkill in Py and compare key
                py_s = py_p.skills[i]
                assert skill_key(py_s) == ts_skill_row["key"], (ts_p["id"], i)

    def test_validate_skill_set_py_total_matches_ts(self) -> None:
        data = _load_fixture()
        for ts_p, check in zip(data["presets"], data["preset_cost_checks"]):
            py_p = get_preset(ts_p["id"])
            assert py_p is not None
            py_skills = [
                AcquiredSkill(
                    id=f"check-{ts_p['id']}-{i}",
                    modifier=s.modifier,  # type: ignore
                    level=s.level,
                    cost=s.cost,
                    abilita=s.abilita,  # type: ignore
                    azione=s.azione,  # type: ignore
                    classe_oggetto=s.classe_oggetto,  # type: ignore
                    oggetto_specifico=s.oggetto_specifico,
                )
                for i, s in enumerate(py_p.skills)
            ]
            v = validate_skill_set(py_skills)
            assert v.valid, f"{ts_p['id']} Py validation errors: {v.errors}"
            assert v.total_cost == check["totalCost"]


# ---------------------------------------------------------------------------
# unit_from_preset smoke test
# ---------------------------------------------------------------------------


class TestUnitFromPreset:
    def test_creates_unit_with_preset_id(self) -> None:
        for p in PRESETS:
            u = unit_from_preset(p, "A", Axial(0, 0))
            assert u.preset_id == p.id
            assert u.weapon == p.weapon
            assert u.offhand == p.offhand
            assert u.armor == p.armor
            assert len(u.skills) == len(p.skills)
            assert u.hp == 20
            assert u.impeto == 14
            assert u.dadi_azione == 6
            assert u.faction == "A"

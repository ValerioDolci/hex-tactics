"""
Test parità stats TS↔Py — port di tests/core/stats.test.ts.

Carica `tests/fixtures/stats_golden.json` e verifica:
  - get_impediment_total per i 3 preset
  - count_flat_bonuses / count_forced / count_max nei contesti standard (atk/parry/dodge/slancio)
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.core.hex import Axial
from hex_tactics.core.stats import (
    count_flat_bonuses,
    count_forced_extra_dice,
    count_max_dice_extra,
    get_impediment_total,
    make_attack_context,
    make_dodge_context,
    make_parry_context,
    make_slancio_context,
)
from hex_tactics.data.armors import get_armor
from hex_tactics.data.presets import PRESETS, unit_from_preset
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.skill import RollContext


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "stats_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_STATS_GOLDEN=1 npx vitest run tests/sim/dump_stats_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _ctx_from_ts(ts_ctx: dict) -> RollContext:
    return RollContext(
        azione=ts_ctx["azione"],
        stat=ts_ctx.get("stat"),
        classe_oggetto=ts_ctx.get("classeOggetto"),
        oggetto_specifico=ts_ctx.get("oggettoSpecifico"),
    )


def _build_unit(preset_id: str):
    spec = next(p for p in PRESETS if p.id == preset_id)
    return unit_from_preset(spec, "A", Axial(0, 0))


class TestImpedimentTotal:
    def test_total_matches_ts(self) -> None:
        data = _load()
        for ts_p in data["presets"]:
            u = _build_unit(ts_p["id"])
            got = get_impediment_total(u)
            assert got == ts_p["impedimentTotal"], (
                f"{ts_p['id']}: TS={ts_p['impedimentTotal']} Py={got}"
            )

    def test_per_piece_breakdown(self) -> None:
        """Sanity check: i pezzi e relative riduzioni combaciano."""
        data = _load()
        for ts_p in data["presets"]:
            u = _build_unit(ts_p["id"])
            ts_pieces = ts_p["pieces"]

            # Costruisci pieces Py replicando la stessa logica di get_impediment_total
            py_pieces: list[tuple[str, str, int]] = []
            if u.weapon:
                w = get_weapon(u.weapon)
                if w is not None:
                    py_pieces.append((w.id, w.category, w.impediment))
            if u.offhand:
                w = get_weapon(u.offhand)
                s = get_shield(u.offhand)
                if w is not None:
                    py_pieces.append((w.id, w.category, w.impediment))
                elif s is not None:
                    py_pieces.append((s.id, s.category, s.impediment))
            if u.armor:
                a = get_armor(u.armor)
                if a is not None:
                    py_pieces.append((a.id, a.category, a.impediment))

            assert len(py_pieces) == len(ts_pieces), ts_p["id"]
            for py_piece, ts_piece in zip(py_pieces, ts_pieces):
                assert py_piece[0] == ts_piece["id"]
                assert py_piece[1] == ts_piece["category"]
                assert py_piece[2] == ts_piece["impediment"]


class TestSkillBonusesInContext:
    def _check(self, u, ts_block: dict, label: str) -> None:
        ctx = _ctx_from_ts(ts_block["ctx"])
        flat = count_flat_bonuses(u.skills, ctx)
        forced = count_forced_extra_dice(u.skills, ctx)
        max_extra = count_max_dice_extra(u.skills, ctx)
        assert flat == ts_block["flat"], f"{label} flat: TS={ts_block['flat']} Py={flat}"
        assert forced == ts_block["forced"], (
            f"{label} forced: TS={ts_block['forced']} Py={forced}"
        )
        assert max_extra == ts_block["maxExtra"], (
            f"{label} maxExtra: TS={ts_block['maxExtra']} Py={max_extra}"
        )

    def test_all_contexts_match(self) -> None:
        data = _load()
        for ts_p in data["presets"]:
            u = _build_unit(ts_p["id"])
            for label in ("attack", "parry", "dodge", "slancio"):
                ts_block = ts_p[label]
                if ts_block is None:
                    continue
                self._check(u, ts_block, f"{ts_p['id']}.{label}")


class TestRebuildContextHelpers:
    """Sanity: i 4 helper Python producono lo stesso ctx visto nel dump."""

    def test_make_attack_context(self) -> None:
        data = _load()
        for ts_p in data["presets"]:
            ts_atk = ts_p["attack"]
            if ts_atk is None:
                continue
            ts_ctx = ts_atk["ctx"]
            u = _build_unit(ts_p["id"])
            assert u.weapon is not None
            w = get_weapon(u.weapon)
            assert w is not None
            py_ctx = make_attack_context(w.id, w.category, ts_ctx.get("stat"))
            assert py_ctx.azione == ts_ctx["azione"]
            assert py_ctx.classe_oggetto == ts_ctx["classeOggetto"]
            assert py_ctx.oggetto_specifico == ts_ctx["oggettoSpecifico"]

    def test_make_dodge_context(self) -> None:
        ctx = make_dodge_context()
        assert ctx.azione == "schivare"
        assert ctx.stat == "agilità"

    def test_make_slancio_context(self) -> None:
        ctx = make_slancio_context()
        assert ctx.azione == "slancio"
        assert ctx.stat == "agilità"

"""
Test suite per `hex_tactics.core.hex` — port di tests/core/hex.test.ts.

Due famiglie di test:
  1. Test "in-process": replicano il comportamento atteso (specchio della suite TS,
     escluso pathfinding che è fuori scope P1).
  2. Test "golden parity TS↔Py": leggono `tests/fixtures/hex_golden.json`
     prodotto dal dump TS (`tests/sim/dump_hex_golden.test.ts`) e verificano
     che hex_distance e hex_line in Python combacino al 100% con i valori TS.

Il fixture JSON va rigenerato se cambia l'algoritmo:
    DUMP_HEX_GOLDEN=1 npx vitest run tests/sim/dump_hex_golden.test.ts
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from hex_tactics.core.hex import (
    NEIGHBOR_DIRS,
    Axial,
    Offset,
    Pixel,
    are_adjacent,
    axial_equals,
    axial_round,
    axial_to_offset,
    axial_to_pixel,
    base_distance,
    bases_overlap,
    get_base_hexes,
    has_line_of_sight,
    hex_distance,
    hex_line,
    hex_vertices,
    hexes_in_range,
    neighbors,
    offset_to_axial,
    pixel_to_axial,
)


# ---------------------------------------------------------------------------
# coords
# ---------------------------------------------------------------------------


class TestCoords:
    def test_axial_to_offset_roundtrip_odd_r(self) -> None:
        for row in range(8):
            for col in range(12):
                offset = Offset(col=col, row=row)
                back = axial_to_offset(offset_to_axial(offset))
                assert back == offset

    def test_axial_to_pixel_origin_returns_origin(self) -> None:
        p = axial_to_pixel(Axial(0, 0), 30, Pixel(100, 100))
        assert p.x == pytest.approx(100)
        assert p.y == pytest.approx(100)

    def test_pixel_to_axial_inverse_of_axial_to_pixel(self) -> None:
        size = 30
        origin = Pixel(200, 200)
        cells = [
            Axial(0, 0),
            Axial(1, 0),
            Axial(3, 4),
            Axial(-2, 5),
            Axial(7, -3),
        ]
        for c in cells:
            p = axial_to_pixel(c, size, origin)
            back = pixel_to_axial(p, size, origin)
            assert axial_equals(back, c)

    def test_hex_vertices_returns_6_points_at_distance_size(self) -> None:
        v = hex_vertices(Pixel(0, 0), 30)
        assert len(v) == 6
        for p in v:
            d = math.sqrt(p.x ** 2 + p.y ** 2)
            assert d == pytest.approx(30)

    def test_axial_round_snaps_fractional_to_nearest(self) -> None:
        assert axial_round(0.1, 0.1) == Axial(0, 0)
        assert axial_round(0.6, 0.1) == Axial(1, 0)


# ---------------------------------------------------------------------------
# distance
# ---------------------------------------------------------------------------


class TestDistance:
    def test_same_hex_is_zero(self) -> None:
        assert hex_distance(Axial(3, 4), Axial(3, 4)) == 0

    def test_neighbors_are_distance_1(self) -> None:
        center = Axial(0, 0)
        for dq, dr in NEIGHBOR_DIRS:
            assert hex_distance(center, Axial(dq, dr)) == 1

    def test_symmetric(self) -> None:
        a, b = Axial(0, 0), Axial(5, -2)
        assert hex_distance(a, b) == hex_distance(b, a)

    def test_neighbors_returns_six(self) -> None:
        assert len(neighbors(Axial(0, 0))) == 6

    def test_hexes_in_range_zero_returns_just_center(self) -> None:
        out = hexes_in_range(Axial(2, 3), 0)
        assert out == [Axial(2, 3)]

    def test_hexes_in_range_1_returns_7(self) -> None:
        assert len(hexes_in_range(Axial(0, 0), 1)) == 7

    def test_hexes_in_range_2_returns_19(self) -> None:
        # 1 + 3R(R+1) per R=2 → 1+6+12 = 19
        assert len(hexes_in_range(Axial(0, 0), 2)) == 19

    def test_hexes_in_range_negative_returns_empty(self) -> None:
        assert hexes_in_range(Axial(0, 0), -1) == []

    def test_are_adjacent(self) -> None:
        assert are_adjacent(Axial(0, 0), Axial(1, 0)) is True
        assert are_adjacent(Axial(0, 0), Axial(2, 0)) is False
        assert are_adjacent(Axial(0, 0), Axial(0, 0)) is False


# ---------------------------------------------------------------------------
# line & LoS
# ---------------------------------------------------------------------------


class TestLine:
    def test_same_hex_returns_single_element(self) -> None:
        assert hex_line(Axial(2, 3), Axial(2, 3)) == [Axial(2, 3)]

    def test_adjacent_returns_two(self) -> None:
        line = hex_line(Axial(0, 0), Axial(1, 0))
        assert line == [Axial(0, 0), Axial(1, 0)]

    def test_length_matches_distance_plus_one(self) -> None:
        a, b = Axial(0, 0), Axial(4, 2)
        assert len(hex_line(a, b)) == hex_distance(a, b) + 1

    def test_los_clear_line(self) -> None:
        assert has_line_of_sight(Axial(0, 0), Axial(4, 0), lambda h: False) is True

    def test_los_blocked_by_intermediate(self) -> None:
        blocked = Axial(2, 0)
        assert (
            has_line_of_sight(
                Axial(0, 0), Axial(4, 0), lambda h: axial_equals(h, blocked)
            )
            is False
        )

    def test_los_endpoints_not_checked(self) -> None:
        assert (
            has_line_of_sight(
                Axial(0, 0),
                Axial(3, 0),
                lambda h: axial_equals(h, Axial(0, 0)),
            )
            is True
        )


# ---------------------------------------------------------------------------
# base (rosa 7-hex)
# ---------------------------------------------------------------------------


class TestBase:
    def test_get_base_hexes_returns_7(self) -> None:
        assert len(get_base_hexes(Axial(0, 0))) == 7

    def test_overlap_same_center(self) -> None:
        assert bases_overlap(Axial(0, 0), Axial(0, 0)) is True

    def test_overlap_distant_centers(self) -> None:
        assert bases_overlap(Axial(0, 0), Axial(5, 0)) is False

    def test_overlap_adjacent_centers(self) -> None:
        # dist 1 → corone si toccano e si sovrappongono
        assert bases_overlap(Axial(0, 0), Axial(1, 0)) is True

    def test_overlap_centers_at_dist_2_still_share_one(self) -> None:
        # dist 2 → ancora condividono un esagono (corona di A tocca corona di B)
        assert bases_overlap(Axial(0, 0), Axial(2, 0)) is True
        # dist 3 → niente sovrapposizione
        assert bases_overlap(Axial(0, 0), Axial(3, 0)) is False

    def test_base_distance_centers_at_dist_3(self) -> None:
        assert base_distance(Axial(0, 0), Axial(3, 0)) == 1

    def test_base_distance_centers_at_dist_5(self) -> None:
        assert base_distance(Axial(0, 0), Axial(5, 0)) == 3


# ---------------------------------------------------------------------------
# Golden parità TS↔Py (load JSON dump del TS)
# ---------------------------------------------------------------------------


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hex_golden.json"


def _load_fixture() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            f"fixture mancante: {FIXTURE_PATH} — rigenerare con\n"
            "  DUMP_HEX_GOLDEN=1 npx vitest run tests/sim/dump_hex_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


class TestGoldenParity:
    def test_distances_match_ts_dump(self) -> None:
        data = _load_fixture()
        for i, p in enumerate(data["pairs"]):
            a = Axial(q=p["a"]["q"], r=p["a"]["r"])
            b = Axial(q=p["b"]["q"], r=p["b"]["r"])
            expected = p["distance"]
            got = hex_distance(a, b)
            assert got == expected, (
                f"pair[{i}] {a}→{b}: TS={expected} Py={got}"
            )

    def test_lines_match_ts_dump(self) -> None:
        data = _load_fixture()
        for i, lin in enumerate(data["lines"]):
            a = Axial(q=lin["a"]["q"], r=lin["a"]["r"])
            b = Axial(q=lin["b"]["q"], r=lin["b"]["r"])
            expected = [Axial(q=h["q"], r=h["r"]) for h in lin["path"]]
            got = hex_line(a, b)
            assert got == expected, (
                f"line[{i}] {a}→{b}:\n  TS={expected}\n  Py={got}"
            )

    def test_fixture_meta_sane(self) -> None:
        data = _load_fixture()
        assert data["meta"]["seed"] == 42
        assert data["meta"]["n_pairs"] == 50
        assert data["meta"]["n_lines"] == 20
        assert len(data["pairs"]) == 50
        assert len(data["lines"]) == 20

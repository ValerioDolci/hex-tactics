"""
Geometria esagonale — port di src/core/hex/{coords,distance,line,base}.ts.

Convenzione: pointy-top hex (vertici in alto/basso). Coordinate axial (q, r).
Riferimento: https://www.redblobgames.com/grids/hexagons/

Source of truth: i 4 file TS in ../src/core/hex/. Questo modulo deve produrre
output identico a parità di input (verificato in tests/test_hex.py).

NB: `axial_round` usa `floor(x + 0.5)` (round-half-up come JS `Math.round`),
NON `round()` di Python che fa banker's rounding e divergerebbe sui .5 esatti.

Pathfinding (A*, reachable_hexes) è fuori scope P1: rimandato a milestone successiva.

Performance (2026-05-04): aggiunti LRU cache + formula chiusa per base_distance.
Profile mostrava `legal_moves` al 98% del tempo CFR; le funzioni hex sono
PURE → cacheable, e base_distance era O(49) per call (formula chiusa è O(1)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Callable, Iterable, List, Optional, Tuple

SQRT3 = math.sqrt(3)


# ---------------------------------------------------------------------------
# Coords
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Axial:
    """Coordinata axial (pointy-top). q = colonna obliqua, r = riga.

    Frozen → hashable: utilizzabile in set/dict come key.
    """

    q: int
    r: int


@dataclass(frozen=True)
class Offset:
    """Coordinata offset rettangolare (odd-r)."""

    col: int
    row: int


@dataclass(frozen=True)
class Pixel:
    """Coordinata pixel (centro esagono)."""

    x: float
    y: float


def axial_equals(a: Axial, b: Axial) -> bool:
    return a.q == b.q and a.r == b.r


def _js_round(x: float) -> int:
    """`Math.round` JS-compatible: half-up verso +∞.

    Math.round(0.5)  → 1   (Python round(0.5)  → 0  ✗)
    Math.round(1.5)  → 2   (Python round(1.5)  → 2  ✓)
    Math.round(2.5)  → 3   (Python round(2.5)  → 2  ✗)
    Math.round(-0.5) → 0   (Python round(-0.5) → 0  ✓)
    Math.round(-1.5) → -1  (Python round(-1.5) → -2 ✗)
    """
    return math.floor(x + 0.5)


def offset_to_axial(o: Offset) -> Axial:
    """odd-r offset → axial."""
    q = o.col - (o.row - (o.row & 1)) // 2
    return Axial(q=q, r=o.row)


@lru_cache(maxsize=4096)
def axial_to_offset(a: Axial) -> Offset:
    """axial → odd-r offset. Cached: chiamato 18.5M volte in 50 iter pre-cache."""
    col = a.q + (a.r - (a.r & 1)) // 2
    return Offset(col=col, row=a.r)


def axial_to_pixel(a: Axial, size: float, origin: Pixel = Pixel(0.0, 0.0)) -> Pixel:
    """axial → pixel pointy-top. `size` = raggio centro→vertice."""
    x = size * SQRT3 * (a.q + a.r / 2)
    y = size * 1.5 * a.r
    return Pixel(x=x + origin.x, y=y + origin.y)


def pixel_to_axial(p: Pixel, size: float, origin: Pixel = Pixel(0.0, 0.0)) -> Axial:
    """pixel → axial pointy-top, arrotondato all'esagono più vicino."""
    x = p.x - origin.x
    y = p.y - origin.y
    q_frac = ((SQRT3 / 3) * x - y / 3) / size
    r_frac = ((2 / 3) * y) / size
    return axial_round(q_frac, r_frac)


def axial_round(q_frac: float, r_frac: float) -> Axial:
    """Arrotonda axial frazionaria all'esagono più vicino, via cube coords.

    Replica l'algoritmo TS in `coords.ts` con `Math.round`.
    """
    x = q_frac
    z = r_frac
    y = -x - z

    rx = _js_round(x)
    ry = _js_round(y)
    rz = _js_round(z)

    x_diff = abs(rx - x)
    y_diff = abs(ry - y)
    z_diff = abs(rz - z)

    if x_diff > y_diff and x_diff > z_diff:
        rx = -ry - rz
    elif y_diff > z_diff:
        ry = -rx - rz
    else:
        rz = -rx - ry

    return Axial(q=rx, r=rz)


def hex_vertices(center: Pixel, size: float) -> List[Pixel]:
    """6 vertici di un esagono pointy-top centrato su `center`."""
    out: List[Pixel] = []
    for i in range(6):
        angle_deg = 60 * i - 30  # pointy-top: ruota di -30°
        angle_rad = (math.pi / 180.0) * angle_deg
        out.append(
            Pixel(
                x=center.x + size * math.cos(angle_rad),
                y=center.y + size * math.sin(angle_rad),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Distance & neighbors
# ---------------------------------------------------------------------------

# Stesso ordine del TS: E, NE, NW, W, SW, SE
NEIGHBOR_DIRS: Tuple[Tuple[int, int], ...] = (
    (+1, 0),
    (+1, -1),
    (0, -1),
    (-1, 0),
    (-1, +1),
    (0, +1),
)


@lru_cache(maxsize=8192)
def hex_distance(a: Axial, b: Axial) -> int:
    """Distanza esagonale tra due celle axial (Manhattan-like su cube)."""
    dq = a.q - b.q
    dr = a.r - b.r
    ds = -dq - dr
    return (abs(dq) + abs(dr) + abs(ds)) // 2


def neighbors(hex_: Axial) -> List[Axial]:
    """6 vicini di `hex_` (anche fuori griglia)."""
    return [Axial(q=hex_.q + dq, r=hex_.r + dr) for (dq, dr) in NEIGHBOR_DIRS]


@lru_cache(maxsize=8192)
def hexes_in_range(center: Axial, range_: int) -> Tuple[Axial, ...]:
    """Tutti gli esagoni entro `range_` passi (incluso center). Range<0 → ().

    Cached LRU: chiamato 9M volte/50 iter pre-cache. Il return è ora tuple
    (immutabile, hashable) per performance — i caller che facevano list mutation
    devono convertire (ma l'engine non lo fa).
    """
    if range_ < 0:
        return ()
    out = []
    for dq in range(-range_, range_ + 1):
        r_min = max(-range_, -dq - range_)
        r_max = min(range_, -dq + range_)
        for dr in range(r_min, r_max + 1):
            out.append(Axial(q=center.q + dq, r=center.r + dr))
    return tuple(out)


def are_adjacent(a: Axial, b: Axial) -> bool:
    """True se distanza esattamente 1 (esclude `a == b`)."""
    return not axial_equals(a, b) and hex_distance(a, b) == 1


# ---------------------------------------------------------------------------
# Line & LoS
# ---------------------------------------------------------------------------


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def hex_line(a: Axial, b: Axial) -> List[Axial]:
    """Esagoni attraversati dalla linea da `a` a `b`, inclusi gli estremi.

    Adiacenti → 2 elementi; stessa cella → 1.
    """
    n = hex_distance(a, b)
    if n == 0:
        return [Axial(q=a.q, r=a.r)]
    out: List[Axial] = []
    for i in range(n + 1):
        t = i / n
        out.append(axial_round(_lerp(a.q, b.q, t), _lerp(a.r, b.r, t)))
    return out


def has_line_of_sight(
    from_: Axial,
    to: Axial,
    is_blocking: Callable[[Axial], bool],
) -> bool:
    """LoS libera se nessun hex *intermedio* (esclusi gli estremi) è bloccante."""
    path = hex_line(from_, to)
    for i in range(1, len(path) - 1):
        if is_blocking(path[i]):
            return False
    return True


# ---------------------------------------------------------------------------
# Base (rosa 7-hex)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=4096)
def get_base_hexes(center: Axial) -> Tuple[Axial, ...]:
    """7 esagoni della basetta (1 centrale + 6 corona = `hexes_in_range(center, 1)`).

    Cached: chiamato 9M volte pre-cache. Return tuple per immutabilità.
    """
    return hexes_in_range(center, 1)


def bases_overlap(center_a: Axial, center_b: Axial) -> bool:
    """True se le due basette condividono almeno un esagono."""
    a = get_base_hexes(center_a)
    b = get_base_hexes(center_b)
    set_a = {(h.q, h.r) for h in a}
    for h in b:
        if (h.q, h.r) in set_a:
            return True
    return False


@lru_cache(maxsize=8192)
def base_distance(center_a: Axial, center_b: Axial) -> int:
    """Distanza minima fra i 7 esagoni della basetta A e i 7 della basetta B.

    Formula chiusa: per due basette 7-hex centrate a distanza D, la min
    distanza tra basetta è max(0, D - 2). Equivalente al naive 7x7 ma O(1).

    Verificato in test_hex.py.
    """
    return max(0, hex_distance(center_a, center_b) - 2)


__all__ = [
    "Axial",
    "Offset",
    "Pixel",
    "SQRT3",
    "NEIGHBOR_DIRS",
    "axial_equals",
    "offset_to_axial",
    "axial_to_offset",
    "axial_to_pixel",
    "pixel_to_axial",
    "axial_round",
    "hex_vertices",
    "hex_distance",
    "neighbors",
    "hexes_in_range",
    "are_adjacent",
    "hex_line",
    "has_line_of_sight",
    "get_base_hexes",
    "bases_overlap",
    "base_distance",
]

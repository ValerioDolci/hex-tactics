"""
Mulberry32 RNG — port del Mulberry32 in src/utils/rng.ts.

Stato a 32 bit, ritorna float [0, 1).
Stessa sequenza per stesso seed → cruciale per test parità con TS.
"""

class Rng:
    """RNG seed-able. Stato avanza ad ogni chiamata."""

    def __init__(self, seed: int):
        self._state = seed & 0xFFFFFFFF

    def next(self) -> float:
        """Ritorna float in [0, 1)."""
        self._state = (self._state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self._state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    def next_int(self, min_inclusive: int, max_inclusive: int) -> int:
        """Intero in [min_inclusive, max_inclusive] (entrambi inclusi).

        API allineata a TS `nextInt(min, max)`:
          floor(next() * (max - min + 1)) + min
        """
        span = max_inclusive - min_inclusive + 1
        return int(self.next() * span) + min_inclusive

    def d6(self) -> int:
        """1..6 inclusive (alias di next_int(1, 6))."""
        return self.next_int(1, 6)

    # Backwards-compatible alias (vecchio uso interno)
    def roll_d6(self) -> int:
        return self.d6()

    def roll_d6s(self, n: int) -> list[int]:
        """Tira N d6 e restituisce il vettore dei risultati (ordine di tiro)."""
        return [self.d6() for _ in range(n)]

    def get_state(self) -> int:
        return self._state

    def set_state(self, s: int) -> None:
        self._state = s & 0xFFFFFFFF


def create_rng(seed: int) -> Rng:
    return Rng(seed)

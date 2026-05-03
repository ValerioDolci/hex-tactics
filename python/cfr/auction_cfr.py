"""
Tabular CFR per il sub-game ASTA MOVIMENTO di hex-tactics.

Il gioco:
  - 2 player simultaneous, info imperfetta privata
  - A (mover) sceglie bid_a ∈ [0, slancio_a]
  - B (defender) sceglie bid_b ∈ [0, slancio_b]
  - A vince se bid_a ≥ bid_b (parità → A vince, regola Valerio)
  - Entrambi pagano la propria puntata in slancio (indipendentemente da chi vince)

  Utility:
    - V (parametro): valore di "passare l'esagono" per A. Negativo per B (zero-sum).
    - A vince → +V − bid_a*0.1 (cost slancio)
    - A perde → −bid_a*0.1
  Cost coefficient (0.1): tradeoff "vincere sì ma quanto costa". Calibrato per
  che fluctua tra "vinco a tutti i costi" e "non spendo niente".

CFR algorithm (vanilla):
  Per T iter:
    Per ogni player i ∈ {A, B}:
      Per ogni info-set (qui = slancio_max disponibile):
        Per ogni azione bid:
          regret(bid) = utility(bid, opponent_strategy) − utility(curr_strategy, op_strat)
        Cumulative regret += regret
        Strategy = regret_matching(cumulative_regret) (positivi normalizzati)
      Cumulative strategy += strategy * t  (linear weighting per faster convergence)
    Switch player update.
  Average strategy = cumulative_strategy / sum(weights)

Run:
  python3 auction_cfr.py
Output:
  - Stampa exploitability per checkpoint
  - Salva strategie + heatmap in /tmp/cfr_auction_results.json
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np

# Hyperparameters
DEFAULT_V = 1.0  # valore di vincere
DEFAULT_COST = 0.1  # costo per unità di slancio bid
T_ITER = 20000  # CFR iterations
PRINT_EVERY = 2000


@dataclass
class AuctionGame:
    """Sub-game asta movimento.

    State (info-set per ciascun player):
      - Player A: il proprio slancio_a (sa il proprio, non quello dell'opponent)
      - Player B: il proprio slancio_b
    Action: bid intero in [0, slancio]
    """
    slancio_a: int  # slancio massimo A
    slancio_b: int  # slancio massimo B
    V: float = DEFAULT_V  # valore di vincere per A
    cost: float = DEFAULT_COST  # costo per unità di slancio

    def actions_a(self) -> List[int]:
        return list(range(self.slancio_a + 1))

    def actions_b(self) -> List[int]:
        return list(range(self.slancio_b + 1))

    def utility_a(self, bid_a: int, bid_b: int) -> float:
        """Utility per A. B = -A (zero-sum)."""
        wins_a = bid_a >= bid_b  # parità → A wins (regola Valerio)
        return (self.V if wins_a else 0.0) - self.cost * bid_a


class CFRSolver:
    """Tabular CFR per asta. Ogni player ha 1 info-set (il proprio slancio_max),
    quindi `cumulative_regret` e `cumulative_strategy` sono semplici array."""

    def __init__(self, game: AuctionGame):
        self.game = game
        n_a = game.slancio_a + 1
        n_b = game.slancio_b + 1
        self.cum_regret_a = np.zeros(n_a)
        self.cum_regret_b = np.zeros(n_b)
        self.cum_strategy_a = np.zeros(n_a)
        self.cum_strategy_b = np.zeros(n_b)
        self.t = 0

    def _regret_matching(self, regret: np.ndarray) -> np.ndarray:
        """Strategy from positive regret. Se tutti zero, uniforme."""
        positive = np.maximum(regret, 0.0)
        s = positive.sum()
        if s > 0:
            return positive / s
        return np.ones_like(regret) / len(regret)

    def step(self):
        """Una iterazione CFR: aggiorna regret di entrambi, accumula strategia."""
        self.t += 1
        sigma_a = self._regret_matching(self.cum_regret_a)
        sigma_b = self._regret_matching(self.cum_regret_b)

        # Update A: per ogni bid_a, calcola utility expected vs sigma_b
        # u_a(bid_a) = sum over bid_b: sigma_b[bid_b] * U(bid_a, bid_b)
        actions_a = np.arange(self.game.slancio_a + 1)
        actions_b = np.arange(self.game.slancio_b + 1)

        # Matrix: U[bid_a, bid_b]
        U_a = np.zeros((len(actions_a), len(actions_b)))
        for ba in actions_a:
            for bb in actions_b:
                U_a[ba, bb] = self.game.utility_a(ba, bb)
        # u_a vs sigma_b (vector of len n_a)
        u_a_per_action = U_a @ sigma_b
        u_a_current = sigma_a @ u_a_per_action
        regret_a = u_a_per_action - u_a_current
        self.cum_regret_a += regret_a

        # B simmetrico (B utility = -A utility)
        U_b = -U_a
        u_b_per_action = U_b.T @ sigma_a  # per bid_b, expect over sigma_a
        u_b_current = sigma_b @ u_b_per_action
        regret_b = u_b_per_action - u_b_current
        self.cum_regret_b += regret_b

        # Accumula strategia con peso lineare (Linear CFR — converge ~quadratically faster)
        self.cum_strategy_a += sigma_a * self.t
        self.cum_strategy_b += sigma_b * self.t

    def avg_strategy_a(self) -> np.ndarray:
        s = self.cum_strategy_a.sum()
        if s > 0:
            return self.cum_strategy_a / s
        return np.ones_like(self.cum_strategy_a) / len(self.cum_strategy_a)

    def avg_strategy_b(self) -> np.ndarray:
        s = self.cum_strategy_b.sum()
        if s > 0:
            return self.cum_strategy_b / s
        return np.ones_like(self.cum_strategy_b) / len(self.cum_strategy_b)

    def exploitability(self) -> Tuple[float, float]:
        """Quanto il best response guadagnerebbe vs strategia media.
        Sum totale = exploitability. 0 = Nash equilibrium esatto.
        """
        sigma_a = self.avg_strategy_a()
        sigma_b = self.avg_strategy_b()
        actions_a = np.arange(self.game.slancio_a + 1)
        actions_b = np.arange(self.game.slancio_b + 1)
        U_a = np.zeros((len(actions_a), len(actions_b)))
        for ba in actions_a:
            for bb in actions_b:
                U_a[ba, bb] = self.game.utility_a(ba, bb)
        # BR(A) vs sigma_b: max bid_a U(bid_a, sigma_b)
        u_a_per_action = U_a @ sigma_b
        br_a = u_a_per_action.max()
        u_a_avg = sigma_a @ u_a_per_action
        gain_a = br_a - u_a_avg
        # BR(B) vs sigma_a: min over bid_a from B's perspective = max over bid_b of -U
        u_b_per_action = (-U_a.T) @ sigma_a
        br_b = u_b_per_action.max()
        u_b_avg = sigma_b @ u_b_per_action
        gain_b = br_b - u_b_avg
        return gain_a, gain_b


def solve_one(slancio_a: int, slancio_b: int, V: float = DEFAULT_V, T: int = T_ITER) -> dict:
    """Risolve un singolo sub-game (slancio_a vs slancio_b) e restituisce stats."""
    game = AuctionGame(slancio_a=slancio_a, slancio_b=slancio_b, V=V)
    solver = CFRSolver(game)
    for t in range(T):
        solver.step()
    sa = solver.avg_strategy_a()
    sb = solver.avg_strategy_b()
    ga, gb = solver.exploitability()
    return {
        "slancio_a": slancio_a,
        "slancio_b": slancio_b,
        "V": V,
        "T": T,
        "strategy_a": sa.tolist(),
        "strategy_b": sb.tolist(),
        "exploit_a": float(ga),
        "exploit_b": float(gb),
        "exploit_total": float(ga + gb),
    }


def main():
    print("=" * 60)
    print("CFR — Sub-game ASTA MOVIMENTO hex-tactics")
    print("=" * 60)

    # Test 1: scenario simmetrico (slancio uguale)
    print("\n[Test 1] Sym: slancio_a=5, slancio_b=5, V=1.0")
    res = solve_one(5, 5, V=1.0, T=T_ITER)
    print(f"  Strategy A: {[f'{p:.3f}' for p in res['strategy_a']]}")
    print(f"  Strategy B: {[f'{p:.3f}' for p in res['strategy_b']]}")
    print(f"  Exploitability: A={res['exploit_a']:.4f}, B={res['exploit_b']:.4f}, total={res['exploit_total']:.4f}")

    # Test 2: A ha più slancio
    print("\n[Test 2] A advantage: slancio_a=10, slancio_b=5, V=1.0")
    res2 = solve_one(10, 5, V=1.0, T=T_ITER)
    print(f"  Strategy A: {[f'{p:.3f}' for p in res2['strategy_a']]}")
    print(f"  Strategy B: {[f'{p:.3f}' for p in res2['strategy_b']]}")
    print(f"  Exploitability: A={res2['exploit_a']:.4f}, B={res2['exploit_b']:.4f}")

    # Test 3: B ha più slancio
    print("\n[Test 3] B advantage: slancio_a=3, slancio_b=10, V=1.0")
    res3 = solve_one(3, 10, V=1.0, T=T_ITER)
    print(f"  Strategy A: {[f'{p:.3f}' for p in res3['strategy_a']]}")
    print(f"  Strategy B: {[f'{p:.3f}' for p in res3['strategy_b']]}")
    print(f"  Exploitability: A={res3['exploit_a']:.4f}, B={res3['exploit_b']:.4f}")

    # Test 4: V alto (passare vale tanto)
    print("\n[Test 4] High V: slancio_a=5, slancio_b=5, V=3.0 (passare vale 3 unità slancio)")
    res4 = solve_one(5, 5, V=3.0, T=T_ITER)
    print(f"  Strategy A: {[f'{p:.3f}' for p in res4['strategy_a']]}")
    print(f"  Strategy B: {[f'{p:.3f}' for p in res4['strategy_b']]}")
    print(f"  Exploitability: A={res4['exploit_a']:.4f}, B={res4['exploit_b']:.4f}")

    # Matrice 8x8 per heatmap
    print("\n=== MATRICE COMPLETA: P(bid|slancio) per slancio 0..7, V=1.0 ===")
    matrix = {}
    for sa in range(0, 8):
        for sb in range(0, 8):
            r = solve_one(sa, sb, V=1.0, T=T_ITER)
            matrix[f"{sa}_vs_{sb}"] = r
    # Salva
    with open("/tmp/cfr_auction_results.json", "w") as f:
        json.dump(matrix, f, indent=2)
    print(f"\nSalvato matrix 8x8 in /tmp/cfr_auction_results.json")

    # Stampa una sintesi: P(bid_a) atteso (mean) per ogni (sa, sb)
    print("\n=== EXPECTED BID per A (mean della strategia mista) ===")
    print(f"{'A\\B':<5}", end="")
    for sb in range(8):
        print(f"{sb:>6}", end="")
    print()
    for sa in range(8):
        print(f"{sa:<5}", end="")
        for sb in range(8):
            r = matrix[f"{sa}_vs_{sb}"]
            sa_strat = np.array(r["strategy_a"])
            mean_bid = float(np.dot(sa_strat, np.arange(len(sa_strat))))
            print(f"{mean_bid:>6.2f}", end="")
        print()

    # Massima exploitability sul matrix (sanity check)
    max_exploit = max(r["exploit_total"] for r in matrix.values())
    print(f"\nMax exploitability across matrix: {max_exploit:.4f} (≈ 0 = converge)")


if __name__ == "__main__":
    main()

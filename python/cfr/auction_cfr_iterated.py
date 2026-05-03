"""
ITERATED auction CFR per hex-tactics — modello esteso.

Modello v1 (auction_cfr.py): single-shot bidding (uno-vinci/perdi-fine).
Modello v2 (questo file): iterated bidding — atk può ritentare se perde.

Regole estese:
  - State: (slancio_a, slancio_b, V_pass)
  - Iter sequence:
    Round k:
      atk decide bid_a ∈ [0, slancio_a]. Può scegliere "QUIT" (interpretato
      come bid_a = -1 in nostra rappresentazione) per arrendersi e non muovere.
      def decide bid_b ∈ [0, slancio_b].
      Se atk QUIT: terminal, atk_payoff = 0, def_payoff = 0
      Altrimenti:
        Entrambi pagano: slancio_a -= bid_a, slancio_b -= bid_b
        Se bid_a >= bid_b: atk vince. atk_payoff = +V - cost_total_atk_speso
                                       def_payoff = -V - cost_total_def_speso
        Else: continue iter (atk può ritentare)
      Limit: max_iter (es. 6, evita esplosione)

  - Cost: 1 unità di slancio = `cost_slancio` di disutility (default 0.1)
  - V: valore di passare l'esagono per atk (parametro, default 1.0)

Approssimazione: lo slancio "speso" è sottratto dal pool. Il pool stesso ha
valore d'uso (se def è ranged-target, lo slancio lo protegge — modellato
come cost = high). Per ora cost uniforme 0.1.

CFR: l'info-set è (slancio_a_residuo, slancio_b_residuo). Tabular CFR
funziona se il game è piccolo (max ~14*14*max_iter ≈ 1200 stati).
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

DEFAULT_V = 1.0
DEFAULT_COST = 0.1
DEFAULT_MAX_ITER = 6
T_ITER = 30000


@dataclass(frozen=True)
class IterState:
    """State CFR: residual slancio per i due player + iter count."""
    sa: int
    sb: int
    iter_n: int = 0


@dataclass
class IteratedAuctionGame:
    V: float = DEFAULT_V
    cost: float = DEFAULT_COST
    max_iter: int = DEFAULT_MAX_ITER

    def actions_a(self, state: IterState) -> List[int]:
        """Atk: bid in [0, sa] + QUIT (rappresentato come -1)."""
        return [-1] + list(range(state.sa + 1))

    def actions_b(self, state: IterState) -> List[int]:
        return list(range(state.sb + 1))

    def is_terminal(self, state: IterState) -> bool:
        return state.iter_n >= self.max_iter or state.sa <= 0

    def step(self, state: IterState, bid_a: int, bid_b: int) -> Tuple[Optional[IterState], float, float]:
        """Apply bids. Restituisce (next_state | None se terminale, payoff_a, payoff_b).

        payoff incrementale solo per questa iter (cost spesi). Il +V/-V finale
        viene dato sul vincitore.
        """
        if bid_a == -1:
            # Atk quits: terminal, no costs (non muove più)
            return None, 0.0, 0.0
        cost_a = -self.cost * bid_a
        cost_b = -self.cost * bid_b
        if bid_a >= bid_b:
            # Atk wins this iter
            return None, self.V + cost_a, -self.V + cost_b
        # Atk loses, può ritentare
        new_state = IterState(sa=state.sa - bid_a, sb=state.sb - bid_b, iter_n=state.iter_n + 1)
        if self.is_terminal(new_state):
            # Atk si arrende implicitamente (slancio esaurito o iter cap)
            return None, cost_a, cost_b
        return new_state, cost_a, cost_b


class IteratedCFRSolver:
    """Tabular CFR su state (sa, sb, iter_n).

    Per ogni state ci sono due info-set (uno per atk, uno per def). In CFR,
    cumulative regret e cumulative strategy sono per (state, player).
    """

    def __init__(self, game: IteratedAuctionGame, max_sa: int, max_sb: int):
        self.game = game
        self.max_sa = max_sa
        self.max_sb = max_sb
        # Storage: dict (state_key) → np.array regret/strategy
        # state_key = (sa, sb, iter_n)
        # action set varies by player
        self.cum_regret_a: Dict[Tuple[int,int,int], np.ndarray] = {}
        self.cum_regret_b: Dict[Tuple[int,int,int], np.ndarray] = {}
        self.cum_strat_a: Dict[Tuple[int,int,int], np.ndarray] = {}
        self.cum_strat_b: Dict[Tuple[int,int,int], np.ndarray] = {}
        self.t = 0

    def _key(self, state: IterState) -> Tuple[int,int,int]:
        return (state.sa, state.sb, state.iter_n)

    def _strategy_a(self, state: IterState) -> np.ndarray:
        """Strategia atk dal regret matching. Actions: -1 (QUIT) + [0..sa]."""
        n = state.sa + 2  # QUIT + bid 0..sa
        k = self._key(state)
        if k not in self.cum_regret_a:
            self.cum_regret_a[k] = np.zeros(n)
        regret = self.cum_regret_a[k]
        positive = np.maximum(regret, 0.0)
        s = positive.sum()
        if s > 0:
            return positive / s
        return np.ones(n) / n

    def _strategy_b(self, state: IterState) -> np.ndarray:
        n = state.sb + 1  # bid 0..sb
        k = self._key(state)
        if k not in self.cum_regret_b:
            self.cum_regret_b[k] = np.zeros(n)
        regret = self.cum_regret_b[k]
        positive = np.maximum(regret, 0.0)
        s = positive.sum()
        if s > 0:
            return positive / s
        return np.ones(n) / n

    def _value(self, state: IterState) -> Tuple[float, float]:
        """Computa (value_a, value_b) ricorsivo dato strategie correnti."""
        if self.game.is_terminal(state):
            return 0.0, 0.0  # se atk non sceglie QUIT esplicito, terminale = 0
        sigma_a = self._strategy_a(state)
        sigma_b = self._strategy_b(state)
        actions_a = self.game.actions_a(state)  # -1, 0, 1, ..., sa
        actions_b = self.game.actions_b(state)
        # Compute U_a[i, j] = utility A se atk bida actions_a[i] e def bida actions_b[j]
        # + ricorsione se non terminal
        n_a = len(actions_a)
        n_b = len(actions_b)
        U_a = np.zeros((n_a, n_b))
        U_b = np.zeros((n_a, n_b))
        for i, ba in enumerate(actions_a):
            for j, bb in enumerate(actions_b):
                next_state, pa, pb = self.game.step(state, ba, bb)
                if next_state is None:
                    U_a[i, j] = pa
                    U_b[i, j] = pb
                else:
                    # Ricorsione: aggiunge value continuazione
                    va, vb = self._value(next_state)
                    U_a[i, j] = pa + va
                    U_b[i, j] = pb + vb
        # Value sotto strategie correnti
        ev_a = sigma_a @ U_a @ sigma_b
        ev_b = sigma_a @ U_b @ sigma_b
        return ev_a, ev_b

    def step_cfr(self):
        """Una iter CFR: attraversa tutto l'albero (small game), accumula regret/strategy."""
        self.t += 1
        self._update_node_regrets(IterState(sa=self.max_sa, sb=self.max_sb, iter_n=0))

    def _update_node_regrets(self, state: IterState):
        """Recursive regret update."""
        if self.game.is_terminal(state):
            return
        sigma_a = self._strategy_a(state)
        sigma_b = self._strategy_b(state)
        actions_a = self.game.actions_a(state)
        actions_b = self.game.actions_b(state)
        n_a = len(actions_a)
        n_b = len(actions_b)
        # U_a[i, j] = val A se ba=actions_a[i], bb=actions_b[j]
        U_a = np.zeros((n_a, n_b))
        U_b = np.zeros((n_a, n_b))
        for i, ba in enumerate(actions_a):
            for j, bb in enumerate(actions_b):
                next_state, pa, pb = self.game.step(state, ba, bb)
                if next_state is None:
                    U_a[i, j] = pa
                    U_b[i, j] = pb
                else:
                    self._update_node_regrets(next_state)
                    va, vb = self._value(next_state)
                    U_a[i, j] = pa + va
                    U_b[i, j] = pb + vb
        # Atk regret update
        u_a_per_action = U_a @ sigma_b
        ev_a = sigma_a @ u_a_per_action
        regret_a = u_a_per_action - ev_a
        k = self._key(state)
        if k not in self.cum_regret_a:
            self.cum_regret_a[k] = np.zeros(n_a)
        self.cum_regret_a[k] += regret_a
        # Def regret update
        u_b_per_action = U_b.T @ sigma_a
        ev_b = sigma_b @ u_b_per_action
        regret_b = u_b_per_action - ev_b
        if k not in self.cum_regret_b:
            self.cum_regret_b[k] = np.zeros(n_b)
        self.cum_regret_b[k] += regret_b
        # Cumulative strategy weighted by t (linear CFR)
        if k not in self.cum_strat_a:
            self.cum_strat_a[k] = np.zeros(n_a)
        if k not in self.cum_strat_b:
            self.cum_strat_b[k] = np.zeros(n_b)
        self.cum_strat_a[k] += sigma_a * self.t
        self.cum_strat_b[k] += sigma_b * self.t

    def avg_strategy_a(self, state: IterState) -> np.ndarray:
        k = self._key(state)
        if k not in self.cum_strat_a:
            n = state.sa + 2
            return np.ones(n) / n
        s = self.cum_strat_a[k]
        if s.sum() > 0:
            return s / s.sum()
        return np.ones_like(s) / len(s)

    def avg_strategy_b(self, state: IterState) -> np.ndarray:
        k = self._key(state)
        if k not in self.cum_strat_b:
            n = state.sb + 1
            return np.ones(n) / n
        s = self.cum_strat_b[k]
        if s.sum() > 0:
            return s / s.sum()
        return np.ones_like(s) / len(s)


def main():
    print("=" * 60)
    print("ITERATED CFR — asta movimento (atk può ritentare)")
    print("=" * 60)

    # Test 1: scenario simmetrico 5 vs 5
    print("\n[Test 1] sa=5, sb=5, V=1.0, max_iter=6")
    game = IteratedAuctionGame(V=1.0, cost=0.1, max_iter=6)
    solver = IteratedCFRSolver(game, max_sa=5, max_sb=5)
    for t in range(2000):
        solver.step_cfr()
    init_state = IterState(sa=5, sb=5, iter_n=0)
    sa = solver.avg_strategy_a(init_state)
    sb = solver.avg_strategy_b(init_state)
    actions_a = ["QUIT"] + [str(i) for i in range(6)]
    print(f"  Atk strat at (5,5,0): {dict(zip(actions_a, [f'{p:.3f}' for p in sa]))}")
    print(f"  Def strat at (5,5,0): {[f'{p:.3f}' for p in sb]}")
    val_a, val_b = solver._value(init_state)
    print(f"  Expected value: A={val_a:.3f}, B={val_b:.3f}")

    # Test 2: atk advantage 10 vs 5
    print("\n[Test 2] sa=10, sb=5, V=1.0, max_iter=6")
    game2 = IteratedAuctionGame(V=1.0, cost=0.1, max_iter=6)
    solver2 = IteratedCFRSolver(game2, max_sa=10, max_sb=5)
    for t in range(2000):
        solver2.step_cfr()
    init2 = IterState(sa=10, sb=5, iter_n=0)
    sa2 = solver2.avg_strategy_a(init2)
    sb2 = solver2.avg_strategy_b(init2)
    actions_a2 = ["QUIT"] + [str(i) for i in range(11)]
    print(f"  Atk strat at (10,5,0): {dict(zip(actions_a2, [f'{p:.3f}' for p in sa2]))}")
    print(f"  Def strat at (10,5,0): {[f'{p:.3f}' for p in sb2]}")
    val_a, val_b = solver2._value(init2)
    print(f"  Expected value: A={val_a:.3f}, B={val_b:.3f}")

    # Test 3: def advantage 3 vs 10
    print("\n[Test 3] sa=3, sb=10, V=1.0, max_iter=6")
    game3 = IteratedAuctionGame(V=1.0, cost=0.1, max_iter=6)
    solver3 = IteratedCFRSolver(game3, max_sa=3, max_sb=10)
    for t in range(2000):
        solver3.step_cfr()
    init3 = IterState(sa=3, sb=10, iter_n=0)
    sa3 = solver3.avg_strategy_a(init3)
    sb3 = solver3.avg_strategy_b(init3)
    actions_a3 = ["QUIT"] + [str(i) for i in range(4)]
    print(f"  Atk strat at (3,10,0): {dict(zip(actions_a3, [f'{p:.3f}' for p in sa3]))}")
    print(f"  Def strat at (3,10,0): {[f'{p:.3f}' for p in sb3]}")
    val_a, val_b = solver3._value(init3)
    print(f"  Expected value: A={val_a:.3f}, B={val_b:.3f}")


if __name__ == "__main__":
    main()

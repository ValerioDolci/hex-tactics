"""Test config Valerio: tie→def + atk paga 1 fisso per attivare l'asta.

Modello:
  - Atk può QUIT (paga 0, no movement) o BID b ∈ [0, slancio_a - 1]
    → costo totale = 1 (movement) + b (bid)
  - Def: bid b' ∈ [0, slancio_b]
  - Vince atk SOLO se bid_a > bid_b (parità → def)
  - Atk paga 1+b sempre (anche se perde)
  - Def paga b' sempre
  - Se atk vince → terminale, atk_payoff = +V - cost*(1+b), def_payoff = -V - cost*b'
  - Se atk perde e ha ancora slancio → ritenta (iter+1, slancio_a -= (1+b), slancio_b -= b')
"""
import sys, os, time
import numpy as np
from dataclasses import dataclass
from typing import Dict, Tuple, Optional


@dataclass(frozen=True)
class IterState:
    sa: int
    sb: int
    iter_n: int = 0


@dataclass
class Game:
    V: float = 1.0
    cost: float = 0.1
    max_iter: int = 4
    fixed_atk_cost: int = 1  # atk paga sempre quando attiva l'asta

    def actions_a(self, state):
        """QUIT (-1) + bid in [0, sa - fixed_atk_cost]. Atk può solo bidare se sa > 0."""
        if state.sa < self.fixed_atk_cost:
            return [-1]  # solo QUIT possibile
        max_bid = state.sa - self.fixed_atk_cost
        return [-1] + list(range(max_bid + 1))

    def actions_b(self, state):
        return list(range(state.sb + 1))

    def is_terminal(self, state):
        return state.iter_n >= self.max_iter or state.sa < self.fixed_atk_cost

    def step(self, state, bid_a, bid_b):
        if bid_a == -1:
            return None, 0.0, 0.0  # QUIT
        total_atk_spend = self.fixed_atk_cost + bid_a
        cost_a = -self.cost * total_atk_spend
        cost_b = -self.cost * bid_b
        # tie → def
        atk_wins = bid_a > bid_b
        if atk_wins:
            return None, self.V + cost_a, -self.V + cost_b
        # atk perde, ritenta?
        new_state = IterState(state.sa - total_atk_spend, state.sb - bid_b, state.iter_n + 1)
        if self.is_terminal(new_state):
            return None, cost_a, cost_b
        return new_state, cost_a, cost_b


class Solver:
    def __init__(self, game: Game, max_sa: int, max_sb: int):
        self.game = game
        self.max_sa = max_sa
        self.max_sb = max_sb
        self.cum_regret_a: Dict = {}
        self.cum_regret_b: Dict = {}
        self.cum_strat_a: Dict = {}
        self.cum_strat_b: Dict = {}
        self.t = 0
        self._iter_cache: Dict = {}

    def _key(self, s): return (s.sa, s.sb, s.iter_n)

    def _strategy_a(self, state):
        n = len(self.game.actions_a(state))
        k = self._key(state)
        if k not in self.cum_regret_a:
            self.cum_regret_a[k] = np.zeros(n)
        r = self.cum_regret_a[k]
        if len(r) != n:
            r = np.zeros(n)
            self.cum_regret_a[k] = r
        pos = np.maximum(r, 0.0)
        s = pos.sum()
        return pos / s if s > 0 else np.ones(n) / n

    def _strategy_b(self, state):
        n = state.sb + 1
        k = self._key(state)
        if k not in self.cum_regret_b:
            self.cum_regret_b[k] = np.zeros(n)
        r = self.cum_regret_b[k]
        pos = np.maximum(r, 0.0)
        s = pos.sum()
        return pos / s if s > 0 else np.ones(n) / n

    def step_cfr(self):
        self.t += 1
        self._iter_cache.clear()
        self._traverse(IterState(self.max_sa, self.max_sb, 0))

    def _traverse(self, state):
        if self.game.is_terminal(state):
            return 0.0, 0.0
        k = self._key(state)
        if k in self._iter_cache:
            return self._iter_cache[k]
        sigma_a = self._strategy_a(state)
        sigma_b = self._strategy_b(state)
        actions_a = self.game.actions_a(state)
        actions_b = self.game.actions_b(state)
        n_a, n_b = len(actions_a), len(actions_b)
        U_a = np.zeros((n_a, n_b))
        U_b = np.zeros((n_a, n_b))
        for i, ba in enumerate(actions_a):
            for j, bb in enumerate(actions_b):
                ns, pa, pb = self.game.step(state, ba, bb)
                if ns is None:
                    U_a[i, j] = pa
                    U_b[i, j] = pb
                else:
                    va, vb = self._traverse(ns)
                    U_a[i, j] = pa + va
                    U_b[i, j] = pb + vb
        u_a_per = U_a @ sigma_b
        ev_a = sigma_a @ u_a_per
        regret_a = u_a_per - ev_a
        if k not in self.cum_regret_a:
            self.cum_regret_a[k] = np.zeros(n_a)
        self.cum_regret_a[k] += regret_a
        u_b_per = U_b.T @ sigma_a
        ev_b = sigma_b @ u_b_per
        regret_b = u_b_per - ev_b
        if k not in self.cum_regret_b:
            self.cum_regret_b[k] = np.zeros(n_b)
        self.cum_regret_b[k] += regret_b
        if k not in self.cum_strat_a:
            self.cum_strat_a[k] = np.zeros(n_a)
        if k not in self.cum_strat_b:
            self.cum_strat_b[k] = np.zeros(n_b)
        self.cum_strat_a[k] += sigma_a * self.t
        self.cum_strat_b[k] += sigma_b * self.t
        self._iter_cache[k] = (ev_a, ev_b)
        return ev_a, ev_b

    def avg_a(self, state):
        k = self._key(state)
        if k not in self.cum_strat_a:
            n = len(self.game.actions_a(state))
            return np.ones(n) / n
        s = self.cum_strat_a[k]
        return s / s.sum() if s.sum() > 0 else np.ones_like(s) / len(s)

    def avg_b(self, state):
        k = self._key(state)
        if k not in self.cum_strat_b:
            n = state.sb + 1
            return np.ones(n) / n
        s = self.cum_strat_b[k]
        return s / s.sum() if s.sum() > 0 else np.ones_like(s) / len(s)


def run(sa, sb, T=2000, max_iter=4):
    game = Game(V=1.0, cost=0.1, max_iter=max_iter, fixed_atk_cost=1)
    solver = Solver(game, max_sa=sa, max_sb=sb)
    t0 = time.time()
    for t in range(T):
        solver.step_cfr()
    elapsed = time.time() - t0
    init = IterState(sa, sb, 0)
    sa_strat = solver.avg_a(init)
    sb_strat = solver.avg_b(init)
    val_a, val_b = solver._traverse(init)
    actions_a = ["QUIT"] + [str(i) for i in range(sa)]  # bid in [0, sa-1]
    return sa_strat, sb_strat, val_a, val_b, elapsed, actions_a, solver


if __name__ == "__main__":
    print("CONFIG: tie→def, atk paga 1 fisso + bid, V=1.0, cost=0.1, max_iter=4 round, T=2000\n")
    print("="*70)
    scenarios = [(2, 2), (3, 3), (5, 5), (8, 8), (10, 5), (5, 10), (3, 10), (10, 3)]
    rows = []
    for (sa, sb) in scenarios:
        saS, sbS, va, vb, el, actA, solver = run(sa, sb)
        top_a = sorted([(p, a) for p, a in zip(saS, actA) if p > 0.01], reverse=True)[:5]
        top_b = sorted([(p, str(i)) for i, p in enumerate(sbS) if p > 0.01], reverse=True)[:5]
        # Probabilità totale di QUIT
        p_quit = saS[0] if len(actA) > 0 and actA[0] == "QUIT" else 0.0
        # Bid medio quando atk decide di tentare (esclude QUIT)
        if 1 - p_quit > 1e-6:
            bids = np.array([int(a) for a in actA[1:]])
            probs_bid = saS[1:] / (1 - p_quit)
            mean_bid = float(np.dot(probs_bid, bids))
        else:
            mean_bid = float('nan')
        bids_b = np.arange(sb+1)
        mean_bid_b = float(np.dot(sbS, bids_b))
        print(f"\n[sa={sa}, sb={sb}]  V_a={va:+.3f}  V_b={vb:+.3f}  ({el:.1f}s)")
        print(f"  Atk top: {[(a, f'{p:.2f}') for p, a in top_a]}")
        print(f"  Def top: {[(b, f'{p:.2f}') for p, b in top_b]}")
        print(f"  P(QUIT)={p_quit:.2f}  E[bid_a|tenta]={mean_bid:.2f}  E[bid_b]={mean_bid_b:.2f}")
        rows.append((sa, sb, va, vb, p_quit, mean_bid, mean_bid_b))

    print("\n" + "="*70)
    print(f"{'sa':>3} {'sb':>3} {'V_a':>7} {'V_b':>7} {'P(quit)':>8} {'E[ba|try]':>10} {'E[bb]':>7}")
    for r in rows:
        sa, sb, va, vb, pq, eb, ebb = r
        print(f"{sa:>3} {sb:>3} {va:>+7.3f} {vb:>+7.3f} {pq:>8.2f} {eb:>10.2f} {ebb:>7.2f}")

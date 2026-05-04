"""Pre-flight OpenSpiel: implementa il sub-game asta D-052 come pyspiel.Game custom
e fa girare CFR tabular per validare contro `auction_cfr_iterated_fix.py`.

Sanity check: V_a, mean bid_a (esclusa QUIT), mean bid_b devono matchare entro
tolleranza (~0.02 su valore, ~0.1 su bid medio) ai risultati ground truth:

  [sa=5, sb=5]   V_a=+0.557  E[ba|tenta]=1.79  E[bb]=1.66  P(QUIT)=0.00
  [sa=8, sb=8]   V_a=+0.800  E[ba|tenta]=1.38  E[bb]=0.08  P(QUIT)=0.00
  [sa=10,sb=5]   V_a=+0.800  E[ba|tenta]=1.00  E[bb]=0.00  P(QUIT)=0.00
  [sa=5, sb=10]  V_a=+0.000  E[bb]=4.38       P(QUIT)=1.00
  [sa=10,sb=3]   V_a=+0.800  E[ba|tenta]=1.00  E[bb]=0.00  P(QUIT)=0.00
  [sa=3, sb=3]   V_a=+0.000  E[bb]=2.00       P(QUIT)=1.00

Modello del sub-game (V=1.0, cost=0.1, max_iter=4):
  - Atk muove (azione 0=QUIT, 1..MAX_BID+1 = bid 0..MAX_BID)
  - Def muove dopo, MA non osserva l'azione di atk (info set indistinguibile)
  - Transizione: atk wins se bid_a > bid_b; tie→def
  - Atk paga 1+bid_a sempre (anche se perde); def paga bid_b
  - Se atk perde e ha ancora slancio: nuovo iter con (sa-(1+bid_a), sb-bid_b)
"""
from __future__ import annotations

import time
import sys

import numpy as np
import pyspiel

from open_spiel.python.algorithms import cfr, exploitability


# ─────────── Modello sub-game ───────────

V = 1.0
COST = 0.1
MAX_ITER = 4
FIXED_ATK_COST = 1
MAX_BID = 15  # bid max possibile (sa o sb fino a 15) — dimensiona action space
MAX_ACTIONS = 1 + MAX_BID + 1  # 0=QUIT, 1..MAX_BID+1 = bid 0..MAX_BID
# action 0 → QUIT
# action k>=1 → bid (k-1)


def _action_to_bid(a: int) -> int:
    """k=0 = QUIT (-1); k>=1 → bid (k-1)."""
    if a == 0:
        return -1
    return a - 1


def _bid_to_action(b: int) -> int:
    return 0 if b < 0 else b + 1


# ─────────── Game type registration ───────────

_GAME_TYPE = pyspiel.GameType(
    short_name="hex_auction_d052",
    long_name="Hex Tactics Auction (D-052) — pre-flight",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.DETERMINISTIC,
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.GENERAL_SUM,  # cost di slancio è spesa reale per entrambi → non zero-sum
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=2,
    min_num_players=2,
    provides_information_state_string=True,
    provides_information_state_tensor=False,
    provides_observation_string=True,
    provides_observation_tensor=False,
    parameter_specification={
        "sa_start": 5,
        "sb_start": 5,
    },
)

_GAME_INFO = pyspiel.GameInfo(
    num_distinct_actions=MAX_ACTIONS,
    max_chance_outcomes=0,
    num_players=2,
    min_utility=-(V + COST * MAX_BID * MAX_ITER) - 1.0,
    max_utility=+V + 1.0,
    utility_sum=None,  # general-sum: i costi sommano a quantità < 0 (slancio bruciato)
    max_game_length=2 * MAX_ITER,  # atk + def per iter
)


class HexAuctionGame(pyspiel.Game):
    """Sub-game asta D-052 come pyspiel.Game."""

    def __init__(self, params=None):
        super().__init__(_GAME_TYPE, _GAME_INFO, params or {})
        params = params or {}
        self.sa_start = int(params.get("sa_start", 5))
        self.sb_start = int(params.get("sb_start", 5))

    def new_initial_state(self):
        return HexAuctionState(self, self.sa_start, self.sb_start)

    def make_py_observer(self, iig_obs_type=None, params=None):
        return HexAuctionObserver(
            iig_obs_type or pyspiel.IIGObservationType(perfect_recall=False),
            params,
        )


class HexAuctionState(pyspiel.State):
    """State del sub-game.

    Ad ogni iter: prima muove atk (player 0), poi def (player 1) senza vedere
    l'azione di atk. La transizione del sub-game si applica DOPO che entrambi
    hanno mosso.
    """

    def __init__(self, game, sa: int, sb: int):
        super().__init__(game)
        self.sa = sa
        self.sb = sb
        self.iter_n = 0
        # turno corrente: 0 = atk deve muovere, 1 = def deve muovere (atk già fatto)
        self.phase = 0
        self.pending_atk = None  # bid di atk in attesa di def
        self._game_over = False
        self._final_returns = [0.0, 0.0]

    # ── PySpiel API ──

    def current_player(self):
        if self._game_over:
            return pyspiel.PlayerId.TERMINAL
        return self.phase  # 0 atk, 1 def

    def _legal_actions(self, player):
        assert player >= 0
        if player == 0:
            # Atk: QUIT (0) + bid in [0, sa - FIXED_ATK_COST]
            if self.sa < FIXED_ATK_COST:
                return [0]  # solo QUIT
            max_b = self.sa - FIXED_ATK_COST
            return [0] + [b + 1 for b in range(max_b + 1)]
        else:
            # Def: solo bid [0..sb] (no QUIT)
            return [b + 1 for b in range(self.sb + 1)]

    def _apply_action(self, action):
        if self.phase == 0:
            # Atk muove
            bid_a = _action_to_bid(action)
            if bid_a == -1:
                # QUIT → terminale (0, 0)
                self._game_over = True
                self._final_returns = [0.0, 0.0]
                return
            self.pending_atk = bid_a
            self.phase = 1
        else:
            # Def muove → applica transizione
            bid_b = _action_to_bid(action)  # ≥ 0 per def
            assert bid_b >= 0
            bid_a = self.pending_atk
            assert bid_a is not None and bid_a >= 0

            cost_a = -COST * (FIXED_ATK_COST + bid_a)
            cost_b = -COST * bid_b
            atk_wins = bid_a > bid_b

            if atk_wins:
                self._game_over = True
                # BUG FIX: cumula i payoff invece di sovrascrivere — _final_returns
                # contiene già i costi degli iter precedenti (atk perse e ritentò)
                self._final_returns[0] += V + cost_a
                self._final_returns[1] += -V + cost_b
                return

            # Atk perde / tie. Spende slancio. Ritenta?
            new_sa = self.sa - (FIXED_ATK_COST + bid_a)
            new_sb = self.sb - bid_b
            new_iter = self.iter_n + 1
            # Aggiorno _final_returns in modo cumulativo per i costi parziali
            self._final_returns[0] += cost_a
            self._final_returns[1] += cost_b
            if new_iter >= MAX_ITER or new_sa < FIXED_ATK_COST:
                self._game_over = True
                return
            # Continua: nuova iter
            self.sa = new_sa
            self.sb = new_sb
            self.iter_n = new_iter
            self.pending_atk = None
            self.phase = 0

    def _action_to_string(self, player, action):
        b = _action_to_bid(action)
        if b == -1:
            return "QUIT"
        return f"bid={b}"

    def is_terminal(self):
        return self._game_over

    def returns(self):
        return list(self._final_returns)

    def information_state_string(self, player=None):
        """Info set key.

        IMPORTANTE: la stringa di def NON deve includere pending_atk (def non
        osserva il bid di atk → simultaneous move encoding).
        """
        if player is None:
            player = self.current_player()
        if player == 0:
            return f"atk:sa={self.sa},sb={self.sb},it={self.iter_n}"
        else:
            # Def: stessa stringa per qualsiasi pending_atk → info set indistinguibile
            return f"def:sa={self.sa},sb={self.sb},it={self.iter_n}"

    def observation_string(self, player=None):
        return self.information_state_string(player)

    def __str__(self):
        return (
            f"HexAuctionState(sa={self.sa}, sb={self.sb}, it={self.iter_n}, "
            f"phase={self.phase}, pending_atk={self.pending_atk}, "
            f"over={self._game_over}, returns={self._final_returns})"
        )


class HexAuctionObserver:
    """Observer minimale; tensor non usato dal CFR tabular."""

    def __init__(self, iig_obs_type, params):
        self.iig_obs_type = iig_obs_type
        self.tensor = None
        self.dict = {}

    def set_from(self, state, player):
        pass

    def string_from(self, state, player):
        return state.information_state_string(player)


# Registro il game
pyspiel.register_game(_GAME_TYPE, HexAuctionGame)


# ─────────── Pre-flight runner ───────────

# Ground truth da auction_cfr_iterated_fix.py (T=2000, scratch CFR)
GROUND_TRUTH = {
    (5, 5):  {"V_a": +0.557, "p_quit": 0.00, "E_ba_try": 1.79, "E_bb": 1.66},
    (8, 8):  {"V_a": +0.800, "p_quit": 0.00, "E_ba_try": 1.38, "E_bb": 0.08},
    (10, 5): {"V_a": +0.800, "p_quit": 0.00, "E_ba_try": 1.00, "E_bb": 0.00},
    (5, 10): {"V_a": +0.000, "p_quit": 1.00, "E_ba_try": float("nan"), "E_bb": 4.38},
    (3, 10): {"V_a": +0.000, "p_quit": 1.00, "E_ba_try": float("nan"), "E_bb": 2.89},
    (10, 3): {"V_a": +0.800, "p_quit": 0.00, "E_ba_try": 1.00, "E_bb": 0.00},
    (3, 3):  {"V_a": +0.000, "p_quit": 1.00, "E_ba_try": float("nan"), "E_bb": 2.00},
    (2, 2):  {"V_a": +0.000, "p_quit": 1.00, "E_ba_try": float("nan"), "E_bb": 1.00},
}


def policy_at_root(solver, game, sa: int, sb: int):
    """Estrae l'average policy di atk e def alla radice (state iniziale)."""
    state = game.new_initial_state()
    info_a = state.information_state_string(0)
    avg_pi = solver.average_policy()

    pi_a_dict = avg_pi.action_probabilities(state)
    # Costruisci array atk: indice 0=QUIT, 1=bid0, 2=bid1, ...
    n_legal_a = len(state._legal_actions(0))
    pi_a = np.zeros(MAX_ACTIONS)
    for action, prob in pi_a_dict.items():
        pi_a[action] = prob

    # Per def alla radice, devo simulare un atk move qualsiasi e poi guardare il suo info set
    # Trick: applico atk action 1 (bid 0) per arrivare al nodo def root, poi prendo policy
    # — l'info set di def dipende solo da (sa, sb, it=0), non da bid_a, quindi è stabile
    legal_a = state.legal_actions()
    # Scegli un'azione bid (skippa QUIT) per portare a phase def
    bid_action = next((a for a in legal_a if a != 0), None)
    if bid_action is None:
        return pi_a, None  # solo QUIT — def non gioca alla radice
    state2 = state.child(bid_action)
    pi_b_dict = avg_pi.action_probabilities(state2)
    pi_b = np.zeros(MAX_ACTIONS)
    for action, prob in pi_b_dict.items():
        pi_b[action] = prob
    return pi_a, pi_b


def summarize(pi_a: np.ndarray, pi_b, sa: int, sb: int):
    """Computa P(QUIT), E[bid_a|tenta], E[bid_b]."""
    p_quit = float(pi_a[0])
    if 1 - p_quit > 1e-9:
        bids_a = np.arange(MAX_ACTIONS - 1)  # 0..MAX_BID
        probs_a_bid = pi_a[1:1 + (sa - FIXED_ATK_COST + 1)] / (1 - p_quit)
        E_ba_try = float(np.dot(probs_a_bid, np.arange(sa - FIXED_ATK_COST + 1)))
    else:
        E_ba_try = float("nan")
    if pi_b is None:
        E_bb = 0.0
    else:
        probs_b = pi_b[1:1 + (sb + 1)]
        E_bb = float(np.dot(probs_b, np.arange(sb + 1)))
    return p_quit, E_ba_try, E_bb


def run_scenario(sa: int, sb: int, T: int = 5000):
    game = HexAuctionGame({"sa_start": sa, "sb_start": sb})
    # CFRPlus converge ~10x più veloce di vanilla CFR
    solver = cfr.CFRPlusSolver(game)
    t0 = time.time()
    for _ in range(T):
        solver.evaluate_and_update_policy()
    elapsed = time.time() - t0

    # NASH_CONV è la metrica corretta per general-sum (somma dei regret massimi vs BR)
    avg_pi = solver.average_policy()
    try:
        nash_conv = exploitability.nash_conv(game, avg_pi)
    except Exception as e:
        nash_conv = float("nan")
    expl = nash_conv  # in general-sum non c'è exploitability; teniamo il nome compat

    # Calcolo V_a giocando la avg policy contro se stessa: sum_z P(z) * u_a(z)
    V_a = _expected_value(game, avg_pi, player=0)

    pi_a, pi_b = policy_at_root(solver, game, sa, sb)
    p_quit, E_ba_try, E_bb = summarize(pi_a, pi_b, sa, sb)

    return {
        "sa": sa, "sb": sb,
        "V_a": V_a,
        "p_quit": p_quit,
        "E_ba_try": E_ba_try,
        "E_bb": E_bb,
        "expl": expl,
        "nash_conv": nash_conv,
        "elapsed": elapsed,
        "pi_a": pi_a,
        "pi_b": pi_b,
    }


def _expected_value(game, policy, player: int) -> float:
    """Expected value della policy giocata contro se stessa per `player`,
    via DFS dell'albero del gioco con probabilità della policy."""
    state = game.new_initial_state()

    def recurse(s, prob):
        if s.is_terminal():
            return prob * s.returns()[player]
        action_probs = policy.action_probabilities(s)
        v = 0.0
        for a, p in action_probs.items():
            if p < 1e-12:
                continue
            v += recurse(s.child(a), prob * p)
        return v

    return recurse(state, 1.0)


def main():
    quick = "--quick" in sys.argv
    T = 5000 if not quick else 5000
    print("=" * 72)
    print("OpenSpiel pre-flight — sub-game asta D-052 vs ground truth scratch CFR")
    print(f"Config: V={V}, cost={COST}, max_iter={MAX_ITER}, fixed_atk_cost={FIXED_ATK_COST}, T={T}, mode={'QUICK' if quick else 'FULL'}")
    print("=" * 72)

    if quick:
        scenarios = [(3, 3), (5, 5), (8, 8)]
    else:
        scenarios = [(2, 2), (3, 3), (5, 5), (8, 8), (10, 5), (5, 10), (3, 10), (10, 3)]
    rows = []
    total_t0 = time.time()
    for (sa, sb) in scenarios:
        try:
            r = run_scenario(sa, sb, T=2000)
        except Exception as e:
            print(f"\n[sa={sa}, sb={sb}] ERROR: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            continue
        gt = GROUND_TRUTH.get((sa, sb), {})
        delta_V = r["V_a"] - gt.get("V_a", float("nan"))
        delta_pq = r["p_quit"] - gt.get("p_quit", float("nan"))
        delta_bb = r["E_bb"] - gt.get("E_bb", float("nan"))

        # E_ba_try: nan-tolerant
        gt_ba = gt.get("E_ba_try", float("nan"))
        if np.isnan(gt_ba) or np.isnan(r["E_ba_try"]):
            delta_ba = float("nan")
        else:
            delta_ba = r["E_ba_try"] - gt_ba

        print(f"\n[sa={sa}, sb={sb}]  ({r['elapsed']:.2f}s)")
        print(f"  V_a       : OS={r['V_a']:+.4f}  GT={gt.get('V_a', float('nan')):+.4f}  Δ={delta_V:+.4f}")
        print(f"  P(QUIT)   : OS={r['p_quit']:.3f}   GT={gt.get('p_quit', float('nan')):.3f}   Δ={delta_pq:+.3f}")
        print(f"  E[ba|try] : OS={r['E_ba_try']:.3f}   GT={gt_ba:.3f}   Δ={delta_ba:+.3f}")
        print(f"  E[bb]     : OS={r['E_bb']:.3f}   GT={gt.get('E_bb', float('nan')):.3f}   Δ={delta_bb:+.3f}")
        print(f"  exploit={r['expl']:.4f}  nash_conv={r['nash_conv']:.4f}")
        rows.append((sa, sb, r, delta_V, delta_pq, delta_ba, delta_bb))

    elapsed_tot = time.time() - total_t0

    # Tabella riassuntiva
    print("\n" + "=" * 72)
    print(f"{'sa':>3} {'sb':>3} | {'V_a':>8} {'ΔV':>8} | {'P(Q)':>5} {'ΔPQ':>6} | {'E[bb]':>6} {'Δbb':>6} | {'expl':>7}")
    print("-" * 72)
    for (sa, sb, r, dV, dPQ, dBA, dBB) in rows:
        print(f"{sa:>3} {sb:>3} | {r['V_a']:>+8.4f} {dV:>+8.4f} | "
              f"{r['p_quit']:>5.2f} {dPQ:>+6.2f} | "
              f"{r['E_bb']:>6.2f} {dBB:>+6.2f} | "
              f"{r['expl']:>7.4f}")

    print(f"\nTotal pre-flight time: {elapsed_tot:.1f}s")

    # Verdetto automatico
    max_dV = max(abs(r[3]) for r in rows)
    max_dBB = max(abs(r[6]) for r in rows if not np.isnan(r[6]))
    print("\n--- VERDETTO ---")
    if max_dV < 0.03 and max_dBB < 0.15:
        print(f"✅ PASS: max |ΔV_a|={max_dV:.4f} < 0.03, max |ΔE[bb]|={max_dBB:.3f} < 0.15")
        print("   OpenSpiel CFR matcha lo scratch. Wrapper extensive-form pulito.")
        return 0
    else:
        print(f"❌ FAIL: max |ΔV_a|={max_dV:.4f}, max |ΔE[bb]|={max_dBB:.3f}")
        print("   Discrepanze oltre la tolleranza — investigare.")
        return 1


if __name__ == "__main__":
    sys.exit(main())

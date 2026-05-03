"""
Deep CFR algorithm scratch — applicato a hex-tactics.

Pseudocode:

  for t = 1..T:
    for player p in {0, 1}:
      for K traversals:
        Traverse(root_state, player=p, t=t)
      train regret_net[p] on regret_buffer[p]
    train strategy_net (su strategy_buffer condiviso)

  Traverse(state, player, t):
    if terminal: return reward(state, player)
    cur = state.current_player()
    if cur == CHANCE:
      apply chance step → return Traverse(next_state, player, t)
    if cur == player:
      # Decision node del traverser
      σ = regret_matching(regret_net[player](state))
      action_values = []
      for a in legal_actions:
        v = Traverse(state.step(a), player, t)
        action_values.append(v)
      ev = Σ σ[a] * action_values[a]
      regret[a] = action_values[a] - ev
      regret_buffer[player].add((obs, regret, legal_mask, t))
      return ev
    else:
      # Decision node opponent
      σ_op = regret_matching(regret_net[opponent](state))
      strategy_buffer.add((obs, σ_op, legal_mask, t))
      a = sample(σ_op)
      return Traverse(state.step(a), player, t)

NOTE:
  - "External Sampling MCCFR": traverser enumera le sue azioni, opponent samplea.
  - Linear CFR: regret weighted by iter_t (faster convergence).
  - "Outcome sampling" sarebbe più rapido ma più rumoroso. Usiamo external.
"""
from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from typing import Tuple

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from game_model import HexTacticsGameModel, CFRState, PLAYER_A, PLAYER_B, PLAYER_CHANCE, MAX_ACTIONS
from networks import (
    RegretNet, StrategyNet, RegretBuffer, StrategyBuffer,
    RegretSample, StrategySample,
    train_regret_net, train_strategy_net,
)


def make_legal_mask(legal_actions: list[int]) -> np.ndarray:
    """Bool mask di shape MAX_ACTIONS, True per azioni legali."""
    mask = np.zeros(MAX_ACTIONS, dtype=np.float32)
    for a in legal_actions:
        if 0 <= a < MAX_ACTIONS:
            mask[a] = 1.0
    return mask


class DeepCFRTrainer:
    """Deep CFR (External Sampling MCCFR) per hex-tactics 2-player zero-sum."""

    def __init__(
        self,
        game: HexTacticsGameModel,
        regret_buffer_size: int = 100_000,
        strategy_buffer_size: int = 100_000,
    ):
        self.game = game
        self.regret_nets = [RegretNet(), RegretNet()]
        self.strategy_net = StrategyNet()
        self.regret_buffers = [
            RegretBuffer(max_size=regret_buffer_size),
            RegretBuffer(max_size=regret_buffer_size),
        ]
        self.strategy_buffer = StrategyBuffer(max_size=strategy_buffer_size)
        self.iter_t = 0
        # Limit ricorsione (alcuni stati sono "long-tail": MOVE multi-step)
        self.max_depth = 80

    def _regret_strategy(self, player: int, obs: np.ndarray, legal_mask: np.ndarray) -> np.ndarray:
        """Strategia del player dato regret_net (regret matching)."""
        return self.regret_nets[player].predict_strategy(obs, legal_mask)

    def _traverse(self, state: CFRState, player: int, reach_prob: float = 1.0,
                   sample_prob: float = 1.0, depth: int = 0) -> float:
        """Outcome Sampling MCCFR.

        Sample 1 azione per ogni decision node (sia traverser che opponent).
        Importance weighting tramite reach_prob/sample_prob. Lineare in depth.
        """
        if self.game.is_terminal(state):
            return self.game.terminal_reward(state, player) / max(sample_prob, 1e-6)
        if depth >= self.max_depth:
            return 0.0

        cur = state.current_player()
        legal = self.game.legal_actions(state)
        if not legal:
            return self.game.terminal_reward(state, player) / max(sample_prob, 1e-6)

        if cur == PLAYER_CHANCE or cur == -1:
            next_state = self.game.step(state, 0)
            return self._traverse(next_state, player, reach_prob, sample_prob, depth + 1)

        legal_mask = make_legal_mask(legal)
        obs = self.game.obs_features(state, cur)
        sigma = self._regret_strategy(cur, obs, legal_mask)

        # Sampling distribution: epsilon-explore + 1-eps strategy
        eps = 0.6  # alta esplorazione per traverser, ridotta per opponent
        if cur == player:
            # ε-greedy per traverser (più exploration)
            sample_dist = np.zeros(MAX_ACTIONS)
            n_legal = len(legal)
            for a in legal:
                sample_dist[a] = eps / n_legal + (1 - eps) * sigma[a]
        else:
            sample_dist = sigma.copy()

        valid_indices = [a for a in legal if sample_dist[a] > 1e-9]
        if not valid_indices:
            valid_indices = legal
            for a in legal:
                sample_dist[a] = 1.0 / len(legal)
        weights = np.array([sample_dist[a] for a in valid_indices])
        weights = weights / weights.sum()
        action = int(np.random.choice(valid_indices, p=weights))
        action_prob = float(weights[valid_indices.index(action)])

        if cur == player:
            # Salva regret usando estimated value via outcome sampling
            next_state = self.game.step(state, action)
            new_reach = reach_prob * sigma[action]
            new_sample = sample_prob * action_prob
            v_action = self._traverse(next_state, player, new_reach, new_sample, depth + 1)
            # Estimate value per action: v[a] = v_action only se a == sampled
            # Importance weighted: regret[a] = (v[a] - ev) * legal_mask[a]
            # OS-CFR formula: regret(a) = w * sigma(a) * (v_action_at_a - ev) — semplificato
            # Versione standard MCCFR-OS:
            #   regret[sampled] = (1 - sigma[sampled]) * v_action / sample_prob
            #   regret[not_sampled] = -sigma[a] * v_action / sample_prob  (per a != sampled)
            regrets = np.zeros(MAX_ACTIONS, dtype=np.float32)
            normalizer = sample_prob  # già nel value path
            for a in legal:
                if a == action:
                    regrets[a] = (1 - sigma[a]) * v_action
                else:
                    regrets[a] = -sigma[a] * v_action
            self.regret_buffers[player].add(
                RegretSample(obs=obs, regrets=regrets, legal_mask=legal_mask, iter_t=self.iter_t),
            )
            return v_action
        else:
            # Opponent: snapshot strategia + ricorri
            self.strategy_buffer.add(
                StrategySample(obs=obs, strategy=sigma.copy(), legal_mask=legal_mask, iter_t=self.iter_t),
            )
            next_state = self.game.step(state, action)
            new_reach = reach_prob * sigma[action]
            new_sample = sample_prob * action_prob
            return self._traverse(next_state, player, new_reach, new_sample, depth + 1)

    def iteration(self, traversals_per_player: int = 50) -> dict:
        """Una iterazione CFR: traverse + train. Restituisce stats."""
        self.iter_t += 1
        t0 = time.time()
        for player in (PLAYER_A, PLAYER_B):
            for _ in range(traversals_per_player):
                state = self.game.reset()
                self._traverse(state, player)
        traverse_time = time.time() - t0

        # Train regret nets
        t1 = time.time()
        loss_a = train_regret_net(self.regret_nets[PLAYER_A], self.regret_buffers[PLAYER_A], epochs=3)
        loss_b = train_regret_net(self.regret_nets[PLAYER_B], self.regret_buffers[PLAYER_B], epochs=3)
        regret_time = time.time() - t1

        # Train strategy net (running avg policy)
        t2 = time.time()
        loss_s = train_strategy_net(self.strategy_net, self.strategy_buffer, epochs=3)
        strat_time = time.time() - t2

        return {
            "iter": self.iter_t,
            "traversals": traversals_per_player * 2,
            "buf_regret_a": len(self.regret_buffers[PLAYER_A]),
            "buf_regret_b": len(self.regret_buffers[PLAYER_B]),
            "buf_strategy": len(self.strategy_buffer),
            "loss_regret_a": loss_a,
            "loss_regret_b": loss_b,
            "loss_strategy": loss_s,
            "time_traverse": traverse_time,
            "time_regret_train": regret_time,
            "time_strat_train": strat_time,
        }

    def evaluate(self, n_games: int = 50) -> dict:
        """Eval: gioca N partite Strategy_net vs Strategy_net (mirror) e vs random.
        Restituisce wr_avg vs random."""
        # Importa basicAi come baseline opponent
        from hex_tactics.ai.utility_ai import utility_decide_move

        wins_vs_utility = 0
        wins_vs_random = 0
        ties = 0
        for ep in range(n_games):
            state = self.game.reset(seed=10000 + ep)
            for _ in range(self.game.max_steps):
                if self.game.is_terminal(state):
                    break
                cur = state.current_player()
                legal = self.game.legal_actions(state)
                if not legal:
                    break
                if cur == PLAYER_CHANCE or cur == -1:
                    state = self.game.step(state, 0)
                    continue
                if cur == PLAYER_A:
                    # Strategy net policy
                    obs = self.game.obs_features(state, PLAYER_A)
                    mask = make_legal_mask(legal)
                    pi = self.strategy_net.predict_strategy(obs, mask)
                    a = int(np.argmax(pi))
                else:
                    # Utility AI baseline
                    events = self.game.get_legal_events(state)
                    if not events:
                        a = 0
                    else:
                        # Scegli action via utility (lookup matching event)
                        from hex_tactics.core.events import EventEndTurn
                        unit_id = state.b_unit_id
                        # Use legal_moves ordering — legal_actions and events are aligned
                        ev_picked = utility_decide_move(state.game_state, unit_id)
                        # find matching index
                        a = 0
                        for i, e in enumerate(events):
                            if e == ev_picked or e.type == ev_picked.type:
                                a = i
                                break
                state = self.game.step(state, a)
            if self.game.terminal_reward(state, PLAYER_A) > 0:
                wins_vs_utility += 1
            elif self.game.terminal_reward(state, PLAYER_A) < 0:
                pass  # B wins
            else:
                ties += 1
        return {
            "n_games": n_games,
            "wr_vs_utility": wins_vs_utility / n_games,
            "ties": ties,
        }


# Smoke test
if __name__ == "__main__":
    print("=" * 60)
    print("Deep CFR — Smoke test 5 iterazioni")
    print("=" * 60)
    game = HexTacticsGameModel(seed=42)
    trainer = DeepCFRTrainer(game)
    for it in range(5):
        stats = trainer.iteration(traversals_per_player=10)
        print(f"\n[iter {stats['iter']}] traverse={stats['time_traverse']:.1f}s "
              f"regret_train={stats['time_regret_train']:.1f}s "
              f"buf_a={stats['buf_regret_a']} buf_b={stats['buf_regret_b']} "
              f"buf_s={stats['buf_strategy']} "
              f"loss_r_a={stats['loss_regret_a']:.3f} "
              f"loss_s={stats['loss_strategy']:.3f}")
    print("\n[eval] vs Utility (10 games)...")
    eval_stats = trainer.evaluate(n_games=10)
    print(f"  wr_vs_utility = {eval_stats['wr_vs_utility']:.2f}, ties = {eval_stats['ties']}")

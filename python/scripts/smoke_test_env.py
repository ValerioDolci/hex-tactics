"""
Smoke test HexTacticsEnv: 100 episodi con policy random.

Verifica:
  - env.reset() + env.step() funzionano senza crash
  - shape obs corretto
  - reward sensato
  - distribuzione winner ragionevole
"""

from __future__ import annotations

import sys
import time

import numpy as np

# Add python/ to path
sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv, MAX_ACTIONS, N_FEATURES  # noqa: E402


def main() -> None:
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=42)
    obs, info = env.reset(seed=42)

    print(f"obs shape: {obs.shape} (expected ({N_FEATURES},))")
    print(f"obs sample: {obs}")
    print(f"action_space: {env.action_space}")
    print(f"observation_space: {env.observation_space}")
    print(f"first info: {info}")
    print()

    n_episodes = 100
    rng = np.random.default_rng(123)

    winners: list[str | None] = []
    rewards_total: list[float] = []
    illegal_counts: list[int] = []
    rounds_played: list[int] = []
    steps_played: list[int] = []

    t0 = time.time()
    for ep in range(n_episodes):
        obs, info = env.reset(seed=ep + 1000)
        ep_reward = 0.0
        steps = 0
        for _ in range(2000):
            # Policy random uniform su MAX_ACTIONS
            action = int(rng.integers(0, MAX_ACTIONS))
            obs, reward, terminated, truncated, info = env.step(action)
            ep_reward += float(reward)
            steps += 1
            if terminated or truncated:
                break

        winners.append(info.get("winner"))
        rewards_total.append(ep_reward)
        illegal_counts.append(env._info.illegal_actions)
        rounds_played.append(info.get("round", 0))
        steps_played.append(steps)

    elapsed = time.time() - t0

    # Stats
    n_a_wins = sum(1 for w in winners if w == "A")
    n_b_wins = sum(1 for w in winners if w == "B")
    n_draws = sum(1 for w in winners if w == "draw")
    n_unfinished = sum(1 for w in winners if w is None)

    print(f"=== {n_episodes} episodi random ===")
    print(f"Tempo: {elapsed:.1f}s ({n_episodes / elapsed:.1f} ep/s)")
    print(f"Steps medio per episodio: {np.mean(steps_played):.1f}")
    print(f"Round medio per episodio: {np.mean(rounds_played):.1f}")
    print(f"Reward medio: {np.mean(rewards_total):+.2f}  (std {np.std(rewards_total):.2f})")
    print(f"Illegal actions medio per episodio: {np.mean(illegal_counts):.1f}")
    print()
    print(f"Winner stats (A=spadaccino RND vs B=tank UTILITY):")
    print(f"  A wins:     {n_a_wins:3d}  ({100*n_a_wins/n_episodes:.1f}%)")
    print(f"  B wins:     {n_b_wins:3d}  ({100*n_b_wins/n_episodes:.1f}%)")
    print(f"  Draws:      {n_draws:3d}  ({100*n_draws/n_episodes:.1f}%)")
    print(f"  Unfinished: {n_unfinished:3d}  ({100*n_unfinished/n_episodes:.1f}%)")


if __name__ == "__main__":
    main()

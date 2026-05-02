"""
Train DQN baseline su HexTacticsEnv (P12 prima prova).

Setup:
  - Agent: A (spadaccino) vs Utility AI B (tank)
  - DQN sb3 default + eval callback ogni 5k step (20 episodi vs Utility AI)
  - Salva modello + log eval in /tmp/hex_tactics_dqn/
  - Plot finale di reward + winrate eval

Output:
  - /tmp/hex_tactics_dqn/model.zip
  - /tmp/hex_tactics_dqn/eval_log.csv
  - /tmp/hex_tactics_dqn/learning_curve.png
"""

from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
from stable_baselines3 import DQN
from stable_baselines3.common.callbacks import BaseCallback

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402


OUT_DIR = Path("/tmp/hex_tactics_dqn")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def evaluate_policy_vs_utility(
    model: DQN, n_episodes: int = 20, seed_offset: int = 90000
) -> dict:
    """Valuta il policy contro Utility AI baseline su N episodi."""
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=seed_offset)
    wins_a = 0
    wins_b = 0
    draws = 0
    unfinished = 0
    rewards = []
    rounds_played = []
    for ep in range(n_episodes):
        obs, info = env.reset(seed=seed_offset + ep)
        ep_reward = 0.0
        for _ in range(2000):
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, terminated, truncated, info = env.step(int(action))
            ep_reward += float(reward)
            if terminated or truncated:
                break
        winner = info.get("winner")
        if winner == "A":
            wins_a += 1
        elif winner == "B":
            wins_b += 1
        elif winner == "draw":
            draws += 1
        else:
            unfinished += 1
        rewards.append(ep_reward)
        rounds_played.append(info.get("round", 0))

    return {
        "wins_a": wins_a,
        "wins_b": wins_b,
        "draws": draws,
        "unfinished": unfinished,
        "winrate_a": wins_a / n_episodes,
        "reward_mean": float(np.mean(rewards)),
        "reward_std": float(np.std(rewards)),
        "rounds_mean": float(np.mean(rounds_played)),
    }


class EvalCallback(BaseCallback):
    """Callback custom: ogni eval_freq step → 20 episodi vs Utility AI, log."""

    def __init__(self, eval_freq: int = 5000, n_eval_episodes: int = 20):
        super().__init__()
        self.eval_freq = eval_freq
        self.n_eval_episodes = n_eval_episodes
        self.history: list[dict] = []
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_initialized = False

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq == 0 and self.num_timesteps > 0:
            t0 = time.time()
            stats = evaluate_policy_vs_utility(
                self.model, n_episodes=self.n_eval_episodes  # type: ignore[arg-type]
            )
            stats["timesteps"] = self.num_timesteps
            stats["eval_time"] = time.time() - t0
            self.history.append(stats)

            # Append to CSV
            mode = "a" if self._csv_initialized else "w"
            with open(self.csv_path, mode, newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(stats.keys()))
                if not self._csv_initialized:
                    w.writeheader()
                    self._csv_initialized = True
                w.writerow(stats)

            print(
                f"[eval @ {self.num_timesteps:>6d}] "
                f"winrate={stats['winrate_a']:.2f} "
                f"(A={stats['wins_a']}/{self.n_eval_episodes}, B={stats['wins_b']}, "
                f"draw={stats['draws']}, unfin={stats['unfinished']}) "
                f"reward={stats['reward_mean']:+.2f}±{stats['reward_std']:.2f} "
                f"rounds={stats['rounds_mean']:.1f} "
                f"({stats['eval_time']:.1f}s)"
            )
        return True


def plot_learning_curve(history: list[dict], out_path: Path) -> None:
    if not history:
        return
    timesteps = [h["timesteps"] for h in history]
    winrates = [h["winrate_a"] for h in history]
    rewards = [h["reward_mean"] for h in history]
    rounds = [h["rounds_mean"] for h in history]

    fig, axes = plt.subplots(3, 1, figsize=(8, 9), sharex=True)

    ax = axes[0]
    ax.plot(timesteps, winrates, marker="o", color="tab:green")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_ylabel("Winrate vs Utility AI")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("DQN baseline — A=spadaccino vs B=tank (Utility)")
    ax.grid(alpha=0.3)

    ax = axes[1]
    ax.plot(timesteps, rewards, marker="o", color="tab:blue")
    ax.axhline(0, ls="--", color="gray", alpha=0.5)
    ax.set_ylabel("Reward medio (eval)")
    ax.grid(alpha=0.3)

    ax = axes[2]
    ax.plot(timesteps, rounds, marker="o", color="tab:orange")
    ax.set_ylabel("Round medio (eval)")
    ax.set_xlabel("Timesteps")
    ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"[plot] saved {out_path}")


def main() -> None:
    total_timesteps = 50_000

    # Train env
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=12345)
    obs, _ = env.reset(seed=12345)

    # Device
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[train] device={device}, total_timesteps={total_timesteps}")

    model = DQN(
        "MlpPolicy",
        env,
        learning_rate=1e-4,
        buffer_size=50_000,
        learning_starts=1_000,
        batch_size=64,
        tau=1.0,
        gamma=0.99,
        train_freq=4,
        gradient_steps=1,
        target_update_interval=1_000,
        exploration_fraction=0.3,
        exploration_initial_eps=1.0,
        exploration_final_eps=0.05,
        policy_kwargs={"net_arch": [128, 128]},
        verbose=0,
        seed=42,
        device=device,
    )

    callback = EvalCallback(eval_freq=5_000, n_eval_episodes=20)

    # Eval iniziale (timesteps=0, no training)
    print("[eval @      0] (pre-training, prima eval ufficiale a 5000)")
    pre_stats = evaluate_policy_vs_utility(model, n_episodes=20, seed_offset=80000)
    print(
        f"  → winrate={pre_stats['winrate_a']:.2f} reward={pre_stats['reward_mean']:+.2f}"
    )

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=callback, progress_bar=False)
    elapsed = time.time() - t0
    print(f"[train] done in {elapsed:.1f}s ({total_timesteps / elapsed:.1f} step/s)")

    # Save modello
    model_path = OUT_DIR / "model.zip"
    model.save(model_path)
    print(f"[save] model → {model_path}")

    # Eval finale
    final = evaluate_policy_vs_utility(model, n_episodes=50, seed_offset=70000)
    print(f"[final eval, 50 ep] winrate={final['winrate_a']:.2f}, reward={final['reward_mean']:+.2f}")

    # Plot
    plot_learning_curve(callback.history, OUT_DIR / "learning_curve.png")


if __name__ == "__main__":
    main()

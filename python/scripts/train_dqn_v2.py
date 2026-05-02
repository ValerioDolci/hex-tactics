"""
Train DQN v2 con observation human-fair (486 feature).

Setup identico a train_dqn.py ma:
  - obs space passa da 30 → 486 feature
  - net_arch [256, 256] (più capacità)
  - learning_rate 3e-4 (un filo più alto, più feature da imparare)

Output: /tmp/hex_tactics_dqn_v2/
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


OUT_DIR = Path("/tmp/hex_tactics_dqn_v2")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def evaluate_policy_vs_utility(
    model: DQN, n_episodes: int = 20, seed_offset: int = 90000
) -> dict:
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
    """Callback con eval periodica + salvataggio del BEST checkpoint.

    Tie-break: se due eval hanno stesso winrate, prendo quella con reward_mean più alto.
    Salvo il modello in `best.zip` ogni volta che batte il record.
    """

    def __init__(self, eval_freq: int = 5000, n_eval_episodes: int = 20):
        super().__init__()
        self.eval_freq = eval_freq
        self.n_eval_episodes = n_eval_episodes
        self.history: list[dict] = []
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_initialized = False
        # Tracking best
        self.best_winrate: float = -1.0
        self.best_reward: float = -1e9
        self.best_timesteps: int = 0
        self.best_path = OUT_DIR / "best.zip"

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq == 0 and self.num_timesteps > 0:
            t0 = time.time()
            stats = evaluate_policy_vs_utility(
                self.model, n_episodes=self.n_eval_episodes  # type: ignore[arg-type]
            )
            stats["timesteps"] = self.num_timesteps
            stats["eval_time"] = time.time() - t0
            self.history.append(stats)

            mode = "a" if self._csv_initialized else "w"
            with open(self.csv_path, mode, newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(stats.keys()))
                if not self._csv_initialized:
                    w.writeheader()
                    self._csv_initialized = True
                w.writerow(stats)

            # Save best checkpoint (winrate primary, reward_mean tie-break)
            wr = stats["winrate_a"]
            rw = stats["reward_mean"]
            is_best = (wr > self.best_winrate) or (
                wr == self.best_winrate and rw > self.best_reward
            )
            best_marker = ""
            if is_best:
                self.best_winrate = wr
                self.best_reward = rw
                self.best_timesteps = self.num_timesteps
                self.model.save(self.best_path)  # type: ignore[union-attr]
                best_marker = " ★ NEW BEST → saved"

            print(
                f"[eval @ {self.num_timesteps:>6d}] "
                f"winrate={wr:.2f} "
                f"(A={stats['wins_a']}/{self.n_eval_episodes}, B={stats['wins_b']}, "
                f"draw={stats['draws']}, unfin={stats['unfinished']}) "
                f"reward={rw:+.2f}±{stats['reward_std']:.2f} "
                f"rounds={stats['rounds_mean']:.1f} "
                f"({stats['eval_time']:.1f}s)" + best_marker
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
    ax.plot(timesteps, winrates, marker="o", color="tab:green", label="DQN v2 (486 feat)")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.axhline(0.17, ls=":", color="tab:red", alpha=0.7, label="Utility-vs-Utility baseline")
    ax.set_ylabel("Winrate vs Utility AI")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("DQN v2 — A=spadaccino vs B=tank (Utility) — obs human-fair 486 feat")
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right", fontsize=8)

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

    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=12345)
    obs, _ = env.reset(seed=12345)
    print(f"[setup] obs shape: {obs.shape}")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[train] device={device}, total_timesteps={total_timesteps}")

    model = DQN(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
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
        policy_kwargs={"net_arch": [256, 256]},
        verbose=0,
        seed=42,
        device=device,
    )

    callback = EvalCallback(eval_freq=5_000, n_eval_episodes=20)

    print("[eval @      0] (pre-training)")
    pre_stats = evaluate_policy_vs_utility(model, n_episodes=20, seed_offset=80000)
    print(f"  → winrate={pre_stats['winrate_a']:.2f} reward={pre_stats['reward_mean']:+.2f}")

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=callback, progress_bar=False)
    elapsed = time.time() - t0
    print(f"[train] done in {elapsed:.1f}s ({total_timesteps / elapsed:.1f} step/s)")

    # Salva ANCHE il modello finale (per riferimento), ma il "vero" output è BEST.
    model_path = OUT_DIR / "model_last.zip"
    model.save(model_path)
    print(f"[save] last model → {model_path}")

    print(
        f"[best  ] checkpoint da step={callback.best_timesteps} "
        f"(winrate eval={callback.best_winrate:.2f}, reward={callback.best_reward:+.2f})"
    )

    # Final eval su BEST (50 episodi, seed nuovi)
    if callback.best_path.exists():
        best_model = DQN.load(callback.best_path, env=env, device=device)
        final = evaluate_policy_vs_utility(best_model, n_episodes=50, seed_offset=70000)
        print(
            f"[final eval BEST, 50 ep] winrate={final['winrate_a']:.2f}, "
            f"reward={final['reward_mean']:+.2f}, rounds_mean={final['rounds_mean']:.1f}"
        )
    else:
        print("[warn] best.zip non trovato, fallback su modello finale")
        final = evaluate_policy_vs_utility(model, n_episodes=50, seed_offset=70000)
        print(
            f"[final eval LAST, 50 ep] winrate={final['winrate_a']:.2f}, "
            f"reward={final['reward_mean']:+.2f}"
        )

    plot_learning_curve(callback.history, OUT_DIR / "learning_curve.png")


if __name__ == "__main__":
    main()

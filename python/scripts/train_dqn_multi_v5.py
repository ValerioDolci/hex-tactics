"""
Train DQN multi-matchup (P11/P12 v3).

Setup:
  - Env con preset_a='random' e preset_b='random' → 9 matchup possibili
  - 200k step training (vs 50k del v2 — più varietà richiede più esposizione)
  - Eval ogni 10k step su tutti i 9 matchup, 5 episodi ciascuno (45 ep totali)
  - Save best basato su winrate medio globale sui 9 matchup
  - Final eval: 20 episodi per matchup, matrice 3x3

Output: /tmp/hex_tactics_dqn_multi_v5/
"""

from __future__ import annotations

import csv
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
from stable_baselines3 import DQN
from stable_baselines3.common.callbacks import BaseCallback

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402


OUT_DIR = Path("/tmp/hex_tactics_dqn_multi_v5")
OUT_DIR.mkdir(parents=True, exist_ok=True)

PRESETS = ("spadaccino", "arciere", "tank")
MATCHUPS = [(a, b) for a in PRESETS for b in PRESETS]  # 9


def evaluate_per_matchup(
    model: DQN, n_episodes: int = 5, seed_offset: int = 90000
) -> dict[tuple[str, str], dict]:
    """Per ogni matchup, gioca n_episodes con DQN agent vs Utility."""
    out = {}
    for (pa, pb) in MATCHUPS:
        env = HexTacticsEnv(preset_a=pa, preset_b=pb, max_rounds=30, seed=seed_offset, obs_version='v2')
        wins_a = wins_b = draws = unfin = 0
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
                unfin += 1
            rewards.append(ep_reward)
            rounds_played.append(info.get("round", 0))
        out[(pa, pb)] = {
            "wins_a": wins_a,
            "wins_b": wins_b,
            "draws": draws,
            "unfinished": unfin,
            "winrate_a": wins_a / n_episodes,
            "reward_mean": float(np.mean(rewards)),
            "rounds_mean": float(np.mean(rounds_played)),
        }
    return out


def aggregate_global(per_match: dict[tuple[str, str], dict]) -> dict:
    """Aggrega stat globale su tutti i 9 matchup."""
    winrates = [s["winrate_a"] for s in per_match.values()]
    rewards = [s["reward_mean"] for s in per_match.values()]
    rounds = [s["rounds_mean"] for s in per_match.values()]
    return {
        "winrate_global": float(np.mean(winrates)),
        "winrate_min": float(np.min(winrates)),
        "winrate_max": float(np.max(winrates)),
        "reward_global": float(np.mean(rewards)),
        "rounds_global": float(np.mean(rounds)),
    }


class MultiEvalCallback(BaseCallback):
    def __init__(self, eval_freq: int = 10_000, n_eval_episodes: int = 5):
        super().__init__()
        self.eval_freq = eval_freq
        self.n_eval_episodes = n_eval_episodes
        self.history: list[dict] = []  # uno per eval, contiene per-matchup + globale
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_header_written = False
        self.best_winrate: float = -1.0
        self.best_reward: float = -1e9
        self.best_timesteps: int = 0
        self.best_path = OUT_DIR / "best.zip"

    def _on_step(self) -> bool:
        if self.num_timesteps % self.eval_freq == 0 and self.num_timesteps > 0:
            t0 = time.time()
            per_match = evaluate_per_matchup(
                self.model, n_episodes=self.n_eval_episodes  # type: ignore[arg-type]
            )
            agg = aggregate_global(per_match)
            elapsed = time.time() - t0
            row = {
                "timesteps": self.num_timesteps,
                "winrate_global": agg["winrate_global"],
                "winrate_min": agg["winrate_min"],
                "winrate_max": agg["winrate_max"],
                "reward_global": agg["reward_global"],
                "rounds_global": agg["rounds_global"],
                "eval_time": elapsed,
            }
            for (pa, pb), s in per_match.items():
                row[f"wr_{pa}_vs_{pb}"] = s["winrate_a"]
            self.history.append({"agg": agg, "per_match": per_match, "timesteps": self.num_timesteps})

            mode = "a" if self._csv_header_written else "w"
            with open(self.csv_path, mode, newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(row.keys()))
                if not self._csv_header_written:
                    w.writeheader()
                    self._csv_header_written = True
                w.writerow(row)

            wrg = agg["winrate_global"]
            rwg = agg["reward_global"]
            is_best = (wrg > self.best_winrate) or (
                wrg == self.best_winrate and rwg > self.best_reward
            )
            best_marker = ""
            if is_best:
                self.best_winrate = wrg
                self.best_reward = rwg
                self.best_timesteps = self.num_timesteps
                self.model.save(self.best_path)  # type: ignore[union-attr]
                best_marker = " ★ NEW BEST"

            print(
                f"[eval @ {self.num_timesteps:>6d}] "
                f"global wr={wrg:.2f} (min={agg['winrate_min']:.2f}, max={agg['winrate_max']:.2f}) "
                f"reward={rwg:+.2f} rounds={agg['rounds_global']:.1f} "
                f"({elapsed:.1f}s){best_marker}"
            )
            # Print quick matrix
            self._print_matrix(per_match)
        return True

    def _print_matrix(self, per_match: dict[tuple[str, str], dict]) -> None:
        col = "  ".join(f"{p:>10s}" for p in PRESETS)
        print(f"        {col}")
        for pa in PRESETS:
            row = []
            for pb in PRESETS:
                w = per_match[(pa, pb)]["winrate_a"]
                row.append(f"{w:>10.2f}")
            print(f"  A={pa:>9s}: {'  '.join(row)}")


def plot_curves(history: list[dict], out_path: Path) -> None:
    if not history:
        return
    timesteps = [h["timesteps"] for h in history]

    fig, axes = plt.subplots(2, 1, figsize=(11, 8), sharex=True)

    # Top: winrate per matchup
    ax = axes[0]
    cmap = plt.get_cmap("tab10")
    for i, (pa, pb) in enumerate(MATCHUPS):
        ys = [h["per_match"][(pa, pb)]["winrate_a"] for h in history]
        ax.plot(
            timesteps, ys, marker="o", color=cmap(i % 10),
            label=f"A={pa} vs B={pb}", alpha=0.85,
        )
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_ylabel("Winrate per matchup")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("DQN multi-matchup — winrate vs Utility AI")
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right", fontsize=7, ncol=3)

    # Bottom: aggregato globale
    ax = axes[1]
    wr_global = [h["agg"]["winrate_global"] for h in history]
    wr_min = [h["agg"]["winrate_min"] for h in history]
    wr_max = [h["agg"]["winrate_max"] for h in history]
    ax.plot(timesteps, wr_global, marker="o", color="tab:green", label="Global mean", linewidth=2)
    ax.fill_between(timesteps, wr_min, wr_max, alpha=0.2, color="tab:green", label="min/max range")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_xlabel("Timesteps")
    ax.set_ylabel("Winrate aggregato (mean / min-max)")
    ax.set_ylim(-0.02, 1.02)
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right")

    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"[plot] saved {out_path}")


def plot_final_matrix(per_match: dict, out_path: Path, n_episodes: int) -> None:
    matrix = np.zeros((3, 3))
    for i, pa in enumerate(PRESETS):
        for j, pb in enumerate(PRESETS):
            matrix[i, j] = per_match[(pa, pb)]["winrate_a"]

    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(matrix, cmap="RdYlGn", vmin=0, vmax=1, aspect="equal")
    ax.set_xticks(range(3))
    ax.set_yticks(range(3))
    ax.set_xticklabels([f"B={p}" for p in PRESETS])
    ax.set_yticklabels([f"A={p}" for p in PRESETS])
    for i in range(3):
        for j in range(3):
            ax.text(
                j, i, f"{matrix[i, j]:.2f}",
                ha="center", va="center",
                color="black" if 0.3 < matrix[i, j] < 0.7 else "white",
                fontsize=14, fontweight="bold",
            )
    ax.set_title(f"DQN multi-matchup — winrate finale ({n_episodes} ep/matchup)")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)
    print(f"[plot] saved {out_path}")


def main() -> None:
    total_timesteps = 200_000

    env = HexTacticsEnv(preset_a="random", preset_b="random", max_rounds=30, seed=12345, obs_version="v2")
    obs, info = env.reset(seed=12345)
    print(f"[setup] obs shape: {obs.shape}, first matchup: {info['matchup']}")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[train] device={device}, total_timesteps={total_timesteps}")

    model = DQN(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
        buffer_size=100_000,
        learning_starts=2_000,
        batch_size=128,
        tau=1.0,
        gamma=0.99,
        train_freq=4,
        gradient_steps=1,
        target_update_interval=1_000,
        exploration_fraction=0.25,
        exploration_initial_eps=1.0,
        exploration_final_eps=0.05,
        policy_kwargs={"net_arch": [256, 256]},
        verbose=0,
        seed=42,
        device=device,
    )

    callback = MultiEvalCallback(eval_freq=10_000, n_eval_episodes=5)

    print("[eval @      0] (pre-training)")
    pre = evaluate_per_matchup(model, n_episodes=5, seed_offset=80000)
    pre_agg = aggregate_global(pre)
    print(
        f"  → global wr={pre_agg['winrate_global']:.2f} "
        f"(min={pre_agg['winrate_min']:.2f}, max={pre_agg['winrate_max']:.2f})"
    )

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=callback, progress_bar=False)
    elapsed = time.time() - t0
    print(f"[train] done in {elapsed:.1f}s ({total_timesteps / elapsed:.1f} step/s)")

    last_path = OUT_DIR / "model_last.zip"
    model.save(last_path)
    print(f"[save] last model → {last_path}")
    print(
        f"[best] checkpoint da step={callback.best_timesteps} "
        f"(global wr={callback.best_winrate:.2f}, reward={callback.best_reward:+.2f})"
    )

    if callback.best_path.exists():
        best_model = DQN.load(callback.best_path, env=env, device=device)
        print(f"\n[final eval BEST, 20 ep/matchup, 9×20=180 ep totali]")
        final_per = evaluate_per_matchup(best_model, n_episodes=20, seed_offset=70000)
        final_agg = aggregate_global(final_per)
        print(f"  global wr={final_agg['winrate_global']:.2f}")
        print(f"  Per matchup:")
        callback._print_matrix(final_per)
        plot_final_matrix(final_per, OUT_DIR / "final_matrix.png", n_episodes=20)

    plot_curves(callback.history, OUT_DIR / "learning_curves.png")


if __name__ == "__main__":
    main()

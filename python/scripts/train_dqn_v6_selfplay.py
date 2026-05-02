"""
Train v6 — self-play con obs_v2 + pool snapshot.

Setup:
  - Env: SelfPlayEnv (B = snapshot pool DQN, fallback Utility se pool vuoto)
  - Pool: rotation 6 snapshot, aggiungi nuovo ogni 50k step
  - Bootstrap: pool inizia vuoto → primi 50k vs Utility (fallback)
  - Total: 500k step
  - Eval ogni 25k step su 9 matchup × 5 ep (vs Utility, per confronto)
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
from hex_tactics.ai.self_play_env import SelfPlayEnv, SnapshotPool  # noqa: E402


OUT_DIR = Path("/tmp/hex_tactics_dqn_v6_selfplay")
OUT_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOTS_DIR = OUT_DIR / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)

PRESETS = ("spadaccino", "arciere", "tank")
MATCHUPS = [(a, b) for a in PRESETS for b in PRESETS]


def evaluate_per_matchup(model: DQN, n_episodes: int = 5, seed_offset: int = 90000) -> dict:
    """Eval su 9 matchup vs Utility AI (NON self-play)."""
    out = {}
    for (pa, pb) in MATCHUPS:
        env = HexTacticsEnv(preset_a=pa, preset_b=pb, max_rounds=30, seed=seed_offset, obs_version="v2")
        wins = 0
        for ep in range(n_episodes):
            obs, info = env.reset(seed=seed_offset + ep)
            for _ in range(2000):
                action, _ = model.predict(obs, deterministic=True)
                obs, _, term, trunc, info = env.step(int(action))
                if term or trunc:
                    break
            if info.get("winner") == "A":
                wins += 1
        out[(pa, pb)] = wins / n_episodes
    return out


def aggregate(per_match: dict) -> dict:
    vals = list(per_match.values())
    return {
        "winrate_global": float(np.mean(vals)),
        "winrate_min": float(np.min(vals)),
        "winrate_max": float(np.max(vals)),
    }


class SelfPlayCallback(BaseCallback):
    """Eval + snapshot management per self-play."""

    def __init__(
        self,
        eval_freq: int = 25_000,
        snapshot_freq: int = 50_000,
        n_eval_episodes: int = 5,
        snapshot_pool: SnapshotPool = None,  # type: ignore
    ):
        super().__init__()
        self.eval_freq = eval_freq
        self.snapshot_freq = snapshot_freq
        self.n_eval_episodes = n_eval_episodes
        self.history = []
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_init = False
        self.snapshot_pool = snapshot_pool
        self.best_winrate = -1.0
        self.best_path = OUT_DIR / "best.zip"

    def _on_step(self) -> bool:
        # Snapshot rotation
        if self.snapshot_pool is not None and self.num_timesteps > 0 and self.num_timesteps % self.snapshot_freq == 0:
            snap_path = SNAPSHOTS_DIR / f"snap_{self.num_timesteps:07d}.zip"
            self.model.save(snap_path)  # type: ignore
            self.snapshot_pool.add(str(snap_path))
            print(
                f"[snapshot @ {self.num_timesteps:>6d}] "
                f"saved {snap_path.name}, pool size={len(self.snapshot_pool)}"
            )

        # Eval
        if self.num_timesteps > 0 and self.num_timesteps % self.eval_freq == 0:
            t0 = time.time()
            per = evaluate_per_matchup(self.model, n_episodes=self.n_eval_episodes)  # type: ignore
            agg = aggregate(per)
            elapsed = time.time() - t0
            row = {"timesteps": self.num_timesteps, **agg, "eval_time": elapsed}
            for (pa, pb), wr in per.items():
                row[f"wr_{pa}_vs_{pb}"] = wr
            self.history.append({"agg": agg, "per_match": per, "timesteps": self.num_timesteps})

            mode = "a" if self._csv_init else "w"
            with open(self.csv_path, mode, newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(row.keys()))
                if not self._csv_init:
                    w.writeheader()
                    self._csv_init = True
                w.writerow(row)

            wrg = agg["winrate_global"]
            best_marker = ""
            if wrg > self.best_winrate:
                self.best_winrate = wrg
                self.model.save(self.best_path)  # type: ignore
                best_marker = " ★ NEW BEST"

            print(
                f"[eval @ {self.num_timesteps:>6d}] "
                f"global wr={wrg:.2f} (min={agg['winrate_min']:.2f}, max={agg['winrate_max']:.2f}) "
                f"({elapsed:.1f}s) pool={len(self.snapshot_pool) if self.snapshot_pool else 0}{best_marker}"
            )
        return True


def plot_curves(history, out_path: Path):
    if not history:
        return
    timesteps = [h["timesteps"] for h in history]
    fig, axes = plt.subplots(2, 1, figsize=(11, 8), sharex=True)
    ax = axes[0]
    cmap = plt.get_cmap("tab10")
    for i, (pa, pb) in enumerate(MATCHUPS):
        ys = [h["per_match"][(pa, pb)] for h in history]
        ax.plot(timesteps, ys, marker="o", color=cmap(i % 10),
                label=f"A={pa} vs B={pb}", alpha=0.85, markersize=4)
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_ylabel("Winrate per matchup")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("v6 Self-play — winrate vs Utility AI (per eval)")
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right", fontsize=7, ncol=3)

    ax = axes[1]
    glb = [h["agg"]["winrate_global"] for h in history]
    mn = [h["agg"]["winrate_min"] for h in history]
    mx = [h["agg"]["winrate_max"] for h in history]
    ax.plot(timesteps, glb, marker="o", color="tab:green", linewidth=2, label="Global mean")
    ax.fill_between(timesteps, mn, mx, alpha=0.2, color="tab:green", label="min/max")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_xlabel("Timesteps")
    ax.set_ylabel("Winrate aggregato")
    ax.set_ylim(-0.02, 1.02)
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right")
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)


def plot_final_matrix(per: dict, out_path: Path, n_ep: int):
    matrix = np.zeros((3, 3))
    for i, pa in enumerate(PRESETS):
        for j, pb in enumerate(PRESETS):
            matrix[i, j] = per[(pa, pb)]
    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(matrix, cmap="RdYlGn", vmin=0, vmax=1)
    ax.set_xticks(range(3))
    ax.set_yticks(range(3))
    ax.set_xticklabels([f"B={p}" for p in PRESETS])
    ax.set_yticklabels([f"A={p}" for p in PRESETS])
    for i in range(3):
        for j in range(3):
            ax.text(j, i, f"{matrix[i, j]:.2f}", ha="center", va="center",
                    color="black" if 0.3 < matrix[i, j] < 0.7 else "white",
                    fontsize=14, fontweight="bold")
    ax.set_title(f"v6 Self-play — winrate finale ({n_ep} ep/matchup vs Utility)")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)


def main():
    total_timesteps = 500_000

    pool = SnapshotPool(max_size=6, device="mps" if torch.backends.mps.is_available() else "cpu")

    # Bootstrap: usa il best v5 (se esiste) come primo snapshot del pool
    v5_best = Path("/tmp/hex_tactics_dqn_multi_v5/best.zip")
    if v5_best.exists():
        pool.add(str(v5_best))
        print(f"[bootstrap] aggiunto v5 best al pool (size={len(pool)})")

    # SelfPlayEnv per training
    env = SelfPlayEnv(
        preset_a="random", preset_b="random",
        max_rounds=30, seed=12345, obs_version="v2",
        snapshot_pool=pool, utility_fallback_prob=0.3,  # 30% partite vs Utility per stabilità
    )
    obs, info = env.reset(seed=12345)
    print(f"[setup] obs shape={obs.shape}, total_steps={total_timesteps}")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = DQN(
        "MlpPolicy", env,
        learning_rate=3e-4,
        buffer_size=200_000,
        learning_starts=2_000,
        batch_size=128,
        tau=1.0, gamma=0.99,
        train_freq=4, gradient_steps=1,
        target_update_interval=1_000,
        exploration_fraction=0.4,
        exploration_initial_eps=1.0,
        exploration_final_eps=0.05,
        policy_kwargs={"net_arch": [256, 256]},
        verbose=0, seed=42, device=device,
    )

    callback = SelfPlayCallback(
        eval_freq=25_000, snapshot_freq=50_000,
        n_eval_episodes=5, snapshot_pool=pool,
    )

    print("[eval @ 0] pre-training")
    pre = evaluate_per_matchup(model, n_episodes=5, seed_offset=80000)
    print(f"  global wr={aggregate(pre)['winrate_global']:.2f}")

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=callback)
    elapsed = time.time() - t0
    print(f"[train] done in {elapsed:.1f}s ({total_timesteps / elapsed:.1f} step/s)")

    model.save(OUT_DIR / "model_last.zip")
    print(f"[save] last → model_last.zip")
    print(f"[best] global wr eval = {callback.best_winrate:.2f} (best.zip)")

    # Final eval BEST
    if callback.best_path.exists():
        best_model = DQN.load(callback.best_path, env=env, device=device)
        print(f"\n[final eval BEST, 20 ep/matchup, 180 ep totali]")
        per = evaluate_per_matchup(best_model, n_episodes=20, seed_offset=70000)
        agg = aggregate(per)
        print(f"  global wr={agg['winrate_global']:.2f}")
        for pa in PRESETS:
            row = "  A=" + pa.ljust(10) + ":"
            for pb in PRESETS:
                row += f" {per[(pa, pb)]:>6.2f}"
            print(row)
        plot_final_matrix(per, OUT_DIR / "final_matrix.png", n_ep=20)

    plot_curves(callback.history, OUT_DIR / "learning_curves.png")
    print("[plot] saved")


if __name__ == "__main__":
    main()

"""
Train v11 — D3 + A CALIBRATA reach>=4 (500k step): armatura pesante RD 9→12 (specialist).

Stesso setup di v7 (random PG + obs_v2 + self-play) ma con:
  - ARMORS["armatura_pesante"].damage_reduction = 12 (era 9)
  - Tutto il resto invariato

Override in-memory dell'ARMORS dict prima di importare env (così tutti i
componenti che leggono ARMORS vedono il valore tweaked).
"""

from __future__ import annotations

import csv
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
from stable_baselines3 import DQN
from stable_baselines3.common.callbacks import BaseCallback

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

# === D3 TWEAK: armatura pesante RD 9→12 ===
# Applicato PRIMA degli import dell'env (cosi tutti i sub-modules ne vedono i valori)
from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante",
    name="Armatura pesante",
    category="armature",
    damage_reduction=12,
    impediment=9,
)
print(f"[D3 tweak] armatura_pesante RD={_armors_module.ARMORS['armatura_pesante'].damage_reduction}")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.self_play_env import SelfPlayEnv, SnapshotPool  # noqa: E402


OUT_DIR = Path("/tmp/hex_tactics_dqn_v11_calib")
OUT_DIR.mkdir(parents=True, exist_ok=True)
SNAPSHOTS_DIR = OUT_DIR / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)

PRESETS = ("spadaccino", "arciere", "tank")
MATCHUPS = [(a, b) for a in PRESETS for b in PRESETS]


def evaluate_per_matchup_presets(model: DQN, n_episodes: int = 5, seed_offset: int = 90000) -> dict:
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


def evaluate_random_pg(model: DQN, n_ep: int = 50, seed_offset: int = 600000) -> dict:
    """Eval su random PG vs random PG. Aggrega per equipment combo."""
    env = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg", max_rounds=30,
                       seed=seed_offset, obs_version="v2")
    wins = 0
    by_weapon = defaultdict(lambda: [0, 0])  # [wins, total]
    by_armor = defaultdict(lambda: [0, 0])
    by_offhand = defaultdict(lambda: [0, 0])

    for ep in range(n_ep):
        obs, info = env.reset(seed=seed_offset + ep)
        a = env._state.units[env._info.a_unit_id]
        # Snapshot di equipment di A (per aggregare stats)
        eq_w = a.weapon or "∅"
        eq_o = a.offhand or "∅"
        eq_a = a.armor or "∅"
        for _ in range(2000):
            action, _ = model.predict(obs, deterministic=True)
            obs, _, term, trunc, info = env.step(int(action))
            if term or trunc:
                break
        win = info.get("winner") == "A"
        if win:
            wins += 1
        for d, k in [(by_weapon, eq_w), (by_armor, eq_a), (by_offhand, eq_o)]:
            d[k][0] += 1 if win else 0
            d[k][1] += 1
    return {
        "winrate": wins / n_ep,
        "wins": wins, "total": n_ep,
        "by_weapon": {k: {"wins": v[0], "total": v[1], "wr": v[0]/v[1]} for k, v in by_weapon.items()},
        "by_armor": {k: {"wins": v[0], "total": v[1], "wr": v[0]/v[1]} for k, v in by_armor.items()},
        "by_offhand": {k: {"wins": v[0], "total": v[1], "wr": v[0]/v[1]} for k, v in by_offhand.items()},
    }


class CharBuilderCallback(BaseCallback):
    def __init__(self, eval_freq=50_000, snapshot_freq=100_000, n_eval_ep=10, snapshot_pool=None):
        super().__init__()
        self.eval_freq = eval_freq
        self.snapshot_freq = snapshot_freq
        self.n_eval_ep = n_eval_ep
        self.history = []
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_init = False
        self.snapshot_pool = snapshot_pool
        self.best_winrate = -1.0
        self.best_path = OUT_DIR / "best.zip"

    def _on_step(self) -> bool:
        if self.snapshot_pool is not None and self.num_timesteps > 0 and self.num_timesteps % self.snapshot_freq == 0:
            snap_path = SNAPSHOTS_DIR / f"snap_{self.num_timesteps:07d}.zip"
            self.model.save(snap_path)  # type: ignore
            self.snapshot_pool.add(str(snap_path))
            print(f"[snap @ {self.num_timesteps:>7d}] pool={len(self.snapshot_pool)}")

        if self.num_timesteps > 0 and self.num_timesteps % self.eval_freq == 0:
            t0 = time.time()
            preset_per = evaluate_per_matchup_presets(self.model, n_episodes=self.n_eval_ep)  # type: ignore
            preset_wr = float(np.mean(list(preset_per.values())))
            random_eval = evaluate_random_pg(self.model, n_ep=20)  # type: ignore
            elapsed = time.time() - t0

            row = {
                "timesteps": self.num_timesteps,
                "preset_wr_global": preset_wr,
                "random_pg_wr": random_eval["winrate"],
                "eval_time": elapsed,
            }
            for (pa, pb), wr in preset_per.items():
                row[f"wr_{pa}_vs_{pb}"] = wr
            self.history.append({
                "timesteps": self.num_timesteps,
                "preset_per": preset_per,
                "preset_wr": preset_wr,
                "random_pg": random_eval,
            })

            mode = "a" if self._csv_init else "w"
            with open(self.csv_path, mode, newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(row.keys()))
                if not self._csv_init:
                    w.writeheader(); self._csv_init = True
                w.writerow(row)

            global_wr = (preset_wr + random_eval["winrate"]) / 2
            mark = ""
            if global_wr > self.best_winrate:
                self.best_winrate = global_wr
                self.model.save(self.best_path)  # type: ignore
                mark = " ★ NEW BEST"
            print(
                f"[eval @ {self.num_timesteps:>7d}] preset_wr={preset_wr:.2f} "
                f"random_pg_wr={random_eval['winrate']:.2f} "
                f"global={global_wr:.2f} ({elapsed:.1f}s){mark}"
            )
        return True


def plot_curves(history, out_path):
    if not history:
        return
    timesteps = [h["timesteps"] for h in history]
    fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)

    ax = axes[0]
    ax.plot(timesteps, [h["preset_wr"] for h in history], marker="o", label="vs Utility (3 preset, mean)")
    ax.plot(timesteps, [h["random_pg"]["winrate"] for h in history], marker="s", label="vs Utility (random PG)")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_ylabel("Winrate")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("v7 Char-builder — winrate evolution")
    ax.legend()
    ax.grid(alpha=0.3)

    ax = axes[1]
    cmap = plt.get_cmap("tab10")
    for i, (pa, pb) in enumerate(MATCHUPS):
        ys = [h["preset_per"][(pa, pb)] for h in history]
        ax.plot(timesteps, ys, marker="o", color=cmap(i % 10),
                label=f"{pa[:4]} vs {pb[:4]}", alpha=0.7, markersize=3)
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_xlabel("Timesteps")
    ax.set_ylabel("Winrate per preset matchup")
    ax.set_ylim(-0.02, 1.02)
    ax.legend(loc="lower right", fontsize=7, ncol=3)
    ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)


def main():
    total_timesteps = 500_000

    pool = SnapshotPool(max_size=8, device="mps" if torch.backends.mps.is_available() else "cpu")
    # NB: NO bootstrap pool (v5/v6/v7 hanno obs 134 feat, env attuale 136 → mismatch).
    # Pool inizia vuoto → fallback Utility AI per i primi 50k step (utility_fallback_prob 0.4 + pool vuoto = 100% Utility).
    print("[bootstrap] pool vuoto (fallback Utility per primi snapshots)")

    env = SelfPlayEnv(
        preset_a="random_pg", preset_b="random_pg",
        max_rounds=30, seed=12345, obs_version="v2",
        snapshot_pool=pool, utility_fallback_prob=0.4,  # 40% vs Utility per stabilità + variabilità
    )
    obs, info = env.reset(seed=12345)
    print(f"[setup] obs shape={obs.shape}, total_steps={total_timesteps}")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = DQN(
        "MlpPolicy", env,
        learning_rate=3e-4,
        buffer_size=300_000,
        learning_starts=5_000,
        batch_size=128,
        tau=1.0, gamma=0.99,
        train_freq=4, gradient_steps=1,
        target_update_interval=1_000,
        exploration_fraction=0.5,
        exploration_initial_eps=1.0,
        exploration_final_eps=0.05,
        policy_kwargs={"net_arch": [256, 256]},
        verbose=0, seed=42, device=device,
    )

    callback = CharBuilderCallback(
        eval_freq=50_000, snapshot_freq=100_000,
        n_eval_ep=10, snapshot_pool=pool,
    )

    print("[eval @ 0] pre-training")
    pre = evaluate_per_matchup_presets(model, n_episodes=5, seed_offset=80000)
    pre_rand = evaluate_random_pg(model, n_ep=20)
    print(f"  preset_wr={float(np.mean(list(pre.values()))):.2f}, random_pg_wr={pre_rand['winrate']:.2f}")

    t0 = time.time()
    model.learn(total_timesteps=total_timesteps, callback=callback)
    elapsed = time.time() - t0
    print(f"[train] done in {elapsed:.1f}s ({total_timesteps / elapsed:.1f} step/s)")

    model.save(OUT_DIR / "model_last.zip")
    print(f"[best] global wr={callback.best_winrate:.2f}")

    # Final eval BEST
    if callback.best_path.exists():
        best_model = DQN.load(callback.best_path, env=env, device=device)
        print(f"\n[final eval BEST]")
        per = evaluate_per_matchup_presets(best_model, n_episodes=20, seed_offset=70000)
        rand_eval = evaluate_random_pg(best_model, n_ep=200, seed_offset=400000)
        preset_wr = float(np.mean(list(per.values())))
        print(f"  preset_wr (3×3, 20 ep/cell) = {preset_wr:.2f}")
        print(f"  random_pg_wr (200 ep) = {rand_eval['winrate']:.2f}")
        print(f"\n  Matrice preset:")
        for pa in PRESETS:
            row = "    A=" + pa.ljust(10) + ":"
            for pb in PRESETS:
                row += f" {per[(pa, pb)]:>6.2f}"
            print(row)
        print(f"\n  Top 5 weapon by winrate (random PG):")
        sorted_w = sorted(rand_eval["by_weapon"].items(), key=lambda x: -x[1]["wr"])
        for w, s in sorted_w[:8]:
            print(f"    {w:>20s}: wr={s['wr']:.2f} ({s['wins']}/{s['total']})")
        print(f"\n  Armor by winrate (random PG):")
        for a, s in sorted(rand_eval["by_armor"].items(), key=lambda x: -x[1]["wr"]):
            print(f"    {a:>20s}: wr={s['wr']:.2f} ({s['wins']}/{s['total']})")
        # Save raw data
        with open(OUT_DIR / "final_eval.json", "w") as f:
            json.dump({
                "preset_per_matchup": {f"{pa}_vs_{pb}": v for (pa, pb), v in per.items()},
                "random_pg": rand_eval,
            }, f, indent=2)

    plot_curves(callback.history, OUT_DIR / "learning_curves.png")
    print("[plot] saved")


if __name__ == "__main__":
    main()

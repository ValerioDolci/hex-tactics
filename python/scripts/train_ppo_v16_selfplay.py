"""Train v16 — MaskablePPO self-play con curriculum + snapshot pool.

Pipeline:
  1. Bootstrap: training contro Utility AI (basicAi V2) per 50k step
  2. Aggiungi snapshot iniziale al pool (= v15 best loaded, oppure modello bootstrap)
  3. Self-play: training contro snapshot pool per 200k step
  4. Aggiungi snapshot ogni 50k step durante self-play
  5. Eval ogni 25k step (vs Utility per consistenza con v14/v15 metrics)

Differenze da v15:
  - Self-play (B = snapshot policy) invece di solo vs Utility
  - Bootstrap iniziale per evitare collasso early
  - utility_fallback_prob=0.3: 30% degli ep contro Utility, 70% contro snapshot
    (mantiene capacità vs Utility, evita overfit a se stesso)
"""

from __future__ import annotations

import csv
import sys
import time
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.callbacks import BaseCallback

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

# === D3 attivo ===
from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor

_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante",
    name="Armatura pesante",
    category="armature",
    damage_reduction=12,
    impediment=9,
)
print(f"[D3] armatura_pesante RD={_armors_module.ARMORS['armatura_pesante'].damage_reduction}")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.self_play_env import SelfPlayEnv, SnapshotPool  # noqa: E402

OUT_DIR = Path("/tmp/hex_tactics_ppo_v16_selfplay")
OUT_DIR.mkdir(parents=True, exist_ok=True)

PRESETS = ("spadaccino", "arciere", "tank")
MATCHUPS = [(a, b) for a in PRESETS for b in PRESETS]

V15_BEST = Path("/tmp/hex_tactics_ppo_v15/best.zip")  # bootstrap iniziale


def evaluate_per_matchup(model, n_ep: int = 5, seed_offset: int = 90000) -> dict:
    """Eval vs Utility (consistenza con v14/v15 metrics)."""
    out = {}
    for (pa, pb) in MATCHUPS:
        env = HexTacticsEnv(preset_a=pa, preset_b=pb, max_rounds=30, seed=seed_offset, obs_version="v2")
        wins = 0
        for ep in range(n_ep):
            obs, info = env.reset(seed=seed_offset + ep)
            for _ in range(2000):
                masks = env.action_masks()
                action, _ = model.predict(obs, action_masks=masks, deterministic=True)
                obs, _, term, trunc, info = env.step(int(action))
                if term or trunc:
                    break
            if info.get("winner") == "A":
                wins += 1
        out[(pa, pb)] = wins / n_ep
    return out


def evaluate_random_pg(model, n_ep: int = 20, seed_offset: int = 600000) -> dict:
    env = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg", max_rounds=30,
                       seed=seed_offset, obs_version="v2")
    wins = 0
    by_weapon = defaultdict(lambda: [0, 0])
    by_armor = defaultdict(lambda: [0, 0])
    for ep in range(n_ep):
        obs, info = env.reset(seed=seed_offset + ep)
        a = env._state.units[env._info.a_unit_id]
        eq_w = a.weapon or "∅"
        eq_a = a.armor or "∅"
        for _ in range(2000):
            masks = env.action_masks()
            action, _ = model.predict(obs, action_masks=masks, deterministic=True)
            obs, _, term, trunc, info = env.step(int(action))
            if term or trunc:
                break
        won = info.get("winner") == "A"
        if won:
            wins += 1
        by_weapon[eq_w][0] += 1 if won else 0
        by_weapon[eq_w][1] += 1
        by_armor[eq_a][0] += 1 if won else 0
        by_armor[eq_a][1] += 1
    return {
        "winrate": wins / n_ep,
        "by_weapon": {k: v[0]/v[1] for k, v in by_weapon.items()},
        "by_armor": {k: v[0]/v[1] for k, v in by_armor.items()},
    }


class V16Callback(BaseCallback):
    """Eval ogni eval_freq step + aggiunge snapshot al pool ogni snapshot_freq step."""

    def __init__(self, snapshot_pool: SnapshotPool, eval_freq=25_000, snapshot_freq=50_000, n_eval_ep=5):
        super().__init__()
        self.eval_freq = eval_freq
        self.snapshot_freq = snapshot_freq
        self.n_eval_ep = n_eval_ep
        self.snapshot_pool = snapshot_pool
        self.history = []
        self.csv_path = OUT_DIR / "eval_log.csv"
        self._csv_init = False
        self.best_winrate = -1.0
        self.best_path = OUT_DIR / "best.zip"

    def _on_step(self) -> bool:
        if self.num_timesteps > 0 and self.num_timesteps % self.eval_freq == 0:
            t0 = time.time()
            preset_per = evaluate_per_matchup(self.model, n_ep=self.n_eval_ep)
            preset_wr = float(np.mean(list(preset_per.values())))
            random_eval = evaluate_random_pg(self.model, n_ep=20)
            elapsed = time.time() - t0

            row = {
                "timesteps": self.num_timesteps,
                "preset_wr": preset_wr,
                "random_pg_wr": random_eval["winrate"],
                "eval_time": elapsed,
                "pool_size": len(self.snapshot_pool),
            }
            self.history.append({
                "timesteps": self.num_timesteps,
                "preset_per": preset_per,
                "preset_wr": preset_wr,
                "random_pg": random_eval,
                "pool_size": len(self.snapshot_pool),
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
                self.model.save(self.best_path)
                mark = " ★ NEW BEST"
            print(
                f"[eval @ {self.num_timesteps:>7d}] preset_wr={preset_wr:.2f} "
                f"random_pg_wr={random_eval['winrate']:.2f} "
                f"global={global_wr:.2f} pool={len(self.snapshot_pool)} "
                f"({elapsed:.1f}s){mark}",
                flush=True,
            )

        # Snapshot: aggiungi al pool ogni snapshot_freq step
        if self.num_timesteps > 0 and self.num_timesteps % self.snapshot_freq == 0:
            snap_path = OUT_DIR / f"snapshot_{self.num_timesteps}.zip"
            self.model.save(snap_path)
            self.snapshot_pool.add(snap_path)
            print(f"[snapshot] aggiunto {snap_path.name} (pool size: {len(self.snapshot_pool)})", flush=True)

        return True


def plot_curves(history, out_path):
    if not history:
        return
    timesteps = [h["timesteps"] for h in history]
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(timesteps, [h["preset_wr"] for h in history], marker="o", label="vs Utility (3 preset)")
    ax.plot(timesteps, [h["random_pg"]["winrate"] for h in history], marker="s", label="vs Utility (random PG)")
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.axhline(0.67, ls=":", color="tab:green", alpha=0.7, label="v15 best (0.67)")
    ax.set_ylabel("Winrate (vs Utility)")
    ax.set_xlabel("Timesteps")
    ax.set_ylim(-0.02, 1.02)
    ax.set_title("v16 MaskablePPO self-play — bootstrap + snapshot pool")
    ax.legend()
    ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=120)
    plt.close(fig)


def main():
    bootstrap_timesteps = 50_000
    selfplay_timesteps = 200_000
    total_timesteps = bootstrap_timesteps + selfplay_timesteps  # 250k

    device = "mps" if torch.backends.mps.is_available() else "cpu"

    # Snapshot pool (vuoto inizialmente, popolato durante training)
    snapshot_pool = SnapshotPool(MaskablePPO, max_size=8, device="cpu")

    # === FASE 1: Bootstrap vs Utility (50k step) ===
    print(f"[fase 1] Bootstrap vs Utility per {bootstrap_timesteps} step")
    env_boot = HexTacticsEnv(
        preset_a="random_pg", preset_b="random_pg",
        max_rounds=30, seed=12345, obs_version="v2",
    )

    # Carica v15 best come weights iniziali se esiste
    if V15_BEST.exists():
        print(f"[init] Carico v15 best come weights iniziali: {V15_BEST}")
        model = MaskablePPO.load(str(V15_BEST), env=env_boot, device=device)
    else:
        print("[init] v15 best non trovato, training from scratch")
        model = MaskablePPO(
            "MlpPolicy", env_boot,
            learning_rate=3e-4, n_steps=2048, batch_size=64, n_epochs=10,
            gamma=0.99, gae_lambda=0.95, clip_range=0.2,
            ent_coef=0.01, vf_coef=0.5, max_grad_norm=0.5,
            policy_kwargs={"net_arch": [256, 256]},
            verbose=0, seed=42, device=device,
        )

    callback = V16Callback(snapshot_pool=snapshot_pool, eval_freq=25_000, snapshot_freq=50_000, n_eval_ep=5)

    print("[eval @ 0] pre-training")
    pre = evaluate_per_matchup(model, n_ep=5)
    pre_rand = evaluate_random_pg(model, n_ep=20)
    print(f"  preset_wr={float(np.mean(list(pre.values()))):.2f}, random_pg_wr={pre_rand['winrate']:.2f}")

    t0 = time.time()
    model.learn(total_timesteps=bootstrap_timesteps, callback=callback, reset_num_timesteps=False)
    elapsed = time.time() - t0
    print(f"[fase 1] done in {elapsed:.1f}s ({bootstrap_timesteps / elapsed:.1f} step/s)")

    # === FASE 2: Self-play (200k step) ===
    print(f"\n[fase 2] Self-play per {selfplay_timesteps} step (utility_fallback_prob=0.3)")
    env_sp = SelfPlayEnv(
        preset_a="random_pg", preset_b="random_pg",
        max_rounds=30, seed=54321, obs_version="v2",
        snapshot_pool=snapshot_pool,
        utility_fallback_prob=0.3,
    )
    model.set_env(env_sp)

    t1 = time.time()
    model.learn(total_timesteps=selfplay_timesteps, callback=callback, reset_num_timesteps=False)
    elapsed_sp = time.time() - t1
    print(f"[fase 2] done in {elapsed_sp:.1f}s ({selfplay_timesteps / elapsed_sp:.1f} step/s)")

    model.save(OUT_DIR / "model_last.zip")
    print(f"[best] global wr={callback.best_winrate:.2f}")

    if callback.best_path.exists():
        best_model = MaskablePPO.load(callback.best_path, env=env_boot, device=device)
        print(f"\n[final eval BEST]")
        per = evaluate_per_matchup(best_model, n_ep=20, seed_offset=70000)
        rand_eval = evaluate_random_pg(best_model, n_ep=200, seed_offset=400000)
        preset_wr = float(np.mean(list(per.values())))
        print(f"  preset_wr (3×3, 20 ep) = {preset_wr:.2f}")
        print(f"  random_pg_wr (200 ep) = {rand_eval['winrate']:.2f}")
        print(f"\n  Matrice preset:")
        for pa in PRESETS:
            row = "    A=" + pa.ljust(11) + ":"
            for pb in PRESETS:
                row += f" {per[(pa, pb)]:>6.2f}"
            print(row)
        print(f"\n  Top weapons:")
        for w, wr in sorted(rand_eval["by_weapon"].items(), key=lambda x: -x[1])[:10]:
            print(f"    {w:>20s}: wr={wr:.2f}")
        print(f"\n  Armor:")
        for a, wr in sorted(rand_eval["by_armor"].items(), key=lambda x: -x[1]):
            print(f"    {a:>20s}: wr={wr:.2f}")

    plot_curves(callback.history, OUT_DIR / "learning_curve.png")
    print("[plot] saved")


if __name__ == "__main__":
    main()

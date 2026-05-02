"""
C2 — Feature importance per gruppi (permutation).

Idea: per ogni gruppo di feature (es. "stat enemy", "skills mie", "storia"),
mescolare quei valori a runtime e misurare il calo di winrate. Più calo = gruppo
più importante.

Gruppi:
  G1: self_stats (13)
  G2: enemy_stats (10)
  G3: equip_self (39)
  G4: equip_enemy (39)
  G5: skills_self (70)
  G6: position (4)
  G7: phase_meta (11)
  G8: history_self (150)
  G9: history_enemy (150)

Procedura:
  - Baseline: eval su 9 matchup × 5 ep = 45 partite, no permutation
  - Per ogni gruppo: eval con permutazione → calo di winrate
"""

from __future__ import annotations

import sys
from typing import Optional

import numpy as np
import torch
from stable_baselines3 import DQN

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402

DQN_PATH = "/tmp/hex_tactics_dqn_multi_v4/best.zip"
PRESETS = ("spadaccino", "arciere", "tank")
N_EP_PER_MATCHUP = 5

# Layout obs (vedere obs_features.py)
# Indici: cumulative offsets
LAYOUT = {
    "self_stats":     (0, 13),
    "enemy_stats":    (13, 23),
    "equip_self":     (23, 62),     # 3 slot × 13
    "equip_enemy":    (62, 101),
    "skills_self":    (101, 171),   # 10 slot × 7
    "position":       (171, 175),
    "phase_meta":     (175, 186),
    "history_self":   (186, 336),   # 10 × 15
    "history_enemy":  (336, 486),
}


class PermutedHexTacticsEnv(HexTacticsEnv):
    """Env che permuta un gruppo di feature dell'observation prima di passarla al policy.

    `permute_group`: nome di un gruppo in LAYOUT (or None per baseline).
    `permute_rng`: rng numpy per riproducibilità.
    """

    def __init__(
        self,
        preset_a: str = "spadaccino",
        preset_b: str = "tank",
        max_rounds: int = 30,
        seed: Optional[int] = None,
        permute_group: Optional[str] = None,
        permute_rng_seed: int = 999,
    ):
        super().__init__(preset_a, preset_b, max_rounds, seed)
        self.permute_group = permute_group
        self.permute_rng = np.random.default_rng(permute_rng_seed)
        self._step_count = 0

    def _build_obs(self):
        obs = super()._build_obs()
        if self.permute_group is None:
            return obs
        start, end = LAYOUT[self.permute_group]
        # Permutazione: shuffle dei valori dentro il gruppo
        idx = np.arange(start, end)
        self.permute_rng.shuffle(idx)
        permuted = obs.copy()
        permuted[start:end] = obs[idx]
        return permuted


def evaluate(
    model: DQN, n_ep_per_matchup: int = N_EP_PER_MATCHUP,
    permute_group: Optional[str] = None, base_seed: int = 800_000,
) -> dict:
    """Eval su 9 matchup, n_ep ciascuno. Ritorna stats globali."""
    wins_a = 0
    total = 0
    for pa in PRESETS:
        for pb in PRESETS:
            env = PermutedHexTacticsEnv(
                preset_a=pa, preset_b=pb, max_rounds=30,
                seed=base_seed, permute_group=permute_group,
                permute_rng_seed=base_seed + (hash(permute_group or "") & 0xFFFF),
            )
            for ep in range(n_ep_per_matchup):
                obs, info = env.reset(seed=base_seed + ep)
                for _ in range(2000):
                    action, _ = model.predict(obs, deterministic=True)
                    obs, _, term, trunc, info = env.step(int(action))
                    if term or trunc:
                        break
                total += 1
                if info.get("winner") == "A":
                    wins_a += 1
    return {"winrate": wins_a / total, "total": total, "wins": wins_a}


def main():
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=99)
    model = DQN.load(DQN_PATH, env=env, device=device)
    print(f"[load] DQN multi v4 best, device={device}")
    print(f"[setup] {len(LAYOUT)} groups × {N_EP_PER_MATCHUP} ep × 9 matchups = "
          f"{len(LAYOUT) * N_EP_PER_MATCHUP * 9} permuted partite + 45 baseline")

    # Baseline
    print("\n[baseline] eval senza permutation...")
    base = evaluate(model, permute_group=None)
    print(f"  baseline winrate = {base['winrate']:.3f} ({base['wins']}/{base['total']})")

    # Per ogni gruppo
    results = []
    for group in LAYOUT.keys():
        r = evaluate(model, permute_group=group)
        delta = r["winrate"] - base["winrate"]
        results.append({
            "group": group, "winrate": r["winrate"],
            "delta_vs_base": delta, "wins": r["wins"], "total": r["total"],
        })
        print(
            f"  perm[{group:>14s}]: winrate={r['winrate']:.3f} "
            f"({r['wins']:>2d}/{r['total']}) Δ={delta:+.3f}"
        )

    # Ranking per importanza (calo più grande = più importante)
    print(f"\n{'═'*60}\n RANKING IMPORTANZA (calo winrate / |delta| desc)\n{'═'*60}")
    results.sort(key=lambda r: r["delta_vs_base"])
    for r in results:
        bar = "█" * int(abs(r["delta_vs_base"]) * 50)
        print(
            f"  {r['group']:>14s}: Δ={r['delta_vs_base']:+.3f}  {bar}"
        )


if __name__ == "__main__":
    main()

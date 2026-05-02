"""
Analisi finale aggregata per Valerio (mattino dopo training notturno).

Carica i 4 modelli (v4, v5, v6, v7) e produce:
  1. Matrice 3×3 winrate per ognuno (vs Utility)
  2. Tabella confronto winrate globale
  3. Per v7: distribuzione winrate per equipment (weapon/armor/offhand)
  4. Per v7: top 10 build più forti / più deboli
  5. Plot comparativo
  6. JSON dump completo per analisi posteriore
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
from stable_baselines3 import DQN

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.random_pg import describe_build  # noqa: E402

PRESETS = ("spadaccino", "arciere", "tank")
MATCHUPS = [(a, b) for a in PRESETS for b in PRESETS]

# Modelli da caricare (alcuni potrebbero non esistere se training non completo)
MODELS = {
    "v4": ("/tmp/hex_tactics_dqn_multi_v4/best.zip", "v1 obs (486 feat)"),
    "v5": ("/tmp/hex_tactics_dqn_multi_v5/best.zip", "v2 obs (134 feat)"),
    "v6": ("/tmp/hex_tactics_dqn_v6_selfplay/best.zip", "v2 + self-play"),
    "v7": ("/tmp/hex_tactics_dqn_v7_charbuilder/best.zip", "v2 + self-play + random PG"),
}

REPORT_DIR = Path("/tmp/hex_tactics_final_report")
REPORT_DIR.mkdir(exist_ok=True)


def eval_preset_matrix(model: DQN, n_ep: int = 30, seed_offset: int = 1_000_000) -> dict:
    out = {}
    for (pa, pb) in MATCHUPS:
        # obs_version dipende dal modello: v4 usa v1, gli altri v2
        env = HexTacticsEnv(preset_a=pa, preset_b=pb, max_rounds=30, seed=seed_offset,
                            obs_version=("v1" if model.observation_space.shape[0] == 486 else "v2"))
        wins = 0
        for ep in range(n_ep):
            obs, info = env.reset(seed=seed_offset + ep)
            for _ in range(2000):
                action, _ = model.predict(obs, deterministic=True)
                obs, _, term, trunc, info = env.step(int(action))
                if term or trunc:
                    break
            if info.get("winner") == "A":
                wins += 1
        out[(pa, pb)] = wins / n_ep
    return out


def eval_random_pg_detailed(model: DQN, n_ep: int = 500, seed_offset: int = 2_000_000) -> dict:
    """Eval estesa su random PG vs random PG. Aggrega per equipment, skill, exp speso."""
    obs_version = "v1" if model.observation_space.shape[0] == 486 else "v2"
    env = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg", max_rounds=30,
                       seed=seed_offset, obs_version=obs_version)

    wins = 0
    by_weapon = defaultdict(lambda: [0, 0])
    by_armor = defaultdict(lambda: [0, 0])
    by_offhand = defaultdict(lambda: [0, 0])
    by_n_skills = defaultdict(lambda: [0, 0])
    by_exp_bracket = defaultdict(lambda: [0, 0])
    detailed = []  # (build, won)

    for ep in range(n_ep):
        obs, info = env.reset(seed=seed_offset + ep)
        a = env._state.units[env._info.a_unit_id]
        eq_w = a.weapon or "∅"
        eq_o = a.offhand or "∅"
        eq_a = a.armor or "∅"
        n_sk = len(a.skills)
        exp_used = sum(s.cost for s in a.skills)
        bracket = (exp_used // 250) * 250

        for _ in range(2000):
            action, _ = model.predict(obs, deterministic=True)
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
        by_offhand[eq_o][0] += 1 if won else 0
        by_offhand[eq_o][1] += 1
        by_n_skills[n_sk][0] += 1 if won else 0
        by_n_skills[n_sk][1] += 1
        by_exp_bracket[bracket][0] += 1 if won else 0
        by_exp_bracket[bracket][1] += 1
        detailed.append({
            "weapon": eq_w, "offhand": eq_o, "armor": eq_a,
            "n_skills": n_sk, "exp": exp_used, "won": won,
        })

    def to_dict(d):
        return {k: {"wins": v[0], "total": v[1], "wr": v[0]/v[1] if v[1] else 0} for k, v in d.items()}
    return {
        "winrate": wins / n_ep,
        "by_weapon": to_dict(by_weapon),
        "by_armor": to_dict(by_armor),
        "by_offhand": to_dict(by_offhand),
        "by_n_skills": to_dict(by_n_skills),
        "by_exp_bracket": to_dict(by_exp_bracket),
        "detailed": detailed,
    }


def main():
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[setup] device={device}")
    print(f"[setup] report_dir={REPORT_DIR}")

    full_data = {}

    for ver, (path, desc) in MODELS.items():
        if not Path(path).exists():
            print(f"\n[skip] {ver}: {path} not found")
            continue
        print(f"\n{'='*70}")
        print(f"  {ver} — {desc}")
        print(f"{'='*70}")
        # Tmp env per caricare il modello (qualunque obs version, lo deduce)
        model = DQN.load(path, device=device)
        print(f"  Loaded. obs_dim={model.observation_space.shape[0]}")

        print(f"  → eval matrice preset (30 ep/cell, 270 ep totali)")
        preset_per = eval_preset_matrix(model, n_ep=30)
        preset_wr = float(np.mean(list(preset_per.values())))
        print(f"  preset_wr_global = {preset_wr:.3f}")
        print(f"  Matrice:")
        for pa in PRESETS:
            row = "    A=" + pa.ljust(11) + ":"
            for pb in PRESETS:
                row += f" {preset_per[(pa, pb)]:>6.2f}"
            print(row)

        print(f"  → eval random_pg (500 ep)")
        rand_eval = eval_random_pg_detailed(model, n_ep=500)
        print(f"  random_pg_wr = {rand_eval['winrate']:.3f}")

        print(f"  Top weapons (random PG):")
        sorted_w = sorted(rand_eval["by_weapon"].items(), key=lambda x: -x[1]["wr"])
        for w, s in sorted_w[:5]:
            print(f"    {w:>20s}: wr={s['wr']:.2f} ({s['wins']}/{s['total']})")
        for w, s in sorted_w[-3:]:
            print(f"    {w:>20s}: wr={s['wr']:.2f} ({s['wins']}/{s['total']}) [low]")

        print(f"  Armor:")
        for a, s in sorted(rand_eval["by_armor"].items(), key=lambda x: -x[1]["wr"]):
            print(f"    {a:>20s}: wr={s['wr']:.2f} ({s['wins']}/{s['total']})")

        full_data[ver] = {
            "desc": desc,
            "preset_per_matchup": {f"{pa}_vs_{pb}": v for (pa, pb), v in preset_per.items()},
            "preset_wr_global": preset_wr,
            "random_pg_eval": rand_eval,
        }

    # Save full data
    # detailed list può essere grande, lo salvo a parte
    for ver, d in full_data.items():
        d["random_pg_eval"]["detailed"] = d["random_pg_eval"]["detailed"][:50]  # solo primi 50 per spazio
    with open(REPORT_DIR / "full_data.json", "w") as f:
        json.dump(full_data, f, indent=2, default=str)
    print(f"\n[save] {REPORT_DIR / 'full_data.json'}")

    # Comparison plot: winrate global per versione
    versions = list(full_data.keys())
    preset_wrs = [full_data[v]["preset_wr_global"] for v in versions]
    random_wrs = [full_data[v]["random_pg_eval"]["winrate"] for v in versions]

    fig, ax = plt.subplots(figsize=(10, 6))
    x = np.arange(len(versions))
    w = 0.35
    ax.bar(x - w/2, preset_wrs, w, label="vs Utility (3×3 preset)", color="tab:blue")
    ax.bar(x + w/2, random_wrs, w, label="vs Utility (random PG)", color="tab:orange")
    for i, v in enumerate(versions):
        ax.text(x[i] - w/2, preset_wrs[i] + 0.02, f"{preset_wrs[i]:.2f}", ha="center", fontsize=9)
        ax.text(x[i] + w/2, random_wrs[i] + 0.02, f"{random_wrs[i]:.2f}", ha="center", fontsize=9)
    ax.axhline(0.5, ls="--", color="gray", alpha=0.5)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{v}\n{full_data[v]['desc']}" for v in versions], fontsize=9)
    ax.set_ylabel("Winrate")
    ax.set_ylim(0, 1)
    ax.set_title("Confronto modelli: winrate globale (eval su Utility AI)")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "comparison.png", dpi=120)
    plt.close(fig)
    print(f"[plot] {REPORT_DIR / 'comparison.png'}")

    # Per ogni versione, plot matrice 3×3
    n_v = len(versions)
    fig, axes = plt.subplots(1, n_v, figsize=(5 * n_v, 4.5))
    if n_v == 1:
        axes = [axes]
    for ax, ver in zip(axes, versions):
        per = full_data[ver]["preset_per_matchup"]
        m = np.zeros((3, 3))
        for i, pa in enumerate(PRESETS):
            for j, pb in enumerate(PRESETS):
                m[i, j] = per[f"{pa}_vs_{pb}"]
        im = ax.imshow(m, cmap="RdYlGn", vmin=0, vmax=1)
        ax.set_xticks(range(3)); ax.set_yticks(range(3))
        ax.set_xticklabels([p[:4] for p in PRESETS])
        ax.set_yticklabels([p[:4] for p in PRESETS])
        ax.set_title(f"{ver}: {full_data[ver]['preset_wr_global']:.2f}")
        for i in range(3):
            for j in range(3):
                ax.text(j, i, f"{m[i, j]:.2f}", ha="center", va="center",
                        color="black" if 0.3 < m[i, j] < 0.7 else "white", fontsize=10)
    plt.tight_layout()
    plt.savefig(REPORT_DIR / "matrices_compared.png", dpi=120)
    plt.close(fig)
    print(f"[plot] {REPORT_DIR / 'matrices_compared.png'}")

    # Per il modello migliore (presumibilmente v7), plot equipment breakdown
    if "v7" in full_data:
        rd = full_data["v7"]["random_pg_eval"]
        for cat, label in [("by_weapon", "Weapons"), ("by_armor", "Armors"), ("by_offhand", "Offhand")]:
            sorted_items = sorted(rd[cat].items(), key=lambda x: -x[1]["wr"])
            names = [x[0] for x in sorted_items]
            wrs = [x[1]["wr"] for x in sorted_items]
            counts = [x[1]["total"] for x in sorted_items]
            fig, ax = plt.subplots(figsize=(10, max(3, len(names)*0.4)))
            colors = ["green" if w > 0.6 else "yellow" if w > 0.4 else "red" for w in wrs]
            bars = ax.barh(range(len(names)), wrs, color=colors)
            ax.set_yticks(range(len(names)))
            ax.set_yticklabels([f"{n} (n={c})" for n, c in zip(names, counts)])
            ax.axvline(0.5, ls="--", color="gray", alpha=0.5)
            ax.set_xlim(0, 1)
            ax.invert_yaxis()
            for i, (w, c) in enumerate(zip(wrs, counts)):
                ax.text(w + 0.01, i, f"{w:.2f}", va="center")
            ax.set_xlabel("Winrate vs Utility AI")
            ax.set_title(f"v7 — Winrate per {label} (random PG, 500 ep)")
            ax.grid(axis="x", alpha=0.3)
            plt.tight_layout()
            plt.savefig(REPORT_DIR / f"v7_{cat}.png", dpi=120)
            plt.close(fig)
            print(f"[plot] v7_{cat}.png")

    print("\n[done] report ready in", REPORT_DIR)


if __name__ == "__main__":
    main()

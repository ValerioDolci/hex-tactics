"""Distill Multi Dataset: estrae dataset da TUTTI i modelli Deep CFR del database.

Per ogni model_dir produce samples (obs_153, mask_24, policy_24, build_a_39, build_b_39).
Concatena tutti i samples in un mega-npz con label per debug.

Usage:
    python -m cfr.distill_multi_dataset --root cfr/nightly_results --n 100 --out /tmp/multi_dataset.npz
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))
sys.setrecursionlimit(20000)

from cfr.abstract_game import HexTacticsAbstractGame, MAX_ACTIONS, PLAYER_A, PLAYER_B
from cfr.abstraction import BuildSpec, SkillSpec
from cfr.build_features import build_to_features, BUILD_FEATURES_DIM
from hex_tactics.ai.obs_features_v2 import build_obs_v2, N_FEATURES_TOTAL_V2

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


class TeacherAdvNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES_TOTAL_V2, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, MAX_ACTIONS),
        )

    def forward(self, x):
        return self.net(x)


def _reg_to_pol(r, m):
    p = np.maximum(0, r) * m
    s = p.sum()
    if s > 1e-9:
        return p / s
    n = m.sum()
    return m / n if n > 0 else m


def _load_build(path: str, name: str) -> BuildSpec:
    with open(path) as f:
        d = json.load(f)
    sk = tuple(SkillSpec(**s) for s in d.get("skills", []))
    return BuildSpec(
        weapon=d.get("weapon"), offhand=d.get("offhand"), armor=d.get("armor"),
        skills=sk, name=name,
        thrown_inventory=tuple(d.get("thrown_inventory", [])),
        backup_weapon=d.get("backup_weapon"), exp_budget=2000,
    )


def extract_for_matchup(model_dir: Path, n_games: int, seed_base: int = 42):
    """Simula n_games partite e ritorna (obs, mask, policy, build_a, build_b) o None se fail."""
    meta_path = model_dir / "metadata.json"
    if not meta_path.exists():
        return None
    meta = json.load(open(meta_path))
    if "build_a" not in meta or "build_b" not in meta:
        return None
    try:
        ba = _load_build(meta["build_a"], "A")
        bb = _load_build(meta["build_b"], "B")
    except Exception as e:
        print(f"  ! Skip {model_dir.name}: build load failed ({e})", file=sys.stderr)
        return None

    nets = []
    for p in range(2):
        net = TeacherAdvNet().to(DEVICE)
        try:
            net.load_state_dict(torch.load(model_dir / f"adv_net_p{p}.pt", map_location=DEVICE))
        except Exception as e:
            print(f"  ! Skip {model_dir.name}: net load failed ({e})", file=sys.stderr)
            return None
        net.eval()
        nets.append(net)

    g = HexTacticsAbstractGame.from_build_specs(ba, bb, seed=seed_base, max_rounds=12)
    g.variable_initial_state = True

    bf_a = build_to_features(ba)
    bf_b = build_to_features(bb)

    obs_buf, mask_buf, policy_buf, ba_buf, bb_buf = [], [], [], [], []

    for ep in range(n_games):
        rng = np.random.default_rng(seed_base + ep * 7919)
        st = g.new_initial_state()
        while not st.is_terminal():
            cur = st.current_player()
            if cur < 0:
                l = st.legal_actions()
                if not l:
                    break
                st.apply_action(l[0])
                continue
            legal = st.legal_actions()
            cfr = st._cfr_state
            gs = cfr.game_state
            fa = "A" if cur == PLAYER_A else "B"
            feat = np.array(
                build_obs_v2(gs, agent_faction=fa, history_self=[], history_enemy=[],
                             enforce_simultaneous_privacy=False),
                dtype=np.float32,
            )
            mask = np.zeros(MAX_ACTIONS, dtype=np.float32)
            for a in legal:
                mask[a] = 1
            x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
            with torch.no_grad():
                r = nets[cur](x).cpu().numpy()[0]
            policy = _reg_to_pol(r, mask).astype(np.float32)

            # Build features dal punto di vista dell'agente (self, opp)
            if cur == PLAYER_A:
                bf_self, bf_opp = bf_a, bf_b
            else:
                bf_self, bf_opp = bf_b, bf_a
            obs_buf.append(feat)
            mask_buf.append(mask)
            policy_buf.append(policy)
            ba_buf.append(bf_self)
            bb_buf.append(bf_opp)

            a = int(rng.choice(MAX_ACTIONS, p=policy))
            st.apply_action(a)

    return (
        np.array(obs_buf, dtype=np.float32),
        np.array(mask_buf, dtype=np.float32),
        np.array(policy_buf, dtype=np.float32),
        np.array(ba_buf, dtype=np.float32),
        np.array(bb_buf, dtype=np.float32),
        meta["label"],
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="cfr/nightly_results", help="Root con i deep_cfr_*/")
    ap.add_argument("--n", type=int, default=100, help="Partite per matchup (default 100)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="/tmp/multi_dataset.npz")
    ap.add_argument("--filter", default=None, help="Solo matchup label che contiene questa stringa")
    ap.add_argument("--skip", default="lanciere_vs_spa,giav_vs_arc,spaScudo_vs_arc,v2", help="Label da escludere (deprecated)")
    args = ap.parse_args()

    root = Path(args.root)
    skip_set = set(args.skip.split(",")) if args.skip else set()

    dirs = sorted([d for d in root.iterdir() if d.is_dir() and d.name.startswith("deep_cfr_")])
    if args.filter:
        dirs = [d for d in dirs if args.filter in d.name]
    dirs = [d for d in dirs if d.name[len("deep_cfr_"):] not in skip_set]

    print(f"Trovati {len(dirs)} matchup. Estrazione (n={args.n} partite/match)...", file=sys.stderr)

    all_obs, all_mask, all_pol, all_ba, all_bb, all_lbl = [], [], [], [], [], []
    label_to_idx: dict[str, int] = {}
    matchup_idx_per_sample: list[int] = []

    t0 = time.time()
    for i, d in enumerate(dirs):
        print(f"  [{i+1}/{len(dirs)}] {d.name}...", file=sys.stderr, flush=True)
        result = extract_for_matchup(d, n_games=args.n, seed_base=args.seed)
        if result is None:
            continue
        obs, mask, pol, ba, bb, label = result
        idx = len(label_to_idx)
        label_to_idx[label] = idx
        all_obs.append(obs)
        all_mask.append(mask)
        all_pol.append(pol)
        all_ba.append(ba)
        all_bb.append(bb)
        matchup_idx_per_sample.extend([idx] * obs.shape[0])

    obs = np.concatenate(all_obs, axis=0)
    mask = np.concatenate(all_mask, axis=0)
    pol = np.concatenate(all_pol, axis=0)
    ba = np.concatenate(all_ba, axis=0)
    bb = np.concatenate(all_bb, axis=0)
    matchup_idx = np.array(matchup_idx_per_sample, dtype=np.int32)

    print(f"\nDone in {time.time()-t0:.1f}s. Total samples: {obs.shape[0]} from {len(label_to_idx)} matchup", file=sys.stderr)
    print(f"Saving to {args.out}...", file=sys.stderr)

    np.savez(
        args.out,
        obs=obs, mask=mask, policy=pol,
        build_self=ba, build_opp=bb,
        matchup_idx=matchup_idx,
        labels=np.array(list(label_to_idx.keys()), dtype="U64"),
    )
    print(f"Saved. File size: ~{Path(args.out).stat().st_size / 1024 / 1024:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()

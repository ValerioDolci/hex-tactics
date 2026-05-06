"""Eval DT multi-matchup vs teacher matchup-specific su singoli matchup.

Per ogni matchup nel database:
1. Carica teacher (Deep CFR specifico)
2. Simula partite con DT come player A o B (vs teacher altro player o vs DT mirror)
3. Confronta V_a con teacher self

Usage:
    python -m cfr.distill_dt_multi_eval /tmp/dt_multi.pkl --root cfr/nightly_results --n 200 --filter lanc_inv
"""

from __future__ import annotations

import argparse
import json
import pickle
import sys
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
from cfr.build_features import build_to_features
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


def play(g, policy_p0_fn, policy_p1_fn, n_games: int, seed_base: int) -> float:
    wins_a = wins_b = 0
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
            policy_fn = policy_p0_fn if cur == PLAYER_A else policy_p1_fn
            p = policy_fn(feat, mask, cur)
            a = int(rng.choice(MAX_ACTIONS, p=p))
            st.apply_action(a)
        if st.is_terminal():
            ret = st.returns()
            if ret[0] > 0:
                wins_a += 1
            elif ret[1] > 0:
                wins_b += 1
    return (wins_a - wins_b) / n_games


def make_teacher_fn(nets):
    def fn(feat, mask, cur):
        x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            r = nets[cur](x).cpu().numpy()[0]
        return _reg_to_pol(r, mask)
    return fn


def make_dt_fn(clf, bf_a, bf_b):
    """Crea policy fn che usa il DT. Output: distribuzione one-hot (deterministic)."""
    def fn(feat, mask, cur):
        bf_self = bf_a if cur == PLAYER_A else bf_b
        bf_opp = bf_b if cur == PLAYER_A else bf_a
        X = np.concatenate([feat, bf_self, bf_opp]).reshape(1, -1).astype(np.float32)
        cls = int(clf.predict(X)[0])
        # Output one-hot, ma se cls è azione illegale fallback alla prima legale
        n_legal = int(mask.sum())
        if cls >= n_legal:
            cls = 0  # fallback
        out = np.zeros(MAX_ACTIONS, dtype=np.float32)
        out[cls] = 1.0
        return out
    return fn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dt_path")
    ap.add_argument("--root", default="cfr/nightly_results")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--filter", default=None)
    ap.add_argument("--skip", default="lanciere_vs_spa,giav_vs_arc,spaScudo_vs_arc,v2,arc_mirror,arc_vs_spa,arc_vs_tank,spa_mirror,spa_vs_tank,tank_mirror")
    args = ap.parse_args()

    clf = pickle.loads(Path(args.dt_path).read_bytes())
    print(f"Loaded DT: {clf.get_n_leaves()} leaves, depth {clf.get_depth()}", file=sys.stderr)

    root = Path(args.root)
    skip_set = set(args.skip.split(",")) if args.skip else set()
    dirs = sorted([d for d in root.iterdir() if d.is_dir() and d.name.startswith("deep_cfr_")])
    if args.filter:
        dirs = [d for d in dirs if args.filter in d.name]
    dirs = [d for d in dirs if d.name[len("deep_cfr_"):] not in skip_set]

    print(f"\nEval su {len(dirs)} matchup, n={args.n} partite\n", file=sys.stderr)

    results = []
    for i, d in enumerate(dirs):
        meta_path = d / "metadata.json"
        if not meta_path.exists():
            continue
        meta = json.load(open(meta_path))
        if "build_a" not in meta or "build_b" not in meta:
            continue
        try:
            ba = _load_build(meta["build_a"], "A")
            bb = _load_build(meta["build_b"], "B")
            teacher_nets = []
            for p in range(2):
                net = TeacherAdvNet().to(DEVICE)
                net.load_state_dict(torch.load(d / f"adv_net_p{p}.pt", map_location=DEVICE))
                net.eval()
                teacher_nets.append(net)
        except Exception:
            continue

        bf_a = build_to_features(ba)
        bf_b = build_to_features(bb)
        g = HexTacticsAbstractGame.from_build_specs(ba, bb, seed=args.seed, max_rounds=12)
        g.variable_initial_state = True

        teacher_fn = make_teacher_fn(teacher_nets)
        dt_fn = make_dt_fn(clf, bf_a, bf_b)

        v_tt = play(g, teacher_fn, teacher_fn, args.n, args.seed)
        v_dd = play(g, dt_fn, dt_fn, args.n, args.seed)
        v_dt_a = play(g, dt_fn, teacher_fn, args.n, args.seed)
        v_dt_b = play(g, teacher_fn, dt_fn, args.n, args.seed)
        max_d = max(abs(v_dt_a - v_tt), abs(v_dt_b - v_tt), abs(v_dd - v_tt))
        status = "✓" if max_d < 0.10 else ("⚠" if max_d < 0.20 else "✗")
        print(f"  [{i+1:2d}/{len(dirs)}] {meta['label']:25s}  V_tt={v_tt:+.2f}  V_dd={v_dd:+.2f}  max|Δ|={max_d:.3f}  {status}", file=sys.stderr)
        results.append({"label": meta["label"], "v_tt": v_tt, "v_dd": v_dd, "max_delta": max_d})

    n = len(results)
    if n == 0:
        return
    n_pass = sum(1 for r in results if r["max_delta"] < 0.10)
    n_marg = sum(1 for r in results if 0.10 <= r["max_delta"] < 0.20)
    n_fail = sum(1 for r in results if r["max_delta"] >= 0.20)
    avg = float(np.mean([r["max_delta"] for r in results]))
    print(f"\n=== Summary ({n} matchup) ===", file=sys.stderr)
    print(f"  ✓ {n_pass}/{n} sotto 0.10  ⚠ {n_marg}/{n}  ✗ {n_fail}/{n}", file=sys.stderr)
    print(f"  Avg max|Δ| = {avg:.3f}", file=sys.stderr)


if __name__ == "__main__":
    main()

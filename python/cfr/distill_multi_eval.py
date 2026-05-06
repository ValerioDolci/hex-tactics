"""Distill Multi Eval: confronta V_a student multi-matchup vs teacher matchup-specific.

Per ogni matchup del database:
1. Carica teacher matchup-specific
2. Simula 500 partite con 4 combinazioni (teacher self / student self / cross)
3. Riporta delta V_a

Usage:
    python -m cfr.distill_multi_eval /tmp/student_multi.pt --root cfr/nightly_results --n 200
    python -m cfr.distill_multi_eval /tmp/student_multi.pt --filter lanc_inv --n 200
"""

from __future__ import annotations

import argparse
import json
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
from cfr.distill_multi_student import StudentMultiMLP
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


def make_teacher_policy_fn(teacher_nets):
    def fn(feat, mask, cur):
        x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            r = teacher_nets[cur](x).cpu().numpy()[0]
        return _reg_to_pol(r, mask)
    return fn


def make_student_multi_policy_fn(student, bf_a, bf_b):
    bf_a_t = torch.from_numpy(bf_a).to(DEVICE)
    bf_b_t = torch.from_numpy(bf_b).to(DEVICE)
    def fn(feat, mask, cur):
        x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
        m = torch.from_numpy(mask).unsqueeze(0).to(DEVICE)
        # Build features dal punto di vista del player corrente (self, opp)
        if cur == PLAYER_A:
            bs, bo = bf_a_t.unsqueeze(0), bf_b_t.unsqueeze(0)
        else:
            bs, bo = bf_b_t.unsqueeze(0), bf_a_t.unsqueeze(0)
        with torch.no_grad():
            p = student.policy(x, bs, bo, m).cpu().numpy()[0]
        return p
    return fn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("student_path", help="Path student multi .pt")
    ap.add_argument("--root", default="cfr/nightly_results")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--filter", default=None)
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--skip", default="lanciere_vs_spa,giav_vs_arc,spaScudo_vs_arc,v2,arc_mirror,arc_vs_spa,arc_vs_tank,spa_mirror,spa_vs_tank,tank_mirror")
    args = ap.parse_args()

    # Load student
    ckpt = torch.load(args.student_path, map_location=DEVICE, weights_only=False)
    student = StudentMultiMLP(hidden=ckpt.get("hidden", 384), n_layers=ckpt.get("n_layers", 3)).to(DEVICE)
    student.load_state_dict(ckpt["state_dict"])
    student.eval()
    print(f"Loaded student multi ({ckpt.get('hidden', 384)}h × {ckpt.get('n_layers',3)}L)", file=sys.stderr)

    root = Path(args.root)
    skip_set = set(args.skip.split(",")) if args.skip else set()
    dirs = sorted([d for d in root.iterdir() if d.is_dir() and d.name.startswith("deep_cfr_")])
    if args.filter:
        dirs = [d for d in dirs if args.filter in d.name]
    dirs = [d for d in dirs if d.name[len("deep_cfr_"):] not in skip_set]

    print(f"\nEval su {len(dirs)} matchup, n={args.n} partite/match\n", file=sys.stderr)

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
        except Exception as e:
            continue

        bf_a = build_to_features(ba)
        bf_b = build_to_features(bb)

        g = HexTacticsAbstractGame.from_build_specs(ba, bb, seed=args.seed, max_rounds=12)
        g.variable_initial_state = True

        teacher_fn = make_teacher_policy_fn(teacher_nets)
        student_fn = make_student_multi_policy_fn(student, bf_a, bf_b)

        v_tt = play(g, teacher_fn, teacher_fn, args.n, args.seed)
        v_st = play(g, student_fn, teacher_fn, args.n, args.seed)
        v_ts = play(g, teacher_fn, student_fn, args.n, args.seed)
        v_ss = play(g, student_fn, student_fn, args.n, args.seed)
        max_d = max(abs(v_st - v_tt), abs(v_ts - v_tt), abs(v_ss - v_tt))
        status = "✓" if max_d < 0.10 else ("⚠" if max_d < 0.20 else "✗")
        print(f"  [{i+1:2d}/{len(dirs)}] {meta['label']:30s}  V_tt={v_tt:+.3f}  V_ss={v_ss:+.3f}  max|Δ|={max_d:.3f}  {status}", file=sys.stderr)
        results.append({
            "label": meta["label"],
            "v_a_train": meta.get("v_a_final"),
            "v_tt": v_tt, "v_st": v_st, "v_ts": v_ts, "v_ss": v_ss,
            "max_delta": max_d,
        })

    # Summary
    n = len(results)
    n_pass = sum(1 for r in results if r["max_delta"] < 0.10)
    n_marginal = sum(1 for r in results if 0.10 <= r["max_delta"] < 0.20)
    n_fail = sum(1 for r in results if r["max_delta"] >= 0.20)
    avg_delta = np.mean([r["max_delta"] for r in results]) if results else 0.0
    print(f"\n=== Summary ({n} matchup) ===", file=sys.stderr)
    print(f"  ✓ {n_pass}/{n} sotto soglia 0.10", file=sys.stderr)
    print(f"  ⚠ {n_marginal}/{n} marginal (0.10-0.20)", file=sys.stderr)
    print(f"  ✗ {n_fail}/{n} fail (>0.20)", file=sys.stderr)
    print(f"  Avg max|Δ| = {avg_delta:.3f}", file=sys.stderr)

    print(json.dumps({"avg_delta": float(avg_delta), "n_pass": n_pass,
                       "n_marginal": n_marginal, "n_fail": n_fail,
                       "results": results}, indent=2))


if __name__ == "__main__":
    main()

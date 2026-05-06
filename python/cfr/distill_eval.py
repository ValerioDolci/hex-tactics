"""Distill Eval: confronta V_a student vs V_a teacher per validare la distillazione.

Carica student + teacher e simula partite. Riporta:
- V_a teacher vs teacher (referenza, dovrebbe coincidere con V_a_train)
- V_a student_p0 vs teacher_p1 (qualità student come player 0)
- V_a teacher_p0 vs student_p1
- V_a student vs student (quanto si auto-batte)

Soglia accettazione distillazione: |Δ V_a (student vs teacher)| < 0.10.

Usage:
    python -m cfr.distill_eval cfr/nightly_results/deep_cfr_lanc_inv_vs_spa /tmp/student_lanc_spa.pt --n 100
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
from cfr.distill_student import StudentMLP
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


def _reg_to_pol(r: np.ndarray, m: np.ndarray) -> np.ndarray:
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


def teacher_policy(net: TeacherAdvNet, feat: np.ndarray, mask: np.ndarray) -> np.ndarray:
    x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        r = net(x).cpu().numpy()[0]
    return _reg_to_pol(r, mask)


def student_policy(net: StudentMLP, feat: np.ndarray, mask: np.ndarray) -> np.ndarray:
    x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
    m = torch.from_numpy(mask).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        p = net.policy(x, m).cpu().numpy()[0]
    return p


def play(g, policy_p0_fn, policy_p1_fn, n_games: int, seed_base: int = 42) -> float:
    """Simula n partite con due policy distinte. Ritorna V_a = (wins_A - wins_B)/n."""
    wins_a = 0
    wins_b = 0
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
            p = policy_fn(feat, mask)
            a = int(rng.choice(MAX_ACTIONS, p=p))
            st.apply_action(a)
        if st.is_terminal():
            ret = st.returns()
            if ret[0] > 0:
                wins_a += 1
            elif ret[1] > 0:
                wins_b += 1
    return (wins_a - wins_b) / n_games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir", help="Path teacher deep_cfr_<label>/")
    ap.add_argument("student_path", help="Path student .pt")
    ap.add_argument("--n", type=int, default=100, help="Partite per ogni eval (default 100)")
    ap.add_argument("--seed", type=int, default=12345)
    args = ap.parse_args()

    model_dir = Path(args.model_dir)
    meta = json.load(open(model_dir / "metadata.json"))
    ba = _load_build(meta["build_a"], "A")
    bb = _load_build(meta["build_b"], "B")

    # Load teacher
    teacher_nets = []
    for p in range(2):
        net = TeacherAdvNet().to(DEVICE)
        net.load_state_dict(torch.load(model_dir / f"adv_net_p{p}.pt", map_location=DEVICE))
        net.eval()
        teacher_nets.append(net)

    # Load student
    ckpt = torch.load(args.student_path, map_location=DEVICE)
    student = StudentMLP(hidden=ckpt.get("hidden", 128)).to(DEVICE)
    student.load_state_dict(ckpt["state_dict"])
    student.eval()

    g = HexTacticsAbstractGame.from_build_specs(ba, bb, seed=args.seed, max_rounds=12)
    g.variable_initial_state = True

    # Define policy functions
    teacher_p0 = lambda f, m: teacher_policy(teacher_nets[0], f, m)
    teacher_p1 = lambda f, m: teacher_policy(teacher_nets[1], f, m)
    student_fn = lambda f, m: student_policy(student, f, m)

    print(f"Eval distillazione per {meta['label']} ({args.n} partite/match)", file=sys.stderr)
    print(f"V_a_train (teacher final): {meta['v_a_final']:+.3f}", file=sys.stderr)

    print(f"\n  [1/4] teacher_p0 vs teacher_p1 (referenza)...", file=sys.stderr)
    v_tt = play(g, teacher_p0, teacher_p1, args.n, seed_base=args.seed)
    print(f"        V_a = {v_tt:+.3f}", file=sys.stderr)

    print(f"  [2/4] student_p0 vs teacher_p1 (student come A)...", file=sys.stderr)
    v_st = play(g, student_fn, teacher_p1, args.n, seed_base=args.seed)
    print(f"        V_a = {v_st:+.3f}  Δ vs ref = {v_st - v_tt:+.3f}", file=sys.stderr)

    print(f"  [3/4] teacher_p0 vs student_p1 (student come B)...", file=sys.stderr)
    v_ts = play(g, teacher_p0, student_fn, args.n, seed_base=args.seed)
    print(f"        V_a = {v_ts:+.3f}  Δ vs ref = {v_ts - v_tt:+.3f}", file=sys.stderr)

    print(f"  [4/4] student vs student (mirror student)...", file=sys.stderr)
    v_ss = play(g, student_fn, student_fn, args.n, seed_base=args.seed)
    print(f"        V_a = {v_ss:+.3f}  Δ vs ref = {v_ss - v_tt:+.3f}", file=sys.stderr)

    print(f"\n=== Verdetto ===", file=sys.stderr)
    max_delta = max(abs(v_st - v_tt), abs(v_ts - v_tt), abs(v_ss - v_tt))
    print(f"Max |Δ V_a| student vs teacher: {max_delta:.3f}", file=sys.stderr)
    if max_delta < 0.10:
        print("✓ Distillazione SUCCESSO (soglia 0.10)", file=sys.stderr)
    elif max_delta < 0.20:
        print("⚠ Distillazione marginale (>0.10 ma <0.20)", file=sys.stderr)
    else:
        print("✗ Distillazione FALLITA (>0.20)", file=sys.stderr)

    # Output JSON for log
    out = {
        "label": meta["label"],
        "v_a_train": meta["v_a_final"],
        "v_a_teacher_self": v_tt,
        "v_a_student_p0_vs_teacher_p1": v_st,
        "v_a_teacher_p0_vs_student_p1": v_ts,
        "v_a_student_self": v_ss,
        "max_delta": max_delta,
        "n_games": args.n,
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

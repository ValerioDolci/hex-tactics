"""Distill Dataset: estrae dataset (obs_features, policy) dai modelli Deep CFR.

Per ogni model_dir:
1. Carica AdvNet p0/p1
2. Simula N partite usando la policy regret_to_policy come "teacher"
3. Per ogni state visitato dal player attivo, salva:
   - obs_features (153)
   - legal_action_mask (MAX_ACTIONS=24)
   - target_policy (24, distribuzione probabilistica masked)

Output: file .npz con shape (n_samples, 153 + 24 + 24).

Usage:
    python -m cfr.distill_dataset cfr/nightly_results/deep_cfr_lanc_inv_vs_spa --n 200 --out /tmp/dataset_lanc_spa.npz
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
from hex_tactics.ai.obs_features_v2 import build_obs_v2, N_FEATURES_TOTAL_V2

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


class AdvNet(nn.Module):
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


def extract_dataset(model_dir: Path, n_games: int, seed_base: int = 42):
    """Simula N partite e raccoglie (obs, mask, policy) per ogni state."""
    meta = json.load(open(model_dir / "metadata.json"))
    ba = _load_build(meta["build_a"], "A")
    bb = _load_build(meta["build_b"], "B")

    nets = []
    for p in range(2):
        net = AdvNet().to(DEVICE)
        net.load_state_dict(torch.load(model_dir / f"adv_net_p{p}.pt", map_location=DEVICE))
        net.eval()
        nets.append(net)

    g = HexTacticsAbstractGame.from_build_specs(ba, bb, seed=seed_base, max_rounds=12)
    g.variable_initial_state = True

    obs_buf, mask_buf, policy_buf = [], [], []

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
            policy = _reg_to_pol(r, mask)

            # Salva sample
            obs_buf.append(feat)
            mask_buf.append(mask)
            policy_buf.append(policy.astype(np.float32))

            # Sample azione (per continuare la partita)
            a = int(rng.choice(MAX_ACTIONS, p=policy))
            st.apply_action(a)

    obs_arr = np.array(obs_buf, dtype=np.float32)
    mask_arr = np.array(mask_buf, dtype=np.float32)
    policy_arr = np.array(policy_buf, dtype=np.float32)
    return obs_arr, mask_arr, policy_arr, meta


def main():
    ap = argparse.ArgumentParser(description="Estrai dataset (obs, mask, policy) per distillation")
    ap.add_argument("model_dir", help="Path a deep_cfr_<label>/")
    ap.add_argument("--n", type=int, default=200, help="Numero partite (default 200)")
    ap.add_argument("--seed", type=int, default=42, help="Seed base")
    ap.add_argument("--out", default=None, help="File .npz (default: /tmp/dataset_<label>.npz)")
    args = ap.parse_args()

    model_dir = Path(args.model_dir)
    label = model_dir.name[len("deep_cfr_"):] if model_dir.name.startswith("deep_cfr_") else model_dir.name
    out_path = Path(args.out) if args.out else Path(f"/tmp/dataset_{label}.npz")

    print(f"Extracting dataset for {label}, {args.n} games...", file=sys.stderr)
    obs, mask, policy, meta = extract_dataset(model_dir, n_games=args.n, seed_base=args.seed)
    print(f"  Got {obs.shape[0]} samples (obs={obs.shape}, mask={mask.shape}, policy={policy.shape})", file=sys.stderr)

    np.savez(
        out_path,
        obs=obs, mask=mask, policy=policy,
        label=label, n_games=args.n,
        v_a_train=meta.get("v_a_final"),
    )
    print(f"  Saved {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

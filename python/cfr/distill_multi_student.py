"""Distill Multi Student: train un singolo MLP che imita TUTTI i teacher Deep CFR del database.

Input: obs (153) + build_self (39) + build_opp (39) = 231 dim
Output: distribuzione su 24 azioni (mascherata)

Architettura: MLP 231 → 384 → 384 → 384 → 24 (più grande del single-matchup student)

Usage:
    python -m cfr.distill_multi_student /tmp/multi_dataset.npz --epochs 100 --out /tmp/student_multi.pt
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from cfr.abstract_game import MAX_ACTIONS
from cfr.build_features import BUILD_FEATURES_DIM
from hex_tactics.ai.obs_features_v2 import N_FEATURES_TOTAL_V2

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

INPUT_DIM = N_FEATURES_TOTAL_V2 + 2 * BUILD_FEATURES_DIM


class StudentMultiMLP(nn.Module):
    """Multi-matchup student: input 231 (obs + build_self + build_opp)."""

    def __init__(self, hidden: int = 384, n_layers: int = 3):
        super().__init__()
        layers = [nn.Linear(INPUT_DIM, hidden), nn.ReLU()]
        for _ in range(n_layers - 1):
            layers += [nn.Linear(hidden, hidden), nn.ReLU()]
        layers.append(nn.Linear(hidden, MAX_ACTIONS))
        self.net = nn.Sequential(*layers)
        self.hidden = hidden
        self.n_layers = n_layers

    def forward(self, obs, build_self, build_opp):
        x = torch.cat([obs, build_self, build_opp], dim=-1)
        return self.net(x)

    def policy(self, obs, build_self, build_opp, mask):
        logits = self.forward(obs, build_self, build_opp)
        masked_logits = logits.masked_fill(mask < 0.5, float("-inf"))
        return torch.softmax(masked_logits, dim=-1)


def masked_ce_loss(student_logits, mask, target_policy):
    masked_logits = student_logits.masked_fill(mask < 0.5, float("-inf"))
    log_probs = torch.log_softmax(masked_logits, dim=-1)
    log_probs = torch.where(torch.isnan(log_probs) | torch.isinf(log_probs),
                            torch.zeros_like(log_probs), log_probs)
    return -(target_policy * log_probs).sum(dim=-1).mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", help="Path mega dataset .npz")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=384)
    ap.add_argument("--n-layers", type=int, default=3)
    ap.add_argument("--val-split", type=float, default=0.05)
    ap.add_argument("--out", default="/tmp/student_multi.pt")
    args = ap.parse_args()

    print(f"Loading {args.dataset}...", file=sys.stderr)
    data = np.load(args.dataset, allow_pickle=True)
    obs = data["obs"]
    mask = data["mask"]
    policy = data["policy"]
    build_self = data["build_self"]
    build_opp = data["build_opp"]
    matchup_idx = data["matchup_idx"]
    labels = list(data["labels"])

    n = obs.shape[0]
    print(f"Loaded {n} samples from {len(labels)} matchup. INPUT_DIM={INPUT_DIM}", file=sys.stderr)
    print(f"Sample distribution per matchup:", file=sys.stderr)
    counts = np.bincount(matchup_idx, minlength=len(labels))
    for lbl, c in zip(labels, counts):
        print(f"  {lbl:30s} {c:5d}", file=sys.stderr)

    # Train/val split (random)
    rng_split = np.random.default_rng(0)
    perm = rng_split.permutation(n)
    n_val = int(n * args.val_split)
    val_idx = perm[:n_val]
    train_idx = perm[n_val:]

    obs_t = torch.from_numpy(obs).to(DEVICE)
    mask_t = torch.from_numpy(mask).to(DEVICE)
    pol_t = torch.from_numpy(policy).to(DEVICE)
    bs_t = torch.from_numpy(build_self).to(DEVICE)
    bo_t = torch.from_numpy(build_opp).to(DEVICE)

    train_obs = obs_t[train_idx]
    train_mask = mask_t[train_idx]
    train_pol = pol_t[train_idx]
    train_bs = bs_t[train_idx]
    train_bo = bo_t[train_idx]
    val_obs = obs_t[val_idx]
    val_mask = mask_t[val_idx]
    val_pol = pol_t[val_idx]
    val_bs = bs_t[val_idx]
    val_bo = bo_t[val_idx]

    student = StudentMultiMLP(hidden=args.hidden, n_layers=args.n_layers).to(DEVICE)
    n_params = sum(p.numel() for p in student.parameters())
    print(f"Student model: hidden={args.hidden} n_layers={args.n_layers} params={n_params:,}", file=sys.stderr)

    opt = optim.Adam(student.parameters(), lr=args.lr, weight_decay=1e-5)

    history = {"train_loss": [], "val_loss": [], "val_top1": []}
    n_train = train_obs.shape[0]
    t0 = time.time()
    for ep in range(args.epochs):
        idx = torch.randperm(n_train, device=DEVICE)
        train_obs_e = train_obs[idx]
        train_mask_e = train_mask[idx]
        train_pol_e = train_pol[idx]
        train_bs_e = train_bs[idx]
        train_bo_e = train_bo[idx]

        student.train()
        ep_loss, n_batches = 0.0, 0
        for i in range(0, n_train, args.batch):
            b_obs = train_obs_e[i:i+args.batch]
            b_mask = train_mask_e[i:i+args.batch]
            b_pol = train_pol_e[i:i+args.batch]
            b_bs = train_bs_e[i:i+args.batch]
            b_bo = train_bo_e[i:i+args.batch]
            logits = student(b_obs, b_bs, b_bo)
            loss = masked_ce_loss(logits, b_mask, b_pol)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(student.parameters(), 1.0)
            opt.step()
            ep_loss += loss.item()
            n_batches += 1
        train_loss = ep_loss / max(1, n_batches)

        student.eval()
        with torch.no_grad():
            v_logits = student(val_obs, val_bs, val_bo)
            v_loss = masked_ce_loss(v_logits, val_mask, val_pol).item()
            v_pred = student.policy(val_obs, val_bs, val_bo, val_mask)
            top1 = (v_pred.argmax(dim=-1) == val_pol.argmax(dim=-1)).float().mean().item()
        history["train_loss"].append(train_loss)
        history["val_loss"].append(v_loss)
        history["val_top1"].append(top1)
        if ep < 3 or ep % 10 == 0 or ep == args.epochs - 1:
            print(f"  ep {ep+1:3d}/{args.epochs}: train={train_loss:.4f} val={v_loss:.4f} top1={top1:.3f} ({time.time()-t0:.0f}s)", file=sys.stderr)

    torch.save({
        "state_dict": student.state_dict(),
        "hidden": args.hidden,
        "n_layers": args.n_layers,
        "input_dim": INPUT_DIM,
        "history": history,
        "labels": labels,
    }, args.out)
    print(f"Saved {args.out} (final top1={top1:.3f})", file=sys.stderr)


if __name__ == "__main__":
    main()

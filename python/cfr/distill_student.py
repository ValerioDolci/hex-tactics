"""Distill Student: train un piccolo MLP che imita la policy del teacher Deep CFR.

Usa il dataset prodotto da distill_dataset.py.

Architettura student: MLP più piccolo del teacher (256x3 → 128x2) per validare
distillazione "lossy" — ottimizzeremo dopo.

Loss: cross-entropy mascherata sulla distribuzione di azioni del teacher.
    L = -sum_a [ target[a] * log(student_softmax_masked[a] + eps) ]

Usage:
    python -m cfr.distill_student /tmp/dataset_lanc_spa.npz --epochs 50 --out /tmp/student_lanc_spa.pt
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
from torch.utils.data import DataLoader, TensorDataset

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from cfr.abstract_game import MAX_ACTIONS
from hex_tactics.ai.obs_features_v2 import N_FEATURES_TOTAL_V2

DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


class StudentMLP(nn.Module):
    """Student: MLP 153→128→128→24 (più piccolo del teacher 153→256×3→24)."""

    def __init__(self, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES_TOTAL_V2, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, MAX_ACTIONS),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

    def policy(self, obs: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """Returns masked-softmax distribution over MAX_ACTIONS."""
        logits = self.net(obs)
        # Mask: invalid actions → -inf prima del softmax
        masked_logits = logits.masked_fill(mask < 0.5, float("-inf"))
        return torch.softmax(masked_logits, dim=-1)


def masked_ce_loss(student_logits: torch.Tensor, mask: torch.Tensor, target_policy: torch.Tensor) -> torch.Tensor:
    """Cross-entropy mascherata.

    student_logits: (B, MAX_ACTIONS)
    mask: (B, MAX_ACTIONS) 0/1
    target_policy: (B, MAX_ACTIONS), distribuzione del teacher (sum=1 sui legali)
    """
    masked_logits = student_logits.masked_fill(mask < 0.5, float("-inf"))
    log_probs = torch.log_softmax(masked_logits, dim=-1)
    # Solo legal actions contribuiscono (target=0 sulle illegali, e log_probs=-inf*0=nan, evitiamo)
    # Sostituiamo log_probs nan con 0 (già zero contribution)
    log_probs = torch.where(torch.isnan(log_probs) | torch.isinf(log_probs), torch.zeros_like(log_probs), log_probs)
    loss = -(target_policy * log_probs).sum(dim=-1).mean()
    return loss


def train(
    obs: np.ndarray, mask: np.ndarray, policy: np.ndarray,
    epochs: int = 50, batch_size: int = 256, lr: float = 1e-3, hidden: int = 128,
    val_split: float = 0.1, verbose: bool = True,
) -> tuple[StudentMLP, dict]:
    n = obs.shape[0]
    perm = np.random.default_rng(0).permutation(n)
    n_val = int(n * val_split)
    val_idx = perm[:n_val]
    train_idx = perm[n_val:]

    obs_t = torch.from_numpy(obs).to(DEVICE)
    mask_t = torch.from_numpy(mask).to(DEVICE)
    policy_t = torch.from_numpy(policy).to(DEVICE)

    train_obs = obs_t[train_idx]
    train_mask = mask_t[train_idx]
    train_pol = policy_t[train_idx]
    val_obs = obs_t[val_idx]
    val_mask = mask_t[val_idx]
    val_pol = policy_t[val_idx]

    student = StudentMLP(hidden=hidden).to(DEVICE)
    opt = optim.Adam(student.parameters(), lr=lr, weight_decay=1e-5)

    history = {"train_loss": [], "val_loss": [], "val_top1_match": []}
    n_train = train_obs.shape[0]
    for ep in range(epochs):
        # Shuffle
        idx = torch.randperm(n_train, device=DEVICE)
        train_obs_e = train_obs[idx]
        train_mask_e = train_mask[idx]
        train_pol_e = train_pol[idx]

        student.train()
        epoch_loss = 0.0
        n_batches = 0
        for i in range(0, n_train, batch_size):
            b_obs = train_obs_e[i:i+batch_size]
            b_mask = train_mask_e[i:i+batch_size]
            b_pol = train_pol_e[i:i+batch_size]
            logits = student(b_obs)
            loss = masked_ce_loss(logits, b_mask, b_pol)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(student.parameters(), 1.0)
            opt.step()
            epoch_loss += loss.item()
            n_batches += 1
        train_loss = epoch_loss / max(1, n_batches)

        student.eval()
        with torch.no_grad():
            v_logits = student(val_obs)
            v_loss = masked_ce_loss(v_logits, val_mask, val_pol).item()
            v_pred = student.policy(val_obs, val_mask)
            v_argmax_pred = v_pred.argmax(dim=-1)
            v_argmax_target = val_pol.argmax(dim=-1)
            top1_match = (v_argmax_pred == v_argmax_target).float().mean().item()

        history["train_loss"].append(train_loss)
        history["val_loss"].append(v_loss)
        history["val_top1_match"].append(top1_match)

        if verbose and (ep < 3 or ep % 5 == 0 or ep == epochs - 1):
            print(f"  ep {ep+1:3d}/{epochs}: train_loss={train_loss:.4f}  val_loss={v_loss:.4f}  val_top1_match={top1_match:.3f}", file=sys.stderr)

    return student, history


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", help="Path a dataset .npz prodotto da distill_dataset.py")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=128, help="Hidden size student MLP (default 128 vs teacher 256)")
    ap.add_argument("--out", default=None, help="File .pt output (default /tmp/student_<label>.pt)")
    args = ap.parse_args()

    data = np.load(args.dataset, allow_pickle=True)
    obs = data["obs"]
    mask = data["mask"]
    policy = data["policy"]
    label = str(data["label"])
    print(f"Loaded {obs.shape[0]} samples for {label}", file=sys.stderr)

    t0 = time.time()
    student, history = train(
        obs, mask, policy,
        epochs=args.epochs, batch_size=args.batch, lr=args.lr, hidden=args.hidden,
    )
    print(f"Training done in {time.time() - t0:.1f}s", file=sys.stderr)

    out_path = Path(args.out) if args.out else Path(f"/tmp/student_{label}.pt")
    torch.save({
        "state_dict": student.state_dict(),
        "hidden": args.hidden,
        "label": label,
        "history": history,
        "n_samples": obs.shape[0],
    }, out_path)
    print(f"Saved student to {out_path}", file=sys.stderr)
    print(f"Final: val_loss={history['val_loss'][-1]:.4f}  top1_match={history['val_top1_match'][-1]:.3f}", file=sys.stderr)


if __name__ == "__main__":
    main()

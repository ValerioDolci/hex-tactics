"""Distill Decision Tree multi-matchup — student sync per build singlefile / GH Pages.

Pipeline:
1. Carica mega-dataset multi (obs153 + build_self39 + build_opp39, target = action argmax)
2. Train DecisionTreeClassifier su input 231 → classe 0..23
3. Eval V_a su singoli matchup (sample policy come argmax DT)
4. Genera TS code (analogo a dtAI_generated.ts) per integrazione browser

Usage:
    python -m cfr.distill_dt_multi /tmp/multi_full_v2.npz \
        --max-depth 35 --max-leaves 12000 \
        --out-py /tmp/dt_multi.pkl --out-ts /tmp/dtMultiAI_generated.ts
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))


def train_dt(X: np.ndarray, y: np.ndarray, *, max_depth: int, max_leaves: int):
    from sklearn.tree import DecisionTreeClassifier
    print(f"Training DT on {X.shape[0]} samples, {X.shape[1]} features, max_depth={max_depth}, max_leaves={max_leaves}", file=sys.stderr)
    t0 = time.time()
    clf = DecisionTreeClassifier(
        max_depth=max_depth,
        max_leaf_nodes=max_leaves,
        min_samples_leaf=10,
        random_state=0,
        class_weight="balanced",
    )
    clf.fit(X, y)
    print(f"  Done in {time.time()-t0:.1f}s. Tree: {clf.get_n_leaves()} leaves, depth {clf.get_depth()}", file=sys.stderr)
    return clf


def emit_ts(clf, n_features: int, n_classes: int, out_path: Path) -> None:
    """Genera codice TS con if/else nested che replica il DT, simile a dtAI_generated.ts."""
    tree = clf.tree_
    feature = tree.feature
    threshold = tree.threshold
    children_left = tree.children_left
    children_right = tree.children_right
    value = tree.value  # shape (n_nodes, 1, n_classes)
    classes = clf.classes_

    lines: list[str] = [
        "// AUTO-GENERATED — DO NOT EDIT BY HAND",
        "// Generato da python/cfr/distill_dt_multi.py",
        f"// Distillazione DecisionTreeClassifier dal multi-matchup Deep CFR student.",
        f"// Tree: depth={clf.get_depth()}, leaves={clf.get_n_leaves()}, classes={list(classes)}",
        "",
        "/**",
        " * Predict action_id (0..23) data una observation di 231 feature:",
        " *   obs153 (da obsFeaturesV2) ++ build_self_39 ++ build_opp_39.",
        " * Distillato dal modello Deep CFR multi-matchup (24 teacher → DT singolo).",
        " * NB: input contiguo 231 — concatenare in quest'ordine prima di chiamare.",
        " */",
        "export function predictDtMultiAction(features: Float32Array | number[]): number {",
    ]

    # Emette ricorsivamente if/else
    def emit(node: int, indent: int):
        ind = "  " * indent
        if children_left[node] == children_right[node]:
            # Foglia: predici la classe argmax
            counts = value[node, 0]
            cls_idx = int(np.argmax(counts))
            cls = int(classes[cls_idx])
            lines.append(f"{ind}return {cls};")
            return
        feat = int(feature[node])
        thr = float(threshold[node])
        lines.append(f"{ind}if (features[{feat}] <= {thr:.6f}) {{")
        emit(children_left[node], indent + 1)
        lines.append(f"{ind}}} else {{")
        emit(children_right[node], indent + 1)
        lines.append(f"{ind}}}")

    emit(0, 1)
    lines.append("}")
    lines.append("")

    out_path.write_text("\n".join(lines))
    size_kb = out_path.stat().st_size / 1024
    print(f"Wrote {out_path} ({size_kb:.1f} KB)", file=sys.stderr)


def eval_vs_teacher_argmax(clf, obs, mask, policy):
    """Top-1 match: in quanti % dei sample il DT predice la stessa azione del teacher (argmax)."""
    n = obs.shape[0]
    teacher_argmax = policy.argmax(axis=-1)
    student_pred = clf.predict(obs)
    return float((teacher_argmax == student_pred).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--max-depth", type=int, default=35)
    ap.add_argument("--max-leaves", type=int, default=12000)
    ap.add_argument("--out-pkl", default="/tmp/dt_multi.pkl")
    ap.add_argument("--out-ts", default="/tmp/dtMultiAI_generated.ts")
    args = ap.parse_args()

    print(f"Loading {args.dataset}...", file=sys.stderr)
    data = np.load(args.dataset, allow_pickle=True)
    obs = data["obs"]
    build_self = data["build_self"]
    build_opp = data["build_opp"]
    mask = data["mask"]
    policy = data["policy"]
    n = obs.shape[0]
    print(f"Loaded {n} samples", file=sys.stderr)

    # Concatena input
    X = np.concatenate([obs, build_self, build_opp], axis=1).astype(np.float32)
    # Target: classe argmax del teacher policy
    y = policy.argmax(axis=-1).astype(np.int32)

    # Stratified train/val split (random)
    rng = np.random.default_rng(0)
    perm = rng.permutation(n)
    n_val = int(n * 0.05)
    val_idx = perm[:n_val]
    train_idx = perm[n_val:]

    clf = train_dt(X[train_idx], y[train_idx], max_depth=args.max_depth, max_leaves=args.max_leaves)

    # Eval top-1 match
    train_acc = float((clf.predict(X[train_idx]) == y[train_idx]).mean())
    val_acc = float((clf.predict(X[val_idx]) == y[val_idx]).mean())
    print(f"\nTop-1 match: train={train_acc:.3f} val={val_acc:.3f}", file=sys.stderr)

    # Save pkl + emit TS
    import pickle
    Path(args.out_pkl).write_bytes(pickle.dumps(clf))
    print(f"Saved {args.out_pkl}", file=sys.stderr)
    n_classes = int(clf.classes_.max() + 1)
    emit_ts(clf, n_features=X.shape[1], n_classes=n_classes, out_path=Path(args.out_ts))


if __name__ == "__main__":
    main()

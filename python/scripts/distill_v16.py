"""Full distillation: v14 MaskablePPO → DecisionTree esportato in TypeScript.

Pipeline:
  1. Rollout 5k partite con v14 (stochastic, per varietà).
  2. Train DT con max_leaf=500 e bench WR.
  3. Salva DT come pickle + esporta in TypeScript (cascata if-else).

Output:
  /tmp/dt_distilled.pkl
  src/ai/dtAI_generated.ts (auto-generated TS code con la logica del DT)

Run:
  /Users/flaviacasini/claude-bot/venv/bin/python3 -u python/scripts/distill_full.py
"""
import sys
import os
import time
import pickle
import json
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from sb3_contrib import MaskablePPO  # noqa: E402
from sklearn.tree import DecisionTreeClassifier, _tree  # noqa: E402

from hex_tactics.ai.env import HexTacticsEnv, MAX_ACTIONS  # noqa: E402

V16_BEST = "/tmp/hex_tactics_ppo_v16_selfplay/best.zip"
N_GAMES_COLLECT = 5000
N_GAMES_BENCH = 300
MAX_STEPS = 400
MAX_LEAF = 1500  # V2: cresciuto da 500 (v15) per ridurre distillation tax
SEED = 42
OUT_PKL = "/tmp/dt_distilled_v16.pkl"
OUT_TS = os.path.join(ROOT, "..", "src", "ai", "dtAI_generated.ts")
OUT_DUMP = "/tmp/dt_dump.json"


def collect(model, env, n):
    Xs, ys = [], []
    t0 = time.time()
    for ep in range(n):
        obs, _ = env.reset()
        done = trunc = False
        steps = 0
        while not (done or trunc) and steps < MAX_STEPS:
            mask = env.action_masks()
            a, _ = model.predict(obs, action_masks=mask, deterministic=False)
            Xs.append(obs.copy())
            ys.append(int(a))
            obs, _r, done, trunc, _ = env.step(int(a))
            steps += 1
        if (ep + 1) % 250 == 0:
            print(f"  {ep+1}/{n} ({(ep+1)/(time.time()-t0):.1f} ep/s)", flush=True)
    return np.array(Xs, dtype=np.float32), np.array(ys, dtype=np.int32)


def bench(env, policy_fn, n):
    wins = trunc_count = 0
    for ep in range(n):
        obs, info = env.reset()
        done = trunc = False
        steps = 0
        while not (done or trunc) and steps < MAX_STEPS:
            mask = env.action_masks()
            a = policy_fn(obs, mask)
            obs, _r, done, trunc, info = env.step(int(a))
            steps += 1
        if steps >= MAX_STEPS:
            trunc_count += 1
        if info.get("winner") == "A":
            wins += 1
        if (ep + 1) % 50 == 0:
            print(f"    {ep+1}/{n} (wr {wins/(ep+1):.3f})", flush=True)
    return wins / n, trunc_count


def export_dt_to_ts(dt: DecisionTreeClassifier, out_path: str, n_features: int):
    """Esporta un DecisionTreeClassifier come funzione TypeScript.

    Genera funzione `predictDtAction(obs: Float32Array): number` con cascata if-else.
    """
    tree = dt.tree_
    classes = dt.classes_
    feature = tree.feature
    threshold = tree.threshold

    lines: list[str] = []
    lines.append("// AUTO-GENERATED — DO NOT EDIT BY HAND")
    lines.append(f"// Generato da python/scripts/distill_full.py")
    lines.append(f"// Albero: depth={dt.get_depth()}, leaves={dt.get_n_leaves()}, classes={list(classes)}")
    lines.append("")
    lines.append("/**")
    lines.append(" * Predict action_id (0..19) data una observation di 153 feature.")
    lines.append(" * L'albero è stato distillato dal modello v14 MaskablePPO.")
    lines.append(" */")
    lines.append("export function predictDtAction(obs: Float32Array | number[]): number {")

    def recurse(node: int, depth: int):
        indent = "  " * (depth + 1)
        if feature[node] == _tree.TREE_UNDEFINED:
            # Foglia: scegli la classe con probabilità max
            value = tree.value[node][0]
            cls_idx = int(np.argmax(value))
            cls = int(classes[cls_idx])
            lines.append(f"{indent}return {cls};")
            return
        feat_idx = int(feature[node])
        thresh = float(threshold[node])
        lines.append(f"{indent}if (obs[{feat_idx}] <= {thresh:.6f}) {{")
        recurse(int(tree.children_left[node]), depth + 1)
        lines.append(f"{indent}}} else {{")
        recurse(int(tree.children_right[node]), depth + 1)
        lines.append(f"{indent}}}")

    recurse(0, 0)
    lines.append("}")
    lines.append("")
    lines.append(f"export const DT_N_FEATURES = {n_features};")
    lines.append("")

    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    with open(out_abs, "w") as f:
        f.write("\n".join(lines))
    file_size = os.path.getsize(out_abs)
    print(f"  exported TS: {out_abs} ({file_size/1024:.1f} KB)", flush=True)


def main():
    print("=== Full distillation v14 → DT → TS ===", flush=True)
    print(f"  collect: {N_GAMES_COLLECT} games", flush=True)
    print(f"  bench: {N_GAMES_BENCH} games", flush=True)
    print(f"  DT max_leaf: {MAX_LEAF}", flush=True)
    print(f"  out TS: {os.path.abspath(OUT_TS)}", flush=True)
    print()

    env = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg",
                       max_rounds=30, seed=SEED, obs_version="v2")
    n_features = env.observation_space.shape[0]

    print("Loading v14...", flush=True)
    model = MaskablePPO.load(V16_BEST, device="cpu")

    print(f"\n=== Collect {N_GAMES_COLLECT} games ===", flush=True)
    t0 = time.time()
    X, y = collect(model, env, N_GAMES_COLLECT)
    print(f"  dataset: {X.shape[0]} samples, {len(np.unique(y))} unique actions", flush=True)
    print(f"  action dist: {np.bincount(y, minlength=MAX_ACTIONS)}", flush=True)
    print(f"  time: {time.time()-t0:.1f}s", flush=True)

    print(f"\n=== Train DT (max_leaf={MAX_LEAF}) ===", flush=True)
    dt = DecisionTreeClassifier(max_leaf_nodes=MAX_LEAF, random_state=SEED)
    dt.fit(X, y)
    train_acc = dt.score(X, y)
    print(f"  train acc: {train_acc:.3f}", flush=True)
    print(f"  depth: {dt.get_depth()}, leaves: {dt.get_n_leaves()}", flush=True)

    # Save pkl
    with open(OUT_PKL, "wb") as f:
        pickle.dump(dt, f)
    print(f"  saved pkl: {OUT_PKL}", flush=True)

    # Export TS
    print("\n=== Export to TypeScript ===", flush=True)
    export_dt_to_ts(dt, OUT_TS, n_features)

    # Bench
    print(f"\n=== Bench DT vs basic ({N_GAMES_BENCH} games) ===", flush=True)
    env_b = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg",
                         max_rounds=30, seed=SEED+5000, obs_version="v2")

    def dt_policy(obs, mask):
        pred = int(dt.predict(obs.reshape(1, -1))[0])
        if 0 <= pred < len(mask) and mask[pred]:
            return pred
        legal = np.where(mask)[0]
        return int(legal[0]) if len(legal) > 0 else 0

    t0 = time.time()
    wr_dt, hardcap = bench(env_b, dt_policy, N_GAMES_BENCH)
    print(f"  DT wr: {wr_dt:.3f} ({time.time()-t0:.1f}s, {hardcap} hit cap)", flush=True)

    # Dump info per Valerio
    info = {
        "n_games_collect": N_GAMES_COLLECT,
        "dataset_samples": int(X.shape[0]),
        "n_features": int(n_features),
        "n_unique_actions": int(len(np.unique(y))),
        "max_leaf": MAX_LEAF,
        "depth": int(dt.get_depth()),
        "leaves": int(dt.get_n_leaves()),
        "train_acc": float(train_acc),
        "wr_vs_basic": float(wr_dt),
        "hardcap_hits": int(hardcap),
    }
    with open(OUT_DUMP, "w") as f:
        json.dump(info, f, indent=2)
    print(f"\n  saved info: {OUT_DUMP}", flush=True)
    print(f"  ✅ DT wr {wr_dt:.3f}, exported TS pronto per integrazione", flush=True)


if __name__ == "__main__":
    main()

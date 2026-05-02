"""Smoke test distillazione AI: v14 (MaskablePPO) → DecisionTree.

Pipeline:
  1. Carica modello v14 (best.zip)
  2. Rollout di N_GAMES partite con v14 vs basic AI, raccogliendo (obs, action_chosen)
  3. Train sklearn DecisionTreeClassifier sul dataset
  4. Bench:
     - v14 vs basic AI (~200 ep) → reference WR
     - DT vs basic AI (~200 ep) → distilled WR
     - DT accuracy on training set (% azioni che predice uguale al v14)
  5. Stampa risultati: se DT WR > 0.55 OK, procedere con full distillation.

Run:
  /Users/flaviacasini/claude-bot/venv/bin/python3 python/scripts/distill_smoke.py
"""

import sys
import os
import time
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from sb3_contrib import MaskablePPO  # noqa: E402
from sklearn.tree import DecisionTreeClassifier  # noqa: E402

from hex_tactics.ai.env import HexTacticsEnv, MAX_ACTIONS  # noqa: E402

V14_BEST = "/private/tmp/hex_tactics_ppo_v14_fase1/best.zip"
N_GAMES_COLLECT = 1000   # partite di rollout per dataset
N_GAMES_BENCH = 200      # partite di bench WR
MAX_DEPTH = 12
MAX_LEAF = 200
SEED = 42


def collect_dataset(model, env: HexTacticsEnv, n_games: int) -> tuple[np.ndarray, np.ndarray]:
    """Raccoglie (obs, action) campionate dal modello v14 in N partite."""
    Xs: list[np.ndarray] = []
    ys: list[int] = []
    t0 = time.time()
    for ep in range(n_games):
        obs, _ = env.reset()
        done = False
        truncated = False
        while not (done or truncated):
            mask = env.action_masks()
            # MaskablePPO predict accetta action_masks
            action, _ = model.predict(obs, action_masks=mask, deterministic=False)
            Xs.append(obs.copy())
            ys.append(int(action))
            obs, _r, done, truncated, _info = env.step(int(action))
        if (ep + 1) % 100 == 0:
            elapsed = time.time() - t0
            rate = (ep + 1) / elapsed
            print(f"  collect: {ep+1}/{n_games} games ({rate:.1f} ep/s)")
    X = np.array(Xs, dtype=np.float32)
    y = np.array(ys, dtype=np.int32)
    return X, y


def bench_policy_winrate(env: HexTacticsEnv, policy_fn, n_games: int) -> float:
    """Esegue n_games partite usando policy_fn(obs, mask) → action; ritorna WR."""
    wins = 0
    for ep in range(n_games):
        obs, _info = env.reset()
        done = False
        truncated = False
        last_info = _info
        while not (done or truncated):
            mask = env.action_masks()
            action = policy_fn(obs, mask)
            obs, _r, done, truncated, last_info = env.step(int(action))
        winner = last_info.get("winner")
        if winner == "A":
            wins += 1
        if (ep + 1) % 50 == 0:
            print(f"    bench: {ep+1}/{n_games} (running wr {wins/(ep+1):.3f})")
    return wins / n_games


def main():
    print(f"=== Distillation smoke test ===")
    print(f"Model: {V14_BEST}")
    print(f"N_GAMES_COLLECT: {N_GAMES_COLLECT}")
    print(f"N_GAMES_BENCH: {N_GAMES_BENCH}")
    print(f"DT max_depth={MAX_DEPTH}, max_leaf_nodes={MAX_LEAF}")
    print()

    # Setup env (random_pg per varietà — stesso config del training v14)
    env = HexTacticsEnv(
        preset_a="random_pg",
        preset_b="random_pg",
        max_rounds=30,
        seed=SEED,
        obs_version="v2",
    )
    print(f"Env: obs shape {env.observation_space.shape}, actions {MAX_ACTIONS}")
    print()

    # Carica modello v14
    print("Loading v14 MaskablePPO...")
    model = MaskablePPO.load(V14_BEST, device="cpu")
    print(f"  loaded. policy: {type(model.policy).__name__}")
    print()

    # 1. Collect dataset
    print(f"=== Step 1: collect dataset ({N_GAMES_COLLECT} games) ===")
    t0 = time.time()
    X, y = collect_dataset(model, env, N_GAMES_COLLECT)
    print(f"  dataset: {X.shape[0]} samples, {X.shape[1]} features, {len(np.unique(y))} unique actions")
    print(f"  action distribution: {np.bincount(y, minlength=MAX_ACTIONS)}")
    print(f"  collect time: {time.time()-t0:.1f}s")
    print()

    # 2. Train DT
    print(f"=== Step 2: train DecisionTree ===")
    t0 = time.time()
    dt = DecisionTreeClassifier(
        max_depth=MAX_DEPTH,
        max_leaf_nodes=MAX_LEAF,
        random_state=SEED,
    )
    dt.fit(X, y)
    train_acc = dt.score(X, y)
    print(f"  train accuracy (DT vs v14 actions): {train_acc:.3f}")
    print(f"  tree depth: {dt.get_depth()}, leaves: {dt.get_n_leaves()}")
    print(f"  fit time: {time.time()-t0:.1f}s")
    print()

    # 3. Bench v14 vs basic
    print(f"=== Step 3: bench v14 vs basic_ai ({N_GAMES_BENCH} games) ===")
    env_bench = HexTacticsEnv(
        preset_a="random_pg",
        preset_b="random_pg",
        max_rounds=30,
        seed=SEED + 1000,
        obs_version="v2",
    )

    def v14_policy(obs, mask):
        action, _ = model.predict(obs, action_masks=mask, deterministic=True)
        return int(action)

    t0 = time.time()
    wr_v14 = bench_policy_winrate(env_bench, v14_policy, N_GAMES_BENCH)
    print(f"  v14 wr: {wr_v14:.3f} ({time.time()-t0:.1f}s)")
    print()

    # 4. Bench DT vs basic
    print(f"=== Step 4: bench DT vs basic_ai ({N_GAMES_BENCH} games) ===")
    env_bench2 = HexTacticsEnv(
        preset_a="random_pg",
        preset_b="random_pg",
        max_rounds=30,
        seed=SEED + 2000,
        obs_version="v2",
    )

    def dt_policy(obs, mask):
        # DT predict diretto. Filtra azioni illegali via mask: se predicted illegal, scegli prima legale.
        pred = int(dt.predict(obs.reshape(1, -1))[0])
        if 0 <= pred < len(mask) and mask[pred]:
            return pred
        # Fallback: prima azione legale
        legal = np.where(mask)[0]
        return int(legal[0]) if len(legal) > 0 else 0

    t0 = time.time()
    wr_dt = bench_policy_winrate(env_bench2, dt_policy, N_GAMES_BENCH)
    print(f"  DT wr: {wr_dt:.3f} ({time.time()-t0:.1f}s)")
    print()

    # 5. Decisione
    print("=== Risultati ===")
    print(f"  DT train accuracy:    {train_acc:.3f}  (matching v14 actions)")
    print(f"  v14 wr vs basic:      {wr_v14:.3f}")
    print(f"  DT  wr vs basic:      {wr_dt:.3f}")
    delta = wr_v14 - wr_dt
    print(f"  performance loss DT:  {delta:.3f}")
    print()
    if wr_dt >= 0.55:
        print(f"  ✅ DT wr {wr_dt:.3f} >= 0.55 → procedere con FULL DISTILLATION")
    else:
        print(f"  ⚠ DT wr {wr_dt:.3f} < 0.55 → considera opzione B (MLP) o C (ONNX)")


if __name__ == "__main__":
    main()

"""Smoke v2: solo DT bench (skip v14 bench che bloccava per loop infinito).

Add hard step cap per evitare partite-zombie.
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
N_GAMES_COLLECT = 1000
N_GAMES_BENCH = 200
MAX_STEPS_PER_GAME = 400  # hard cap
MAX_DEPTH = 12
MAX_LEAF = 200
SEED = 42


def collect_dataset(model, env, n_games):
    Xs, ys = [], []
    t0 = time.time()
    for ep in range(n_games):
        obs, _ = env.reset()
        done = truncated = False
        steps = 0
        while not (done or truncated) and steps < MAX_STEPS_PER_GAME:
            mask = env.action_masks()
            action, _ = model.predict(obs, action_masks=mask, deterministic=False)
            Xs.append(obs.copy())
            ys.append(int(action))
            obs, _r, done, truncated, _info = env.step(int(action))
            steps += 1
        if (ep + 1) % 100 == 0:
            print(f"  collect: {ep+1}/{n_games} ({(ep+1)/(time.time()-t0):.1f} ep/s)", flush=True)
    return np.array(Xs, dtype=np.float32), np.array(ys, dtype=np.int32)


def bench_policy(env, policy_fn, n_games):
    wins = 0
    truncs = 0
    for ep in range(n_games):
        obs, info = env.reset()
        done = truncated = False
        steps = 0
        while not (done or truncated) and steps < MAX_STEPS_PER_GAME:
            mask = env.action_masks()
            action = policy_fn(obs, mask)
            obs, _r, done, truncated, info = env.step(int(action))
            steps += 1
        if steps >= MAX_STEPS_PER_GAME:
            truncs += 1
        winner = info.get("winner")
        if winner == "A":
            wins += 1
        if (ep + 1) % 25 == 0:
            print(f"    bench: {ep+1}/{n_games} (wr {wins/(ep+1):.3f}, hardcap {truncs})", flush=True)
    return wins / n_games, truncs


def main():
    print("=== Distillation smoke v2 ===", flush=True)
    env = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg",
                       max_rounds=30, seed=SEED, obs_version="v2")
    print(f"obs shape {env.observation_space.shape}", flush=True)

    print("Loading v14...", flush=True)
    model = MaskablePPO.load(V14_BEST, device="cpu")

    print(f"\n=== Collect {N_GAMES_COLLECT} games ===", flush=True)
    t0 = time.time()
    X, y = collect_dataset(model, env, N_GAMES_COLLECT)
    print(f"  dataset: {X.shape[0]} samples, {len(np.unique(y))} unique actions", flush=True)
    print(f"  action dist: {np.bincount(y, minlength=MAX_ACTIONS)}", flush=True)
    print(f"  collect time: {time.time()-t0:.1f}s", flush=True)

    print(f"\n=== Train DT (max_depth={MAX_DEPTH}, max_leaf={MAX_LEAF}) ===", flush=True)
    dt = DecisionTreeClassifier(max_depth=MAX_DEPTH, max_leaf_nodes=MAX_LEAF, random_state=SEED)
    dt.fit(X, y)
    train_acc = dt.score(X, y)
    print(f"  train acc: {train_acc:.3f}", flush=True)
    print(f"  depth: {dt.get_depth()}, leaves: {dt.get_n_leaves()}", flush=True)

    print(f"\n=== Bench DT vs basic ({N_GAMES_BENCH} games) ===", flush=True)
    env_bench = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg",
                             max_rounds=30, seed=SEED+2000, obs_version="v2")

    def dt_policy(obs, mask):
        pred = int(dt.predict(obs.reshape(1, -1))[0])
        if 0 <= pred < len(mask) and mask[pred]:
            return pred
        legal = np.where(mask)[0]
        return int(legal[0]) if len(legal) > 0 else 0

    t0 = time.time()
    wr_dt, hardcap_dt = bench_policy(env_bench, dt_policy, N_GAMES_BENCH)
    print(f"  DT wr: {wr_dt:.3f} ({time.time()-t0:.1f}s, {hardcap_dt} games hit cap)", flush=True)

    # Bench basic vs basic (sanity: ~0.5)
    print(f"\n=== Bench random_legal vs basic ({N_GAMES_BENCH} games) ===", flush=True)
    env_bench3 = HexTacticsEnv(preset_a="random_pg", preset_b="random_pg",
                              max_rounds=30, seed=SEED+3000, obs_version="v2")
    rng = np.random.default_rng(SEED)

    def random_policy(obs, mask):
        legal = np.where(mask)[0]
        return int(rng.choice(legal)) if len(legal) > 0 else 0

    wr_rand, hardcap_rand = bench_policy(env_bench3, random_policy, N_GAMES_BENCH)
    print(f"  Random wr: {wr_rand:.3f} ({hardcap_rand} games hit cap)", flush=True)

    print("\n=== Risultati ===", flush=True)
    print(f"  DT train acc:           {train_acc:.3f}", flush=True)
    print(f"  DT wr vs basic_ai:      {wr_dt:.3f}", flush=True)
    print(f"  Random wr vs basic_ai:  {wr_rand:.3f}", flush=True)
    print(f"  v14 wr vs basic (noto): ~0.70", flush=True)
    if wr_dt >= 0.55:
        print(f"  ✅ DT >= 0.55, FULL DISTILLATION OK", flush=True)
    else:
        print(f"  ⚠ DT < 0.55, considera B/C", flush=True)


if __name__ == "__main__":
    main()

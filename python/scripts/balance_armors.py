"""Balance armors — matrice wr armor_A vs armor_B con AI top (DT v16).

Output: /tmp/balance_armors.json + summary stdout.

Tempo stimato: 4×4 × 200 ep / 1.5 ep/s = ~30 min.
"""
from __future__ import annotations

import json
import os
import pickle
import random
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante", name="Armatura pesante", category="armature",
    damage_reduction=12, impediment=9,
)

from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
from hex_tactics.core.events import EventEndTurn, EventResolveCombat, EventStartRound
from hex_tactics.core.hex import offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state

# Riusa policy + game loop dal balance_weapons
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from balance_weapons import make_dt_policy, play_with_forced_weapons

DT_PKL = "/tmp/dt_distilled_v16.pkl"
N_EP = 200
SEED_BASE = 88000

ALL_ARMORS = ["∅", "armatura_leggera", "armatura_media", "armatura_pesante"]
# "∅" = nessuna armatura


def play_with_forced_armors(a_policy, b_policy, armor_a: str, armor_b: str,
                              seed: int, max_steps: int = 400):
    """Genera random PG con armor forzata."""
    rng = random.Random(seed)
    build_a = generate_random_pg(rng, seed=rng.randrange(2**31))
    build_b = generate_random_pg(rng, seed=rng.randrange(2**31))
    build_a.armor = None if armor_a == "∅" else armor_a
    build_b.armor = None if armor_b == "∅" else armor_b
    A = unit_from_random_pg(build_a, "A", offset_to_axial(Offset(4, 8)))
    B = unit_from_random_pg(build_b, "B", offset_to_axial(Offset(18, 8)))

    game_seed = rng.randrange(2**31)
    state = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
    state = reduce(state, EventStartRound())

    steps = 0
    while steps < max_steps:
        steps += 1
        if state.phase == "game-over" or state.round > 30:
            break
        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            continue
        if state.phase == "awaiting-defense":
            target = state.units.get(state.pending_action.target_id) if state.pending_action else None
            if target:
                pol = a_policy if target.faction == "A" else b_policy
                state = reduce(state, pol(state, target.id))
                continue
        if state.phase == "awaiting-attacker-bid" and state.move_in_progress:
            mover = state.units.get(state.move_in_progress.unit_id)
            if mover:
                pol = a_policy if mover.faction == "A" else b_policy
                state = reduce(state, pol(state, mover.id))
                continue
        if state.phase == "awaiting-defender-bid" and state.move_in_progress:
            defender = state.units.get(state.move_in_progress.defender_id) if state.move_in_progress.defender_id else None
            if defender:
                pol = a_policy if defender.faction == "A" else b_policy
                state = reduce(state, pol(state, defender.id))
                continue
        if state.phase in ("turn-start", "choosing-action", "declaring-attack", "awaiting-carica"):
            if not state.turn_order:
                break
            cur_id = state.turn_order[state.current_turn_idx]
            cur = state.units.get(cur_id)
            if not cur:
                break
            pol = a_policy if cur.faction == "A" else b_policy
            state = reduce(state, pol(state, cur_id))
            continue
        break
    return state.winner if state.phase == "game-over" else None


def main():
    print(f"[setup] Loading DT v16 from {DT_PKL}")
    with open(DT_PKL, "rb") as f:
        dt = pickle.load(f)
    policy = make_dt_policy(dt)
    print(f"[setup] DT loaded, depth={dt.get_depth()}, leaves={dt.get_n_leaves()}")
    print(f"[setup] Matrix {len(ALL_ARMORS)}×{len(ALL_ARMORS)} × {N_EP} ep = {len(ALL_ARMORS)**2 * N_EP} partite")

    matrix = {}
    armor_global = defaultdict(lambda: [0, 0])
    t0 = time.time()
    total_cells = len(ALL_ARMORS) ** 2
    cell_count = 0

    for aA in ALL_ARMORS:
        for aB in ALL_ARMORS:
            cell_count += 1
            wins_a = wins_b = ties = 0
            for ep in range(N_EP):
                seed = SEED_BASE + hash((aA, aB, ep)) % (10**8)
                winner = play_with_forced_armors(policy, policy, aA, aB, seed)
                if winner == "A":
                    wins_a += 1
                elif winner == "B":
                    wins_b += 1
                else:
                    ties += 1
            matrix[(aA, aB)] = {"wins_a": wins_a, "wins_b": wins_b, "ties": ties, "n": N_EP}
            armor_global[aA][0] += wins_a
            armor_global[aA][1] += N_EP
            elapsed = time.time() - t0
            print(f"  cell {cell_count}/{total_cells} ({aA} vs {aB}) "
                  f"wr_A={wins_a/N_EP:.2f} ties={ties} elapsed={elapsed:.0f}s", flush=True)

    elapsed = time.time() - t0
    print(f"\n[done] {total_cells * N_EP} partite in {elapsed:.0f}s")

    print("\n=== ARMOR RANKING (wr A globale) ===")
    ranking = sorted(armor_global.items(), key=lambda x: -x[1][0]/max(1, x[1][1]))
    for a, (wins, tot) in ranking:
        wr = wins / tot if tot > 0 else 0
        flag = " ⚠️ OP" if wr > 0.65 else (" ⚠️ UP" if wr < 0.35 else "")
        print(f"  {a:>20s}: wr={wr:.3f} ({wins}/{tot}){flag}")

    print("\n=== MIRROR MATCH (wr A in stessa armor) — dovrebbe essere ≈ 0.5 ===")
    for a in ALL_ARMORS:
        cell = matrix[(a, a)]
        wr = cell["wins_a"] / cell["n"]
        print(f"  {a:>20s}: wr_A={wr:.3f} ties={cell['ties']}")

    out = {
        "n_ep": N_EP,
        "armors": ALL_ARMORS,
        "matrix": {f"{a}__VS__{b}": v for (a, b), v in matrix.items()},
        "armor_global_wr": {a: v[0]/max(1, v[1]) for a, v in armor_global.items()},
        "elapsed_s": elapsed,
    }
    with open("/tmp/balance_armors.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\n[done] /tmp/balance_armors.json")


if __name__ == "__main__":
    main()

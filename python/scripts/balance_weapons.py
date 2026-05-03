"""Balance weapons — matrice wr arma_A vs arma_B con AI top (DT v16).

Per ogni cella (weapon_a, weapon_b), gioca N_EP partite con random PG generati
ma weapon FORZATA. L'AI per entrambi i lati è il DT distillato (v16 best).

Output: /tmp/balance_weapons.json + summary stdout.

Run:
  /Users/flaviacasini/claude-bot/venv/bin/python3 -u python/scripts/balance_weapons.py

Tempo stimato: 13×13 × 100 ep / 1.5 ep/s = ~3 ore.
"""
from __future__ import annotations

import json
import os
import pickle
import random
import sys
import time
from collections import defaultdict
from typing import Optional

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# === D3 attivo ===
from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante", name="Armatura pesante", category="armature",
    damage_reduction=12, impediment=9,
)

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features_v2 import build_obs_v2
from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
from hex_tactics.core.events import EventEndTurn, EventResolveCombat, EventStartRound
from hex_tactics.core.hex import offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state

DT_PKL = "/tmp/dt_distilled_v16.pkl"
N_EP = 100
MAX_STEPS = 400
SEED_BASE = 99000

ALL_WEAPONS = [
    "pugnale", "spada", "spada_lunga", "mazza", "ascia_1h", "ascia_2h",
    "lancia_2m", "lancia_3m", "giavellotto",
    "arco_corto", "arco_lungo", "balestra",
]


def make_dt_policy(dt):
    """Wrapper DT con override euristici (coerente con TS dtAI.ts).

    Override:
      1. END_TURN proposto ma c'è ATTACK legale → ATTACK
      2. D-050: START_TURN slancio_dice=0 e nemico ranged-capable → forza =2
    """
    from hex_tactics.data.weapons import get_weapon

    def policy(state, unit_id):
        unit = state.units.get(unit_id)
        if not unit:
            return EventEndTurn()
        moves = legal_moves(state, unit_id)
        if not moves:
            return EventEndTurn()
        try:
            obs = build_obs_v2(
                state=state,
                agent_faction=unit.faction,
                agent_unit_id=unit_id,
                enforce_simultaneous_privacy=True,
            )
        except Exception:
            return moves[0]
        action = int(dt.predict(obs.reshape(1, -1))[0])
        if action < 0 or action >= len(moves):
            attacks = [m for m in moves if m.type == "DECLARE_ATTACK"]
            if attacks:
                return attacks[0]
            mv = [m for m in moves if m.type == "MOVE"]
            if mv:
                return mv[0]
            return moves[-1]
        chosen = moves[action]
        if chosen.type == "END_TURN":
            attacks = [m for m in moves if m.type == "DECLARE_ATTACK"]
            if attacks:
                return attacks[0]
        # Override D-050: counter-ranged
        if chosen.type == "START_TURN" and getattr(chosen, "slancio_dice", 0) == 0:
            my_w = get_weapon(unit.weapon) if unit.weapon else None
            i_am_ranged_only = (
                my_w is not None and my_w.range is not None
                and my_w.range.distance is not None and my_w.range.reach is None
            )
            if not i_am_ranged_only:
                enemies = [u for u in state.units.values() if u.faction != unit.faction and u.alive]
                def has_ranged(e):
                    if not e.weapon:
                        return False
                    w = get_weapon(e.weapon)
                    return w is not None and w.range is not None and w.range.distance is not None
                if any(has_ranged(e) for e in enemies):
                    alt = next(
                        (m for m in moves
                         if m.type == "START_TURN" and getattr(m, "slancio_dice", 0) == 2),
                        None,
                    )
                    if alt is not None:
                        return alt
        return chosen
    return policy


def play_with_forced_weapons(a_policy, b_policy, weapon_a: str, weapon_b: str,
                              seed: int) -> Optional[str]:
    """Genera random PG ma con weapon forzata. Tutto il resto random (armor, skills, etc.)."""
    rng = random.Random(seed)
    build_a = generate_random_pg(rng, seed=rng.randrange(2**31))
    build_b = generate_random_pg(rng, seed=rng.randrange(2**31))
    # Forza weapon (il random_pg setta weapon nel build, override)
    build_a.weapon = weapon_a
    build_b.weapon = weapon_b
    A = unit_from_random_pg(build_a, "A", offset_to_axial(Offset(4, 8)))
    B = unit_from_random_pg(build_b, "B", offset_to_axial(Offset(18, 8)))

    game_seed = rng.randrange(2**31)
    state = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
    state = reduce(state, EventStartRound())

    steps = 0
    while steps < MAX_STEPS:
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
    print(f"[setup] DT v16 loaded, depth={dt.get_depth()}, leaves={dt.get_n_leaves()}")
    print(f"[setup] Matrix {len(ALL_WEAPONS)}×{len(ALL_WEAPONS)} × {N_EP} ep = {len(ALL_WEAPONS)**2 * N_EP} partite totali")

    matrix = {}  # (wA, wB) -> {wins_a, wins_b, ties, n}
    weapon_global = defaultdict(lambda: [0, 0])  # weapon -> [wins, total] (faction A only)
    t0 = time.time()
    total_cells = len(ALL_WEAPONS) ** 2
    cell_count = 0

    for wA in ALL_WEAPONS:
        for wB in ALL_WEAPONS:
            cell_count += 1
            wins_a = wins_b = ties = 0
            for ep in range(N_EP):
                seed = SEED_BASE + hash((wA, wB, ep)) % (10**8)
                winner = play_with_forced_weapons(policy, policy, wA, wB, seed)
                if winner == "A":
                    wins_a += 1
                elif winner == "B":
                    wins_b += 1
                else:
                    ties += 1
            matrix[(wA, wB)] = {"wins_a": wins_a, "wins_b": wins_b, "ties": ties, "n": N_EP}
            weapon_global[wA][0] += wins_a
            weapon_global[wA][1] += N_EP
            elapsed = time.time() - t0
            if cell_count % 10 == 0 or cell_count == total_cells:
                eta_sec = elapsed * (total_cells - cell_count) / max(1, cell_count)
                print(f"  cell {cell_count}/{total_cells} ({wA} vs {wB}) "
                      f"wr_A={wins_a/N_EP:.2f} elapsed={elapsed:.0f}s eta={eta_sec:.0f}s", flush=True)

    elapsed = time.time() - t0
    print(f"\n[done] {total_cells * N_EP} partite in {elapsed:.0f}s ({total_cells * N_EP / elapsed:.1f} ep/s)")

    # Ranking weapon globale (wr A media su tutti gli avversari)
    print("\n=== WEAPON RANKING (wr A globale, vs tutte le armi) ===")
    ranking = sorted(weapon_global.items(), key=lambda x: -x[1][0]/max(1, x[1][1]))
    for w, (wins, tot) in ranking:
        wr = wins / tot if tot > 0 else 0
        flag = " ⚠️ OP" if wr > 0.65 else (" ⚠️ UP" if wr < 0.35 else "")
        print(f"  {w:>20s}: wr={wr:.3f} ({wins}/{tot}){flag}")

    # Mirror match (diagonale)
    print("\n=== MIRROR MATCH (wr A in stessa weapon) — dovrebbe essere ≈ 0.5 ===")
    for w in ALL_WEAPONS:
        cell = matrix[(w, w)]
        wr = cell["wins_a"] / cell["n"]
        print(f"  {w:>20s}: wr_A={wr:.3f} ties={cell['ties']}")

    # Save JSON
    out = {
        "n_ep": N_EP,
        "weapons": ALL_WEAPONS,
        "matrix": {f"{a}__VS__{b}": v for (a, b), v in matrix.items()},
        "weapon_global_wr": {w: v[0]/max(1, v[1]) for w, v in weapon_global.items()},
        "elapsed_s": elapsed,
    }
    with open("/tmp/balance_weapons.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\n[done] /tmp/balance_weapons.json")


if __name__ == "__main__":
    main()

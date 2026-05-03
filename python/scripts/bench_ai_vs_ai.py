"""Bench AI vs AI — confronto policy headless senza Gym env.

Usa direttamente reducer + AI policies. Gioca N partite per ogni matchup di
policy, conta wr di A. Setup random PG ad ogni reset (varietà).

Output: stdout summary + JSON in /tmp/bench_ai_vs_ai.json

Run:
  /Users/flaviacasini/claude-bot/venv/bin/python3 -u python/scripts/bench_ai_vs_ai.py
"""
from __future__ import annotations

import json
import os
import pickle
import random
import sys
import time
from collections import defaultdict
from typing import Callable, Optional

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# === D3 attivo (armatura pesante RD 12) — coerente con training v15 ===
from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor

_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante",
    name="Armatura pesante",
    category="armature",
    damage_reduction=12,
    impediment=9,
)

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features_v2 import build_obs_v2
from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
from hex_tactics.ai.utility_ai import utility_decide_move
from hex_tactics.core.events import (
    EventEndTurn,
    EventResolveCombat,
    EventStartRound,
    GameEvent,
)
from hex_tactics.core.hex import Axial, offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state, GameState
from hex_tactics.data.presets import get_preset, unit_from_preset

DT_PKL = "/tmp/dt_distilled.pkl"  # output di distill_v15.py
N_GAMES = 200
MAX_STEPS = 400
SEED_BASE = 12345

PRESETS = ("spadaccino", "arciere", "tank")


# ----- Policy implementations -----

PolicyFn = Callable[[GameState, str], GameEvent]


def utility_policy(state: GameState, unit_id: str) -> GameEvent:
    return utility_decide_move(state, unit_id)


def random_policy(state: GameState, unit_id: str, rng: random.Random) -> GameEvent:
    moves = legal_moves(state, unit_id)
    if not moves:
        return EventEndTurn()
    return rng.choice(moves)


def make_dt_policy(dt) -> PolicyFn:
    """Wrapper DT: build obs (faction-aware) + predict + decode."""
    def policy(state: GameState, unit_id: str) -> GameEvent:
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
            obs = None
        if obs is None:
            return moves[0]
        action = int(dt.predict(obs.reshape(1, -1))[0])
        if action < 0 or action >= len(moves):
            # Preferenza ATTACK > MOVE > END_TURN (coerente con TS dtAI override)
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
        return chosen
    return policy


# ----- Game loop -----

def play_one_game(
    a_policy: PolicyFn,
    b_policy: PolicyFn,
    seed: int,
    matchup: tuple[str, str] = ("random_pg", "random_pg"),
    max_steps: int = MAX_STEPS,
) -> tuple[Optional[str], dict]:
    """Gioca una partita 1v1. Restituisce (winner, info_dict)."""
    rng = random.Random(seed)

    chosen_a, chosen_b = matchup
    if chosen_a == "random_pg":
        build_a = generate_random_pg(rng, seed=rng.randrange(2**31))
        A = unit_from_random_pg(build_a, "A", offset_to_axial(Offset(4, 8)))
        weapon_a = build_a.weapon
        armor_a = build_a.armor
    else:
        A = unit_from_preset(get_preset(chosen_a), "A", offset_to_axial(Offset(4, 8)))
        weapon_a = A.weapon
        armor_a = A.armor
    if chosen_b == "random_pg":
        build_b = generate_random_pg(rng, seed=rng.randrange(2**31))
        B = unit_from_random_pg(build_b, "B", offset_to_axial(Offset(18, 8)))
    else:
        B = unit_from_preset(get_preset(chosen_b), "B", offset_to_axial(Offset(18, 8)))

    game_seed = rng.randrange(2**31)
    state = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
    state = reduce(state, EventStartRound())

    a_id = A.id
    b_id = B.id

    steps = 0
    while steps < max_steps:
        steps += 1
        if state.phase == "game-over":
            break
        if state.round > 30:
            break

        # Auto-resolve fasi non-decisionali
        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            continue

        # Determina chi deve giocare
        if state.phase == "awaiting-defense":
            target = state.units.get(state.pending_action.target_id) if state.pending_action else None
            if target:
                pol = a_policy if target.faction == "A" else b_policy
                ev = pol(state, target.id)
                state = reduce(state, ev)
                continue
        if state.phase == "awaiting-attacker-bid" and state.move_in_progress:
            mover = state.units.get(state.move_in_progress.unit_id)
            if mover:
                pol = a_policy if mover.faction == "A" else b_policy
                ev = pol(state, mover.id)
                state = reduce(state, ev)
                continue
        if state.phase == "awaiting-defender-bid" and state.move_in_progress:
            defender_id = state.move_in_progress.defender_id
            defender = state.units.get(defender_id) if defender_id else None
            if defender:
                pol = a_policy if defender.faction == "A" else b_policy
                ev = pol(state, defender.id)
                state = reduce(state, ev)
                continue
        if state.phase in ("turn-start", "choosing-action", "declaring-attack", "awaiting-carica"):
            if not state.turn_order:
                break
            cur_id = state.turn_order[state.current_turn_idx]
            cur = state.units.get(cur_id)
            if not cur:
                break
            pol = a_policy if cur.faction == "A" else b_policy
            ev = pol(state, cur_id)
            state = reduce(state, ev)
            continue
        # Fase sconosciuta: break per sicurezza
        break

    winner = state.winner if state.phase == "game-over" else None
    info = {
        "steps": steps,
        "rounds": state.round,
        "weapon_a": weapon_a or "∅",
        "armor_a": armor_a or "∅",
        "matchup": matchup,
    }
    return winner, info


def bench(
    name: str, a_policy_factory, b_policy_factory, n_games: int, seed_offset: int = 0
) -> dict:
    """Esegui N partite e collect stats."""
    print(f"\n=== BENCH: {name} ({n_games} ep) ===", flush=True)
    t0 = time.time()
    wins_a = wins_b = ties = 0
    by_weapon = defaultdict(lambda: [0, 0])  # [wins, total]
    by_armor = defaultdict(lambda: [0, 0])
    by_matchup = defaultdict(lambda: [0, 0])
    avg_rounds = []
    for ep in range(n_games):
        seed = SEED_BASE + seed_offset + ep
        # Factory per evitare side-effect tra episodi (es. random.Random interna)
        a_pol = a_policy_factory(seed)
        b_pol = b_policy_factory(seed + 1_000_000)
        winner, info = play_one_game(a_pol, b_pol, seed=seed)
        if winner == "A":
            wins_a += 1
        elif winner == "B":
            wins_b += 1
        else:
            ties += 1
        won = winner == "A"
        by_weapon[info["weapon_a"]][0] += 1 if won else 0
        by_weapon[info["weapon_a"]][1] += 1
        by_armor[info["armor_a"]][0] += 1 if won else 0
        by_armor[info["armor_a"]][1] += 1
        by_matchup[info["matchup"]][0] += 1 if won else 0
        by_matchup[info["matchup"]][1] += 1
        avg_rounds.append(info["rounds"])
        if (ep + 1) % 50 == 0:
            print(f"  {ep+1}/{n_games} (wr_A {wins_a/(ep+1):.3f})", flush=True)
    elapsed = time.time() - t0
    wr_a = wins_a / n_games
    wr_b = wins_b / n_games
    print(f"  → wr A={wr_a:.3f}, wr B={wr_b:.3f}, ties={ties} ({elapsed:.1f}s)", flush=True)
    print(f"  Top weapons (A):")
    for w, (wins, tot) in sorted(by_weapon.items(), key=lambda x: -x[1][0]/max(1, x[1][1]))[:6]:
        if tot > 0:
            print(f"    {w:>20s}: wr={wins/tot:.2f} ({tot} ep)")
    return {
        "name": name,
        "wr_a": wr_a,
        "wr_b": wr_b,
        "ties": ties,
        "avg_rounds": float(np.mean(avg_rounds)),
        "by_weapon": {k: (v[0]/v[1] if v[1] > 0 else 0.0) for k, v in by_weapon.items()},
        "by_armor": {k: (v[0]/v[1] if v[1] > 0 else 0.0) for k, v in by_armor.items()},
        "by_matchup": {f"{k[0]}_vs_{k[1]}": (v[0]/v[1] if v[1] > 0 else 0.0) for k, v in by_matchup.items()},
        "elapsed_s": elapsed,
    }


def main():
    print(f"[setup] Loading DT v15 from {DT_PKL}")
    with open(DT_PKL, "rb") as f:
        dt = pickle.load(f)
    print(f"[setup] DT loaded: depth={dt.get_depth()}, leaves={dt.get_n_leaves()}")

    # Policies factories (callable seed → callable policy)
    util = lambda _seed: utility_policy
    rnd = lambda seed: (lambda s, u: random_policy(s, u, random.Random(seed)))
    dtv15 = lambda _seed: make_dt_policy(dt)

    results = []

    # 1. DT v15 vs DT v15 (mirror match) — wr A dovrebbe essere ≈ 0.5 (bilanciato)
    results.append(bench("DT_v15 vs DT_v15 (mirror)", dtv15, dtv15, N_GAMES, seed_offset=10000))
    # 2. DT v15 vs basicAi V2 (utility) — DT dovrebbe vincere
    results.append(bench("DT_v15 vs Utility_V2", dtv15, util, N_GAMES, seed_offset=20000))
    # 3. DT v15 vs random — DT dovrebbe dominare
    results.append(bench("DT_v15 vs Random", dtv15, rnd, N_GAMES, seed_offset=30000))
    # 4. Utility V2 vs Random — sanity check baseline
    results.append(bench("Utility_V2 vs Random", util, rnd, N_GAMES // 2, seed_offset=40000))

    # Save
    out = {
        "results": results,
        "n_games": N_GAMES,
        "seed_base": SEED_BASE,
    }
    with open("/tmp/bench_ai_vs_ai.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n[done] Salvato in /tmp/bench_ai_vs_ai.json")
    print("\n=== SUMMARY ===")
    for r in results:
        print(f"  {r['name']:<35s} wr_A={r['wr_a']:.3f} wr_B={r['wr_b']:.3f} ties={r['ties']}")


if __name__ == "__main__":
    main()

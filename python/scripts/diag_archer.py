"""Diagnostic: come l'AI gioca arciere vs melee.

Per capire se gli archi sono OP per AI weakness o per design strutturale 1v1.

Test:
  1. preset arciere vs spadaccino (no scudo) — bullet test
  2. preset arciere vs tank (con scudo) — defensive stance opportunity

Per ogni partita logga:
  - Round fine partita
  - HP finali entrambi
  - N shots ranged sparati
  - N attacchi melee tentati dal difensore
  - Slancio medio del target quando subisce ranged shot
  - Defensive stance attivata dal melee? (count)
  - Distanza media tra unità per round
  - Prima azione del melee turno 1
"""
from __future__ import annotations

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

from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante", name="Armatura pesante", category="armature",
    damage_reduction=12, impediment=9,
)

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features_v2 import build_obs_v2
from hex_tactics.core.events import (
    EventDeclareAttack, EventEndTurn, EventResolveCombat, EventStartRound,
    EventToggleDefensive, GameEvent,
)
from hex_tactics.core.hex import base_distance, offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state
from hex_tactics.data.presets import get_preset, unit_from_preset

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from balance_weapons import make_dt_policy

DT_PKL = "/tmp/dt_distilled_v16.pkl"
N_EP = 100
MAX_STEPS = 400


def play_diag(a_policy, b_policy, archer_preset: str, melee_preset: str, seed: int):
    """Gioca: A=archer, B=melee. Restituisce dict di stats."""
    A = unit_from_preset(get_preset(archer_preset), "A", offset_to_axial(Offset(4, 8)))
    B = unit_from_preset(get_preset(melee_preset), "B", offset_to_axial(Offset(18, 8)))
    state = create_initial_state([A, B], Board(cols=24, rows=18), seed)
    state = reduce(state, EventStartRound())

    stats = {
        "n_ranged_shots": 0,
        "n_melee_attacks": 0,
        "n_defensive_toggles": 0,
        "first_action_melee": None,  # primo evento di B nel suo primo turno
        "shots_target_slancio_sum": 0,
        "shots_target_slancio_n": 0,
        "distances": [],
        "rounds": 0,
        "winner": None,
        "hp_a_final": A.hp,
        "hp_b_final": B.hp,
    }

    seen_first_b_action = False
    last_round_recorded = -1

    steps = 0
    while steps < MAX_STEPS:
        steps += 1
        if state.phase == "game-over" or state.round > 30:
            break

        # Snapshot distanza per round
        if state.round != last_round_recorded:
            a_pos = state.units[A.id].position
            b_pos = state.units[B.id].position
            stats["distances"].append(base_distance(a_pos, b_pos))
            last_round_recorded = state.round

        # Auto-resolve / phase routing
        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            continue
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
            defender = state.units.get(state.move_in_progress.defender_id) if state.move_in_progress.defender_id else None
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

            # Tracking event prima del dispatch
            if cur.faction == "A" and ev.type == "DECLARE_ATTACK" and getattr(ev, "is_ranged", False):
                stats["n_ranged_shots"] += 1
                target_unit = state.units.get(ev.target_id)
                if target_unit:
                    stats["shots_target_slancio_sum"] += target_unit.slancio
                    stats["shots_target_slancio_n"] += 1
            elif cur.faction == "B":
                if not seen_first_b_action and state.phase == "choosing-action":
                    stats["first_action_melee"] = ev.type
                    seen_first_b_action = True
                if ev.type == "DECLARE_ATTACK" and not getattr(ev, "is_ranged", False):
                    stats["n_melee_attacks"] += 1
                if ev.type == "TOGGLE_DEFENSIVE":
                    stats["n_defensive_toggles"] += 1

            state = reduce(state, ev)
            continue
        break

    stats["rounds"] = state.round
    stats["winner"] = state.winner if state.phase == "game-over" else None
    stats["hp_a_final"] = state.units[A.id].hp
    stats["hp_b_final"] = state.units[B.id].hp
    return stats


def aggregate(name: str, stats_list: list[dict], n_ep: int):
    print(f"\n=== {name} ({n_ep} ep) ===")
    win_a = sum(1 for s in stats_list if s["winner"] == "A")
    win_b = sum(1 for s in stats_list if s["winner"] == "B")
    ties = n_ep - win_a - win_b
    print(f"  wr_A (arciere) = {win_a/n_ep:.3f}, wr_B (melee) = {win_b/n_ep:.3f}, ties = {ties}")

    avg_rounds = np.mean([s["rounds"] for s in stats_list])
    avg_hp_a = np.mean([s["hp_a_final"] for s in stats_list])
    avg_hp_b = np.mean([s["hp_b_final"] for s in stats_list])
    avg_shots = np.mean([s["n_ranged_shots"] for s in stats_list])
    avg_melee_atk = np.mean([s["n_melee_attacks"] for s in stats_list])
    avg_def_toggles = np.mean([s["n_defensive_toggles"] for s in stats_list])

    # Slancio medio target alla scarica ranged
    total_sum = sum(s["shots_target_slancio_sum"] for s in stats_list)
    total_n = sum(s["shots_target_slancio_n"] for s in stats_list)
    avg_target_slancio = total_sum / total_n if total_n > 0 else 0

    # Distanza media (su tutti i round di tutte le partite)
    all_dists = [d for s in stats_list for d in s["distances"]]
    avg_dist = np.mean(all_dists) if all_dists else 0

    # First action del melee (frequenza)
    first_actions = defaultdict(int)
    for s in stats_list:
        first_actions[s["first_action_melee"] or "(nessuna)"] += 1

    print(f"  Round medio fine = {avg_rounds:.1f}")
    print(f"  HP finale A (arciere) = {avg_hp_a:.1f}")
    print(f"  HP finale B (melee)   = {avg_hp_b:.1f}")
    print(f"  Avg shots ranged sparati dall'arciere: {avg_shots:.2f}")
    print(f"  Avg attacchi melee del difensore: {avg_melee_atk:.2f}")
    print(f"  Avg defensive_stance toggles del melee: {avg_def_toggles:.2f}")
    print(f"  Slancio medio target quando subisce ranged: {avg_target_slancio:.2f}")
    print(f"  Distanza media tra unità (per round): {avg_dist:.2f}")
    print(f"  Prima azione del melee (turno 1):")
    for action, count in sorted(first_actions.items(), key=lambda x: -x[1]):
        print(f"    {action}: {count} ({100*count/n_ep:.0f}%)")


def main():
    print(f"[setup] Loading DT v16 from {DT_PKL}")
    with open(DT_PKL, "rb") as f:
        dt = pickle.load(f)
    policy = make_dt_policy(dt)
    print(f"[setup] DT loaded, depth={dt.get_depth()}, leaves={dt.get_n_leaves()}\n")

    # === Test 1: arciere vs spadaccino (no scudo) ===
    stats_1 = []
    t0 = time.time()
    for ep in range(N_EP):
        seed = 50000 + ep
        s = play_diag(policy, policy, "arciere", "spadaccino", seed)
        stats_1.append(s)
    print(f"[t1] {N_EP} partite in {time.time()-t0:.0f}s")
    aggregate("ARCIERE vs SPADACCINO (no scudo)", stats_1, N_EP)

    # === Test 2: arciere vs tank (con scudo) ===
    stats_2 = []
    t0 = time.time()
    for ep in range(N_EP):
        seed = 60000 + ep
        s = play_diag(policy, policy, "arciere", "tank", seed)
        stats_2.append(s)
    print(f"\n[t2] {N_EP} partite in {time.time()-t0:.0f}s")
    aggregate("ARCIERE vs TANK (scudo + arm pesante)", stats_2, N_EP)


if __name__ == "__main__":
    main()

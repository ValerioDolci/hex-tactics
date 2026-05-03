"""Balance skills — efficacia di ogni skill loadout vs build baseline.

Per ogni "skill loadout" definito, testa wr vs un PG baseline (no skill) col
medesimo equipaggiamento. Se la skill da costo X exp dà wr 0.5+δ, e una skill
2X dà wr 0.5+2δ → skill bilanciate.

Output: /tmp/balance_skills.json + summary stdout.

Tempo stimato: 14 loadouts × 200 ep / 1.5 ep/s = ~30 min.
"""
from __future__ import annotations

import json
import os
import pickle
import random
import sys
import time
from typing import List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante", name="Armatura pesante", category="armature",
    damage_reduction=12, impediment=9,
)

from hex_tactics.entities.skill import AcquiredSkill, compute_skill_cost, count_specializations
from hex_tactics.data.presets import unit_from_preset, get_preset
from hex_tactics.core.events import EventEndTurn, EventResolveCombat, EventStartRound
from hex_tactics.core.hex import offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from balance_weapons import make_dt_policy

DT_PKL = "/tmp/dt_distilled_v16.pkl"
N_EP = 200
SEED_BASE = 77000


def make_skill(modifier: str, level: int, abilita=None, azione=None, classe=None, oggetto=None):
    spec_count = sum(1 for x in (abilita, azione, classe, oggetto) if x is not None)
    cost = compute_skill_cost(modifier, level, spec_count)
    return AcquiredSkill(
        id=f"{modifier}_{level}_{abilita or '_'}_{azione or '_'}_{classe or '_'}_{oggetto or '_'}",
        modifier=modifier, level=level,
        abilita=abilita, azione=azione, classe_oggetto=classe, oggetto_specifico=oggetto,
        cost=cost,
    )


# Skill loadouts da testare. Ogni loadout è (nome, lista_skill, costo_totale)
LOADOUTS = [
    ("baseline (no skill)", [], 0),
    ("imp_armature_lv1", [make_skill("-1impedimento", 1, classe="armature")], None),
    ("imp_armature_lv2", [make_skill("-1impedimento", 2, classe="armature")], None),
    ("imp_armature_lv3", [make_skill("-1impedimento", 3, classe="armature")], None),
    ("imp_universal_lv1", [make_skill("-1impedimento", 1)], None),  # no spec, 100 exp
    ("imp_universal_lv2", [make_skill("-1impedimento", 2)], None),  # 300 exp
    ("tiro_atk_spade_lv1", [make_skill("+1tiro", 1, azione="attaccare", classe="spade")], None),
    ("tiro_atk_spade_lv2", [make_skill("+1tiro", 2, azione="attaccare", classe="spade")], None),
    ("tiro_universal_lv1", [make_skill("+1tiro", 1)], None),  # 600 exp
    ("dado_atk_lv1", [make_skill("+1dado", 1, azione="attaccare")], None),
    ("dadomax_slancio_lv1", [make_skill("+1dadomax", 1, azione="slancio")], None),
    ("mix_imp2_tiro1_spade", [
        make_skill("-1impedimento", 2, classe="armature"),
        make_skill("+1tiro", 1, azione="attaccare", classe="spade"),
    ], None),
    ("imp_armature_lv4", [make_skill("-1impedimento", 4, classe="armature")], None),
    ("tiro_atk_specialized_lv2", [make_skill("+1tiro", 2, abilita="forza", azione="attaccare", classe="spade")], None),
]


def play_skill_match(a_policy, b_policy, a_skills: List[AcquiredSkill],
                      b_skills: List[AcquiredSkill], seed: int, max_steps: int = 400):
    """Spadaccino base con skill custom vs spadaccino base con skill custom (mirror equip)."""
    rng = random.Random(seed)
    A_template = unit_from_preset(get_preset("spadaccino"), "A", offset_to_axial(Offset(4, 8)))
    B_template = unit_from_preset(get_preset("spadaccino"), "B", offset_to_axial(Offset(18, 8)))
    A_template.skills = a_skills
    B_template.skills = b_skills
    game_seed = rng.randrange(2**31)
    state = create_initial_state([A_template, B_template], Board(cols=24, rows=18), game_seed)
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
    print(f"[setup] {len(LOADOUTS)} loadouts × {N_EP} ep vs baseline = {len(LOADOUTS) * N_EP} partite\n")

    baseline_skills = LOADOUTS[0][1]
    results = []
    for name, skills, _ in LOADOUTS:
        cost_total = sum(s.cost for s in skills)
        wins_a = wins_b = ties = 0
        t0 = time.time()
        for ep in range(N_EP):
            seed = SEED_BASE + hash((name, ep)) % (10**8)
            winner = play_skill_match(policy, policy, skills, baseline_skills, seed)
            if winner == "A":
                wins_a += 1
            elif winner == "B":
                wins_b += 1
            else:
                ties += 1
        elapsed = time.time() - t0
        wr = wins_a / N_EP
        # Efficacia per exp: wr_advantage / cost_in_100exp_units
        adv = wr - 0.5
        eff = adv * 100 / max(1, cost_total) if cost_total > 0 else 0
        results.append({
            "name": name, "cost": cost_total, "wr_a": wr,
            "advantage": adv, "eff_per_100exp": eff,
            "wins_a": wins_a, "wins_b": wins_b, "ties": ties,
            "skills": [s.id for s in skills],
            "elapsed_s": elapsed,
        })
        print(f"  {name:<32s} cost={cost_total:>5d} wr_A={wr:.3f} adv={adv:+.3f} eff/100exp={eff:+.4f} ({elapsed:.0f}s)", flush=True)

    print("\n=== SKILL EFFICACY RANKING (vantaggio per 100 exp) ===")
    for r in sorted(results, key=lambda x: -x["eff_per_100exp"]):
        if r["cost"] == 0:
            continue
        flag = " ⚠️ STRONG" if r["eff_per_100exp"] > 0.05 else (" ⚠️ WEAK" if r["eff_per_100exp"] < 0.01 else "")
        print(f"  {r['name']:<32s} cost={r['cost']:>5d} wr={r['wr_a']:.3f} eff={r['eff_per_100exp']:+.4f}{flag}")

    out = {"n_ep": N_EP, "results": results}
    with open("/tmp/balance_skills.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\n[done] /tmp/balance_skills.json")


if __name__ == "__main__":
    main()

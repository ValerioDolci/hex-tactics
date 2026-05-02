"""
C1 — Replay verbose 1 partita per ognuno dei 9 matchup col v4 best.

Per ciascun matchup:
  - Stato iniziale + pattern tattico osservato (cosa fa il DQN)
  - Decisioni chiave con Q-values
  - Risultato finale

Output sintetico (no verbosità totale, solo decisioni significative).
"""

from __future__ import annotations

import sys
from collections import Counter
from typing import Optional

import numpy as np
import torch
from stable_baselines3 import DQN

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.legal_moves import legal_moves  # noqa: E402
from hex_tactics.core.events import GameEvent  # noqa: E402
from hex_tactics.core.hex import base_distance  # noqa: E402

DQN_PATH = "/tmp/hex_tactics_dqn_multi_v4/best.zip"
PRESETS = ("spadaccino", "arciere", "tank")


def event_short(ev: GameEvent) -> str:
    t = ev.type
    if t == "START_TURN":
        return f"slancio={ev.slancio_dice}d t={ev.impeto_to_slancio}"  # type: ignore
    if t == "DECLARE_ATTACK":
        rng = "RNG" if ev.is_ranged else "MEL"  # type: ignore
        return f"ATK[{rng}] {ev.weapon_id}#{ev.attack_mode_idx}"  # type: ignore
    if t == "CHOOSE_ATTACKER_DICE":
        return f"atk_dice={ev.dice_n}d"  # type: ignore
    if t == "CHOOSE_DEFENSE":
        return f"DEF {ev.defense_type} {ev.dice_n}d ({ev.parry_with})"  # type: ignore
    if t == "MOVE":
        return f"MOVE→({ev.target_hex.q},{ev.target_hex.r})"  # type: ignore
    if t == "RELOAD":
        return f"RELOAD {ev.dice_n}d"  # type: ignore
    if t == "END_TURN":
        return "END"
    return t


def get_q(model: DQN, obs: np.ndarray) -> np.ndarray:
    t = torch.as_tensor(obs, dtype=torch.float32).unsqueeze(0).to(model.device)
    with torch.no_grad():
        return model.q_net(t).cpu().numpy()[0]


def play_one(env: HexTacticsEnv, model: DQN, pa: str, pb: str, seed: int) -> dict:
    obs, info = env.reset(seed=seed, options={"preset_a": pa, "preset_b": pb})
    a = env._state.units[env._info.a_unit_id]
    b = env._state.units[env._info.b_unit_id]
    init_dist = base_distance(a.position, b.position)

    # Tracking azioni del policy (categorie)
    decision_types = Counter()
    movement_dist_changes = []  # delta dist after each MOVE
    slancio_choices = []
    atk_dice_choices = []
    defense_choices = []
    attack_modes = []
    last_dist = init_dist
    significant_decisions = []  # (round, phase, chosen, top_alts)

    while True:
        agent_id = env._agent_decision_unit_id(env._state)
        if agent_id is None:
            obs, _, term, trunc, info = env.step(0)
            if term or trunc:
                break
            continue
        moves = legal_moves(env._state, agent_id)
        q = get_q(model, obs)
        action_idx = int(np.argmax(q))

        if 0 <= action_idx < len(moves):
            ev = moves[action_idx]
            decision_types[ev.type] += 1
            if ev.type == "START_TURN":
                slancio_choices.append((ev.slancio_dice, ev.impeto_to_slancio))  # type: ignore
            elif ev.type == "CHOOSE_ATTACKER_DICE":
                atk_dice_choices.append(ev.dice_n)  # type: ignore
            elif ev.type == "CHOOSE_DEFENSE":
                defense_choices.append((ev.defense_type, ev.dice_n, ev.parry_with))  # type: ignore
            elif ev.type == "DECLARE_ATTACK":
                attack_modes.append((ev.weapon_id, ev.attack_mode_idx, ev.is_ranged))  # type: ignore
            # MOVE: track dist change
            phase = env._state.phase
            if env._state.phase in ("turn-start", "declaring-attack", "awaiting-defense"):
                ranked = sorted(
                    [(i, q[i], moves[i]) for i in range(len(moves))],
                    key=lambda x: -x[1],
                )[:3]
                significant_decisions.append({
                    "round": env._state.round,
                    "phase": phase,
                    "ranked": [(qv, event_short(mv)) for _, qv, mv in ranked],
                    "chosen_idx": action_idx,
                })

        obs, _, term, trunc, info = env.step(action_idx)

        # Track dist after MOVE
        a = env._state.units[env._info.a_unit_id]
        b = env._state.units[env._info.b_unit_id]
        new_dist = base_distance(a.position, b.position)
        if new_dist != last_dist:
            movement_dist_changes.append(new_dist - last_dist)
            last_dist = new_dist

        if term or trunc:
            break

    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    final_dist = base_distance(a.position, b.position)

    return {
        "preset_a": pa, "preset_b": pb, "seed": seed,
        "winner": s.winner, "rounds": s.round,
        "hp_a": a.hp, "hp_b": b.hp,
        "init_dist": init_dist, "final_dist": final_dist,
        "decision_types": dict(decision_types),
        "slancio_choices": Counter(slancio_choices).most_common(3),
        "atk_dice_choices": Counter(atk_dice_choices).most_common(3),
        "defense_choices": Counter(defense_choices).most_common(3),
        "attack_modes": Counter(attack_modes).most_common(3),
        "movement_summary": {
            "n_moves": len(movement_dist_changes),
            "net_dist_change": sum(movement_dist_changes),
            "closing": sum(1 for d in movement_dist_changes if d < 0),
            "retreating": sum(1 for d in movement_dist_changes if d > 0),
        },
        "significant_decisions": significant_decisions,
    }


def fmt_summary(r: dict) -> str:
    out = []
    tag = f"{r['preset_a']:>10s} → {r['preset_b']:<10s}"
    win_str = (
        "✅ A WIN" if r["winner"] == "A"
        else "❌ B WIN" if r["winner"] == "B"
        else "⚠️ NONE"
    )
    out.append(
        f"\n{'='*70}\n{tag}  {win_str}  R{r['rounds']:>2d}  "
        f"HP:{r['hp_a']:>2d}/{r['hp_b']:<2d}  dist:{r['init_dist']:>2d}→{r['final_dist']:<2d}"
    )
    out.append(f"  Azioni: {r['decision_types']}")
    out.append(
        f"  Movimento: {r['movement_summary']['n_moves']} moves, "
        f"closing={r['movement_summary']['closing']} retreating={r['movement_summary']['retreating']}, "
        f"net_dist={r['movement_summary']['net_dist_change']:+d}"
    )
    if r["slancio_choices"]:
        out.append(f"  Slancio: {r['slancio_choices']}")
    if r["atk_dice_choices"]:
        out.append(f"  Atk dice: {r['atk_dice_choices']}")
    if r["defense_choices"]:
        out.append(f"  Defense: {r['defense_choices']}")
    if r["attack_modes"]:
        out.append(f"  Attack mode: {r['attack_modes']}")
    return "\n".join(out)


def main():
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=99)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = DQN.load(DQN_PATH, env=env, device=device)
    print(f"[load] DQN multi v4 best, device={device}")

    print("\n" + "═"*70)
    print(" REPLAY MULTI-MATCHUP — 1 partita per ognuno dei 9 matchup")
    print("═"*70)

    all_results = []
    for pa in PRESETS:
        for pb in PRESETS:
            r = play_one(env, model, pa, pb, seed=700_001 + len(all_results))
            all_results.append(r)
            print(fmt_summary(r))

    # Sintesi globale
    print(f"\n\n{'═'*70}\n SOMMARIO 9 MATCHUP \n{'═'*70}")
    n_a_win = sum(1 for r in all_results if r["winner"] == "A")
    n_b_win = sum(1 for r in all_results if r["winner"] == "B")
    n_unfin = sum(1 for r in all_results if r["winner"] is None)
    print(f"A win: {n_a_win}/9, B win: {n_b_win}/9, unfin: {n_unfin}/9")


if __name__ == "__main__":
    main()

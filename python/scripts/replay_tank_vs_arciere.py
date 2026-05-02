"""
Replay verbose tank (DQN multi best) vs arciere (Utility AI).

Verifica empirica del matchup 0% — cosa succede esattamente?
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import DQN

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.legal_moves import legal_moves  # noqa: E402
from hex_tactics.core.events import GameEvent  # noqa: E402
from hex_tactics.core.hex import base_distance  # noqa: E402

DQN_PATH = "/tmp/hex_tactics_dqn_multi/best.zip"
SEEDS = [500_001, 500_002, 500_003, 500_004, 500_005]


def event_label(ev: GameEvent) -> str:
    t = ev.type
    if t == "START_TURN":
        return f"START_TURN slancio={ev.slancio_dice}d transfer={ev.impeto_to_slancio}"  # type: ignore
    if t == "DECLARE_ATTACK":
        atk = "RANGED" if ev.is_ranged else "melee"  # type: ignore
        return f"DECLARE [{atk}] {ev.weapon_id}#{ev.attack_mode_idx}"  # type: ignore
    if t == "CHOOSE_ATTACKER_DICE":
        return f"ATK_DICE={ev.dice_n}d"  # type: ignore
    if t == "CHOOSE_DEFENSE":
        return f"DEFENSE {ev.defense_type} {ev.dice_n}d ({ev.parry_with})"  # type: ignore
    if t == "MOVE":
        return f"MOVE → ({ev.target_hex.q},{ev.target_hex.r})"  # type: ignore
    if t == "RELOAD":
        return f"RELOAD {ev.dice_n}d"  # type: ignore
    if t == "END_TURN":
        return "END_TURN"
    return t


def state_brief(env: HexTacticsEnv) -> str:
    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    dist = base_distance(a.position, b.position)
    return (
        f"R{s.round} ph={s.phase} dist={dist} | "
        f"A=tank: HP{a.hp}/{a.hp_max} S{a.slancio} I{a.impeto} D{a.dadi_azione} "
        f"act={int(a.action_taken_this_turn)} | "
        f"B=arc: HP{b.hp}/{b.hp_max} S{b.slancio} I{b.impeto} D{b.dadi_azione} "
        f"loaded={int(b.weapon_loaded)}"
    )


def get_q(model: DQN, obs: np.ndarray) -> np.ndarray:
    t = torch.as_tensor(obs, dtype=torch.float32).unsqueeze(0).to(model.device)
    with torch.no_grad():
        return model.q_net(t).cpu().numpy()[0]


def replay_one(env: HexTacticsEnv, model: DQN, seed: int, gid: int) -> dict:
    obs, info = env.reset(seed=seed, options={"preset_a": "tank", "preset_b": "arciere"})
    print(f"\n{'='*78}\nP{gid} seed={seed} — A=tank (DQN) vs B=arciere (Utility)\n{'='*78}")

    step = 0
    initial_state = state_brief(env)
    print(f"INIT: {initial_state}")

    # Tracking aggregato
    total_damage_received = 0
    total_damage_dealt = 0
    last_hp_a = env._state.units[env._info.a_unit_id].hp
    last_hp_b = env._state.units[env._info.b_unit_id].hp

    while True:
        agent_id = env._agent_decision_unit_id(env._state)
        if agent_id is None:
            obs, _, terminated, truncated, info = env.step(0)
            if terminated or truncated:
                break
            continue

        moves = legal_moves(env._state, agent_id)
        q = get_q(model, obs)
        action_idx = int(np.argmax(q))

        step += 1
        # Stampa solo decisioni significative (ranged-defense, attack, slancio, primo movimento)
        phase = env._state.phase
        will_print = (
            phase in ("turn-start", "declaring-attack", "awaiting-defense") or step <= 6
        )

        if will_print:
            print(f"\n  [{step}] {state_brief(env)}")
            if moves:
                ranked = sorted(
                    [(i, q[i], moves[i]) for i in range(len(moves))],
                    key=lambda x: -x[1],
                )[:6]  # top 6
                for idx, qv, mv in ranked:
                    marker = " ★" if idx == action_idx else ""
                    print(f"      Q={qv:+7.3f}  {event_label(mv)}{marker}")

        obs, reward, terminated, truncated, info = env.step(action_idx)

        # Track damage
        new_hp_a = env._state.units[env._info.a_unit_id].hp
        new_hp_b = env._state.units[env._info.b_unit_id].hp
        if new_hp_a < last_hp_a:
            total_damage_received += last_hp_a - new_hp_a
        if new_hp_b < last_hp_b:
            total_damage_dealt += last_hp_b - new_hp_b
        last_hp_a = new_hp_a
        last_hp_b = new_hp_b

        if terminated or truncated:
            break

    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    print(
        f"\n  RESULT: winner={s.winner} rounds={s.round} steps={step} | "
        f"HP_A={a.hp}/20 HP_B={b.hp}/20 | dmg_taken={total_damage_received} "
        f"dmg_dealt={total_damage_dealt}"
    )
    return {
        "winner": s.winner,
        "rounds": s.round,
        "hp_a": a.hp,
        "hp_b": b.hp,
        "dmg_received": total_damage_received,
        "dmg_dealt": total_damage_dealt,
    }


def main():
    env = HexTacticsEnv(preset_a="tank", preset_b="arciere", max_rounds=30, seed=99)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = DQN.load(DQN_PATH, env=env, device=device)
    print(f"[load] DQN multi best, device={device}")

    summaries = []
    for i, seed in enumerate(SEEDS, 1):
        out = replay_one(env, model, seed, i)
        summaries.append(out)

    print(f"\n\n{'='*78}\nSOMMARIO 5 PARTITE TANK vs ARCIERE\n{'='*78}")
    for i, s in enumerate(summaries, 1):
        print(
            f"  P{i}: {s['winner']:>5s} R{s['rounds']:>2d} "
            f"HP_A={s['hp_a']:>2d} HP_B={s['hp_b']:>2d} "
            f"taken={s['dmg_received']:>2d} dealt={s['dmg_dealt']:>2d}"
        )
    avg_dmg_taken = float(np.mean([s["dmg_received"] for s in summaries]))
    avg_dmg_dealt = float(np.mean([s["dmg_dealt"] for s in summaries]))
    avg_rounds = float(np.mean([s["rounds"] for s in summaries]))
    print(f"\nAvg damage taken: {avg_dmg_taken:.1f}")
    print(f"Avg damage dealt: {avg_dmg_dealt:.1f}")
    print(f"Avg rounds:       {avg_rounds:.1f}")


if __name__ == "__main__":
    main()

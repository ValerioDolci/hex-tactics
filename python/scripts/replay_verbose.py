"""
Analisi #3 — replay verbose di partite con Q-values.

Per ogni decisione del DQN best:
  - Stato sintetico (HP me/enemy, slancio, impeto, dadi, distance, fase)
  - Tutte le legal moves con relativo Q-value (DQN q_net output)
  - Evidenzia l'azione scelta (argmax)
  - Highlight i momenti dove DQN sceglie 1-mano della spada lunga

Output leggibile come narrativa.
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

DQN_PATH = "/tmp/hex_tactics_dqn_v2/best.zip"
N_GAMES = 3
SEEDS = [400_001, 400_002, 400_003]


def event_label(ev: GameEvent) -> str:
    """Label leggibile di un evento."""
    t = ev.type
    if t == "START_TURN":
        s = ev.slancio_dice  # type: ignore[attr-defined]
        tr = ev.impeto_to_slancio  # type: ignore[attr-defined]
        return f"START_TURN (slancio {s}d, transfer impeto→slancio {tr})"
    if t == "DECLARE_ATTACK":
        atk = "ranged" if ev.is_ranged else "melee"  # type: ignore[attr-defined]
        return (
            f"DECLARE_ATTACK [{atk}] {ev.weapon_id}#{ev.attack_mode_idx} "  # type: ignore[attr-defined]
            f"stat={ev.chosen_stat}"  # type: ignore[attr-defined]
        )
    if t == "CHOOSE_ATTACKER_DICE":
        return f"CHOOSE_ATTACKER_DICE = {ev.dice_n}d"  # type: ignore[attr-defined]
    if t == "CHOOSE_DEFENSE":
        pw = ev.parry_with  # type: ignore[attr-defined]
        return (
            f"CHOOSE_DEFENSE {ev.defense_type}"  # type: ignore[attr-defined]
            f" {ev.dice_n}d{(' with=' + pw) if pw else ''}"  # type: ignore[attr-defined]
        )
    if t == "MOVE":
        target = ev.target_hex  # type: ignore[attr-defined]
        return f"MOVE → ({target.q},{target.r})"
    if t == "RELOAD":
        return f"RELOAD {ev.dice_n}d"  # type: ignore[attr-defined]
    if t == "END_TURN":
        return "END_TURN (passa)"
    return t


def state_brief(env: HexTacticsEnv) -> str:
    """Riassunto compatto dello stato corrente."""
    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    dist = base_distance(a.position, b.position)
    pa_str = ""
    if s.pending_action is not None:
        pa = s.pending_action
        atk = "(B atk)" if pa.attacker_id == b.id else "(A atk)"
        pa_str = (
            f" pending=[{atk} {pa.weapon_id}#{pa.attack_mode_idx} ranged={pa.is_ranged} "
            f"atk_dice={pa.attacker_dice}]"
        )
    return (
        f"R{s.round} ph={s.phase} | "
        f"A: HP {a.hp}/{a.hp_max} S={a.slancio} I={a.impeto} D={a.dadi_azione} "
        f"act_used={int(a.action_taken_this_turn)} | "
        f"B: HP {b.hp}/{b.hp_max} S={b.slancio} I={b.impeto} D={b.dadi_azione} | "
        f"dist={dist}{pa_str}"
    )


def get_q_values(model: DQN, obs: np.ndarray) -> np.ndarray:
    """Ritorna il vettore Q delle 20 azioni dato un obs."""
    obs_tensor = torch.as_tensor(obs, dtype=torch.float32).unsqueeze(0).to(model.device)
    with torch.no_grad():
        q = model.q_net(obs_tensor).cpu().numpy()[0]
    return q


def replay_game(env: HexTacticsEnv, model: DQN, seed: int, gid: int) -> dict:
    """Gioca 1 partita verbose."""
    obs, info = env.reset(seed=seed)
    print(f"\n{'='*78}")
    print(f"PARTITA #{gid} — seed {seed}")
    print(f"{'='*78}")

    step = 0
    one_handed_count = 0
    two_handed_count = 0

    while True:
        agent_id = env._agent_decision_unit_id(env._state)  # type: ignore[arg-type]
        if agent_id is None:
            # Non dovrebbe succedere ma fallback
            obs, _, terminated, truncated, info = env.step(0)
            if terminated or truncated:
                break
            continue

        moves = legal_moves(env._state, agent_id)  # type: ignore[arg-type]

        # Q-values
        q = get_q_values(model, obs)

        # Decisione (argmax)
        action_idx = int(np.argmax(q))

        # Print stato
        step += 1
        print(f"\n--- Step {step} | {state_brief(env)}")

        # Print legal moves con Q-value, ranked
        if moves:
            ranked = sorted(
                [(i, q[i], moves[i]) for i in range(len(moves))],
                key=lambda x: -x[1],
            )
            for i, (idx, qv, mv) in enumerate(ranked):
                marker = " ★ CHOSEN" if idx == action_idx else ""
                lab = event_label(mv)
                # Highlight 1-mano
                if mv.type == "DECLARE_ATTACK" and mv.weapon_id == "spada_lunga":  # type: ignore[attr-defined]
                    if mv.attack_mode_idx == 0:  # type: ignore[attr-defined]
                        lab = f"⚔️ 1-MANO  {lab}"
                        if idx == action_idx:
                            one_handed_count += 1
                    elif mv.attack_mode_idx == 1:  # type: ignore[attr-defined]
                        lab = f"🗡 2-MANI  {lab}"
                        if idx == action_idx:
                            two_handed_count += 1
                print(f"    [Q={qv:+8.3f}] {lab}{marker}")
            # Anche le azioni "fuori dalle legal moves" hanno Q-value, ma se action_idx >=
            # len(moves) significa che l'env le mappa a fallback END_TURN
            if action_idx >= len(moves):
                print(
                    f"    ⚠️ argmax={action_idx} fuori range legal moves "
                    f"({len(moves)}), env useà fallback END_TURN"
                )

        # Esegui
        obs, reward, terminated, truncated, info = env.step(action_idx)
        if terminated or truncated:
            break

    print(f"\n--- FINE PARTITA #{gid} ---")
    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    print(
        f"Winner: {s.winner}, rounds: {s.round}, HP A={a.hp}, HP B={b.hp}, "
        f"steps={step}"
    )
    print(
        f"Spada lunga 1-mano scelta: {one_handed_count}× | "
        f"2-mani scelta: {two_handed_count}×"
    )
    return {
        "winner": s.winner,
        "rounds": s.round,
        "hp_a": a.hp,
        "hp_b": b.hp,
        "steps": step,
        "one_handed": one_handed_count,
        "two_handed": two_handed_count,
    }


def main() -> None:
    print(f"[load] DQN best da {DQN_PATH}")
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=99)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = DQN.load(DQN_PATH, env=env, device=device)
    print(f"[device] {device}")

    summaries = []
    for i, seed in enumerate(SEEDS, 1):
        out = replay_game(env, model, seed, i)
        summaries.append(out)

    # Summary aggregato
    print(f"\n\n{'='*78}")
    print("SOMMARIO 3 PARTITE")
    print(f"{'='*78}")
    for i, s in enumerate(summaries, 1):
        print(
            f"  P{i}: winner={s['winner']}, rounds={s['rounds']}, "
            f"HP_A={s['hp_a']}, HP_B={s['hp_b']}, "
            f"1-mano={s['one_handed']}×, 2-mani={s['two_handed']}×"
        )


if __name__ == "__main__":
    main()

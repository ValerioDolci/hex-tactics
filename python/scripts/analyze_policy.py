"""
Analisi #1 — statistiche aggregate sulle scelte del DQN best.

Gira N partite (default 200) con DQN best vs Utility AI tank, registrando ogni
decisione del DQN. Poi:
  - aggrega le scelte per fase
  - calcola distribuzioni dadi/difese/movimenti
  - confronta con baseline Utility-vs-Utility (stesso matchup ma A=Utility)
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from stable_baselines3 import DQN

sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

from hex_tactics.ai.env import HexTacticsEnv  # noqa: E402
from hex_tactics.ai.legal_moves import legal_moves  # noqa: E402
from hex_tactics.ai.utility_ai import utility_decide_move  # noqa: E402
from hex_tactics.core.events import (  # noqa: E402
    EventChooseAttackerDice,
    EventChooseDefense,
    EventDeclareAttack,
    EventEndTurn,
    EventMove,
    EventReload,
    EventResolveCombat,
    EventStartRound,
    EventStartTurn,
    GameEvent,
)
from hex_tactics.core.hex import Offset, base_distance, offset_to_axial  # noqa: E402
from hex_tactics.core.reducer import reduce  # noqa: E402
from hex_tactics.core.state import Board, GameState, create_initial_state  # noqa: E402
from hex_tactics.data.presets import get_preset, unit_from_preset  # noqa: E402


N_PARTITE_DQN = 200
N_PARTITE_UTILITY = 200
DQN_PATH = "/tmp/hex_tactics_dqn_v2/best.zip"


def event_summary(ev: GameEvent, state: GameState) -> dict[str, Any]:
    """Riassume in dict semplice una scelta dell'agente."""
    out: dict[str, Any] = {"type": ev.type, "phase": state.phase, "round": state.round}
    if ev.type == "START_TURN":
        out["slancio_dice"] = ev.slancio_dice  # type: ignore[attr-defined]
        out["impeto_to_slancio"] = ev.impeto_to_slancio  # type: ignore[attr-defined]
    elif ev.type == "DECLARE_ATTACK":
        out["weapon_id"] = ev.weapon_id  # type: ignore[attr-defined]
        out["attack_mode_idx"] = ev.attack_mode_idx  # type: ignore[attr-defined]
        out["is_ranged"] = ev.is_ranged  # type: ignore[attr-defined]
        out["chosen_stat"] = ev.chosen_stat  # type: ignore[attr-defined]
    elif ev.type == "CHOOSE_ATTACKER_DICE":
        out["dice_n"] = ev.dice_n  # type: ignore[attr-defined]
    elif ev.type == "CHOOSE_DEFENSE":
        out["defense_type"] = ev.defense_type  # type: ignore[attr-defined]
        out["dice_n"] = ev.dice_n  # type: ignore[attr-defined]
        out["parry_with"] = ev.parry_with  # type: ignore[attr-defined]
    elif ev.type == "MOVE":
        out["move_target"] = (ev.target_hex.q, ev.target_hex.r)  # type: ignore[attr-defined]
    elif ev.type == "RELOAD":
        out["dice_n"] = ev.dice_n  # type: ignore[attr-defined]
    return out


def play_dqn_match(env: HexTacticsEnv, model: DQN, seed: int) -> tuple[list[dict], dict]:
    """Gioca 1 match DQN vs Utility, registra ogni decisione DQN."""
    obs, info = env.reset(seed=seed)
    decisions: list[dict] = []
    while True:
        # Capisci che decisione sta prendendo (per tracciare il summary in `event_summary`)
        agent_id = env._agent_decision_unit_id(env._state)  # type: ignore[arg-type]
        moves = legal_moves(env._state, agent_id) if agent_id else []  # type: ignore[arg-type]

        action, _ = model.predict(obs, deterministic=True)
        action_idx = int(action)

        # Registra l'evento corrispondente (per analisi)
        if 0 <= action_idx < len(moves):
            chosen_event = moves[action_idx]
            summary = event_summary(chosen_event, env._state)  # type: ignore[arg-type]
            summary["legal_moves_count"] = len(moves)
            decisions.append(summary)

        obs, reward, terminated, truncated, info = env.step(action_idx)
        if terminated or truncated:
            break

    return decisions, {
        "winner": info.get("winner"),
        "rounds": info.get("round", 0),
        "hp_a": env._state.units[env._info.a_unit_id].hp,  # type: ignore[arg-type]
        "hp_b": env._state.units[env._info.b_unit_id].hp,  # type: ignore[arg-type]
    }


def play_utility_match(seed: int) -> tuple[list[dict], dict]:
    """Gioca 1 match Utility-vs-Utility (A=Utility, B=Utility), registra decisioni di A."""
    A = unit_from_preset(get_preset("spadaccino"), "A", offset_to_axial(Offset(4, 8)))  # type: ignore[arg-type]
    B = unit_from_preset(get_preset("tank"), "B", offset_to_axial(Offset(18, 8)))  # type: ignore[arg-type]
    state = create_initial_state([A, B], Board(cols=24, rows=18), seed)
    state = reduce(state, EventStartRound())

    decisions_a: list[dict] = []
    safety = 0
    max_rounds = 30

    while state.phase != "game-over" and state.round <= max_rounds and safety < 5000:
        safety += 1
        # Resolving auto
        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            continue
        # Awaiting-defense → chi è target?
        if state.phase == "awaiting-defense":
            assert state.pending_action is not None
            target = state.units.get(state.pending_action.target_id)
            if target is None:
                break
            move = utility_decide_move(state, target.id)
            # Se A è target, registra
            if target.faction == "A":
                summary = event_summary(move, state)
                summary["legal_moves_count"] = len(legal_moves(state, target.id))
                decisions_a.append(summary)
            state = reduce(state, move)
            continue

        if state.phase in ("turn-start", "choosing-action", "declaring-attack"):
            cur_id = state.turn_order[state.current_turn_idx]
            cur = state.units.get(cur_id)
            if cur is None:
                break
            move = utility_decide_move(state, cur_id)
            if cur.faction == "A":
                summary = event_summary(move, state)
                summary["legal_moves_count"] = len(legal_moves(state, cur_id))
                decisions_a.append(summary)
            state = reduce(state, move)
            continue
        # END_TURN/END_ROUND fallback
        state = reduce(state, EventEndTurn())

    a_unit = next(u for u in state.units.values() if u.faction == "A")
    b_unit = next(u for u in state.units.values() if u.faction == "B")
    return decisions_a, {
        "winner": state.winner,
        "rounds": state.round,
        "hp_a": a_unit.hp,
        "hp_b": b_unit.hp,
    }


def aggregate_stats(decisions: list[list[dict]], outcomes: list[dict]) -> dict:
    """Aggrega decisioni di N partite in un dict di statistiche."""
    flat = [d for game in decisions for d in game]
    n_games = len(decisions)
    n_dec = len(flat)

    # Outcome
    winners = Counter(o["winner"] for o in outcomes)
    rounds_avg = float(np.mean([o["rounds"] for o in outcomes]))
    hp_a_final_avg = float(np.mean([o["hp_a"] for o in outcomes]))
    hp_b_final_avg = float(np.mean([o["hp_b"] for o in outcomes]))

    # Per fase
    by_phase = defaultdict(list)
    for d in flat:
        by_phase[d["phase"]].append(d)

    # Stats per fase
    phase_stats = {}
    for ph, items in by_phase.items():
        type_counter = Counter(d["type"] for d in items)
        phase_stats[ph] = {
            "n_decisions": len(items),
            "type_distribution": dict(type_counter),
        }

    # Slancio dice scelta in turn-start
    slancio_dist = Counter(
        (d.get("slancio_dice"), d.get("impeto_to_slancio", 0))
        for d in flat
        if d["type"] == "START_TURN"
    )

    # Attacker dice in declaring-attack
    atk_dice_dist = Counter(
        d.get("dice_n") for d in flat if d["type"] == "CHOOSE_ATTACKER_DICE"
    )

    # Difese in awaiting-defense
    defense_dist = Counter(
        (d.get("defense_type"), d.get("dice_n"), d.get("parry_with"))
        for d in flat
        if d["type"] == "CHOOSE_DEFENSE"
    )

    # Attack modes in declaring-attack (mode_idx + ranged/melee)
    attack_mode_dist = Counter(
        (d.get("weapon_id"), d.get("attack_mode_idx"), d.get("chosen_stat"), d.get("is_ranged"))
        for d in flat
        if d["type"] == "DECLARE_ATTACK"
    )

    # Movimenti
    move_count = sum(1 for d in flat if d["type"] == "MOVE")
    end_turn_count = sum(1 for d in flat if d["type"] == "END_TURN")

    return {
        "n_games": n_games,
        "n_decisions": n_dec,
        "outcomes": {
            "winners": dict(winners),
            "rounds_avg": rounds_avg,
            "hp_a_final_avg": hp_a_final_avg,
            "hp_b_final_avg": hp_b_final_avg,
        },
        "phase_stats": phase_stats,
        "slancio_choice": dict(slancio_dist),
        "attacker_dice": dict(atk_dice_dist),
        "defense_choice": dict(defense_dist),
        "attack_mode_choice": dict(attack_mode_dist),
        "move_count": move_count,
        "end_turn_count": end_turn_count,
    }


def fmt_phase_stats(name: str, stats: dict) -> str:
    out = [f"\n=== {name} ==="]
    out.append(f"Partite: {stats['n_games']}, decisioni totali: {stats['n_decisions']}")
    o = stats["outcomes"]
    out.append(
        f"Outcome: A win={o['winners'].get('A', 0)}, B win={o['winners'].get('B', 0)}, "
        f"draw={o['winners'].get('draw', 0)}, unfin={o['winners'].get(None, 0)}"
    )
    out.append(
        f"  rounds_avg={o['rounds_avg']:.1f}, hp_A_final={o['hp_a_final_avg']:.1f}, "
        f"hp_B_final={o['hp_b_final_avg']:.1f}"
    )

    out.append("\nDecisioni per fase:")
    for ph, ph_data in sorted(stats["phase_stats"].items()):
        types = ", ".join(f"{t}={n}" for t, n in sorted(ph_data["type_distribution"].items()))
        out.append(f"  {ph} ({ph_data['n_decisions']}): {types}")

    out.append("\nSlancio choice (slancio_dice, transfer):")
    for k, n in sorted(stats["slancio_choice"].items()):
        out.append(f"  {k}: {n}")

    out.append("\nAttacker dice scelta:")
    for k, n in sorted(stats["attacker_dice"].items()):
        out.append(f"  {k} dadi: {n}")

    out.append("\nDifese (defense_type, dice_n, parry_with):")
    for k, n in sorted(stats["defense_choice"].items(), key=lambda x: -x[1]):
        out.append(f"  {k}: {n}")

    out.append("\nAttack mode (weapon, mode_idx, stat, is_ranged):")
    for k, n in sorted(stats["attack_mode_choice"].items(), key=lambda x: -x[1]):
        out.append(f"  {k}: {n}")

    out.append(f"\nMovimenti: {stats['move_count']}")
    out.append(f"End turn (passa senza fare nulla): {stats['end_turn_count']}")
    return "\n".join(out)


def main() -> None:
    print(f"[load] DQN da {DQN_PATH}")
    env = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", max_rounds=30, seed=99)
    model = DQN.load(DQN_PATH, env=env, device="mps")

    # ── DQN partite ─────────────────────────────────────────────────────
    print(f"[run] DQN: {N_PARTITE_DQN} partite vs Utility tank")
    dqn_decisions: list[list[dict]] = []
    dqn_outcomes: list[dict] = []
    for ep in range(N_PARTITE_DQN):
        decs, out = play_dqn_match(env, model, seed=200_000 + ep)
        dqn_decisions.append(decs)
        dqn_outcomes.append(out)
        if (ep + 1) % 50 == 0:
            print(f"  [DQN] {ep+1}/{N_PARTITE_DQN}")
    dqn_stats = aggregate_stats(dqn_decisions, dqn_outcomes)

    # ── Utility partite ─────────────────────────────────────────────────
    print(f"[run] Utility-vs-Utility: {N_PARTITE_UTILITY} partite (per baseline)")
    util_decisions: list[list[dict]] = []
    util_outcomes: list[dict] = []
    for ep in range(N_PARTITE_UTILITY):
        decs, out = play_utility_match(seed=300_000 + ep)
        util_decisions.append(decs)
        util_outcomes.append(out)
        if (ep + 1) % 50 == 0:
            print(f"  [UTIL] {ep+1}/{N_PARTITE_UTILITY}")
    util_stats = aggregate_stats(util_decisions, util_outcomes)

    # ── Output ──────────────────────────────────────────────────────────
    print(fmt_phase_stats("DQN best (spadaccino) vs Utility (tank)", dqn_stats))
    print(fmt_phase_stats("Utility (spadaccino) vs Utility (tank)", util_stats))

    # Save
    out_dir = Path("/tmp/hex_tactics_dqn_v2")
    import json
    with (out_dir / "policy_analysis.json").open("w") as f:
        json.dump({"dqn": dqn_stats, "utility": util_stats}, f, indent=2, default=str)
    print(f"\n[save] /tmp/hex_tactics_dqn_v2/policy_analysis.json")


if __name__ == "__main__":
    main()

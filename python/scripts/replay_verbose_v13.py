"""Replay verbose v13 in 5 condizioni diverse."""
import sys
sys.path.insert(0, '/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python')

# D3 tweak
from hex_tactics.data import armors as _armors_module
from hex_tactics.entities.equipment import Armor as _Armor
_armors_module.ARMORS["armatura_pesante"] = _Armor(
    id="armatura_pesante", name="Armatura pesante", category="armature",
    damage_reduction=12, impediment=9,
)

from hex_tactics.ai.env import HexTacticsEnv
from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.core.events import GameEvent
from hex_tactics.core.hex import base_distance
from sb3_contrib import MaskablePPO
import torch

device = "mps" if torch.backends.mps.is_available() else "cpu"


def event_short(ev):
    t = ev.type
    if t == "START_TURN":
        return f"slancio={ev.slancio_dice}d t+{ev.impeto_to_slancio}"
    if t == "DECLARE_ATTACK":
        rng = "RNG" if ev.is_ranged else "MEL"
        return f"ATK[{rng}] {ev.weapon_id}#{ev.attack_mode_idx}"
    if t == "CHOOSE_ATTACKER_DICE":
        return f"atk_dice={ev.dice_n}d"
    if t == "CHOOSE_DEFENSE":
        return f"DEF {ev.defense_type} {ev.dice_n}d ({ev.parry_with})"
    if t == "MOVE":
        return f"MOVE→({ev.target_hex.q},{ev.target_hex.r})"
    if t == "BID_MOVEMENT":
        return f"BID amount={ev.amount}"
    if t == "RELOAD":
        return f"RELOAD {ev.dice_n}d"
    if t == "END_TURN":
        return "END"
    return t


def state_brief(env):
    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    dist = base_distance(a.position, b.position)
    pa_str = ""
    if s.move_in_progress:
        mip = s.move_in_progress
        pa_str = f" mip(idx={mip.current_idx}/{len(mip.path)})"
    return (f"R{s.round} ph={s.phase} dist={dist}{pa_str} | "
            f"A: HP{a.hp}/20 S{a.slancio} I{a.impeto} D{a.dadi_azione} | "
            f"B: HP{b.hp}/20 S{b.slancio} I{b.impeto} D{b.dadi_azione}")


def replay_match(model, preset_a, preset_b, seed, label):
    env = HexTacticsEnv(preset_a=preset_a, preset_b=preset_b, max_rounds=30, seed=seed, obs_version="v2")
    obs, info = env.reset(seed=seed)
    print(f"\n{'='*78}")
    print(f"{label} — seed {seed} — A={preset_a} vs B={preset_b}")
    print(f"{'='*78}")
    a = env._state.units[env._info.a_unit_id]
    b = env._state.units[env._info.b_unit_id]
    print(f"INIT: dist={base_distance(a.position, b.position)}, A weapon={a.weapon}, B weapon={b.weapon}")

    step = 0
    n_bids = 0
    while True:
        step += 1
        agent_id = env._agent_decision_unit_id(env._state)
        if agent_id is None:
            obs, _, term, trunc, info = env.step(0)
            if term or trunc: break
            continue
        masks = env.action_masks()
        action, _ = model.predict(obs, action_masks=masks, deterministic=True)
        action_idx = int(action)
        moves = legal_moves(env._state, agent_id)

        ph = env._state.phase
        if ph in ("turn-start", "declaring-attack", "awaiting-defense", "awaiting-attacker-bid", "awaiting-defender-bid"):
            chosen = moves[action_idx] if 0 <= action_idx < len(moves) else None
            if chosen:
                print(f"  [{step}] {state_brief(env)}")
                print(f"      -> {event_short(chosen)}")
                if ph in ("awaiting-attacker-bid", "awaiting-defender-bid"):
                    n_bids += 1

        obs, _, term, trunc, info = env.step(action_idx)
        if term or trunc: break

    s = env._state
    a = s.units[env._info.a_unit_id]
    b = s.units[env._info.b_unit_id]
    print(f"\n  RESULT: winner={s.winner} R{s.round} steps={step} bids={n_bids}")
    print(f"  HP_A={a.hp}/20, HP_B={b.hp}/20")
    return {'winner': s.winner, 'rounds': s.round, 'bids': n_bids, 'hp_a': a.hp, 'hp_b': b.hp}


def main():
    env_dummy = HexTacticsEnv(preset_a="spadaccino", preset_b="tank", obs_version="v2")
    model = MaskablePPO.load("/tmp/hex_tactics_ppo_v13/best.zip", env=env_dummy, device=device)
    print(f"[load] v13 MaskablePPO")

    scenarios = [
        ("Tank vs Arciere (matchup difficile)", "tank", "arciere", 700_001),
        ("Spadaccino vs Tank (regolare)", "spadaccino", "tank", 700_002),
        ("Arciere vs Arciere (specchio)", "arciere", "arciere", 700_003),
        ("Spadaccino vs Spadaccino (specchio mischia + reach 2)", "spadaccino", "spadaccino", 700_004),
        ("Tank vs Spadaccino (vs reach 2)", "tank", "spadaccino", 700_005),
    ]

    summaries = []
    for label, pa, pb, seed in scenarios:
        s = replay_match(model, pa, pb, seed, label)
        summaries.append((label, s))

    print(f"\n\n{'='*78}\nSOMMARIO 5 PARTITE v13\n{'='*78}")
    for lbl, s in summaries:
        print(f"  {lbl:<55s}: winner={s['winner']:>5s} R{s['rounds']:>2d} bids={s['bids']:>2d} HP_A={s['hp_a']:>2d}/{s['hp_b']:<2d}")


if __name__ == "__main__":
    main()

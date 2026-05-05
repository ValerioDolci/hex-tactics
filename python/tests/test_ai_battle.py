"""
Test parità AI + battaglie end-to-end TS↔Py (P9 + P8).

Carica `tests/fixtures/ai_battle_golden.json` (dump TS) e verifica:
  - ai_decisions: 5 scenari isolati di decisione AI
  - battles: 30 battaglie complete (matchup × seed) → winner, rounds, HP finali, RNG state finale
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hex_tactics.ai.basic_ai import (
    ai_decide_action,
    ai_decide_attacker_dice,
    ai_decide_defense,
    ai_decide_slancio,
)
from hex_tactics.core.events import (
    EventChooseAttackerDice,
    EventChooseDefense,
    EventEndTurn,
    EventResolveCombat,
    EventStartRound,
    EventStartTurn,
)
from hex_tactics.core.hex import Offset, offset_to_axial
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, GameState, create_initial_state
from hex_tactics.data.presets import get_preset, unit_from_preset


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "ai_battle_golden.json"


def _load() -> dict:
    if not FIXTURE_PATH.exists():
        pytest.skip(
            "fixture mancante. Rigenerare con:\n"
            "  DUMP_AI_BATTLE_GOLDEN=1 npx vitest run tests/sim/dump_ai_battle_golden.test.ts"
        )
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def _run_battle(preset_a: str, preset_b: str, seed: int, max_rounds: int = 30) -> dict:
    """Replica del runBattle TS in Py."""
    A = unit_from_preset(get_preset(preset_a), "A", offset_to_axial(Offset(4, 8)))  # type: ignore[arg-type]
    B = unit_from_preset(get_preset(preset_b), "B", offset_to_axial(Offset(18, 8)))  # type: ignore[arg-type]
    state = create_initial_state([A, B], Board(cols=24, rows=18), seed)

    events_count = 0
    safety = 0
    state = reduce(state, EventStartRound())
    events_count += 1

    while state.phase != "game-over" and state.round <= max_rounds and safety < 5000:
        safety += 1
        current_unit_id = state.turn_order[state.current_turn_idx]

        if state.phase == "turn-start":
            slancio_dice = ai_decide_slancio(state, current_unit_id)
            state = reduce(state, EventStartTurn(slancio_dice=slancio_dice))
            events_count += 1
            continue

        if state.phase == "choosing-action":
            action = ai_decide_action(state, current_unit_id)
            state = reduce(state, action)
            events_count += 1
            continue

        if state.phase == "declaring-attack":
            dice = ai_decide_attacker_dice(state, current_unit_id)
            state = reduce(state, EventChooseAttackerDice(dice_n=dice))
            events_count += 1
            continue

        if state.phase == "awaiting-defense":
            assert state.pending_action is not None
            def_id = state.pending_action.target_id
            d = ai_decide_defense(state, def_id)
            state = reduce(
                state,
                EventChooseDefense(
                    defense_type=d["defenseType"],
                    dice_n=d["diceN"],
                    parry_with=d.get("parryWith"),
                ),
            )
            events_count += 1
            continue

        if state.phase == "resolving":
            state = reduce(state, EventResolveCombat())
            events_count += 1
            continue

        # Fallback safety
        state = reduce(state, EventEndTurn())
        events_count += 1

    a_unit = next(u for u in state.units.values() if u.faction == "A")
    b_unit = next(u for u in state.units.values() if u.faction == "B")

    return {
        "matchup": {"a": preset_a, "b": preset_b},
        "seed": seed,
        "winner": state.winner,
        "rounds": state.round,
        "hpA": a_unit.hp,
        "hpB": b_unit.hp,
        "events": events_count,
        "finalState": {
            "phase": state.phase,
            "currentTurnIdx": state.current_turn_idx,
            "rngSeed": state.rng_seed,
            "logSize": len(state.log),
            "units": {
                uid: {
                    "hp": u.hp,
                    "slancio": u.slancio,
                    "impeto": u.impeto,
                    "dadiAzione": u.dadi_azione,
                    "alive": u.alive,
                }
                for uid, u in state.units.items()
            },
        },
    }


# ---------------------------------------------------------------------------
# AI decisions
# ---------------------------------------------------------------------------


def _setup_state_arc_vs_tank(seed: int = 31337) -> tuple[GameState, GameState]:
    A_arc = unit_from_preset(get_preset("arciere"), "A", offset_to_axial(Offset(4, 4)))  # type: ignore[arg-type]
    B_tank = unit_from_preset(get_preset("tank"), "B", offset_to_axial(Offset(7, 4)))  # type: ignore[arg-type]
    state = create_initial_state([A_arc, B_tank], Board(cols=24, rows=18), seed)
    state_after_round = reduce(state, EventStartRound())
    state_turn_start = reduce(state_after_round, EventStartTurn(slancio_dice=2))
    return state_after_round, state_turn_start


def _setup_state_spadaccino_vs_spadaccino(seed: int = 31338) -> GameState:
    sa = unit_from_preset(get_preset("spadaccino"), "A", offset_to_axial(Offset(4, 4)))  # type: ignore[arg-type]
    sb = unit_from_preset(get_preset("spadaccino"), "B", offset_to_axial(Offset(5, 4)))  # type: ignore[arg-type]
    state = create_initial_state([sa, sb], Board(cols=24, rows=18), seed)
    from hex_tactics.core.events import EventDeclareAttack

    state = reduce(state, EventStartRound())
    state = reduce(state, EventStartTurn(slancio_dice=0))
    state = reduce(
        state,
        EventDeclareAttack(
            attacker_id=state.turn_order[0],
            target_id=state.turn_order[1],
            weapon_id="spada_lunga",
            attack_mode_idx=1,
            is_ranged=False,
        ),
    )
    state = reduce(state, EventChooseAttackerDice(dice_n=2))
    return state


class TestAiDecisions:
    @pytest.mark.skip(
        reason="Golden TS↔Py divergente dopo balance ranged 2026-05-04 "
        "(basic_ai ora supporta reload_cost_slancio path; TS engine non aggiornato). "
        "Da rigenerare fixture quando TS sincronizzato."
    )
    def test_decisions_match_ts(self) -> None:
        data = _load()
        s_after_round, s_turn_start = _setup_state_arc_vs_tank()
        s_mischia = _setup_state_spadaccino_vs_spadaccino()

        for ds in data["ai_decisions"]:
            label = ds["label"]
            if label == "arciere-vs-tank-decideSlancio":
                got = ai_decide_slancio(s_after_round, s_after_round.turn_order[0])
                assert got == ds["output"], f"{label}: TS={ds['output']} Py={got}"
            elif label == "arciere-vs-tank-decideAction":
                got = ai_decide_action(s_turn_start, s_turn_start.turn_order[0])
                # Confronto field-by-field con il dict TS
                ts = ds["output"]
                assert got.type == ts["type"], label
                if got.type == "DECLARE_ATTACK":
                    assert got.attacker_id == ts["attackerId"], label  # type: ignore[attr-defined]
                    assert got.target_id == ts["targetId"], label  # type: ignore[attr-defined]
                    assert got.weapon_id == ts["weaponId"], label  # type: ignore[attr-defined]
                    assert got.attack_mode_idx == ts["attackModeIdx"], label  # type: ignore[attr-defined]
                    assert got.is_ranged == ts.get("isRanged", False), label  # type: ignore[attr-defined]
                    assert got.chosen_stat == ts.get("chosenStat"), label  # type: ignore[attr-defined]
                elif got.type == "MOVE":
                    assert got.unit_id == ts["unitId"], label  # type: ignore[attr-defined]
                    assert got.target_hex.q == ts["targetHex"]["q"], label  # type: ignore[attr-defined]
                    assert got.target_hex.r == ts["targetHex"]["r"], label  # type: ignore[attr-defined]
                elif got.type == "RELOAD":
                    assert got.unit_id == ts["unitId"], label  # type: ignore[attr-defined]
                    assert got.dice_n == ts["diceN"], label  # type: ignore[attr-defined]
                # END_TURN: no payload
            elif label == "arciere-vs-tank-decideAttackerDice":
                got = ai_decide_attacker_dice(s_turn_start, s_turn_start.turn_order[0])
                assert got == ds["output"], label
            elif label == "arciere-vs-tank-decideDefense-no-pendingAction":
                got = ai_decide_defense(s_turn_start, s_turn_start.turn_order[1])
                ts = ds["output"]
                assert got["defenseType"] == ts["defenseType"], label
                assert got["diceN"] == ts["diceN"], label
                # parryWith potrebbe essere undefined (TS) → None (Py)
                assert got.get("parryWith") == ts.get("parryWith"), label
            elif label == "spadaccino-vs-spadaccino-decideDefense-pa-2D6":
                got = ai_decide_defense(s_mischia, s_mischia.turn_order[1])
                ts = ds["output"]
                assert got["defenseType"] == ts["defenseType"], label
                assert got["diceN"] == ts["diceN"], label
                assert got.get("parryWith") == ts.get("parryWith"), label
            else:
                raise AssertionError(f"Decision label sconosciuto: {label}")


# ---------------------------------------------------------------------------
# Full battles end-to-end
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Meccanica A (asta movimento) divergenza voluta da TS")
class TestFullBattles:
    def test_all_30_battles_match(self) -> None:
        data = _load()
        for ts_battle in data["battles"]:
            preset_a = ts_battle["matchup"]["a"]
            preset_b = ts_battle["matchup"]["b"]
            seed = ts_battle["seed"]
            py_battle = _run_battle(preset_a, preset_b, seed)

            tag = f"[{preset_a} vs {preset_b}, seed={seed}]"
            assert py_battle["winner"] == ts_battle["winner"], (
                f"{tag} winner: TS={ts_battle['winner']} Py={py_battle['winner']}"
            )
            assert py_battle["rounds"] == ts_battle["rounds"], (
                f"{tag} rounds: TS={ts_battle['rounds']} Py={py_battle['rounds']}"
            )
            assert py_battle["hpA"] == ts_battle["hpA"], (
                f"{tag} HPA: TS={ts_battle['hpA']} Py={py_battle['hpA']}"
            )
            assert py_battle["hpB"] == ts_battle["hpB"], (
                f"{tag} HPB: TS={ts_battle['hpB']} Py={py_battle['hpB']}"
            )
            assert py_battle["events"] == ts_battle["events"], (
                f"{tag} events count: TS={ts_battle['events']} Py={py_battle['events']}"
            )
            # final RNG state mod 2^32
            ts_seed = ts_battle["finalState"]["rngSeed"] & 0xFFFFFFFF
            py_seed = py_battle["finalState"]["rngSeed"] & 0xFFFFFFFF
            assert py_seed == ts_seed, (
                f"{tag} final RNG state diverge mod 2^32: TS={ts_seed} Py={py_seed}"
            )
            # Final units
            for uid, ts_u in ts_battle["finalState"]["units"].items():
                py_u = py_battle["finalState"]["units"][uid]
                assert py_u == ts_u, f"{tag} final unit {uid}: TS={ts_u} Py={py_u}"

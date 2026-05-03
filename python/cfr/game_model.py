"""
HexTacticsGameModel — wrapper hex-tactics → interfaccia CFR-compatible.

Espone l'API standard per Deep CFR:
  - reset() → state
  - step(state, action) → (next_state, reward, done, info)
  - current_player(state) → 0 (A) / 1 (B) / -1 (chance)
  - legal_actions(state) → List[int] (indici nelle azioni legali)
  - is_terminal(state) → bool
  - terminal_reward(state, player) → float in [-1,+1]
  - info_set_key(state, player) → hashable
  - obs_features(state, player) → np.ndarray (per neural net)

Le scelte simultanee (asta, atk/def dadi) sono modellate come SEQUENTIAL
con info-set masking: il primo a giocare scrive la sua scelta privatamente,
il secondo decide SENZA conoscere quella del primo. Convenzione standard
nei game theory frameworks (Kuhn, OpenSpiel).

Lo stato include un campo "private_log" che separa ciò che ogni player
sa dello state. info_set_key usa SOLO la info pubblica + propria privata.
"""
from __future__ import annotations

import os
import random
import sys
from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # python/
sys.path.insert(0, ROOT)

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features_v2 import build_obs_v2
from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
from hex_tactics.core.events import (
    EventEndTurn, EventResolveCombat, EventStartRound, GameEvent,
)
from hex_tactics.core.hex import offset_to_axial, Offset
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state, GameState

PLAYER_A = 0
PLAYER_B = 1
PLAYER_CHANCE = -1
MAX_ACTIONS = 24  # cap per action space (legalMoves Python ≤ 24)


@dataclass
class CFRState:
    """Wrapper attorno a GameState con info aggiuntive per CFR."""
    game_state: GameState
    a_unit_id: str
    b_unit_id: str
    rng_seed: int  # per chance node sampling

    @property
    def phase(self) -> str:
        return self.game_state.phase

    def current_player(self) -> int:
        """Restituisce 0 (A) / 1 (B) / -1 (chance/no-decision)."""
        gs = self.game_state
        if gs.phase == "game-over":
            return -1  # terminal
        if gs.phase == "resolving":
            return PLAYER_CHANCE  # auto-resolve, deterministic but treat as chance
        # awaiting-defense
        if gs.phase == "awaiting-defense" and gs.pending_action is not None:
            target = gs.units.get(gs.pending_action.target_id)
            if target is None:
                return -1
            return PLAYER_A if target.faction == "A" else PLAYER_B
        # awaiting-attacker-bid / awaiting-defender-bid (asta)
        if gs.phase == "awaiting-attacker-bid" and gs.move_in_progress is not None:
            mover = gs.units.get(gs.move_in_progress.unit_id)
            if mover is None:
                return -1
            return PLAYER_A if mover.faction == "A" else PLAYER_B
        if gs.phase == "awaiting-defender-bid" and gs.move_in_progress is not None:
            defender_id = gs.move_in_progress.defender_id
            if defender_id is None:
                return -1
            defender = gs.units.get(defender_id)
            return PLAYER_A if defender.faction == "A" else PLAYER_B
        # turn-start, choosing-action, declaring-attack, awaiting-carica
        if gs.phase in ("turn-start", "choosing-action", "declaring-attack", "awaiting-carica"):
            if not gs.turn_order:
                return -1
            cur_id = gs.turn_order[gs.current_turn_idx]
            cur = gs.units.get(cur_id)
            if cur is None:
                return -1
            return PLAYER_A if cur.faction == "A" else PLAYER_B
        return -1


class HexTacticsGameModel:
    """Modello CFR-compatible di hex-tactics."""

    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)
        self.max_steps = 400

    def reset(self, preset_a: str = "random_pg", preset_b: str = "random_pg",
              seed: Optional[int] = None) -> CFRState:
        """Inizializza una nuova partita. preset_X può essere id specifico
        o 'random_pg'. Restituisce stato iniziale post-START_ROUND."""
        if seed is None:
            seed = self.rng.randrange(2**31)
        local_rng = random.Random(seed)
        # Build A
        if preset_a == "random_pg":
            build_a = generate_random_pg(local_rng, seed=local_rng.randrange(2**31))
            A = unit_from_random_pg(build_a, "A", offset_to_axial(Offset(4, 8)))
        else:
            from hex_tactics.data.presets import unit_from_preset, get_preset
            A = unit_from_preset(get_preset(preset_a), "A", offset_to_axial(Offset(4, 8)))
        # Build B
        if preset_b == "random_pg":
            build_b = generate_random_pg(local_rng, seed=local_rng.randrange(2**31))
            B = unit_from_random_pg(build_b, "B", offset_to_axial(Offset(18, 8)))
        else:
            from hex_tactics.data.presets import unit_from_preset, get_preset
            B = unit_from_preset(get_preset(preset_b), "B", offset_to_axial(Offset(18, 8)))
        game_seed = local_rng.randrange(2**31)
        gs = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
        gs = reduce(gs, EventStartRound())
        return CFRState(game_state=gs, a_unit_id=A.id, b_unit_id=B.id, rng_seed=game_seed)

    def is_terminal(self, state: CFRState) -> bool:
        return state.game_state.phase == "game-over" or state.game_state.round > 30

    def terminal_reward(self, state: CFRState, player: int) -> float:
        """Reward in [-1, +1] per il player."""
        if not self.is_terminal(state):
            return 0.0
        winner = state.game_state.winner
        if winner is None:
            return 0.0  # tie / max rounds
        a_won = winner == "A"
        if player == PLAYER_A:
            return +1.0 if a_won else -1.0
        return -1.0 if a_won else +1.0

    def legal_actions(self, state: CFRState) -> List[int]:
        """Lista di indici nelle azioni legali (per policy net masking)."""
        cur = state.current_player()
        if cur == -1:
            return [0]  # forced no-op (resolve/game-over)
        if cur == PLAYER_CHANCE:
            return [0]  # chance node: 1 azione "auto-resolve"
        # decisione di un player
        gs = state.game_state
        unit_id = state.a_unit_id if cur == PLAYER_A else state.b_unit_id
        # Per fasi multi-player (defense/bid), legal_moves usa unit specifica
        if gs.phase == "awaiting-defense" and gs.pending_action is not None:
            unit_id = gs.pending_action.target_id
        elif gs.phase == "awaiting-attacker-bid" and gs.move_in_progress is not None:
            unit_id = gs.move_in_progress.unit_id
        elif gs.phase == "awaiting-defender-bid" and gs.move_in_progress is not None:
            unit_id = gs.move_in_progress.defender_id or unit_id
        moves = legal_moves(gs, unit_id)
        n = min(len(moves), MAX_ACTIONS)
        return list(range(n))

    def get_legal_events(self, state: CFRState) -> List[GameEvent]:
        """Per dispatch interno: lista GameEvent nello stesso ordine di legal_actions."""
        cur = state.current_player()
        if cur in (-1, PLAYER_CHANCE):
            return []
        gs = state.game_state
        unit_id = state.a_unit_id if cur == PLAYER_A else state.b_unit_id
        if gs.phase == "awaiting-defense" and gs.pending_action is not None:
            unit_id = gs.pending_action.target_id
        elif gs.phase == "awaiting-attacker-bid" and gs.move_in_progress is not None:
            unit_id = gs.move_in_progress.unit_id
        elif gs.phase == "awaiting-defender-bid" and gs.move_in_progress is not None:
            unit_id = gs.move_in_progress.defender_id or unit_id
        moves = legal_moves(gs, unit_id)
        return moves[:MAX_ACTIONS]

    def step(self, state: CFRState, action_idx: int) -> CFRState:
        """Applica l'azione specificata e auto-avanza fasi non-decisionali."""
        cur = state.current_player()
        if self.is_terminal(state):
            return state

        if cur == PLAYER_CHANCE:
            # Auto-resolve
            new_gs = reduce(state.game_state, EventResolveCombat())
            return CFRState(game_state=new_gs, a_unit_id=state.a_unit_id,
                           b_unit_id=state.b_unit_id, rng_seed=state.rng_seed)

        if cur == -1:
            # Stato sconosciuto: termina
            return state

        events = self.get_legal_events(state)
        if action_idx >= len(events) or not events:
            # Fallback: END_TURN se possibile
            ev = next((e for e in events if e.type == "END_TURN"), None)
            if ev is None:
                return state
            new_gs = reduce(state.game_state, ev)
        else:
            ev = events[action_idx]
            new_gs = reduce(state.game_state, ev)
        return CFRState(game_state=new_gs, a_unit_id=state.a_unit_id,
                        b_unit_id=state.b_unit_id, rng_seed=state.rng_seed)

    def info_set_key(self, state: CFRState, player: int) -> str:
        """Identificatore hashable per l'info-set di `player`.

        IMPORTANTE: deve includere SOLO le informazioni che `player` può vedere.
        Nel nostro gioco, le simultaneous private moves sono già modellate come
        sequential (uno gioca, l'altro NON sa che ha già giocato — ma noi lo
        sappiamo nel state). Per CFR corretto, l'info-set NON deve distinguere
        gli stati che il player non sa distinguere.

        Per ora, semplificazione: usiamo lo stato pubblico + faction-specific obs.
        Per simultaneous, due stati (player1 ha giocato bid_X) e (player1 ha giocato bid_Y)
        sono indistinguibili per player2 → DOVREBBERO avere lo stesso info-set.
        Limitazione attuale: non gestiamo questa indistinguibilità (treat as sequential
        with private knowledge). È un'approssimazione comune (ed è quanto fa OpenSpiel
        di default). Per la nostra Deep CFR scratch va bene per ora.
        """
        gs = state.game_state
        unit_id = state.a_unit_id if player == PLAYER_A else state.b_unit_id
        my_unit = gs.units.get(unit_id)
        if my_unit is None:
            return "terminal"
        op_id = state.b_unit_id if player == PLAYER_A else state.a_unit_id
        op = gs.units.get(op_id)
        # Key: posizione mia + opponent + HP / slancio / impeto + phase + round + dadiAzione
        # NB: pendingAction e moveInProgress aggiungono contesto
        key_parts = [
            f"r{gs.round}p{gs.phase}",
            f"M:{my_unit.position.q},{my_unit.position.r}|hp{my_unit.hp}|sl{my_unit.slancio}|imp{my_unit.impeto}|d{my_unit.dadi_azione}|stance{int(my_unit.defensive_stance)}",
            f"O:{op.position.q},{op.position.r}|hp{op.hp}|sl{op.slancio}|imp{op.impeto}|d{op.dadi_azione}|stance{int(op.defensive_stance)}",
            f"w{my_unit.weapon}|of{my_unit.offhand}|ar{my_unit.armor}",
            f"Ow{op.weapon}|Oof{op.offhand}|Oar{op.armor}",
        ]
        if gs.pending_action is not None:
            pa = gs.pending_action
            key_parts.append(f"pa:atk{pa.attacker_id}|t{pa.target_id}|w{pa.weapon_id}|r{int(pa.is_ranged)}")
        if gs.move_in_progress is not None:
            mip = gs.move_in_progress
            key_parts.append(f"mip:u{mip.unit_id}|d{mip.defender_id}")
        return "|".join(key_parts)

    def obs_features(self, state: CFRState, player: int) -> np.ndarray:
        """Vector di feature per neural net. Riusa build_obs_v2 dell'env esistente."""
        unit_id = state.a_unit_id if player == PLAYER_A else state.b_unit_id
        try:
            obs = build_obs_v2(
                state=state.game_state,
                agent_faction="A" if player == PLAYER_A else "B",
                agent_unit_id=unit_id,
                enforce_simultaneous_privacy=True,
            )
            return obs.astype(np.float32)
        except Exception:
            # Fallback: zeros
            return np.zeros(153, dtype=np.float32)


# Smoke test
if __name__ == "__main__":
    model = HexTacticsGameModel(seed=42)
    state = model.reset(preset_a="spadaccino", preset_b="tank")
    print(f"Initial state: phase={state.phase}, current_player={state.current_player()}")
    print(f"Legal actions: {model.legal_actions(state)}")
    print(f"Info-set A: {model.info_set_key(state, PLAYER_A)[:120]}...")
    print(f"Obs shape: {model.obs_features(state, PLAYER_A).shape}")
    # Step manuale di 5 azioni random
    for i in range(5):
        if model.is_terminal(state):
            print(f"  Terminal, reward A = {model.terminal_reward(state, 0)}")
            break
        actions = model.legal_actions(state)
        a = random.choice(actions)
        cur = state.current_player()
        print(f"  Step {i}: phase={state.phase} player={cur} action={a}/{len(actions)-1}")
        state = model.step(state, a)
    print(f"\nFinal: phase={state.phase} round={state.game_state.round}")

"""
HexTacticsEnv — wrapper Gymnasium per training RL (versione human-fair).

Design "human-fair":
  L'agente vede esattamente quello che vede un umano in hot-seat:
    - Stato proprio completo + skills dettagliate
    - Stato nemico osservabile (HP, F/A/V, impeto, slancio, dadi, equip)
    - Skills nemiche NASCOSTE
    - Storia ultime 10 azioni proprie + 10 nemiche (dadi post-rivelazione)
    - Censura `pa.attacker_dice` se l'agente è il difensore in awaiting-defense

Vedi `obs_features.build_obs` per il layout esatto del vettore observation
(486 feature totali).

Setup:
  - Agent: faction A (controllata da NN policy)
  - Avversario: faction B controllata da Utility AI (DEFAULT_WEIGHTS)
  - 1v1 battaglia su mappa 24x18
  - Preset configurabile

Action space:
  Discrete(MAX_ACTIONS = 20). Action k → legal_moves(state, agent_id)[k].
  Se k >= len(legal_moves) → fallback a END_TURN + penalty.

Reward (per step):
  - +danni inflitti
  - -danni subiti
  - -0.5 azione illegale
  Bonus terminale:
  - +10 vittoria, -10 sconfitta, 0 draw
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, List, Literal, Optional

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features import (
    HISTORY_LEN,
    HistoryEntry,
    N_FEATURES_TOTAL,
    build_obs,
)
from hex_tactics.ai.utility_ai import utility_decide_move
from hex_tactics.core.events import (
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
from hex_tactics.core.hex import Offset, base_distance, offset_to_axial
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, GameState, create_initial_state, PendingAction
from hex_tactics.data.presets import get_preset, unit_from_preset


MAX_ACTIONS = 20
N_FEATURES = N_FEATURES_TOTAL  # 486 (vedi obs_features.py)


@dataclass
class EpisodeInfo:
    rounds: int = 0
    illegal_actions: int = 0
    a_unit_id: str = ""
    b_unit_id: str = ""
    history_a: List[HistoryEntry] = field(default_factory=list)
    history_b: List[HistoryEntry] = field(default_factory=list)


class HexTacticsEnv(gym.Env):
    """1v1 con A (RL agent) vs B (Utility AI baseline). Obs human-fair."""

    metadata = {"render_modes": []}

    PRESET_POOL = ("spadaccino", "arciere", "tank")

    def __init__(
        self,
        preset_a: str = "spadaccino",
        preset_b: str = "tank",
        max_rounds: int = 30,
        seed: Optional[int] = None,
        obs_version: str = "v1",
    ):
        """preset_a/preset_b possono essere:
          - id specifico ("spadaccino"/"arciere"/"tank")
          - "random" → estratto uniforme da PRESET_POOL ad ogni reset

        obs_version:
          - "v1" (default): 486 feat, design originale human-fair
          - "v2": 134 feat, pruned dopo feature importance analysis
        """
        super().__init__()
        self.preset_a = preset_a
        self.preset_b = preset_b
        self.max_rounds = max_rounds
        self.obs_version = obs_version

        # Determina N_FEATURES in base alla versione
        if obs_version == "v2":
            from hex_tactics.ai.obs_features_v2 import N_FEATURES_TOTAL_V2
            self._n_features = N_FEATURES_TOTAL_V2
        else:
            self._n_features = N_FEATURES

        self.action_space = spaces.Discrete(MAX_ACTIONS)
        self.observation_space = spaces.Box(
            low=-10.0, high=30.0, shape=(self._n_features,), dtype=np.float32
        )

        self._state: Optional[GameState] = None
        self._info: EpisodeInfo = EpisodeInfo()
        self._rng = random.Random(seed)
        # Tracking del matchup corrente (per logging/eval)
        self._current_preset_a: str = ""
        self._current_preset_b: str = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(
        self, *, seed: Optional[int] = None, options: Optional[dict] = None
    ) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        if seed is not None:
            self._rng = random.Random(seed)
        game_seed = self._rng.randrange(0, 2**31)

        # options può forzare matchup specifico (utile per eval per-matchup)
        force_a = (options or {}).get("preset_a")
        force_b = (options or {}).get("preset_b")
        chosen_a = force_a if force_a is not None else self._resolve_preset(self.preset_a)
        chosen_b = force_b if force_b is not None else self._resolve_preset(self.preset_b)
        self._current_preset_a = chosen_a
        self._current_preset_b = chosen_b

        # Build unit A
        if chosen_a == "random_pg":
            from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
            build_a = generate_random_pg(self._rng, seed=self._rng.randrange(2**31))
            A = unit_from_random_pg(build_a, "A", offset_to_axial(Offset(4, 8)))
        else:
            A = unit_from_preset(
                get_preset(chosen_a),  # type: ignore[arg-type]
                "A",
                offset_to_axial(Offset(4, 8)),
            )
        # Build unit B
        if chosen_b == "random_pg":
            from hex_tactics.ai.random_pg import generate_random_pg, unit_from_random_pg
            build_b = generate_random_pg(self._rng, seed=self._rng.randrange(2**31))
            B = unit_from_random_pg(build_b, "B", offset_to_axial(Offset(18, 8)))
        else:
            B = unit_from_preset(
                get_preset(chosen_b),  # type: ignore[arg-type]
                "B",
                offset_to_axial(Offset(18, 8)),
            )
        self._state = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
        self._info = EpisodeInfo(a_unit_id=A.id, b_unit_id=B.id)

        # Avvia round 1 e auto-advance fino alla prima decisione di A
        self._apply_event_with_history(EventStartRound())
        self._auto_advance()

        return self._build_obs(), self._build_info()

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        assert self._state is not None
        assert 0 <= action < MAX_ACTIONS

        a_unit_pre = self._state.units[self._info.a_unit_id]
        b_unit_pre = self._state.units[self._info.b_unit_id]
        hp_a_pre = a_unit_pre.hp
        hp_b_pre = b_unit_pre.hp

        # Decode action → GameEvent
        agent_unit_id = self._agent_decision_unit_id(self._state)
        moves = legal_moves(self._state, agent_unit_id) if agent_unit_id else []

        illegal = False
        if not moves:
            event = EventEndTurn()
            illegal = True
        elif action >= len(moves):
            event = EventEndTurn() if any(m.type == "END_TURN" for m in moves) else moves[-1]
            illegal = True
        else:
            event = moves[action]

        if illegal:
            self._info.illegal_actions += 1

        # Applica evento (con tracking storia)
        self._apply_event_with_history(event)

        # Auto-advance (B + fasi automatiche)
        self._auto_advance()

        a_unit_post = self._state.units[self._info.a_unit_id]
        b_unit_post = self._state.units[self._info.b_unit_id]
        hp_a_post = a_unit_post.hp
        hp_b_post = b_unit_post.hp

        damage_dealt = max(0, hp_b_pre - hp_b_post)
        damage_received = max(0, hp_a_pre - hp_a_post)
        reward = float(damage_dealt) - float(damage_received)
        if illegal:
            reward -= 0.5

        # Time penalty: costo per ogni step → spinge a chiudere veloce.
        # Disincentiva la fuga "scappare per sopravvivere" che il policy v3 aveva
        # imparato sul matchup tank-vs-arciere.
        reward -= 0.1

        terminated = self._state.phase == "game-over"
        truncated = self._state.round > self.max_rounds and not terminated

        if terminated:
            if self._state.winner == "A":
                reward += 10.0
            elif self._state.winner == "B":
                reward -= 10.0
        elif truncated:
            # Lose-on-truncate FORTE: arrivare a max_rounds conta come PEGGIO
            # di una sconfitta. Calibrato a -25 perché:
            #   - fuga 60 step ⇒ reward ≈ -25 - 6 = -31
            #   - combat lost (p=0.1, 20 step) ⇒ reward ≈ -32
            #   - expected combat (p=0.1) ≈ -27 < -31 → meglio combattere
            # Forza il policy a giocare per chiudere anche in matchup sfavorevoli.
            reward -= 25.0

        obs = self._build_obs()
        info = self._build_info()
        info["illegal_action"] = illegal
        info["damage_dealt"] = damage_dealt
        info["damage_received"] = damage_received
        return obs, reward, terminated, truncated, info

    def render(self):
        pass

    def action_masks(self) -> np.ndarray:
        """Bool mask di azioni legali (richiesto da MaskablePPO).

        Restituisce shape (MAX_ACTIONS,) bool. True per azioni legali per la
        phase corrente e l'agente in turno. Se nessuna azione legale,
        forza ENDTURN/RESOLVE come fallback.
        """
        assert self._state is not None
        agent_id = self._agent_decision_unit_id(self._state)
        if agent_id is None:
            mask = np.zeros(MAX_ACTIONS, dtype=bool)
            mask[0] = True  # fallback: solo prima azione
            return mask
        moves = legal_moves(self._state, agent_id)
        n = len(moves)
        mask = np.zeros(MAX_ACTIONS, dtype=bool)
        if n == 0:
            mask[0] = True  # fallback
            return mask
        for i in range(min(n, MAX_ACTIONS)):
            mask[i] = True
        return mask

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _resolve_preset(self, preset_spec: str) -> str:
        """'random' → uniform da PRESET_POOL; altrimenti id specifico."""
        if preset_spec == "random":
            return self._rng.choice(self.PRESET_POOL)
        return preset_spec

    def _agent_decision_unit_id(self, state: GameState) -> Optional[str]:
        phase = state.phase
        if phase == "awaiting-defense":
            assert state.pending_action is not None
            target = state.units.get(state.pending_action.target_id)
            if target is not None and target.faction == "A":
                return target.id
            return None
        if phase == "awaiting-attacker-bid":
            # Bid attaccante = unit che sta muovendo
            assert state.move_in_progress is not None
            mover = state.units.get(state.move_in_progress.unit_id)
            if mover is not None and mover.faction == "A":
                return mover.id
            return None
        if phase == "awaiting-defender-bid":
            # Bid difensore = unit che controlla la zona
            assert state.move_in_progress is not None
            assert state.move_in_progress.defender_id is not None
            defender = state.units.get(state.move_in_progress.defender_id)
            if defender is not None and defender.faction == "A":
                return defender.id
            return None
        if phase in ("turn-start", "choosing-action", "declaring-attack", "awaiting-carica"):
            if not state.turn_order:
                return None
            cur_id = state.turn_order[state.current_turn_idx]
            cur = state.units.get(cur_id)
            if cur is not None and cur.faction == "A":
                return cur_id
            return None
        return None

    def _auto_advance(self) -> None:
        """Avanza fasi non-decisionali per A; fa giocare B con Utility AI.

        Termina quando: game-over, max_rounds superato, o serve decisione di A.
        """
        assert self._state is not None
        safety = 0
        while safety < 5000:
            safety += 1
            state = self._state
            if state.phase == "game-over" or state.round > self.max_rounds:
                return

            # Resolving: auto-RESOLVE
            if state.phase == "resolving":
                self._apply_event_with_history(EventResolveCombat())
                continue

            # Awaiting-defense → se target è B, fa giocare B; se è A, return
            if state.phase == "awaiting-defense":
                assert state.pending_action is not None
                target = state.units.get(state.pending_action.target_id)
                if target is not None and target.faction == "B":
                    move = utility_decide_move(state, target.id)
                    self._apply_event_with_history(move)
                    continue
                return  # serve decisione policy A

            # Awaiting-attacker-bid → se mover è B, B bidda; se A, return
            if state.phase == "awaiting-attacker-bid":
                assert state.move_in_progress is not None
                mover = state.units.get(state.move_in_progress.unit_id)
                if mover is not None and mover.faction == "B":
                    move = utility_decide_move(state, mover.id)
                    self._apply_event_with_history(move)
                    continue
                return

            # Awaiting-defender-bid → se difensore è B, B bidda; se A, return
            if state.phase == "awaiting-defender-bid":
                assert state.move_in_progress is not None
                assert state.move_in_progress.defender_id is not None
                defender = state.units.get(state.move_in_progress.defender_id)
                if defender is not None and defender.faction == "B":
                    move = utility_decide_move(state, defender.id)
                    self._apply_event_with_history(move)
                    continue
                return

            if state.phase in ("turn-start", "choosing-action", "declaring-attack", "awaiting-carica"):
                if not state.turn_order:
                    return
                cur_id = state.turn_order[state.current_turn_idx]
                cur = state.units.get(cur_id)
                if cur is None:
                    return
                if cur.faction == "A":
                    return  # serve decisione policy
                # B → utility AI
                move = utility_decide_move(state, cur_id)
                self._apply_event_with_history(move)
                continue

            return

    # ------------------------------------------------------------------
    # History tracking
    # ------------------------------------------------------------------

    def _apply_event_with_history(self, event: GameEvent) -> None:
        """Applica l'evento al state e aggiorna la storia.

        Ogni evento "rilevante" produce 0/1/2 entry di storia, distribuite tra
        history_a e history_b in base all'attore.

        Eventi e mapping:
         - START_TURN: 1 entry per current unit (type=start_turn, dice_spent=slancioDice)
         - MOVE: 1 entry per unit (type=move, dice_spent=delta_slancio)
         - DECLARE_ATTACK: nessuna entry (è solo dichiarazione, attendiamo RESOLVE)
         - CHOOSE_ATTACKER_DICE: nessuna entry (idem)
         - CHOOSE_DEFENSE: nessuna entry (idem)
         - RESOLVE_COMBAT: 2 entry (atk + def) con dadi+esito completo
         - RELOAD: 1 entry (type=reload, dice_spent=diceN, success=reload_riuscito)
         - END_TURN: 1 entry (type=end_turn) — utile per inferire "ha passato"
         - END_ROUND, START_ROUND: nessuna entry (eventi di gestione)
        """
        assert self._state is not None
        state_pre = self._state
        ev_type = event.type

        # Snapshot pre per capire i delta
        units_pre = {uid: (u.hp, u.slancio, u.impeto, u.dadi_azione, u.weapon_loaded)
                     for uid, u in state_pre.units.items()}
        pending_pre: Optional[PendingAction] = state_pre.pending_action

        # Applica
        self._state = reduce(state_pre, event)
        state_post = self._state
        units_post = {uid: (u.hp, u.slancio, u.impeto, u.dadi_azione, u.weapon_loaded)
                      for uid, u in state_post.units.items()}

        # ── Routing per tipo evento ────────────────────────────────────────
        cur_unit_id = (
            state_pre.turn_order[state_pre.current_turn_idx]
            if state_pre.turn_order and 0 <= state_pre.current_turn_idx < len(state_pre.turn_order)
            else None
        )
        cur_unit = state_pre.units.get(cur_unit_id) if cur_unit_id else None

        if ev_type == "START_TURN" and cur_unit is not None:
            self._add_entry(
                cur_unit.faction,
                HistoryEntry(
                    actor_faction=cur_unit.faction,
                    action_type="start_turn",
                    dice_spent=event.slancio_dice,  # type: ignore[attr-defined]
                ),
            )

        elif ev_type == "MOVE" and cur_unit is not None:
            slancio_pre, slancio_post = (
                units_pre.get(cur_unit_id, (0, 0, 0, 0, False))[1] if cur_unit_id else 0,
                units_post.get(cur_unit_id, (0, 0, 0, 0, False))[1] if cur_unit_id else 0,
            )
            cost = max(0, slancio_pre - slancio_post)
            self._add_entry(
                cur_unit.faction,
                HistoryEntry(
                    actor_faction=cur_unit.faction,
                    action_type="move",
                    dice_spent=cost,
                ),
            )

        elif ev_type == "RELOAD" and cur_unit is not None:
            wp_pre = units_pre.get(cur_unit_id, (0, 0, 0, 0, False))[4] if cur_unit_id else False
            wp_post = units_post.get(cur_unit_id, (0, 0, 0, 0, False))[4] if cur_unit_id else False
            success = (not wp_pre) and wp_post
            self._add_entry(
                cur_unit.faction,
                HistoryEntry(
                    actor_faction=cur_unit.faction,
                    action_type="reload",
                    dice_spent=event.dice_n,  # type: ignore[attr-defined]
                    success=success,
                ),
            )

        elif ev_type == "END_TURN" and cur_unit is not None:
            self._add_entry(
                cur_unit.faction,
                HistoryEntry(
                    actor_faction=cur_unit.faction,
                    action_type="end_turn",
                ),
            )

        elif ev_type == "RESOLVE_COMBAT":
            # `pending_pre` ha tutti i dati necessari: chi atk, chi def, dadi, ecc.
            # `state_post.pending_action` è None ora.
            if pending_pre is not None:
                attacker = state_pre.units.get(pending_pre.attacker_id)
                target = state_pre.units.get(pending_pre.target_id)
                if attacker is not None and target is not None:
                    hp_target_pre = units_pre.get(target.id, (0,))[0]
                    hp_target_post = units_post.get(target.id, (0,))[0]
                    damage_to_target = max(0, hp_target_pre - hp_target_post)
                    hit = damage_to_target > 0

                    # Tipo azione attaccante (mischia o ranged)
                    atk_type = (
                        "declare_attack_ranged" if pending_pre.is_ranged else "declare_attack_melee"
                    )
                    # Entry attaccante: dice_spent = pa.attacker_dice (post-rivelazione)
                    self._add_entry(
                        attacker.faction,
                        HistoryEntry(
                            actor_faction=attacker.faction,
                            action_type=atk_type,
                            dice_spent=pending_pre.attacker_dice or 0,
                            damage_inflicted=damage_to_target,
                            damage_received=0,
                            success=hit,
                        ),
                    )

                    # Entry difensore (se non ranged + ha scelto difesa)
                    if not pending_pre.is_ranged and pending_pre.defense_type is not None:
                        def_type_map = {
                            "dodge": "defense_dodge",
                            "parry": "defense_parry",
                            "none": "defense_none",
                        }
                        def_action = def_type_map.get(pending_pre.defense_type, "defense_none")
                        self._add_entry(
                            target.faction,
                            HistoryEntry(
                                actor_faction=target.faction,
                                action_type=def_action,
                                dice_spent=pending_pre.defense_dice_n or 0,
                                damage_inflicted=0,
                                damage_received=damage_to_target,
                                success=(not hit),  # blocked = success di difesa
                            ),
                        )
                    elif pending_pre.is_ranged:
                        # Ranged: il difensore non agisce, ma se è stato colpito tracciamo
                        # un'entry "received" per la storia "azioni che ha subito"?
                        # Per pulizia: NO, perché concettualmente la storia è di azioni
                        # *agite*, non subite. Il danno è già nella entry attaccante.
                        pass

        # END_ROUND, START_ROUND, DECLARE_ATTACK, CHOOSE_*: nessuna entry esplicita

    def _add_entry(self, actor_faction: str, entry: HistoryEntry) -> None:
        if actor_faction == "A":
            self._info.history_a.append(entry)
            # Cap a HISTORY_LEN entries (mantengo le ultime)
            if len(self._info.history_a) > HISTORY_LEN * 2:
                self._info.history_a = self._info.history_a[-HISTORY_LEN:]
        else:
            self._info.history_b.append(entry)
            if len(self._info.history_b) > HISTORY_LEN * 2:
                self._info.history_b = self._info.history_b[-HISTORY_LEN:]

    # ------------------------------------------------------------------
    # Obs / Info
    # ------------------------------------------------------------------

    def _build_obs(self) -> np.ndarray:
        assert self._state is not None
        if self.obs_version == "v2":
            from hex_tactics.ai.obs_features_v2 import build_obs_v2
            return build_obs_v2(
                state=self._state,
                agent_faction="A",
                history_self=self._info.history_a,
                history_enemy=self._info.history_b,
                agent_unit_id=self._info.a_unit_id,
                enforce_simultaneous_privacy=True,
            )
        return build_obs(
            state=self._state,
            agent_faction="A",
            history_self=self._info.history_a,
            history_enemy=self._info.history_b,
            agent_unit_id=self._info.a_unit_id,
            enforce_simultaneous_privacy=True,
        )

    def _build_info(self) -> dict[str, Any]:
        assert self._state is not None
        agent_id = self._agent_decision_unit_id(self._state)
        if agent_id:
            moves = legal_moves(self._state, agent_id)
            n_legal = len(moves)
            mask = np.zeros(MAX_ACTIONS, dtype=bool)
            for i in range(min(n_legal, MAX_ACTIONS)):
                mask[i] = True
        else:
            n_legal = 0
            mask = np.zeros(MAX_ACTIONS, dtype=bool)

        return {
            "round": self._state.round,
            "phase": self._state.phase,
            "n_legal_moves": n_legal,
            "action_mask": mask,
            "agent_decision_unit": agent_id,
            "winner": self._state.winner,
            "history_a_len": len(self._info.history_a),
            "history_b_len": len(self._info.history_b),
            "matchup": (self._current_preset_a, self._current_preset_b),
        }


__all__ = ["HexTacticsEnv", "MAX_ACTIONS", "N_FEATURES"]

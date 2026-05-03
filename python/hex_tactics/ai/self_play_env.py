"""
Self-play env: B controllata da un pool di snapshot del policy A.

Setup:
  - Pool di N snapshot (DQN o MaskablePPO — auto-detect dalla classe)
  - A ogni reset, sampling random di un snapshot
  - Durante _auto_advance, B chiama il snapshot per decidere

Riusa l'env human-fair (obs_v2) ma con avversario "se stesso" invece di Utility AI.

V2 (post regole imp variabile + asta universale): coverage anche di
awaiting-attacker-bid, awaiting-defender-bid, awaiting-carica, declaring-attack.
Per le fasi non gestite dal policy (es. asta movimento) fallback a Utility per B.
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import List, Optional

import numpy as np

from hex_tactics.ai.env import HexTacticsEnv, MAX_ACTIONS
from hex_tactics.ai.legal_moves import legal_moves
from hex_tactics.ai.obs_features_v2 import build_obs_v2
from hex_tactics.ai.utility_ai import utility_decide_move
from hex_tactics.core.events import EventEndTurn, EventResolveCombat


class SnapshotPool:
    """Gestisce un pool di snapshot di un modello per self-play.

    Compatibile con qualsiasi modello sb3 (DQN, MaskablePPO) — la classe del
    modello deve essere passata in __init__ (es. `MaskablePPO`).

    Pool con max_size: quando si aggiunge un nuovo snapshot oltre il limite,
    si rimuove il più vecchio (FIFO). Inizialmente vuoto: se vuoto, fallback a
    Utility AI per B (per bootstrap iniziale).
    """

    def __init__(self, model_class, max_size: int = 6, device: str = "cpu"):
        self.model_class = model_class
        self.max_size = max_size
        self.device = device
        self.snapshots: list = []
        self.snapshot_paths: List[str] = []  # per debug/log

    def add(self, model_or_path) -> None:
        """Aggiunge un snapshot al pool. Rimuove il più vecchio se pool > max_size."""
        if isinstance(model_or_path, (str, Path)):
            model = self.model_class.load(str(model_or_path), device=self.device)
            path = str(model_or_path)
        else:
            # È un modello già istanziato (es. clone in-memory)
            model = model_or_path
            path = "<in-memory>"
        self.snapshots.append(model)
        self.snapshot_paths.append(path)
        # Trim
        while len(self.snapshots) > self.max_size:
            self.snapshots.pop(0)
            self.snapshot_paths.pop(0)

    def sample(self, rng: random.Random):
        """Estrae uniforme random. None se pool vuoto."""
        if not self.snapshots:
            return None
        return rng.choice(self.snapshots)

    def __len__(self) -> int:
        return len(self.snapshots)


class SelfPlayEnv(HexTacticsEnv):
    """Self-play: B controllata da snapshot pool (con fallback Utility se vuoto).

    V2: copre tutte le fasi V2 (asta movimento universale, carica). Per le fasi
    "specialistiche" (asta, carica) usa Utility AI per B (il policy globale non
    è ben tarato per quelle fasi specifiche; usare snapshot per carica/asta
    rallenterebbe e forse peggiorerebbe). Solo turn-start/choosing-action/
    declaring-attack/awaiting-defense usano il policy snapshot.
    """

    def __init__(
        self,
        preset_a: str = "spadaccino",
        preset_b: str = "tank",
        max_rounds: int = 30,
        seed: Optional[int] = None,
        obs_version: str = "v2",
        snapshot_pool: Optional[SnapshotPool] = None,
        utility_fallback_prob: float = 0.0,
    ):
        """
        Args:
            snapshot_pool: pool di modelli (DQN/MaskablePPO) per controllare B
            utility_fallback_prob: probabilità di usare Utility invece del pool
                (utile per evitare collassi nel self-play; default 0 = sempre snapshot)
        """
        super().__init__(preset_a, preset_b, max_rounds, seed, obs_version)
        self.snapshot_pool = snapshot_pool
        self.utility_fallback_prob = utility_fallback_prob
        self._current_b_model = None
        self._use_utility_this_episode: bool = False

    def reset(self, **kwargs):
        obs, info = super().reset(**kwargs)
        # Decide quale "B agent" usare per questo episodio
        if (
            self.snapshot_pool is not None
            and len(self.snapshot_pool) > 0
            and self._rng.random() >= self.utility_fallback_prob
        ):
            self._current_b_model = self.snapshot_pool.sample(self._rng)
            self._use_utility_this_episode = False
        else:
            self._current_b_model = None
            self._use_utility_this_episode = True
        return obs, info

    def _b_decide(self, unit_id: str):
        """Decide cosa fa B in questo step. Snapshot se disponibile, else Utility."""
        if self._current_b_model is None:
            return utility_decide_move(self._state, unit_id)  # type: ignore[arg-type]
        # Costruisci obs dalla prospettiva di B
        try:
            obs_b = build_obs_v2(
                state=self._state,
                agent_faction="B",
                history_self=self._info.history_b,
                history_enemy=self._info.history_a,
                agent_unit_id=unit_id,
                enforce_simultaneous_privacy=True,
            )
        except Exception:
            # Fallback Utility se obs fallisce (es. unit_id non in stato)
            return utility_decide_move(self._state, unit_id)  # type: ignore[arg-type]
        # MaskablePPO accetta action_masks; DQN no. Usa duck typing.
        moves = legal_moves(self._state, unit_id)  # type: ignore[arg-type]
        if not moves:
            return EventEndTurn()
        try:
            # MaskablePPO: passa mask se metodo accetta
            n = len(moves)
            mask = np.zeros(MAX_ACTIONS, dtype=bool)
            for i in range(min(n, MAX_ACTIONS)):
                mask[i] = True
            action, _ = self._current_b_model.predict(
                obs_b, action_masks=mask, deterministic=True
            )
        except TypeError:
            # DQN o modello senza action_masks
            action, _ = self._current_b_model.predict(obs_b, deterministic=True)
        action_idx = int(action)
        if action_idx >= len(moves):
            return EventEndTurn() if any(m.type == "END_TURN" for m in moves) else moves[-1]
        chosen = moves[action_idx]
        # Anti-degenerazione coerente con TS aiDecideHard: se snapshot propone
        # END_TURN ma c'è un attacco legale, forza l'attacco.
        if chosen.type == "END_TURN":
            attacks = [m for m in moves if m.type == "DECLARE_ATTACK"]
            if attacks:
                return attacks[0]
        return chosen

    def _auto_advance(self) -> None:
        """Override: B usa snapshot invece di Utility (con fallback Utility per fasi specialistiche)."""
        assert self._state is not None
        safety = 0
        while safety < 5000:
            safety += 1
            state = self._state
            if state.phase == "game-over" or state.round > self.max_rounds:
                return

            if state.phase == "resolving":
                self._apply_event_with_history(EventResolveCombat())
                continue

            if state.phase == "awaiting-defense":
                assert state.pending_action is not None
                target = state.units.get(state.pending_action.target_id)
                if target is not None and target.faction == "B":
                    move = self._b_decide(target.id)
                    self._apply_event_with_history(move)
                    continue
                return  # serve A

            # V2: aste universali e carica → usa Utility per B (il policy globale
            # non è specializzato per queste fasi specifiche, Utility è già OK)
            if state.phase == "awaiting-attacker-bid":
                assert state.move_in_progress is not None
                mover = state.units.get(state.move_in_progress.unit_id)
                if mover is not None and mover.faction == "B":
                    move = utility_decide_move(state, mover.id)  # type: ignore[arg-type]
                    self._apply_event_with_history(move)
                    continue
                return
            if state.phase == "awaiting-defender-bid":
                assert state.move_in_progress is not None
                assert state.move_in_progress.defender_id is not None
                defender = state.units.get(state.move_in_progress.defender_id)
                if defender is not None and defender.faction == "B":
                    move = utility_decide_move(state, defender.id)  # type: ignore[arg-type]
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
                    return
                # B → snapshot o Utility
                move = self._b_decide(cur_id)
                self._apply_event_with_history(move)
                continue

            return


__all__ = ["SnapshotPool", "SelfPlayEnv"]

"""HexTacticsAbstractGame — pyspiel.Game wrapper su HexTacticsGameModel.

Espone l'engine hex-tactics come gioco OpenSpiel-compatible per CFR tabular,
External Sampling MCCFR, exploitability solver, ecc.

Caratteristiche:
  - Sequential extensive-form, imperfect information, general-sum (V_a + V_b
    non somma 0 a causa di costi slancio).
  - State abstraction via abstract_info_state_key (vedi cfr.abstraction).
  - Action space: indici nelle legal_moves dell'engine, max MAX_ACTIONS.
  - Chance node (combat resolve) gestito **deterministicamente** in F3
    (transparent skip): quando current_player ritornerebbe CHANCE,
    applichiamo auto-resolve subito.
    TODO F4: chance esplicito con K=10 outcome equiprobabili (richiede
             OpenSpiel `chance_outcomes()` API).

Build A/B come parametri di game (stringa preset OPPURE BuildSpec via
factory `from_build_specs()`).
"""
from __future__ import annotations

import os
import sys
from typing import List, Optional, Tuple

import numpy as np
import pyspiel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from cfr.abstraction import BuildSpec, abstract_info_state_key, unit_from_build_spec
from cfr.game_model import (
    HexTacticsGameModel, CFRState, PLAYER_A, PLAYER_B, PLAYER_CHANCE,
    MAX_ACTIONS,
)
from hex_tactics.core.events import EventResolveCombat, EventStartRound
from hex_tactics.core.hex import Offset, offset_to_axial
from hex_tactics.core.reducer import reduce
from hex_tactics.core.state import Board, create_initial_state


# ─────── Game type ───────

_GAME_TYPE = pyspiel.GameType(
    short_name="hex_tactics_abstract",
    long_name="Hex Tactics — Abstracted (CFR-ready)",
    dynamics=pyspiel.GameType.Dynamics.SEQUENTIAL,
    chance_mode=pyspiel.GameType.ChanceMode.DETERMINISTIC,  # F3: chance interno auto-risolto
    information=pyspiel.GameType.Information.IMPERFECT_INFORMATION,
    utility=pyspiel.GameType.Utility.ZERO_SUM,  # win/loss terminal reward {-1,0,+1}
    reward_model=pyspiel.GameType.RewardModel.TERMINAL,
    max_num_players=2,
    min_num_players=2,
    provides_information_state_string=True,
    provides_information_state_tensor=False,
    provides_observation_string=True,
    provides_observation_tensor=False,
    parameter_specification={
        "preset_a": "spadaccino",
        "preset_b": "tank",
        "seed": 12345,
        "max_rounds": 25,
    },
)

_GAME_INFO = pyspiel.GameInfo(
    num_distinct_actions=MAX_ACTIONS,  # 24 dal game_model
    max_chance_outcomes=0,  # F3: no chance esplicito
    num_players=2,
    min_utility=-1.0,
    max_utility=+1.0,
    utility_sum=0.0,
    max_game_length=400,  # circa 200 decisioni × 2 player
)


# Singleton model: evita deep-copy del random.Random interno (recursion error
# in OpenSpiel state.clone()). I metodi del model usati dallo State sono
# stateless rispetto a self.rng (solo reset() usa rng, ma reset è chiamato
# una sola volta dal Game._create_initial_cfr_state() con seed esplicito).
_MODEL_SINGLETON = HexTacticsGameModel(seed=0)


class HexTacticsAbstractGame(pyspiel.Game):
    """Game OpenSpiel-compatible per hex-tactics post-D-052.

    Due modi di costruzione:
      - via game parameters: HexTacticsAbstractGame({"preset_a": "spadaccino", ...})
        usa preset hardcoded da hex_tactics.data.presets.
      - via factory: HexTacticsAbstractGame.from_build_specs(build_a, build_b, seed)
        accetta BuildSpec arbitrari.
    """

    def __init__(self, params=None):
        super().__init__(_GAME_TYPE, _GAME_INFO, params or {})
        params = params or {}
        self.preset_a = params.get("preset_a", "spadaccino")
        self.preset_b = params.get("preset_b", "tank")
        self.seed = int(params.get("seed", 12345))
        self.max_rounds = int(params.get("max_rounds", 25))

        # Build A/B custom (impostati da from_build_specs)
        self._custom_build_a: Optional[BuildSpec] = None
        self._custom_build_b: Optional[BuildSpec] = None

    @classmethod
    def from_build_specs(
        cls,
        build_a: BuildSpec,
        build_b: BuildSpec,
        *,
        seed: int = 12345,
        max_rounds: int = 25,
    ) -> "HexTacticsAbstractGame":
        """Costruisce un Game con BuildSpec arbitrari (bypass dei parameter dict)."""
        # Validazione preventiva
        for label, b in (("A", build_a), ("B", build_b)):
            errs = b.validate()
            if errs:
                raise ValueError(f"BuildSpec {label} invalida: {'; '.join(errs)}")
        g = cls({"seed": seed, "max_rounds": max_rounds})
        g._custom_build_a = build_a
        g._custom_build_b = build_b
        return g

    def new_initial_state(self):
        return HexTacticsAbstractState(self)

    def make_py_observer(self, iig_obs_type=None, params=None):
        return HexTacticsAbstractObserver(
            iig_obs_type or pyspiel.IIGObservationType(perfect_recall=False),
            params,
        )

    # Helper interno: crea CFRState iniziale rispettando custom build se presenti
    def _create_initial_cfr_state(self) -> CFRState:
        import random
        if self._custom_build_a is not None and self._custom_build_b is not None:
            local_rng = random.Random(self.seed)
            A = unit_from_build_spec(
                self._custom_build_a, "A", offset_to_axial(Offset(4, 8)),
                custom_id="A-build", validate=False,  # già validato in from_build_specs
            )
            B = unit_from_build_spec(
                self._custom_build_b, "B", offset_to_axial(Offset(18, 8)),
                custom_id="B-build", validate=False,
            )
            game_seed = local_rng.randrange(2**31)
            gs = create_initial_state([A, B], Board(cols=24, rows=18), game_seed)
            gs = reduce(gs, EventStartRound())
            return CFRState(game_state=gs, a_unit_id=A.id, b_unit_id=B.id, rng_seed=game_seed)
        else:
            # Preset path
            model = HexTacticsGameModel(seed=self.seed)
            return model.reset(preset_a=self.preset_a, preset_b=self.preset_b, seed=self.seed)


class HexTacticsAbstractState(pyspiel.State):
    """State OpenSpiel-compatible. Wrappa CFRState e applica auto-resolve sui chance.

    NOTA: lo State è self-contained — copia in __init__ tutti gli attributi
    rilevanti dal Game in modo che il clone OpenSpiel (che non preserva
    attributi custom Python sul Game) non li perda. Pattern standard
    (vedi kuhn_poker.py reference).
    """

    # Hard cap: termina forzatamente dopo N apply_action (anti infinite-loop).
    # Game depth misurata empiricamente 62-108 step a max_rounds=12.
    # 400 lascia headroom abbondante ma cap il loop infinito di CFR.
    MAX_STEPS_HARD = 400

    def __init__(self, game: HexTacticsAbstractGame):
        super().__init__(game)
        # Snapshot delle config dal game (poi non più referenziato)
        self._max_rounds = game.max_rounds
        self._seed = game.seed
        # NB: NON salviamo _model come attribute — usiamo _MODEL_SINGLETON
        # per evitare RecursionError nel deepcopy clone() di OpenSpiel.
        self._cfr_state: CFRState = game._create_initial_cfr_state()
        self._terminated = False
        self._step_count = 0  # incrementa ad ogni apply_action; hard cap MAX_STEPS_HARD
        # Cache per legal_actions: OpenSpiel li chiama 2 volte per step
        # (una in apply_action, una in information_state_string per n_legal).
        self._legal_cache_for_id = None
        self._legal_cache = None
        # Cache per information_state_string: chiamato 10K volte / 50 iter, dominante
        # nel profile post-memoize. Cache invalidata quando _cfr_state cambia.
        self._iss_cache_for_id = None
        self._iss_cache = {}  # {player: str}
        # Auto-skip chance/no-decision iniziale
        self._advance_to_decision()

    @property
    def _model(self):
        """Accesso al model singleton — non parte dello state copiabile."""
        return _MODEL_SINGLETON

    # ── PySpiel API ──

    def current_player(self):
        if self._terminated or self._is_terminal_internal():
            return pyspiel.PlayerId.TERMINAL
        cur = self._cfr_state.current_player()
        if cur in (PLAYER_CHANCE, -1):
            # Should not happen post _advance_to_decision; safety
            return pyspiel.PlayerId.TERMINAL
        return cur  # 0 (A) o 1 (B)

    def _legal_actions(self, player):
        assert player >= 0
        # Cache per evitare ricalcolo quando OpenSpiel chiama 2x lo stesso state
        cur_id = id(self._cfr_state)
        if self._legal_cache_for_id == cur_id:
            return self._legal_cache
        result = self._model.legal_actions(self._cfr_state)
        self._legal_cache = result
        self._legal_cache_for_id = cur_id
        return result

    def _apply_action(self, action: int):
        # Applica la decisione del player
        self._cfr_state = self._model.step(self._cfr_state, action)
        self._step_count += 1
        # Auto-skip chance / no-decision steps fino a prossima decision (o terminal)
        self._advance_to_decision()

    def _action_to_string(self, player, action):
        # Riusa le legal_events per dare nome leggibile
        events = self._model.get_legal_events(self._cfr_state)
        if 0 <= action < len(events):
            ev = events[action]
            return f"{ev.type}:{getattr(ev, '__dict__', {})}"
        return f"action_{action}"

    def is_terminal(self):
        return self._terminated or self._is_terminal_internal()

    def returns(self) -> List[float]:
        if not self.is_terminal():
            return [0.0, 0.0]
        r_a = self._model.terminal_reward(self._cfr_state, PLAYER_A)
        r_b = self._model.terminal_reward(self._cfr_state, PLAYER_B)
        return [r_a, r_b]

    def information_state_string(self, player=None):
        if player is None:
            player = self.current_player()
        if player < 0:
            return "terminal"
        # Cache per state-id (cfr_state immutabile finché non cambia con apply_action)
        cur_id = id(self._cfr_state)
        if self._iss_cache_for_id == cur_id and player in self._iss_cache:
            return self._iss_cache[player]
        if self._iss_cache_for_id != cur_id:
            self._iss_cache = {}
            self._iss_cache_for_id = cur_id
        # Usa cache di _legal_actions (evita ricalcolo)
        n_legal = len(self._legal_actions(player))
        result = abstract_info_state_key(self._cfr_state, player, n_legal=n_legal)
        self._iss_cache[player] = result
        return result

    def observation_string(self, player=None):
        return self.information_state_string(player)

    def __str__(self):
        gs = self._cfr_state.game_state
        return (
            f"HexTacticsAbstractState(round={gs.round}, phase={gs.phase}, "
            f"terminated={self._terminated})"
        )

    # ── Internals ──

    def _is_terminal_internal(self) -> bool:
        gs = self._cfr_state.game_state
        if gs.phase == "game-over":
            return True
        if gs.round > self._max_rounds:
            return True
        # Hard cap anti infinite-loop CFR
        if self._step_count >= self.MAX_STEPS_HARD:
            return True
        return False

    def _advance_to_decision(self):
        """Applica auto-resolve / no-decision finché non si arriva a un decision node
        di un player o al terminal.

        F3: chance node = deterministic auto-resolve (combat usa il seed dello state).
        TODO F4: chance esplicito con OpenSpiel chance_outcomes() per Nash precision.
        """
        max_iter = 200  # safety
        for _ in range(max_iter):
            if self._is_terminal_internal():
                self._terminated = True
                return
            cur = self._cfr_state.current_player()
            if cur in (PLAYER_A, PLAYER_B):
                return  # decision node → CFR deciderà
            # Chance / no-decision → auto-step
            self._cfr_state = self._model.step(self._cfr_state, 0)
            self._step_count += 1  # conta anche auto-resolve verso il cap
        # Safety: troppi step di auto-resolve → marca terminal per evitare loop
        self._terminated = True


class HexTacticsAbstractObserver:
    """Observer minimale; tensor non usato dal CFR tabular."""

    def __init__(self, iig_obs_type, params):
        self.iig_obs_type = iig_obs_type
        self.tensor = None
        self.dict = {}

    def set_from(self, state, player):
        pass

    def string_from(self, state, player):
        return state.information_state_string(player)


# Registro il game in OpenSpiel
pyspiel.register_game(_GAME_TYPE, HexTacticsAbstractGame)


# ─────── Smoke test ───────

def _smoke_test():
    print("=" * 70)
    print("HexTacticsAbstractGame — smoke test")
    print("=" * 70)

    # Test 1: random rollout via game parameters (preset)
    g = HexTacticsAbstractGame({"preset_a": "spadaccino", "preset_b": "tank", "seed": 12345})
    s = g.new_initial_state()
    print(f"\nInitial state: terminal={s.is_terminal()}, current_player={s.current_player()}")
    print(f"  info_state_str: {s.information_state_string()}")
    print(f"  legal_actions count: {len(s.legal_actions())}")

    import random
    rng = random.Random(99)
    depth = 0
    while not s.is_terminal() and depth < 50:
        legal = s.legal_actions()
        if not legal:
            break
        a = rng.choice(legal)
        s.apply_action(a)
        depth += 1

    print(f"\nDopo {depth} step: terminal={s.is_terminal()}, returns={s.returns()}")

    # Test 2: from_build_specs con BuildSpec custom
    from cfr.abstraction import SkillSpec
    custom_a = BuildSpec(
        name="custom_a",
        weapon="ascia_2h",
        armor="armatura_pesante",
        skills=(
            SkillSpec("-1impedimento", level=3),
            SkillSpec("-1impedimento", level=3, classe_oggetto="armature"),
            SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="asce"),
        ),
        exp_budget=2000,
    )
    custom_b = BuildSpec(
        name="custom_b",
        weapon="balestra",
        offhand="pugnale",
        armor="armatura_leggera",
        skills=(
            SkillSpec("-1impedimento", level=2),
            SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="balestre"),
        ),
        exp_budget=2000,
    )
    g2 = HexTacticsAbstractGame.from_build_specs(custom_a, custom_b, seed=99)
    s2 = g2.new_initial_state()
    print(f"\nCustom build state: terminal={s2.is_terminal()}, info_state={s2.information_state_string()}")
    assert not s2.is_terminal()
    print("\nAll smoke tests passed.")


if __name__ == "__main__":
    _smoke_test()


__all__ = [
    "HexTacticsAbstractGame", "HexTacticsAbstractState",
]

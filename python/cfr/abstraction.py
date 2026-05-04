"""State + Build abstraction for hex-tactics CFR solver.

Esposto a uso del solver:
  - BuildSpec/SkillSpec: descrittori parametrici di un PG (skill+equip arbitrari).
  - unit_from_build_spec(): converte BuildSpec → Unit pronto per l'engine.
  - abstract_info_state_key(): bucketing dello state per CFR tabular.

Choices (concordate con Valerio 2026-05-03):
  - HP: 5 bucket [0, 1-5, 6-10, 11-15, 16-20]
  - Slancio: ESATTO (0..25 cap), exact/coarse ratio misurato 1.24x → costo trascurabile
  - Impeto delta: 5 bucket
  - Distance: 7 bucket [0,1,2,3,4-6,7-10,11+]
  - Dadi azione: esatto 0-9
  - Action abstraction: NESSUNA (engine già discretizza in legal_moves)
  - Tie-break stocastico ma replicabile (seed-determinato).

Generalizzabilità: BuildSpec accetta combinazioni arbitrarie di skill+equip,
costo D-046 validato automaticamente. Permette sweep parametrici per balance.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Literal, Optional, Tuple

import sys, os

# Permetti import dell'engine quando il file è eseguito direttamente
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from hex_tactics.core.hex import Axial, base_distance
from hex_tactics.entities.equipment import EquipCategory, Stat
from hex_tactics.entities.skill import (
    AcquiredSkill, ActionType, SkillModifier,
    compute_skill_cost, count_specializations, skill_key, validate_skill_set,
)
from hex_tactics.entities.unit import FactionId, Unit, create_baseline_unit


# ─────────────────────────────── BuildSpec ────────────────────────────────

@dataclass(frozen=True)
class SkillSpec:
    """Skill in un BuildSpec. Costo calcolato automaticamente (D-046)."""

    modifier: SkillModifier
    level: int = 1
    abilita: Optional[Stat] = None
    azione: Optional[ActionType] = None
    classe_oggetto: Optional[EquipCategory] = None
    oggetto_specifico: Optional[str] = None

    def n_specs(self) -> int:
        n = 0
        if self.abilita is not None: n += 1
        if self.azione is not None: n += 1
        if self.classe_oggetto is not None: n += 1
        if self.oggetto_specifico is not None: n += 1
        return n

    def cost(self) -> int:
        return compute_skill_cost(self.modifier, self.level, self.n_specs())

    def to_acquired(self, owner_id: str, idx: int) -> AcquiredSkill:
        return AcquiredSkill(
            id=f"{owner_id}-skill-{idx}",
            modifier=self.modifier,
            level=self.level,
            cost=self.cost(),
            abilita=self.abilita,
            azione=self.azione,
            classe_oggetto=self.classe_oggetto,
            oggetto_specifico=self.oggetto_specifico,
        )


@dataclass(frozen=True)
class BuildSpec:
    """Descrittore parametrico di un PG.

    Costanti durante una run di CFR: ogni matchup risolve UN game con
    `(build_a, build_b)` fissati. Per sweep parametrico → N matchup.
    """

    weapon: Optional[str] = None  # id arma (es. 'spada_lunga')
    offhand: Optional[str] = None  # id arma 2 / scudo
    armor: Optional[str] = None  # id armatura
    skills: Tuple[SkillSpec, ...] = ()
    forza: int = 2
    agilita: int = 2
    volonta: int = 2
    hp: int = 20
    name: str = "build"  # label cosmetica
    exp_budget: Optional[int] = None  # se non None → validato (errore se exp speso > budget)

    def total_exp(self) -> int:
        return sum(s.cost() for s in self.skills)

    def validate(self) -> List[str]:
        """Errori (lista vuota se ok). Verifica D-046 cost + duplicati skill."""
        errs: List[str] = []
        # Validazione skill set (duplicati + costi)
        acquired = [s.to_acquired("validate", i) for i, s in enumerate(self.skills)]
        v = validate_skill_set(acquired)
        if not v.valid:
            errs.extend(v.errors)
        # Budget exp
        if self.exp_budget is not None and self.total_exp() > self.exp_budget:
            errs.append(
                f"exp speso ({self.total_exp()}) > budget ({self.exp_budget})"
            )
        # HP / stats minime
        if self.hp <= 0:
            errs.append(f"hp ({self.hp}) deve essere > 0")
        for stat_name, val in (("forza", self.forza), ("agilita", self.agilita), ("volonta", self.volonta)):
            if val < 0:
                errs.append(f"{stat_name} ({val}) deve essere ≥ 0")
        return errs


def unit_from_build_spec(
    build: BuildSpec,
    faction: FactionId,
    position: Axial,
    *,
    custom_id: Optional[str] = None,
    validate: bool = True,
) -> Unit:
    """Crea Unit da BuildSpec. Riusa pattern di unit_from_preset.

    `validate=True` → solleva ValueError se il build ha errori (skill duplicate,
    costi sbagliati, exp budget superato).
    """
    if validate:
        errs = build.validate()
        if errs:
            raise ValueError(f"BuildSpec invalida: {'; '.join(errs)}")

    uid = custom_id if custom_id is not None else f"{faction}-{build.name}"
    u = create_baseline_unit(
        id=uid,
        name=build.name,
        faction=faction,
        position=position,
    )
    # Override stats se specificate non-baseline
    u.forza = build.forza
    u.agilita = build.agilita
    u.volonta = build.volonta
    u.hp = build.hp
    u.hp_max = build.hp
    u.weapon = build.weapon
    u.offhand = build.offhand
    u.armor = build.armor
    u.skills = [s.to_acquired(uid, i) for i, s in enumerate(build.skills)]
    return u


# ───────────────────────── State Abstraction ────────────────────────────

# Scelta D-A (Valerio 2026-05-03):
#   HP 5 bucket / Slancio ESATTO / Impeto delta 5 bucket / Distance 7 bucket
#   Dadi esatti / Phase + flags inclusi.

def hp_bucket(hp: int) -> int:
    """5 bucket: [0, 1-5, 6-10, 11-15, 16-20+]."""
    if hp <= 0: return 0
    if hp <= 5: return 1
    if hp <= 10: return 2
    if hp <= 15: return 3
    return 4


_SLANCIO_CAP = 25


def slancio_value(s: int) -> int:
    """Slancio esatto (cap a 25 per safety)."""
    return min(max(0, s), _SLANCIO_CAP)


def impeto_delta_bucket(my_imp: int, en_imp: int) -> int:
    """5 bucket sul delta self - enemy: very_behind, behind, eq, ahead, very_ahead."""
    d = my_imp - en_imp
    if d <= -4: return 0
    if d < 0: return 1
    if d == 0: return 2
    if d < 4: return 3
    return 4


def distance_bucket(d: int) -> int:
    """7 bucket: [0,1,2,3,4-6,7-10,11+]."""
    if d <= 0: return 0
    if d <= 3: return d
    if d <= 6: return 4
    if d <= 10: return 5
    return 6


def abstract_info_state_key(cfr_state, player: int, n_legal: Optional[int] = None) -> str:
    """Restituisce stringa hashable dell'info-set astratto.

    Args:
      cfr_state: CFRState (da cfr.game_model)
      player: 0 (PLAYER_A) o 1 (PLAYER_B)
      n_legal: numero di legal actions del player in questo state (optional).
               Se fornito → incluso nella key per garantire che stati con
               stesso bucket ma diverso branching abbiano info-set distinti
               (requisito OpenSpiel CFR: regret array dimensione fissa per info-set).

    Returns:
      stringa canonica usabile come key per CFR tabular.

    NB: build_a/build_b NON sono nello state perché sono COSTANTI di game.
    Stati che hanno stesso "bucket macro" ma diverso branching (es. posizione
    su mappa diversa con N hex raggiungibili) sarebbero collisi senza n_legal.
    """
    gs = cfr_state.game_state
    if player == 0:  # PLAYER_A
        my_id, en_id = cfr_state.a_unit_id, cfr_state.b_unit_id
    else:
        my_id, en_id = cfr_state.b_unit_id, cfr_state.a_unit_id

    me = gs.units.get(my_id)
    en = gs.units.get(en_id)
    if me is None or en is None:
        return "terminal"

    dist = base_distance(me.position, en.position) if hasattr(me, 'position') and hasattr(en, 'position') else 0

    parts = [
        f"ph:{gs.phase}",
        f"hp:{hp_bucket(me.hp)}/{hp_bucket(en.hp)}",
        f"sl:{slancio_value(me.slancio)}/{slancio_value(en.slancio)}",
        f"im:{impeto_delta_bucket(me.impeto, en.impeto)}",
        f"d:{me.dadi_azione}/{en.dadi_azione}",
        f"dist:{distance_bucket(dist)}",
    ]
    # Flags che cambiano il legal action set (necessari per CFR)
    parts.append(f"att:{int(getattr(me, 'action_taken_this_turn', False))}")
    parts.append(f"mvd:{int(getattr(me, 'hex_moved_this_turn', 0) > 0)}")
    if hasattr(me, 'weapon_loaded'):
        parts.append(f"wl:{int(me.weapon_loaded)}")
    if hasattr(me, 'defensive_stance'):
        parts.append(f"ds:{int(me.defensive_stance)}")
        parts.append(f"dtt:{int(getattr(me, 'defensive_toggled_this_turn', False))}")
    # Pending action / move
    if gs.pending_action is not None:
        pa = gs.pending_action
        is_my_atk = (pa.attacker_id == my_id)
        parts.append(f"pa:r{int(pa.is_ranged)}/m{int(is_my_atk)}")
    if gs.move_in_progress is not None:
        mip = gs.move_in_progress
        is_my_move = (mip.unit_id == my_id)
        parts.append(f"mip:{int(is_my_move)}")
    # Numero di legal actions: garantisce dimensionalità constante per info-set
    if n_legal is not None:
        parts.append(f"na:{n_legal}")
    return "|".join(parts)


# ───────────────────────── Concretize (action) ──────────────────────────
#
# Decisione: l'engine già discretizza le legal_moves a 4-10 azioni per
# decisione (top 3 hex closer + 2 farther per MOVE, ecc.). Le azioni
# CFR sono direttamente gli indici nelle legal_moves, NON una abstract
# action separata. concretize è quindi l'IDENTITÀ.
#
# Tie-break replicabile: per fissare la scelta deterministica quando più
# legal moves sono semanticamente equivalenti (es. due hex equidistanti),
# l'engine restituisce la lista in ordine canonico e CFR la usa così.
# Stocastico vero: la mixed strategy CFR sceglie la distribuzione di
# probabilità su questi indici → aleatorietà coerente con seed CFR.


# ─────────────────────────── Smoke test ─────────────────────────────────

def _smoke_test():
    """Rapido test che le costruzioni funzionano end-to-end."""
    # 1. BuildSpec valido (replica spadaccino)
    spada_build = BuildSpec(
        name="spadaccino_test",
        weapon="spada_lunga",
        offhand=None,
        armor="armatura_media",
        skills=(
            SkillSpec("-1impedimento", level=3),
            SkillSpec("-1impedimento", level=3, classe_oggetto="spade"),
            SkillSpec("-1impedimento", level=3, classe_oggetto="armature"),
            SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="spade"),
            SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
        ),
        exp_budget=2000,
    )
    errs = spada_build.validate()
    print(f"Spadaccino-clone validate: errors={errs}, total_exp={spada_build.total_exp()}")
    assert errs == [], f"Build errors: {errs}"

    # 2. unit_from_build_spec
    u = unit_from_build_spec(spada_build, "A", Axial(4, 8))
    print(f"Unit creato: hp={u.hp}, weapon={u.weapon}, n_skills={len(u.skills)}")
    assert u.weapon == "spada_lunga"
    assert len(u.skills) == 5

    # 3. BuildSpec invalido (exp budget superato)
    overbuild = BuildSpec(
        name="overspend",
        weapon="spada",
        skills=(SkillSpec("+1dado", level=2),),  # 3600 * 3 = 10800 exp
        exp_budget=2000,
    )
    errs2 = overbuild.validate()
    print(f"Overspend validate: errors={len(errs2)} (expected ≥1)")
    assert len(errs2) >= 1

    # 4. abstract_info_state_key con CFRState mock
    from cfr.game_model import HexTacticsGameModel
    model = HexTacticsGameModel(seed=42)
    state = model.reset(preset_a="spadaccino", preset_b="tank", seed=12345)
    key_a = abstract_info_state_key(state, 0)
    key_b = abstract_info_state_key(state, 1)
    print(f"Abstract key A: {key_a}")
    print(f"Abstract key B: {key_b}")
    assert "ph:" in key_a
    assert "hp:" in key_a

    print("\nAll smoke tests passed.")


if __name__ == "__main__":
    _smoke_test()


__all__ = [
    "SkillSpec", "BuildSpec",
    "unit_from_build_spec",
    "hp_bucket", "slancio_value", "impeto_delta_bucket", "distance_bucket",
    "abstract_info_state_key",
]

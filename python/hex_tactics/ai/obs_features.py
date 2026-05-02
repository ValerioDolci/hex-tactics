"""
Costruzione observation "human-fair" per HexTacticsEnv.

Principio: l'agente vede esattamente quello che vede un umano in hot-seat e
nient'altro:
  - Le mie info complete (stat, equip, skill dettagliate)
  - Info pubbliche del nemico (HP, F/A/V, impeto, slancio, dadi, equip)
  - Posizione + LoS visibility
  - Fase corrente
  - Storia delle ultime 10 azioni mie (con dadi/danni) e 10 nemiche
    (post-rivelazione i dadi sono pubblici)
  - Skills nemiche: NASCOSTE
  - Pending action: `attacker_dice` censurato se sono difensore (regola
    "scelte simultanee e private")

Vedi `OBS_LAYOUT` per il layout completo del vettore.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

import numpy as np

from hex_tactics.core.hex import base_distance
from hex_tactics.core.ranged import compute_los
from hex_tactics.core.state import GameState
from hex_tactics.data.armors import get_armor
from hex_tactics.data.shields import get_shield
from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.skill import AcquiredSkill
from hex_tactics.entities.unit import Unit


# ---------------------------------------------------------------------------
# Vocabolari (encoding)
# ---------------------------------------------------------------------------

# Categorie equipment (12 cat distinte: 8 weapon + scudi + armature)
EQUIP_CATEGORIES = (
    "pugnali", "spade", "mazze", "asce", "lance",
    "archi", "balestre", "giavellotti", "scudi", "armature",
)
EQUIP_CAT_TO_ID = {c: i for i, c in enumerate(EQUIP_CATEGORIES)}

# Item IDs (tutti i 12 weapons + 3 shields + 3 armors)
ITEM_IDS = (
    # weapons
    "pugnale", "spada", "spada_lunga", "mazza", "ascia_1h", "ascia_2h",
    "lancia_2m", "lancia_3m", "giavellotto", "arco_corto", "arco_lungo", "balestra",
    # shields
    "scudo_piccolo", "scudo_medio", "scudo_pesante",
    # armors
    "armatura_leggera", "armatura_media", "armatura_pesante",
)
ITEM_ID_TO_IDX = {iid: i for i, iid in enumerate(ITEM_IDS)}
N_ITEMS = len(ITEM_IDS)  # 18

# Skill modifier
SKILL_MODIFIERS = ("-1impedimento", "+1tiro", "+1dado", "+1dadomax")
SKILL_MOD_TO_ID = {m: i for i, m in enumerate(SKILL_MODIFIERS)}

# Skill spec
SKILL_ABILITA = ("forza", "agilità", "volontà")  # 3
SKILL_ABILITA_TO_ID = {a: i for i, a in enumerate(SKILL_ABILITA)}

SKILL_AZIONI = ("attaccare", "parare", "schivare", "slancio", "ricaricare")  # 5
SKILL_AZIONI_TO_ID = {a: i for i, a in enumerate(SKILL_AZIONI)}

# Phases
PHASES = ("turn-start", "choosing-action", "declaring-attack", "awaiting-defense", "resolving")
PHASE_TO_ID = {p: i for i, p in enumerate(PHASES)}

# Action history types (high-level azioni che vengono memorizzate)
HISTORY_ACTION_TYPES = (
    "start_turn",
    "move",
    "declare_attack_melee",
    "declare_attack_ranged",
    "defense_dodge",
    "defense_parry",
    "defense_none",
    "reload",
    "end_turn",
    "resolve_hit",     # pseudo-action: l'attaccante ha colpito (per la storia)
    "resolve_miss",    # pseudo-action: l'attaccante ha mancato
)
HISTORY_TYPE_TO_ID = {t: i for i, t in enumerate(HISTORY_ACTION_TYPES)}
N_HISTORY_TYPES = len(HISTORY_ACTION_TYPES)


# ---------------------------------------------------------------------------
# Action history entry
# ---------------------------------------------------------------------------


@dataclass
class HistoryEntry:
    """Una entry nella storia delle azioni di un attore.

    `actor_faction`: 'A' o 'B'
    `action_type`: chiave in HISTORY_ACTION_TYPES
    `dice_spent`: dadi azione spesi per quell'azione (post-rivelazione public)
    `damage_inflicted`: danno fatto al nemico (0 se non era un attacco o non ha colpito)
    `damage_received`: danno subito (0 se non era subìto)
    `success`: bool — esito (hit per attacco, parato/schivato per difesa che ha bloccato)
    """

    actor_faction: Literal["A", "B"]
    action_type: str
    dice_spent: int = 0
    damage_inflicted: int = 0
    damage_received: int = 0
    success: bool = False


# ---------------------------------------------------------------------------
# Layout helpers
# ---------------------------------------------------------------------------


# Costanti di dimensionamento
MAX_SKILL_SLOTS = 10
HISTORY_LEN = 10

# Feature counts per sezione (per assert + debug)
N_SELF_STATS = 13
N_ENEMY_STATS = 10
N_EQUIP_PER_SLOT = 13
N_EQUIP_TOTAL_PER_PLAYER = N_EQUIP_PER_SLOT * 3  # 3 slot
N_SKILL_PER_SLOT = 7
N_SKILLS_TOTAL = N_SKILL_PER_SLOT * MAX_SKILL_SLOTS  # 70
N_POSITION = 4
N_PHASE_META = 11
N_HISTORY_PER_ENTRY_SELF = N_HISTORY_TYPES + 4  # type one-hot + dice/dmg_inf/dmg_rec/success
N_HISTORY_PER_ENTRY_ENEMY = N_HISTORY_TYPES + 4  # stesso shape, ma popolato post-rivelazione
N_HISTORY_TOTAL = (N_HISTORY_PER_ENTRY_SELF + N_HISTORY_PER_ENTRY_ENEMY) * HISTORY_LEN

N_FEATURES_TOTAL = (
    N_SELF_STATS
    + N_ENEMY_STATS
    + 2 * N_EQUIP_TOTAL_PER_PLAYER  # mio + nemico
    + N_SKILLS_TOTAL  # solo mie (nemiche nascoste)
    + N_POSITION
    + N_PHASE_META
    + N_HISTORY_TOTAL
)


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


def _equip_features(equip_id: Optional[str]) -> List[float]:
    """13 feature per uno slot di equipment.

    [present, category_id_normalized, dice_var_mode0, fixed_mode0,
     dice_var_mode1, fixed_mode1, parry_dice, parry_fixed, impediment,
     range_distance, range_throw, range_reach, range_div_or_RD]

    - Se non c'è equip in slot: tutti 0 + present=0
    - Per armatura usiamo l'ultimo slot per damage_reduction (RD); per arma
      lo usiamo per ranged_divisor (e reload via parry_dice se serve — TBD).
    NB: per semplicità il "reload" non è esposto come feature dedicata; la NN
    può inferire dal weapon_loaded del Unit.
    """
    if equip_id is None:
        return [0.0] * N_EQUIP_PER_SLOT

    w = get_weapon(equip_id)
    sh = get_shield(equip_id)
    ar = get_armor(equip_id)

    if w is not None:
        cat_id = EQUIP_CAT_TO_ID.get(w.category, -1) / max(1, len(EQUIP_CATEGORIES) - 1)
        m0 = w.attack_modes[0]
        m1 = w.attack_modes[1] if len(w.attack_modes) > 1 else None
        parry_dice = w.parry.dice if w.parry is not None else 0
        parry_fixed = w.parry.fixed if w.parry is not None else 0
        rng = w.range
        rd = rng.distance if (rng is not None and rng.distance is not None) else 0
        rt = rng.throw if (rng is not None and rng.throw is not None) else 0
        rr = rng.reach if (rng is not None and rng.reach is not None) else 0
        rdiv = (
            rng.ranged_divisor
            if (rng is not None and rng.ranged_divisor is not None)
            else 0
        )
        return [
            1.0,
            cat_id,
            float(m0.dice_variable),
            float(m0.fixed_bonus),
            float(m1.dice_variable) if m1 is not None else 0.0,
            float(m1.fixed_bonus) if m1 is not None else 0.0,
            float(parry_dice),
            float(parry_fixed),
            float(w.impediment),
            float(rd),
            float(rt),
            float(rr),
            float(rdiv),
        ]

    if sh is not None:
        cat_id = EQUIP_CAT_TO_ID.get(sh.category, -1) / max(1, len(EQUIP_CATEGORIES) - 1)
        return [
            1.0,
            cat_id,
            0.0, 0.0, 0.0, 0.0,
            float(sh.parry.dice),
            float(sh.parry.fixed),
            float(sh.impediment),
            0.0, 0.0, 0.0,
            float(sh.attack_fixed_bonus),  # riuso last slot per "ATK improvvisato"
        ]

    if ar is not None:
        cat_id = EQUIP_CAT_TO_ID.get(ar.category, -1) / max(1, len(EQUIP_CATEGORIES) - 1)
        return [
            1.0,
            cat_id,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0,
            float(ar.impediment),
            0.0, 0.0, 0.0,
            float(ar.damage_reduction),  # ultimo slot = RD
        ]

    return [0.0] * N_EQUIP_PER_SLOT


def _skill_features(skill: Optional[AcquiredSkill]) -> List[float]:
    """7 feature per uno slot skill.

    [present, modifier_id_norm, level_norm, abilita_id_norm,
     azione_id_norm, classe_id_norm, oggetto_specifico_present]
    """
    if skill is None:
        return [0.0] * N_SKILL_PER_SLOT
    mod_id = SKILL_MOD_TO_ID.get(skill.modifier, -1)
    abilita_id = SKILL_ABILITA_TO_ID.get(skill.abilita, -1) if skill.abilita else -1
    azione_id = SKILL_AZIONI_TO_ID.get(skill.azione, -1) if skill.azione else -1
    classe_id = EQUIP_CAT_TO_ID.get(skill.classe_oggetto, -1) if skill.classe_oggetto else -1
    has_oggetto = 1.0 if skill.oggetto_specifico is not None else 0.0

    return [
        1.0,
        (mod_id + 1) / max(1, len(SKILL_MODIFIERS)),
        skill.level / 6.0,
        (abilita_id + 1) / max(1, len(SKILL_ABILITA) + 1),
        (azione_id + 1) / max(1, len(SKILL_AZIONI) + 1),
        (classe_id + 1) / max(1, len(EQUIP_CATEGORIES) + 1),
        has_oggetto,
    ]


def _history_entry_features(entry: Optional[HistoryEntry]) -> List[float]:
    """N_HISTORY_TYPES + 4 feature per una entry di storia.

    [type one-hot (N_HISTORY_TYPES), dice_spent, damage_inflicted,
     damage_received, success_bool]
    """
    n = N_HISTORY_TYPES + 4
    out = [0.0] * n
    if entry is None:
        return out
    type_id = HISTORY_TYPE_TO_ID.get(entry.action_type, -1)
    if 0 <= type_id < N_HISTORY_TYPES:
        out[type_id] = 1.0
    out[N_HISTORY_TYPES + 0] = entry.dice_spent / 5.0
    out[N_HISTORY_TYPES + 1] = entry.damage_inflicted / 20.0
    out[N_HISTORY_TYPES + 2] = entry.damage_received / 20.0
    out[N_HISTORY_TYPES + 3] = 1.0 if entry.success else 0.0
    return out


def build_obs(
    state: GameState,
    agent_faction: Literal["A", "B"],
    history_self: List[HistoryEntry],
    history_enemy: List[HistoryEntry],
    agent_unit_id: Optional[str] = None,
    *,
    enforce_simultaneous_privacy: bool = True,
) -> np.ndarray:
    """Costruisce il vettore obs per `agent_faction`.

    Args:
        state: GameState corrente
        agent_faction: 'A' o 'B'
        history_self: lista entry storia (azioni proprie, ordine cronologico)
        history_enemy: lista entry storia (azioni avversario)
        agent_unit_id: opzionale, ID dell'unità agente (default: prima alive
            con faction matching)
        enforce_simultaneous_privacy: se True, censura `pending_action.attacker_dice`
            quando l'agente è il difensore in awaiting-defense (regola hot-seat)
    """
    # Identifica le 2 unità
    me = _find_unit_for_faction(state, agent_faction, agent_unit_id)
    other_faction = "B" if agent_faction == "A" else "A"
    enemy = _find_unit_for_faction(state, other_faction, None)

    out: List[float] = []

    # ── A. Stato mio (13 feature) ──────────────────────────────────────
    out.extend(_self_stats(state, me))

    # ── B. Stato nemico (10 feature) ───────────────────────────────────
    out.extend(_enemy_stats(enemy))

    # ── C. Equipment mio (3 slot × 13 = 39) ────────────────────────────
    out.extend(_equip_features(me.weapon if me else None))
    out.extend(_equip_features(me.offhand if me else None))
    out.extend(_equip_features(me.armor if me else None))

    # ── D. Equipment nemico (3 × 13 = 39) ──────────────────────────────
    out.extend(_equip_features(enemy.weapon if enemy else None))
    out.extend(_equip_features(enemy.offhand if enemy else None))
    out.extend(_equip_features(enemy.armor if enemy else None))

    # ── E. Skills mie (10 slot × 7 = 70) ───────────────────────────────
    skills = me.skills if me else []
    for i in range(MAX_SKILL_SLOTS):
        out.extend(_skill_features(skills[i] if i < len(skills) else None))

    # ── F. Posizione (4) ───────────────────────────────────────────────
    out.extend(_position_features(state, me, enemy))

    # ── G. Phase + meta (11) ───────────────────────────────────────────
    out.extend(_phase_meta_features(state, agent_faction, enforce_simultaneous_privacy))

    # ── H. Storia mie (10 × ~15 = ~150) ────────────────────────────────
    self_hist = list(history_self[-HISTORY_LEN:])
    while len(self_hist) < HISTORY_LEN:
        self_hist.insert(0, None)  # type: ignore[arg-type]
    for entry in self_hist:
        out.extend(_history_entry_features(entry))

    # ── I. Storia nemiche (10 × ~15 = ~150) ────────────────────────────
    enemy_hist = list(history_enemy[-HISTORY_LEN:])
    while len(enemy_hist) < HISTORY_LEN:
        enemy_hist.insert(0, None)  # type: ignore[arg-type]
    for entry in enemy_hist:
        out.extend(_history_entry_features(entry))

    # Sanity check
    if len(out) != N_FEATURES_TOTAL:
        raise RuntimeError(
            f"obs feature count mismatch: got {len(out)}, expected {N_FEATURES_TOTAL}"
        )

    return np.asarray(out, dtype=np.float32)


def _find_unit_for_faction(
    state: GameState, faction: str, override_id: Optional[str]
) -> Optional[Unit]:
    if override_id is not None:
        return state.units.get(override_id)
    for u in state.units.values():
        if u.faction == faction:
            return u
    return None


def _self_stats(state: GameState, me: Optional[Unit]) -> List[float]:
    """13 feature stat mie."""
    if me is None:
        return [0.0] * N_SELF_STATS
    is_my_turn = 0.0
    if state.turn_order and 0 <= state.current_turn_idx < len(state.turn_order):
        cur_id = state.turn_order[state.current_turn_idx]
        cu = state.units.get(cur_id)
        if cu is not None and cu.faction == me.faction:
            is_my_turn = 1.0
    return [
        me.hp / 20.0,
        me.hp_max / 20.0,
        me.forza / 5.0,
        me.agilita / 5.0,
        me.volonta / 5.0,
        me.impeto / 30.0,
        me.impeto_max / 30.0,
        me.slancio / 30.0,
        me.dadi_azione / 9.0,
        me.dadi_azione_max / 9.0,
        me.hex_moved_this_turn / 6.0,
        1.0 if me.action_taken_this_turn else 0.0,
        1.0 if me.weapon_loaded else 0.0,
        # is_my_turn ← in phase_meta
    ][:N_SELF_STATS]


def _enemy_stats(enemy: Optional[Unit]) -> List[float]:
    """10 feature stat nemico (skills NASCOSTE)."""
    if enemy is None:
        return [0.0] * N_ENEMY_STATS
    return [
        enemy.hp / 20.0,
        enemy.hp_max / 20.0,
        enemy.forza / 5.0,
        enemy.agilita / 5.0,
        enemy.volonta / 5.0,
        enemy.impeto / 30.0,
        enemy.impeto_max / 30.0,
        enemy.slancio / 30.0,
        enemy.dadi_azione / 9.0,
        1.0 if enemy.alive else 0.0,
    ]


def _position_features(
    state: GameState, me: Optional[Unit], enemy: Optional[Unit]
) -> List[float]:
    if me is None or enemy is None or not me.alive or not enemy.alive:
        return [0.0] * N_POSITION
    dist = base_distance(me.position, enemy.position)
    try:
        los = compute_los(me, enemy, state.units)
        vis = los.visibility
    except Exception:
        vis = 0
    return [
        dist / 20.0,
        vis / 7.0,
        1.0 if dist <= 1 else 0.0,
        1.0 if dist <= 4 else 0.0,
    ]


def _phase_meta_features(
    state: GameState, agent_faction: str, enforce_simultaneous_privacy: bool
) -> List[float]:
    """11 feature: phase one-hot (5) + round + has_pending + pending_is_ranged
    + pending_mode_idx + pending_attacker_dice (CENSURATO se sono def) + attacker_is_me_flag.
    """
    out: List[float] = []
    # phase one-hot
    phase_oh = [0.0] * len(PHASES)
    pid = PHASE_TO_ID.get(state.phase, -1)
    if 0 <= pid < len(PHASES):
        phase_oh[pid] = 1.0
    out.extend(phase_oh)

    # round
    out.append(state.round / 10.0)

    pa = state.pending_action
    if pa is None:
        out.extend([0.0, 0.0, 0.0, 0.0, 0.0])  # 5 zeros (has, ranged, mode, atk_dice, is_me_atk)
        return out

    out.append(1.0)  # has_pending
    out.append(1.0 if pa.is_ranged else 0.0)
    out.append(pa.attack_mode_idx / 3.0)

    # CENSURA: se sono def in awaiting-defense, NON posso vedere attacker_dice
    attacker = state.units.get(pa.attacker_id)
    am_attacker = (attacker is not None and attacker.faction == agent_faction)

    show_atk_dice = True
    if enforce_simultaneous_privacy:
        if state.phase == "awaiting-defense" and not am_attacker:
            show_atk_dice = False

    if show_atk_dice and pa.attacker_dice is not None:
        out.append(pa.attacker_dice / 3.0)
    else:
        out.append(0.0)  # censurato o non ancora scelto

    out.append(1.0 if am_attacker else -1.0)
    return out


__all__ = [
    "HistoryEntry",
    "build_obs",
    "N_FEATURES_TOTAL",
    "MAX_SKILL_SLOTS",
    "HISTORY_LEN",
    "HISTORY_ACTION_TYPES",
]

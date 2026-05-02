"""
Observation v2 — pruned (~130 feature) basato su feature importance v1.

Rimosse o compresse:
  - enemy_stats (era ignorato: 0% impact)
  - history_enemy (era ignorato: 0% impact, 150 feat)
  - skills_self verbose → solo 7 derivati
  - equip verbose → only id one-hot

Mantenute:
  - phase_meta (-31% calo, critica)
  - position (-18%, critica)
  - history_self compatto (5 entry × 11 feat = 55 vs 150)
  - self_stats minimal
  - enemy_stats minimal (HP/slancio/dadi solo, no F/A/V)
  - equip via one-hot id (semplice, niente proprietà ridondanti)
  - skills_self DERIVATE (i bonus effettivi pre-calcolati, non la lista)

Layout v2 (134 feat):
  G1 self_stats          (5)   HP/HP_max, slancio/30, impeto/30, dadi/9, weapon_loaded
  G2 enemy_stats         (5)   HP/HP_max, slancio/30, impeto/30, dadi/9, alive
  G3 equip_self          (21)  weapon one-hot (13) + offhand (4) + armor (4)
  G4 equip_enemy         (21)  idem
  G5 skills_self_derived (7)   imp_tot, +tiro per atk/par/dod/sla, +1dado_count, +1dadomax_count
  G6 position            (4)   distance/20, los_vis/7, in_melee_flag, in_ranged_flag
  G7 phase_meta          (11)  phase_one_hot (5) + round + has_pending + pending_is_ranged + pending_mode + pending_atk_dice + atk_is_me
  G8 history_self        (60)  5 entry × 12: type one-hot 7 + dice/5 + success + dmg_inf/20 + dmg_rec/20
"""

from __future__ import annotations

from typing import List, Literal, Optional

import numpy as np

from hex_tactics.core.hex import base_distance
from hex_tactics.core.ranged import compute_los
from hex_tactics.core.state import GameState
from hex_tactics.core.stats import (
    count_flat_bonuses,
    count_forced_extra_dice,
    count_max_dice_extra,
    get_impediment_total,
    make_attack_context,
    make_dodge_context,
    make_parry_context,
    make_slancio_context,
)
from hex_tactics.entities.skill import RollContext
from hex_tactics.entities.unit import Unit
from hex_tactics.data.weapons import get_weapon


# Vocabolari one-hot (compatti)
WEAPON_IDS = (
    "pugnale", "spada", "spada_lunga", "mazza", "ascia_1h", "ascia_2h",
    "lancia_2m", "lancia_3m", "giavellotto", "arco_corto", "arco_lungo", "balestra",
)
SHIELD_IDS = ("scudo_piccolo", "scudo_medio", "scudo_pesante")
ARMOR_IDS = ("armatura_leggera", "armatura_media", "armatura_pesante")

WEAPON_TO_IDX = {w: i for i, w in enumerate(WEAPON_IDS)}
SHIELD_TO_IDX = {s: i for i, s in enumerate(SHIELD_IDS)}
ARMOR_TO_IDX = {a: i for i, a in enumerate(ARMOR_IDS)}

PHASES = (
    "turn-start", "choosing-action", "declaring-attack",
    "awaiting-defense", "resolving",
    "awaiting-attacker-bid", "awaiting-defender-bid",
    "awaiting-carica",  # Fase 1
)
PHASE_TO_ID = {p: i for i, p in enumerate(PHASES)}

# History action types (compresso a 7 categorie)
HISTORY_TYPES = (
    "start_turn", "move", "attack_melee", "attack_ranged",
    "defense_dodge", "defense_parry", "end_or_other",
)
HIST_TYPE_TO_ID = {t: i for i, t in enumerate(HISTORY_TYPES)}

# Layout sizes
N_SELF = 5
N_ENEMY = 5
N_EQUIP = 21  # weapon (12+null=13) + offhand (3+null=4) + armor (3+null=4)
N_SKILLS_DERIVED = 7
N_POSITION = 4
N_PHASE_META = 14  # 8 phase one-hot + round + has_pending + pending_is_ranged + pending_mode + pending_atk_dice + atk_is_me
N_HISTORY_PER_ENTRY = 12  # type one-hot 7 + dice/5 + success + dmg_inf + dmg_rec
HISTORY_LEN = 5
N_HISTORY_TOTAL = N_HISTORY_PER_ENTRY * HISTORY_LEN

# v12: feature dedicate al BID CONTEXT (meccanica A) — addresses limited info in bid phases
N_BID_CONTEXT = 12
# Fase 1: feature aggiuntive (carica + stance)
N_FASE1_CONTEXT = 4
# Layout: [my_defensive_stance, enemy_defensive_stance, delta_dist_carica/10, my_carica_max/10]
# Layout: [
#   in_bid_phase (bool),
#   is_atk_bid (bool, 1 se sono attaccante in bid),
#   is_def_bid (bool, 1 se sono difensore in bid),
#   path_total_len/10,
#   current_idx_in_path/10,
#   hex_remaining_in_path/10,
#   defender_reach/6 (reach dell'arma del difensore corrente, 0..6),
#   defender_slancio/30 (slancio difensore visibile - quanto può biddare al massimo),
#   attacker_slancio/30 (slancio attaccante - quanto possa biddare),
#   distance_atk_to_target/10 (residual hex da current pos a target finale),
#   bid_attempt_n/5 (n bid affrontati nel current move),
#   contested_hex_dist_from_def/6 (quanto è "vicino" l'hex contestato al difensore)
# ]

N_FEATURES_TOTAL_V2 = (
    N_SELF + N_ENEMY + 2 * N_EQUIP + N_SKILLS_DERIVED
    + N_POSITION + N_PHASE_META + N_HISTORY_TOTAL
    + N_BID_CONTEXT + N_FASE1_CONTEXT
)


# ---------------------------------------------------------------------------
# History entry (re-import dal v1 per coerenza)
# ---------------------------------------------------------------------------

from hex_tactics.ai.obs_features import HistoryEntry  # noqa: E402

HIST_TYPE_MAP = {
    "start_turn": "start_turn",
    "move": "move",
    "declare_attack_melee": "attack_melee",
    "declare_attack_ranged": "attack_ranged",
    "defense_dodge": "defense_dodge",
    "defense_parry": "defense_parry",
    "defense_none": "end_or_other",
    "reload": "end_or_other",
    "end_turn": "end_or_other",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _self_stats(state: GameState, me: Optional[Unit]) -> List[float]:
    if me is None:
        return [0.0] * N_SELF
    return [
        me.hp / 20.0,
        me.slancio / 30.0,
        me.impeto / 30.0,
        me.dadi_azione / 9.0,
        1.0 if me.weapon_loaded else 0.0,
    ]


def _enemy_stats(enemy: Optional[Unit]) -> List[float]:
    if enemy is None:
        return [0.0] * N_ENEMY
    return [
        enemy.hp / 20.0,
        enemy.slancio / 30.0,
        enemy.impeto / 30.0,
        enemy.dadi_azione / 9.0,
        1.0 if enemy.alive else 0.0,
    ]


def _equip_one_hot(unit: Optional[Unit]) -> List[float]:
    """21 feature: weapon one-hot 13 (12 + null) + offhand 4 (3 + null) + armor 4 (3 + null)."""
    out = [0.0] * 21
    if unit is None:
        return out
    # Weapon (idx 0..12 = WEAPON_IDS, idx 12 = null)
    if unit.weapon is not None and unit.weapon in WEAPON_TO_IDX:
        out[WEAPON_TO_IDX[unit.weapon]] = 1.0
    # offhand (può essere weapon o shield)
    # idx 13..15 = SHIELD_IDS, 16 = weapon offhand, 17 = null offhand
    if unit.offhand is not None:
        if unit.offhand in SHIELD_TO_IDX:
            out[13 + SHIELD_TO_IDX[unit.offhand]] = 1.0
        elif unit.offhand in WEAPON_TO_IDX:
            out[16] = 1.0  # offhand weapon (any)
        # else null (out[17] left 0 = null)
    # Armor (idx 17..19 = ARMOR_IDS, 20 = null)
    if unit.armor is not None and unit.armor in ARMOR_TO_IDX:
        out[17 + ARMOR_TO_IDX[unit.armor]] = 1.0
    return out


def _skills_derived(unit: Optional[Unit]) -> List[float]:
    """7 derivati: imp totale + bonus tiro per ogni azione + count +1dado/+1dadomax."""
    if unit is None:
        return [0.0] * N_SKILLS_DERIVED
    imp = get_impediment_total(unit)
    # Per i bonus tiro: usiamo un context generico per ogni azione
    # Senza specializzazioni di equip → match "general" skill
    ctx_atk = make_attack_context(unit.weapon or "", "spade", "forza") if unit.weapon else RollContext(azione="attaccare")
    ctx_par = make_parry_context(unit.weapon or "", "spade") if unit.weapon else RollContext(azione="parare")
    ctx_dod = make_dodge_context()
    ctx_sla = make_slancio_context()

    return [
        imp / 10.0,
        count_flat_bonuses(unit.skills, ctx_atk) / 4.0,
        count_flat_bonuses(unit.skills, ctx_par) / 4.0,
        count_flat_bonuses(unit.skills, ctx_dod) / 4.0,
        count_flat_bonuses(unit.skills, ctx_sla) / 4.0,
        sum(s.level for s in unit.skills if s.modifier == "+1dado") / 4.0,
        sum(s.level for s in unit.skills if s.modifier == "+1dadomax") / 4.0,
    ]


def _position(state: GameState, me: Optional[Unit], enemy: Optional[Unit]) -> List[float]:
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


def _phase_meta(state: GameState, agent_faction: str, enforce_privacy: bool) -> List[float]:
    out: List[float] = [0.0] * len(PHASES)
    pid = PHASE_TO_ID.get(state.phase, -1)
    if 0 <= pid < len(PHASES):
        out[pid] = 1.0
    out.append(state.round / 10.0)

    pa = state.pending_action
    if pa is None:
        out.extend([0.0, 0.0, 0.0, 0.0, 0.0])
        return out
    out.append(1.0)  # has_pending
    out.append(1.0 if pa.is_ranged else 0.0)
    out.append(pa.attack_mode_idx / 3.0)
    attacker = state.units.get(pa.attacker_id)
    am_attacker = attacker is not None and attacker.faction == agent_faction
    show_atk = not (enforce_privacy and state.phase == "awaiting-defense" and not am_attacker)
    if show_atk and pa.attacker_dice is not None:
        out.append(pa.attacker_dice / 3.0)
    else:
        out.append(0.0)
    out.append(1.0 if am_attacker else -1.0)
    return out


def _bid_context(state: GameState, agent_faction: str) -> List[float]:
    """v12: feature dedicate al bid context (meccanica A).

    Esposte SEMPRE (0 se non in bid phase). Quando in bid phase, danno al
    policy le info per decidere bene.

    Layout: vedi N_BID_CONTEXT in header.
    """
    out = [0.0] * N_BID_CONTEXT

    is_bid_phase = state.phase in ("awaiting-attacker-bid", "awaiting-defender-bid")
    if not is_bid_phase or state.move_in_progress is None:
        return out

    mip = state.move_in_progress
    out[0] = 1.0  # in_bid_phase

    # Identifica chi è atk e chi è def
    atk_unit = state.units.get(mip.unit_id)
    def_unit = state.units.get(mip.defender_id) if mip.defender_id else None

    if atk_unit is None:
        return out

    am_atk = atk_unit.faction == agent_faction
    am_def = def_unit is not None and def_unit.faction == agent_faction

    out[1] = 1.0 if am_atk else 0.0  # is_atk_bid (sono attaccante)
    out[2] = 1.0 if am_def else 0.0  # is_def_bid (sono difensore)

    # Path info
    path_len = len(mip.path)
    out[3] = path_len / 10.0
    out[4] = mip.current_idx / 10.0
    out[5] = max(0, path_len - mip.current_idx) / 10.0

    # Difensore reach + slancio
    if def_unit is not None:
        from hex_tactics.data.weapons import get_weapon
        w_def = get_weapon(def_unit.weapon) if def_unit.weapon else None
        reach = 0
        if w_def is not None and w_def.range is not None and w_def.range.reach is not None:
            reach = w_def.range.reach
        out[6] = reach / 6.0
        out[7] = def_unit.slancio / 30.0
    else:
        out[6] = 0.0
        out[7] = 0.0

    # Attaccante slancio
    out[8] = atk_unit.slancio / 30.0

    # Distance atk -> final target
    if path_len > 0:
        from hex_tactics.core.hex import hex_distance
        target = mip.path[-1]
        out[9] = hex_distance(atk_unit.position, target) / 10.0
    else:
        out[9] = 0.0

    # Bid attempt count (current_idx è approssimazione di "quanti bid finora")
    # Più precisamente: contested_hex_idx misura il bid corrente
    if mip.contested_hex_idx is not None:
        out[10] = mip.contested_hex_idx / 5.0
    else:
        out[10] = 0.0

    # Contested hex distance from defender
    if def_unit is not None and mip.contested_hex_idx is not None and 0 <= mip.contested_hex_idx < path_len:
        from hex_tactics.core.hex import hex_distance
        contested = mip.path[mip.contested_hex_idx]
        out[11] = hex_distance(def_unit.position, contested) / 6.0
    else:
        out[11] = 0.0

    return out


def _fase1_context(state: GameState, me, enemy) -> List[float]:
    """4 feature: stance flags + carica info."""
    out = [0.0] * N_FASE1_CONTEXT
    if me is not None:
        out[0] = 1.0 if me.defensive_stance else 0.0
    if enemy is not None:
        out[1] = 1.0 if enemy.defensive_stance else 0.0
    # Delta distance (per carica disponibile)
    if me is not None and enemy is not None and me.position_at_turn_start is not None:
        from hex_tactics.core.hex import base_distance
        d_start = base_distance(me.position_at_turn_start, enemy.position)
        d_now = base_distance(me.position, enemy.position)
        delta = max(0, d_start - d_now)
        out[2] = delta / 10.0
        out[3] = max(0, min(delta, me.slancio)) / 10.0
    return out


def _history_entry(entry: Optional[HistoryEntry]) -> List[float]:
    """12 feat: type one-hot 7 + dice/5 + success + dmg_inf/20 + dmg_rec/20 + (1 padding)."""
    out = [0.0] * N_HISTORY_PER_ENTRY
    if entry is None:
        return out
    mapped = HIST_TYPE_MAP.get(entry.action_type, "end_or_other")
    type_id = HIST_TYPE_TO_ID.get(mapped, len(HISTORY_TYPES) - 1)
    if 0 <= type_id < 7:
        out[type_id] = 1.0
    out[7] = entry.dice_spent / 5.0
    out[8] = 1.0 if entry.success else 0.0
    out[9] = entry.damage_inflicted / 20.0
    out[10] = entry.damage_received / 20.0
    # out[11] padding 0
    return out


def build_obs_v2(
    state: GameState,
    agent_faction: Literal["A", "B"],
    history_self: List[HistoryEntry],
    history_enemy: List[HistoryEntry],  # ignored but kept for API compatibility
    agent_unit_id: Optional[str] = None,
    *,
    enforce_simultaneous_privacy: bool = True,
) -> np.ndarray:
    """Costruisce obs v2 (~134 feat) per `agent_faction`."""
    # find units
    me = None
    if agent_unit_id is not None:
        me = state.units.get(agent_unit_id)
    if me is None:
        for u in state.units.values():
            if u.faction == agent_faction:
                me = u
                break
    enemy = None
    other_fac = "B" if agent_faction == "A" else "A"
    for u in state.units.values():
        if u.faction == other_fac:
            enemy = u
            break

    out: List[float] = []
    out.extend(_self_stats(state, me))
    out.extend(_enemy_stats(enemy))
    out.extend(_equip_one_hot(me))
    out.extend(_equip_one_hot(enemy))
    out.extend(_skills_derived(me))
    out.extend(_position(state, me, enemy))
    out.extend(_phase_meta(state, agent_faction, enforce_simultaneous_privacy))

    # history_self compressed: ultimo HISTORY_LEN entry, padding zero a inizio
    self_hist = list(history_self[-HISTORY_LEN:])
    while len(self_hist) < HISTORY_LEN:
        self_hist.insert(0, None)  # type: ignore
    for entry in self_hist:
        out.extend(_history_entry(entry))

    # v12: bid context (meccanica A) — feature dedicate al policy in bid phase
    out.extend(_bid_context(state, agent_faction))

    # Fase 1: stance + carica context
    out.extend(_fase1_context(state, me, enemy))

    if len(out) != N_FEATURES_TOTAL_V2:
        raise RuntimeError(
            f"obs_v2 feature count mismatch: got {len(out)}, expected {N_FEATURES_TOTAL_V2}"
        )

    return np.asarray(out, dtype=np.float32)


__all__ = [
    "build_obs_v2",
    "N_FEATURES_TOTAL_V2",
    "HISTORY_LEN",
    "WEAPON_IDS",
    "SHIELD_IDS",
    "ARMOR_IDS",
]

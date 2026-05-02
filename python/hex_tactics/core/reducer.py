"""
Reducer principale — port di src/core/reducer.ts.

Pure function. Tutte le mutazioni di GameState passano da qui.
"""

from __future__ import annotations

from typing import List, cast

from hex_tactics.data.weapons import get_weapon
from hex_tactics.entities.skill import RollContext

from .combat import (
    BASE_PG_FIXED,
    apply_damage_with_armor,
    compose_attack_roll,
    compose_dodge_roll,
    compose_parry_roll,
    resolve_dodge,
    resolve_no_defense,
    resolve_parry,
)
from .dice import make_roll, roll_total, variable_sum
from .events import (
    EventBidMovement,
    EventChooseCarica,
    EventChooseDefense,
    EventDeclareAttack,
    EventToggleDefensive,
    GameEvent,
)
from .hex import Axial, get_base_hexes, hex_distance, hex_line
from .ranged import compose_ranged_attack_roll, compute_los
from .rng import create_rng
from .round import check_game_over
from .round import compute_turn_order
from .state import (
    GamePhase,
    GameState,
    LogEntry,
    MoveInProgress,
    PendingAction,
    append_log,
    update_unit,
    _state_with,
)
from .stats import (
    count_flat_bonuses,
    count_forced_extra_dice,
    get_actual_dice_count,
    get_impediment_total,
)
from .turn import apply_slancio_penalty, apply_turn_start


def reduce(state: GameState, event: GameEvent) -> GameState:
    t = event.type
    if t == "START_ROUND":
        return _do_start_round(state)
    if t == "START_TURN":
        return _do_start_turn(state, event.slancio_dice, event.impeto_to_slancio)  # type: ignore[attr-defined]
    if t == "MOVE":
        return _do_move(state, event.unit_id, event.target_hex)  # type: ignore[attr-defined]
    if t == "DECLARE_ATTACK":
        return _do_declare_attack(state, cast(EventDeclareAttack, event))
    if t == "CHOOSE_ATTACKER_DICE":
        return _do_choose_attacker_dice(state, event.dice_n)  # type: ignore[attr-defined]
    if t == "CHOOSE_DEFENSE":
        return _do_choose_defense(state, cast(EventChooseDefense, event))
    if t == "RESOLVE_COMBAT":
        return _do_resolve_combat(state)
    if t == "RELOAD":
        return _do_reload(state, event.unit_id, event.dice_n)  # type: ignore[attr-defined]
    if t == "END_TURN":
        return _do_end_turn(state)
    if t == "END_ROUND":
        return _do_end_round(state)
    if t == "BID_MOVEMENT":
        return _do_bid_movement(state, event.amount)  # type: ignore[attr-defined]
    if t == "TOGGLE_DEFENSIVE":
        return _do_toggle_defensive(state, event.unit_id)  # type: ignore[attr-defined]
    if t == "CHOOSE_CARICA":
        return _do_choose_carica(state, event.amount)  # type: ignore[attr-defined]
    return state


# ---------------------------------------------------------------------------
# Helpers di phase guard
# ---------------------------------------------------------------------------


def _reject(state: GameState, event_type: str, reason: str) -> GameState:
    return append_log(
        state, f"[reducer] evento '{event_type}' rifiutato: {reason} (phase={state.phase})"
    )


def _ensure_phase(state: GameState, event_type: str, allowed: List[GamePhase]) -> GameState | None:
    if state.phase in allowed:
        return None
    return _reject(state, event_type, f"fase richiesta: {'|'.join(allowed)}")


# ---------------------------------------------------------------------------
# START_ROUND
# ---------------------------------------------------------------------------


def _do_start_round(state: GameState) -> GameState:
    if state.phase == "game-over":
        return _reject(state, "START_ROUND", "partita già conclusa")

    # Decoupled per round: state.rngSeed + (state.round * 1000)
    rng = create_rng(state.rng_seed + state.round * 1000)
    order = compute_turn_order(state.units, rng)

    new_log = [
        *state.log,
        LogEntry(
            round=state.round + 1,
            turn_unit_id=None,
            message=f"── Inizio round {state.round + 1} ──",
        ),
    ]
    return _state_with(
        state,
        round=state.round + 1,
        turn_order=order,
        current_turn_idx=0,
        phase="turn-start",
        rng_seed=rng.get_state(),
        log=new_log,
    )


# ---------------------------------------------------------------------------
# START_TURN
# ---------------------------------------------------------------------------


def _do_start_turn(state: GameState, slancio_dice: int, impeto_to_slancio: int) -> GameState:
    rj = _ensure_phase(state, "START_TURN", ["turn-start"])
    if rj is not None:
        return rj
    if not state.turn_order:
        return _reject(state, "START_TURN", "turnOrder vuoto")
    unit_id = state.turn_order[state.current_turn_idx]
    unit = state.units.get(unit_id)
    if unit is None:
        return _reject(state, "START_TURN", f"unit {unit_id} non trovata")
    if not unit.alive:
        return _reject(state, "START_TURN", f"unit {unit_id} non viva")

    rng = create_rng(state.rng_seed)
    updated = apply_turn_start(unit, slancio_dice, rng, impeto_to_slancio)

    new_state = update_unit(
        state,
        unit_id,
        dadi_azione=updated.dadi_azione,
        impeto=updated.impeto,
        slancio=updated.slancio,
        hex_moved_this_turn=updated.hex_moved_this_turn,
        action_taken_this_turn=updated.action_taken_this_turn,
        position_at_turn_start=updated.position_at_turn_start,
        defensive_toggled_this_turn=updated.defensive_toggled_this_turn,
        turns_played=updated.turns_played,
    )
    new_state = append_log(
        new_state,
        f"{unit.name}: turno start (dadi {updated.dadi_azione}, impeto {updated.impeto}, slancio {updated.slancio})",
    )
    return _state_with(new_state, phase="choosing-action", rng_seed=rng.get_state())


# ---------------------------------------------------------------------------
# MOVE
# ---------------------------------------------------------------------------


def _do_move(state: GameState, unit_id: str, target: Axial) -> GameState:
    """MOVE: decompone in path step-by-step. Per ogni hex contestato (zona-reach
    di un difensore con slancio>0), apre un'asta nascosta (meccanica A).
    """
    rj = _ensure_phase(state, "MOVE", ["choosing-action"])
    if rj is not None:
        return rj
    unit = state.units.get(unit_id)
    if unit is None:
        return _reject(state, "MOVE", f"unit {unit_id} non trovata")
    if unit.id != state.turn_order[state.current_turn_idx]:
        return _reject(state, "MOVE", f"non è il turno di {unit_id}")
    if state.move_in_progress is not None:
        return _reject(state, "MOVE", "movimento già in corso")

    dist = hex_distance(unit.position, target)
    if dist == 0:
        return _reject(state, "MOVE", "target == posizione corrente")

    # Costo totale stimato (free hex se prima mossa del turno)
    free_hex_left = 1 if unit.hex_moved_this_turn == 0 else 0
    cost_estimate = max(0, dist - free_hex_left)
    if unit.slancio < cost_estimate:
        return append_log(
            state,
            f"{unit.name}: movimento rifiutato (slancio insufficiente: {unit.slancio} < {cost_estimate})",
        )

    # Verifica destinazione finale (no overlap con basette altre unità vive)
    target_base = {(h.q, h.r) for h in get_base_hexes(target)}
    for other in state.units.values():
        if other.id == unit.id or not other.alive:
            continue
        for h in get_base_hexes(other.position):
            if (h.q, h.r) in target_base:
                return append_log(
                    state,
                    f"{unit.name}: movimento rifiutato (basetta sovrapposta a {other.name})",
                )

    # Computa path da pos a target (linea hex), escluso start
    full_line = hex_line(unit.position, target)
    path = full_line[1:]  # escludo start

    mip = MoveInProgress(
        unit_id=unit_id,
        path=path,
        current_idx=0,
        free_hex_used=False,
    )
    new_state = _state_with(state, move_in_progress=mip)
    return _advance_movement(new_state)


def _check_threat_zone(state: GameState, mover_id: str, target_hex: Axial) -> Optional[str]:
    """Verifica se un esagono è in zona-reach di un difensore avversario eligibile.

    Eligibilità difensore:
      - vivo (alive)
      - faction diversa da mover
      - slancio > 0
      - arma da mischia con reach >= 1

    Restituisce defender_id se trigger, None altrimenti.
    Tie-break: il difensore con reach più alto (poi alphabetic).
    """
    mover = state.units.get(mover_id)
    if mover is None:
        return None

    candidates = []
    for other in state.units.values():
        if other.id == mover_id or not other.alive:
            continue
        if other.faction == mover.faction:
            continue
        if other.slancio <= 0:
            continue
        if other.weapon is None:
            continue
        weapon = get_weapon(other.weapon)
        if weapon is None:
            continue
        # V2 (regola universale): TUTTE le armi melee con reach >= 1 triggerano l'asta.
        # Default: pugnale, spada, mazza, ascia 1h, ascia 2h hanno reach 1 (= 0.5m).
        # Spada lunga reach 2, lancia 2m reach 4, lancia 3m reach 6, giavellotto reach 2.
        # Disarmato (no weapon) → reach considerato 0.
        # Armi solo-ranged senza secondaria melee (arco, balestra) → reach undefined.
        if weapon.range is None or weapon.range.reach is None:
            continue
        reach = weapon.range.reach
        if reach < 1:
            continue
        # Distanza dal centro difensore al target_hex
        d = hex_distance(other.position, target_hex)
        if d <= reach:
            candidates.append((other.id, reach))

    if not candidates:
        return None
    # Tie-break: max reach, poi alphabetic id
    candidates.sort(key=lambda x: (-x[1], x[0]))
    return candidates[0][0]


def _advance_movement(state: GameState) -> GameState:
    """Avanza il movimento step-by-step finché non incontra un hex contestato
    (apre asta) o completa il path.
    """
    if state.move_in_progress is None:
        return state

    while state.move_in_progress is not None:
        mip = state.move_in_progress
        if mip.current_idx >= len(mip.path):
            # Path completato: chiudi move_in_progress
            return _state_with(state, move_in_progress=None)

        unit = state.units.get(mip.unit_id)
        if unit is None:
            return _state_with(state, move_in_progress=None)

        next_hex = mip.path[mip.current_idx]

        # Verifica se hex contestato (zona reach difensore)
        defender_id = _check_threat_zone(state, mip.unit_id, next_hex)
        if defender_id is not None:
            # Apri asta — phase awaiting-attacker-bid
            new_mip = MoveInProgress(
                unit_id=mip.unit_id,
                path=mip.path,
                current_idx=mip.current_idx,
                free_hex_used=mip.free_hex_used,
                contested_hex_idx=mip.current_idx,
                defender_id=defender_id,
                attacker_bid=None,
                defender_bid=None,
            )
            defender = state.units.get(defender_id)
            def_name = defender.name if defender else defender_id
            new_state = _state_with(
                state, phase="awaiting-attacker-bid", move_in_progress=new_mip
            )
            new_state = append_log(
                new_state,
                f"{unit.name}: zona di controllo di {def_name} su ({next_hex.q},{next_hex.r}) — asta",
            )
            return new_state

        # Hex non contestato: applica step
        # Costo: 1 slancio per hex, ma il primo hex del turno è gratis
        if not mip.free_hex_used and unit.hex_moved_this_turn == 0:
            cost = 0
            new_free = True
        else:
            cost = 1
            new_free = mip.free_hex_used or True  # rimane True dopo primo hex

        if unit.slancio < cost:
            # Slancio insufficiente: termina movimento qui
            new_state = append_log(
                state,
                f"{unit.name}: movimento interrotto a ({unit.position.q},{unit.position.r}) — slancio insufficiente",
            )
            return _state_with(new_state, move_in_progress=None)

        # Verifica overlap basette
        new_pos_base = {(h.q, h.r) for h in get_base_hexes(next_hex)}
        blocked = False
        for other in state.units.values():
            if other.id == mip.unit_id or not other.alive:
                continue
            for h in get_base_hexes(other.position):
                if (h.q, h.r) in new_pos_base:
                    blocked = True
                    break
            if blocked:
                break
        if blocked:
            # Movimento bloccato (basetta nemica sopra il path)
            new_state = append_log(
                state,
                f"{unit.name}: movimento bloccato (basetta nemica) a ({next_hex.q},{next_hex.r})",
            )
            return _state_with(new_state, move_in_progress=None)

        # Applica step
        state = update_unit(
            state, mip.unit_id,
            position=Axial(q=next_hex.q, r=next_hex.r),
            slancio=unit.slancio - cost,
            hex_moved_this_turn=unit.hex_moved_this_turn + 1,
        )
        new_mip = MoveInProgress(
            unit_id=mip.unit_id,
            path=mip.path,
            current_idx=mip.current_idx + 1,
            free_hex_used=new_free,
        )
        state = _state_with(state, move_in_progress=new_mip)

    return state


def _do_bid_movement(state: GameState, amount: int) -> GameState:
    """Gestisce un bid di asta movimento.

    Phase awaiting-attacker-bid → registra atk_bid, passa a awaiting-defender-bid.
    Phase awaiting-defender-bid → registra def_bid, risolvi:
      - applica spese slancio a entrambi
      - se atk_bid >= def_bid: continua MOVE (chiamando _advance_movement)
      - se atk_bid < def_bid: termina MOVE (movement_in_progress=None, phase=choosing-action)
    """
    if state.move_in_progress is None:
        return _reject(state, "BID_MOVEMENT", "nessun movimento in corso")
    mip = state.move_in_progress

    if state.phase == "awaiting-attacker-bid":
        unit = state.units.get(mip.unit_id)
        if unit is None:
            return _reject(state, "BID_MOVEMENT", "attaccante non trovato")
        clamped = max(0, min(amount, unit.slancio))
        new_mip = MoveInProgress(
            unit_id=mip.unit_id,
            path=mip.path,
            current_idx=mip.current_idx,
            free_hex_used=mip.free_hex_used,
            contested_hex_idx=mip.contested_hex_idx,
            defender_id=mip.defender_id,
            attacker_bid=clamped,
            defender_bid=None,
        )
        return _state_with(
            state, phase="awaiting-defender-bid", move_in_progress=new_mip
        )

    if state.phase == "awaiting-defender-bid":
        if mip.defender_id is None or mip.attacker_bid is None:
            return _reject(state, "BID_MOVEMENT", "stato bid corrotto")
        defender = state.units.get(mip.defender_id)
        if defender is None:
            return _reject(state, "BID_MOVEMENT", "difensore non trovato")
        clamped = max(0, min(amount, defender.slancio))

        atk_bid = mip.attacker_bid
        def_bid = clamped
        atk_wins = atk_bid >= def_bid  # parità → atk vince

        # Applica spese slancio: entrambi pagano
        atk_unit = state.units.get(mip.unit_id)
        if atk_unit is None:
            return _reject(state, "BID_MOVEMENT", "atk non trovato")
        new_state = update_unit(
            state, mip.unit_id, slancio=atk_unit.slancio - atk_bid
        )
        new_state = update_unit(
            new_state, mip.defender_id, slancio=defender.slancio - def_bid
        )

        result_str = "passa" if atk_wins else "BLOCCATO"
        new_state = append_log(
            new_state,
            f"  asta: atk={atk_bid} vs def={def_bid} → {result_str} "
            f"(atk -{atk_bid} sla, def -{def_bid} sla)",
        )

        if atk_wins:
            # Continua MOVE: applica step (movimento avanti di 1) e prosegui
            next_hex = mip.path[mip.current_idx]
            atk_after = new_state.units[mip.unit_id]
            cost = 0 if (not mip.free_hex_used and atk_after.hex_moved_this_turn == 0) else 1
            new_free = mip.free_hex_used or True
            if atk_after.slancio < cost:
                # Niente slancio per il movimento residuo dopo aver pagato il bid
                new_state = append_log(
                    new_state,
                    f"{atk_unit.name}: post-asta, slancio insufficiente per muoversi",
                )
                new_state = _state_with(
                    new_state, phase="choosing-action", move_in_progress=None
                )
                return new_state
            # Verifica overlap basette
            new_pos_base = {(h.q, h.r) for h in get_base_hexes(next_hex)}
            blocked = False
            for other in new_state.units.values():
                if other.id == mip.unit_id or not other.alive:
                    continue
                for h in get_base_hexes(other.position):
                    if (h.q, h.r) in new_pos_base:
                        blocked = True
                        break
                if blocked:
                    break
            if blocked:
                new_state = append_log(
                    new_state,
                    f"{atk_unit.name}: post-asta, basetta bloccata a ({next_hex.q},{next_hex.r})",
                )
                new_state = _state_with(
                    new_state, phase="choosing-action", move_in_progress=None
                )
                return new_state
            # Applica step
            new_state = update_unit(
                new_state, mip.unit_id,
                position=Axial(q=next_hex.q, r=next_hex.r),
                slancio=atk_after.slancio - cost,
                hex_moved_this_turn=atk_after.hex_moved_this_turn + 1,
            )
            new_mip = MoveInProgress(
                unit_id=mip.unit_id,
                path=mip.path,
                current_idx=mip.current_idx + 1,
                free_hex_used=new_free,
            )
            new_state = _state_with(
                new_state, phase="choosing-action", move_in_progress=new_mip
            )
            # Prosegui movimento
            return _advance_movement(new_state)
        else:
            # Atk perde: movimento si ferma (atk resta nell'hex precedente, già pagato bid)
            new_state = _state_with(
                new_state, phase="choosing-action", move_in_progress=None
            )
            return new_state

    return _reject(state, "BID_MOVEMENT", f"phase {state.phase} non valida per bid")


# ---------------------------------------------------------------------------
# DECLARE_ATTACK
# ---------------------------------------------------------------------------


def _can_charge_with_weapon(weapon_id: str) -> bool:
    """Carica disponibile se l'arma NON è ranged-only.

    Ranged-only = ha range.distance senza reach o throw (archi, balestra).
    Tutto il resto (mischia + lancio = giavellotto, lancia 2m, pugnale, ecc.) può caricare.
    """
    w = get_weapon(weapon_id)
    if w is None or w.range is None:
        return True  # mischia pura
    if w.range.distance is not None and w.range.throw is None and w.range.reach is None:
        return False  # ranged-only (arco, balestra)
    return True


def _delta_distance_for_carica(attacker, target) -> int:
    """Quanti hex l'attaccante si è avvicinato al target dal turn-start.

    delta = max(0, base_distance(start_pos, target_pos) - base_distance(now_pos, target_pos))
    Cattura "movimento netto verso l'avversario" indipendente dal path effettivo.
    """
    if attacker.position_at_turn_start is None:
        return 0
    from .hex import base_distance
    d_start = base_distance(attacker.position_at_turn_start, target.position)
    d_now = base_distance(attacker.position, target.position)
    return max(0, d_start - d_now)


def _do_declare_attack(state: GameState, e: EventDeclareAttack) -> GameState:
    rj = _ensure_phase(state, "DECLARE_ATTACK", ["choosing-action"])
    if rj is not None:
        return rj
    attacker = state.units.get(e.attacker_id)
    target = state.units.get(e.target_id)
    if attacker is None:
        return _reject(state, "DECLARE_ATTACK", f"attaccante {e.attacker_id} non trovato")
    if target is None:
        return _reject(state, "DECLARE_ATTACK", f"target {e.target_id} non trovato")
    if not target.alive:
        return _reject(state, "DECLARE_ATTACK", f"target {e.target_id} è già caduto")
    if attacker.id != state.turn_order[state.current_turn_idx]:
        return _reject(state, "DECLARE_ATTACK", f"non è il turno di {e.attacker_id}")
    if state.pending_action is not None:
        return _reject(state, "DECLARE_ATTACK", "pendingAction già attivo")
    if attacker.action_taken_this_turn:
        return _reject(
            state, "DECLARE_ATTACK", f"{e.attacker_id} ha già usato la sua azione questo turno"
        )
    if attacker.dadi_azione < 1:
        return _reject(
            state, "DECLARE_ATTACK", f"{e.attacker_id} ha 0 dadi azione (minimo 1 per attaccare)"
        )

    pending = PendingAction(
        attacker_id=e.attacker_id,
        target_id=e.target_id,
        weapon_id=e.weapon_id,
        attack_mode_idx=e.attack_mode_idx,
        is_ranged=e.is_ranged,
        chosen_stat=e.chosen_stat,
    )
    new_log = [
        *state.log,
        LogEntry(
            round=state.round,
            turn_unit_id=e.attacker_id,
            message=f"{attacker.name} dichiara "
            f"{'attacco a distanza' if e.is_ranged else 'attacco'} "
            f"a {target.name} con {e.weapon_id}",
        ),
    ]

    # Fase 1: se arma carica-able + delta_dist > 0 + slancio > 0 → awaiting-carica
    # Altrimenti vai direttamente a declaring-attack
    delta = _delta_distance_for_carica(attacker, target)
    can_charge = _can_charge_with_weapon(e.weapon_id) and delta > 0 and attacker.slancio > 0
    next_phase = "awaiting-carica" if can_charge else "declaring-attack"

    return _state_with(state, phase=next_phase, pending_action=pending, log=new_log)


# ---------------------------------------------------------------------------
# CHOOSE_ATTACKER_DICE
# ---------------------------------------------------------------------------


def _do_choose_attacker_dice(state: GameState, dice_n: int) -> GameState:
    rj = _ensure_phase(state, "CHOOSE_ATTACKER_DICE", ["declaring-attack"])
    if rj is not None:
        return rj
    if state.pending_action is None:
        return _reject(state, "CHOOSE_ATTACKER_DICE", "pendingAction mancante")
    if dice_n < 1:
        return _reject(state, "CHOOSE_ATTACKER_DICE", "diceN < 1 (minimo 1 dado per attaccare)")

    new_pending = PendingAction(
        attacker_id=state.pending_action.attacker_id,
        target_id=state.pending_action.target_id,
        weapon_id=state.pending_action.weapon_id,
        attack_mode_idx=state.pending_action.attack_mode_idx,
        is_ranged=state.pending_action.is_ranged,
        chosen_stat=state.pending_action.chosen_stat,
        attacker_dice=dice_n,
        defense_type=state.pending_action.defense_type,
        defense_dice_n=state.pending_action.defense_dice_n,
        defense_parry_with=state.pending_action.defense_parry_with,
        carica_amount=state.pending_action.carica_amount,
    )
    if state.pending_action.is_ranged:
        return _state_with(state, phase="resolving", pending_action=new_pending)
    return _state_with(state, phase="awaiting-defense", pending_action=new_pending)


# ---------------------------------------------------------------------------
# CHOOSE_CARICA (Fase 1)
# ---------------------------------------------------------------------------


def _do_choose_carica(state: GameState, amount: int) -> GameState:
    """Carica: bonus alla fissa atk = amount, costo amount slancio.
    Clampato a delta_distance (max disponibile) e slancio attuale.
    """
    rj = _ensure_phase(state, "CHOOSE_CARICA", ["awaiting-carica"])
    if rj is not None:
        return rj
    if state.pending_action is None:
        return _reject(state, "CHOOSE_CARICA", "pendingAction mancante")
    pa = state.pending_action
    attacker = state.units.get(pa.attacker_id)
    target = state.units.get(pa.target_id)
    if attacker is None or target is None:
        return _reject(state, "CHOOSE_CARICA", "atk/target non trovato")

    delta = _delta_distance_for_carica(attacker, target)
    max_carica = min(delta, attacker.slancio)
    clamped = max(0, min(amount, max_carica))

    # Spende slancio
    new_state = update_unit(state, attacker.id, slancio=attacker.slancio - clamped)
    new_pending = PendingAction(
        attacker_id=pa.attacker_id, target_id=pa.target_id,
        weapon_id=pa.weapon_id, attack_mode_idx=pa.attack_mode_idx,
        is_ranged=pa.is_ranged, chosen_stat=pa.chosen_stat,
        attacker_dice=pa.attacker_dice,
        defense_type=pa.defense_type, defense_dice_n=pa.defense_dice_n,
        defense_parry_with=pa.defense_parry_with,
        carica_amount=clamped,
    )
    new_state = _state_with(new_state, phase="declaring-attack", pending_action=new_pending)
    if clamped > 0:
        new_state = append_log(
            new_state,
            f"{attacker.name}: carica +{clamped} (delta_dist={delta}, slancio -{clamped})",
        )
    return new_state


# ---------------------------------------------------------------------------
# TOGGLE_DEFENSIVE (Fase 1)
# ---------------------------------------------------------------------------


def _do_toggle_defensive(state: GameState, unit_id: str) -> GameState:
    """Posizione difensiva: max 1 toggle per turno. Solo scudi veri.

    Azione gratuita (non consuma dadi azione né slancio). Solo in choosing-action.
    """
    rj = _ensure_phase(state, "TOGGLE_DEFENSIVE", ["choosing-action"])
    if rj is not None:
        return rj
    unit = state.units.get(unit_id)
    if unit is None:
        return _reject(state, "TOGGLE_DEFENSIVE", f"unit {unit_id} non trovata")
    if unit.id != state.turn_order[state.current_turn_idx]:
        return _reject(state, "TOGGLE_DEFENSIVE", f"non è il turno di {unit_id}")
    if unit.defensive_toggled_this_turn:
        return _reject(state, "TOGGLE_DEFENSIVE", "già toggled in questo turno")
    # Verifica: ha uno scudo VERO in offhand?
    if unit.offhand is None:
        return _reject(state, "TOGGLE_DEFENSIVE", "no offhand")
    from hex_tactics.data.shields import get_shield
    sh = get_shield(unit.offhand)
    if sh is None:
        return _reject(state, "TOGGLE_DEFENSIVE", "offhand non è uno scudo")

    new_stance = not unit.defensive_stance
    new_state = update_unit(
        state, unit_id,
        defensive_stance=new_stance,
        defensive_toggled_this_turn=True,
    )
    label = "ATTIVA" if new_stance else "DISATTIVA"
    new_state = append_log(new_state, f"{unit.name}: {label} posizione difensiva con {sh.name}")
    return new_state


# ---------------------------------------------------------------------------
# CHOOSE_DEFENSE
# ---------------------------------------------------------------------------


def _do_choose_defense(state: GameState, e: EventChooseDefense) -> GameState:
    rj = _ensure_phase(state, "CHOOSE_DEFENSE", ["awaiting-defense"])
    if rj is not None:
        return rj
    if state.pending_action is None:
        return _reject(state, "CHOOSE_DEFENSE", "pendingAction mancante")
    if e.dice_n < 0:
        return _reject(state, "CHOOSE_DEFENSE", f"diceN negativo ({e.dice_n})")

    pa = state.pending_action
    new_pending = PendingAction(
        attacker_id=pa.attacker_id,
        target_id=pa.target_id,
        weapon_id=pa.weapon_id,
        attack_mode_idx=pa.attack_mode_idx,
        is_ranged=pa.is_ranged,
        chosen_stat=pa.chosen_stat,
        attacker_dice=pa.attacker_dice,
        defense_type=e.defense_type,
        defense_dice_n=e.dice_n,
        defense_parry_with=e.parry_with,
    )
    return _state_with(state, phase="resolving", pending_action=new_pending)


# ---------------------------------------------------------------------------
# RESOLVE_COMBAT
# ---------------------------------------------------------------------------


def _do_resolve_combat(state: GameState) -> GameState:
    rj = _ensure_phase(state, "RESOLVE_COMBAT", ["resolving"])
    if rj is not None:
        return rj
    if state.pending_action is None:
        return _reject(state, "RESOLVE_COMBAT", "pendingAction mancante")
    pa = state.pending_action
    if pa.attacker_dice is None:
        return _reject(state, "RESOLVE_COMBAT", "attackerDice non scelti")
    if not pa.is_ranged and pa.defense_type is None:
        return _reject(state, "RESOLVE_COMBAT", "difesa CaC non scelta")
    attacker = state.units.get(pa.attacker_id)
    target = state.units.get(pa.target_id)
    if attacker is None:
        return _reject(state, "RESOLVE_COMBAT", f"attaccante {pa.attacker_id} non trovato")
    if target is None:
        return _reject(state, "RESOLVE_COMBAT", f"target {pa.target_id} non trovato")

    rng = create_rng(state.rng_seed)

    if pa.is_ranged:
        los = compute_los(attacker, target, state.units)
        att_roll = compose_ranged_attack_roll(
            attacker,
            pa.weapon_id,
            pa.attack_mode_idx,
            pa.chosen_stat,  # type: ignore[arg-type]
            pa.attacker_dice,
            target,
            los,
            rng,
            carica_amount=pa.carica_amount,
        )
        result = resolve_no_defense(att_roll)
    else:
        att_roll = compose_attack_roll(
            attacker,
            pa.weapon_id,
            pa.attack_mode_idx,
            pa.chosen_stat,  # type: ignore[arg-type]
            pa.attacker_dice,
            rng,
            target=target,
            carica_amount=pa.carica_amount,
        )
        if pa.defense_type == "dodge":
            dodge_roll = compose_dodge_roll(target, pa.defense_dice_n or 0, rng)
            result = resolve_dodge(att_roll, dodge_roll)
        elif pa.defense_type == "parry":
            parry_with = pa.defense_parry_with if pa.defense_parry_with is not None else "weapon"
            parry_roll = compose_parry_roll(target, parry_with, pa.defense_dice_n or 0, rng)
            if parry_roll is None:
                result = resolve_no_defense(att_roll)
            else:
                result = resolve_parry(att_roll, parry_roll)
        else:
            result = resolve_no_defense(att_roll)

    # Spendi dadi azione attaccante
    new_state: GameState = state
    weapon_data = get_weapon(pa.weapon_id)
    become_unloaded = pa.is_ranged and (
        weapon_data is not None and weapon_data.range is not None and weapon_data.range.reload is not None
    )
    patch = dict(
        dadi_azione=max(0, attacker.dadi_azione - pa.attacker_dice),
        action_taken_this_turn=True,
    )
    if become_unloaded:
        patch["weapon_loaded"] = False
    new_state = update_unit(new_state, attacker.id, **patch)

    if (not pa.is_ranged) and pa.defense_type is not None and pa.defense_type != "none":
        new_state = update_unit(
            new_state,
            target.id,
            dadi_azione=max(0, target.dadi_azione - (pa.defense_dice_n or 0)),
        )

    # Log dei tiri
    att_var_str = ",".join(str(v) for v in att_roll.variable)
    att_descr = (
        f"var=[{att_var_str}](sum {variable_sum(att_roll)}) + fix {att_roll.fixed} "
        f"= total {roll_total(att_roll)}"
    )
    new_state = append_log(
        new_state,
        f"{attacker.name} tira "
        f"{'attacco ranged' if pa.is_ranged else 'attacco'}: {att_descr}",
    )
    if (not pa.is_ranged) and pa.defense_type is not None and pa.defense_type != "none":
        dr = result.defender_roll
        dr_var_str = ",".join(str(v) for v in dr.variable)
        def_descr = f"var=[{dr_var_str}](sum {variable_sum(dr)}) + fix {dr.fixed} = total {roll_total(dr)}"
        new_state = append_log(
            new_state, f"{target.name} tira {pa.defense_type}: {def_descr}"
        )

    # Apply result
    if result.hit:
        # D-043: ranged "il tiro È il danno"; RD già pagata al tiro → niente RD ulteriore
        if pa.is_ranged:
            effective_damage = result.raw_damage
            new_hp = max(0, target.hp - result.raw_damage)
        else:
            dmg = apply_damage_with_armor(target, result.raw_damage)
            effective_damage = dmg.effective_damage
            new_hp = dmg.new_hp
        new_state = update_unit(
            new_state, target.id, hp=new_hp, alive=new_hp > 0
        )
        new_state = append_log(
            new_state,
            f"{attacker.name} colpisce {target.name} per {effective_damage} danni "
            f"(raw {result.raw_damage}, RD {result.raw_damage - effective_damage}). "
            f"HP: {new_hp}/{target.hp_max}",
        )
        # D-048: contraccolpo allo slancio del difensore = rawDamage (PRE-RD)
        if result.raw_damage > 0:
            target_after_hit = new_state.units.get(target.id)
            if target_after_hit is not None and target_after_hit.alive:
                updated = apply_slancio_penalty(target_after_hit, result.raw_damage)
                new_state = update_unit(
                    new_state, target.id, slancio=updated.slancio, impeto=updated.impeto
                )
                new_state = append_log(
                    new_state,
                    f"{target.name} contraccolpo: -{result.raw_damage} slancio "
                    f"(slancio {updated.slancio}, impeto {updated.impeto})",
                )
        if new_hp == 0:
            new_state = append_log(new_state, f"{target.name} è caduto!")
    else:
        # Miss
        if pa.is_ranged:
            new_state = append_log(
                new_state,
                f"{attacker.name} manca {target.name} (tiro {roll_total(att_roll)} <= 0 dopo malus)",
            )
        elif pa.defense_type is not None:
            if result.slancio_penalty_to_attacker > 0:
                updated = apply_slancio_penalty(attacker, result.slancio_penalty_to_attacker)
                new_state = update_unit(
                    new_state,
                    attacker.id,
                    slancio=updated.slancio,
                    impeto=updated.impeto,
                )
                new_state = append_log(
                    new_state,
                    f"{target.name} ha "
                    f"{'parato' if pa.defense_type == 'parry' else 'schivato'}. "
                    f"{attacker.name} perde {result.slancio_penalty_to_attacker} slancio",
                )
            else:
                new_state = append_log(
                    new_state,
                    f"{target.name} ha "
                    f"{'parato' if pa.defense_type == 'parry' else 'schivato'} senza penalty",
                )

    # V2: applicazione slancio loss da imp variabile (atk/def). Cumulativo a
    # slancio_penalty_to_attacker se entrambi presenti. Floor a 0 sul totale.
    if result.slancio_loss_attacker_imp > 0:
        atk_now = new_state.units.get(attacker.id)
        if atk_now is not None and atk_now.alive:
            updated = apply_slancio_penalty(atk_now, result.slancio_loss_attacker_imp)
            new_state = update_unit(
                new_state, attacker.id, slancio=updated.slancio, impeto=updated.impeto
            )
            new_state = append_log(
                new_state,
                f"{attacker.name} impedimento eccessivo: "
                f"-{result.slancio_loss_attacker_imp} slancio "
                f"(sl {updated.slancio}, imp {updated.impeto})",
            )
    if result.slancio_loss_defender_imp > 0:
        def_now = new_state.units.get(target.id)
        if def_now is not None and def_now.alive:
            updated = apply_slancio_penalty(def_now, result.slancio_loss_defender_imp)
            new_state = update_unit(
                new_state, target.id, slancio=updated.slancio, impeto=updated.impeto
            )
            new_state = append_log(
                new_state,
                f"{target.name} impedimento eccessivo: "
                f"-{result.slancio_loss_defender_imp} slancio "
                f"(sl {updated.slancio}, imp {updated.impeto})",
            )

    return _state_with(
        new_state, phase="choosing-action", pending_action=None, rng_seed=rng.get_state()
    )


# ---------------------------------------------------------------------------
# RELOAD
# ---------------------------------------------------------------------------


def _do_reload(state: GameState, unit_id: str, dice_n: int) -> GameState:
    rj = _ensure_phase(state, "RELOAD", ["choosing-action"])
    if rj is not None:
        return rj
    unit = state.units.get(unit_id)
    if unit is None:
        return _reject(state, "RELOAD", f"unit {unit_id} non trovata")
    if unit.id != state.turn_order[state.current_turn_idx]:
        return _reject(state, "RELOAD", f"non è il turno di {unit_id}")
    if dice_n < 1:
        return _reject(state, "RELOAD", "diceN < 1 (minimo 1 dado per ricaricare)")
    if unit.dadi_azione < dice_n:
        return _reject(state, "RELOAD", f"dadi azione insufficienti ({unit.dadi_azione} < {dice_n})")
    if not unit.weapon:
        return _reject(state, "RELOAD", "nessuna arma equipaggiata")
    weapon = get_weapon(unit.weapon)
    if weapon is None:
        return _reject(state, "RELOAD", "arma non trovata")
    if weapon.range is None or weapon.range.reload is None:
        return _reject(state, "RELOAD", "arma non richiede ricarica")
    if unit.weapon_loaded:
        return _reject(state, "RELOAD", "arma già carica")
    if unit.action_taken_this_turn:
        return _reject(state, "RELOAD", f"{unit_id} ha già usato la sua azione questo turno")

    ctx = RollContext(
        azione="ricaricare",
        stat="forza",
        classe_oggetto=weapon.category,
        oggetto_specifico=weapon.id,
    )
    rng = create_rng(state.rng_seed)
    actual_dice = get_actual_dice_count(unit, ctx, dice_n)
    roll = make_roll(rng, actual_dice, BASE_PG_FIXED)
    roll.fixed += count_flat_bonuses(unit.skills, ctx)
    # V2: imp alla VARIABILE (non più fissa).
    roll.variable_mod -= get_impediment_total(unit)
    # forced extra già contabilizzato in get_actual_dice_count; calcolato qui solo per parità con TS (no-op)
    _ = count_forced_extra_dice(unit.skills, ctx)

    total = roll_total(roll)
    difficulty = weapon.range.reload
    success = total >= difficulty

    new_state = update_unit(
        state,
        unit_id,
        dadi_azione=max(0, unit.dadi_azione - dice_n),
        weapon_loaded=success or unit.weapon_loaded,
        action_taken_this_turn=True,
    )
    var_str = ",".join(str(v) for v in roll.variable)
    new_state = append_log(
        new_state,
        f"{unit.name}: ricarica {weapon.name} "
        f"(var=[{var_str}] sum {variable_sum(roll)} + fix {roll.fixed} "
        f"= {total} vs diff {difficulty}) → "
        f"{'CARICA ✓' if success else 'fallita, ritenta'}",
    )
    # NB: il TS non avanza rng_seed in RELOAD! Ricontrollare:
    # ... [legge il TS] ... non c'è `rngSeed: rng.getState()` in doReload.
    # Quindi il seed RESTA quello pre-reload (una potenziale stranezza, ma è il TS
    # source of truth → replichiamo fedelmente). Niente set di rng_seed qui.
    return new_state


# ---------------------------------------------------------------------------
# END_TURN
# ---------------------------------------------------------------------------


def _do_end_turn(state: GameState) -> GameState:
    rj = _ensure_phase(state, "END_TURN", ["choosing-action", "turn-start"])
    if rj is not None:
        return rj
    if state.pending_action is not None:
        return _reject(state, "END_TURN", "pendingAction in corso, completarlo prima")

    next_idx = state.current_turn_idx + 1
    while next_idx < len(state.turn_order):
        u = state.units.get(state.turn_order[next_idx])
        if u is not None and u.alive:
            break
        next_idx += 1
    if next_idx >= len(state.turn_order):
        return _do_end_round(state)
    return _state_with(state, current_turn_idx=next_idx, phase="turn-start")


# ---------------------------------------------------------------------------
# END_ROUND
# ---------------------------------------------------------------------------


def _do_end_round(state: GameState) -> GameState:
    winner = check_game_over(state.units)
    if winner is not None:
        s = append_log(
            state,
            f"Game over: vincitore "
            f"{'pareggio' if winner == 'draw' else f'fazione {winner}'}",
        )
        return _state_with(s, phase="game-over", winner=winner)
    return _do_start_round(state)


__all__ = ["reduce"]

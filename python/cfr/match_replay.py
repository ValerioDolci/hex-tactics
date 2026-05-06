"""Match Replay: carica un modello Deep CFR e simula partite con tracking turn-by-turn.

Produce trace strutturate (per analisi automatica) + rendering narrativo (per lettura umana).

Usage:
    from cfr.match_replay import MatchReplay
    mr = MatchReplay.from_dir("path/to/deep_cfr_lanc_inv_vs_spa")
    traces = mr.simulate(n_games=50, seed=42)
    print(mr.render_summary(traces))
    print(mr.render_narrative(traces[0]))
"""

from __future__ import annotations

import json
import sys
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

import numpy as np
import torch
import torch.nn as nn

# Garantiamo l'import del package locale anche se eseguito come script
_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))
sys.setrecursionlimit(20000)

from cfr.abstract_game import HexTacticsAbstractGame, MAX_ACTIONS, PLAYER_A, PLAYER_B
from cfr.abstraction import BuildSpec, SkillSpec
from hex_tactics.ai.obs_features_v2 import build_obs_v2, N_FEATURES_TOTAL_V2
from hex_tactics.core.hex import hex_distance


DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cpu")


# ──────────────────────────────────────────────────────────────────────────
# Network (must match deep_cfr_build.py)
# ──────────────────────────────────────────────────────────────────────────


class AdvNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES_TOTAL_V2, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, 256), nn.ReLU(),
            nn.Linear(256, MAX_ACTIONS),
        )

    def forward(self, x):
        return self.net(x)


def _reg_to_pol(r: np.ndarray, m: np.ndarray) -> np.ndarray:
    p = np.maximum(0, r) * m
    s = p.sum()
    if s > 1e-9:
        return p / s
    n = m.sum()
    return m / n if n > 0 else m


# ──────────────────────────────────────────────────────────────────────────
# Build loading
# ──────────────────────────────────────────────────────────────────────────


def load_build(path: str, name: str, exp_budget: int = 2000) -> BuildSpec:
    with open(path) as f:
        d = json.load(f)
    sk = tuple(SkillSpec(**s) for s in d.get("skills", []))
    return BuildSpec(
        weapon=d.get("weapon"),
        offhand=d.get("offhand"),
        armor=d.get("armor"),
        skills=sk,
        name=name,
        thrown_inventory=tuple(d.get("thrown_inventory", [])),
        backup_weapon=d.get("backup_weapon"),
        exp_budget=exp_budget,
    )


# ──────────────────────────────────────────────────────────────────────────
# Trace data structures
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class TraceStep:
    """Singolo step di una partita: chi sta giocando cosa, snapshot stato."""
    round: int
    phase: str
    player: str            # "A" or "B"
    event: str             # human-readable (es. "DECL_ATK[RANGED lancia_2m mode=0]")
    raw_type: str          # GameEvent.type (es. "DECLARE_ATTACK")
    hp_a: int
    hp_b: int
    sl_a: int
    sl_b: int
    imp_a: int
    imp_b: int
    d_a: int               # dadi azione A
    d_b: int
    dist: int              # distanza in hex tra A e B
    weap_loaded_a: bool
    weap_loaded_b: bool
    in_def_stance_a: bool
    in_def_stance_b: bool


@dataclass
class AttackEpisode:
    """Un singolo episodio di attacco: dichiarazione → difesa → esito.

    Ricostruito post-hoc dalla trace osservando il delta HP del target.
    """
    round: int
    attacker: str          # "A" or "B"
    target: str            # "A" or "B"
    weapon: str            # weapon_id
    is_ranged: bool
    distance: int          # hex distance al momento del DECLARE_ATTACK
    atk_dice: Optional[int] = None
    def_type: Optional[str] = None     # "parry" / "dodge" / "none" / None (ranged: nessuna scelta attiva)
    def_dice: Optional[int] = None
    parry_with: Optional[str] = None
    target_hp_before: int = 20
    target_hp_after: int = 20
    damage: int = 0
    hit: bool = False                  # True se damage > 0


@dataclass
class GameTrace:
    """Trace completa di una partita."""
    steps: List[TraceStep] = field(default_factory=list)
    returns: List[float] = field(default_factory=lambda: [0.0, 0.0])
    seed: int = 0
    episodes: List[AttackEpisode] = field(default_factory=list)

    @property
    def winner(self) -> str:
        if self.returns[0] > 0:
            return "A"
        if self.returns[1] > 0:
            return "B"
        return "draw"

    @property
    def n_rounds(self) -> int:
        return self.steps[-1].round if self.steps else 0

    @property
    def hp_a_final(self) -> int:
        return self.steps[-1].hp_a if self.steps else 20

    @property
    def hp_b_final(self) -> int:
        return self.steps[-1].hp_b if self.steps else 20


def _extract_episodes(trace: GameTrace) -> List[AttackEpisode]:
    """Ricostruisce gli episodi di attacco dalla sequenza di step.

    Pattern atteso nei step:
        DECLARE_ATTACK (atk player, weapon, is_ranged, [target_id implicito])
        [CHOOSE_CARICA] (atk player, opzionale)
        CHOOSE_ATTACKER_DICE (atk player, dice_n)
        [CHOOSE_DEFENSE] (target player, defense_type, dice_n) — solo per CaC
        ... (resolve auto-applicato fra gli step, hp del target può variare)

    Damage = hp_target_pre_DECLARE − hp_target_min_within_window.
    """
    episodes: List[AttackEpisode] = []
    steps = trace.steps
    i = 0
    while i < len(steps):
        s = steps[i]
        if s.raw_type == "DECLARE_ATTACK":
            # Estrai weapon + is_ranged + chi è il target dal suffisso
            ev_str = s.event  # "DECL_ATK[RANGED lancia_2m mode=0]" or "DECL_ATK[MELEE ...]"
            try:
                inner = ev_str.split("[", 1)[1].rstrip("]")
                kind, weapon, _ = inner.split(" ", 2)
                is_ranged = kind == "RANGED"
            except Exception:
                weapon = "?"
                is_ranged = False
            attacker = s.player
            target = "B" if attacker == "A" else "A"
            target_hp_before = s.hp_b if target == "B" else s.hp_a
            ep = AttackEpisode(
                round=s.round,
                attacker=attacker,
                target=target,
                weapon=weapon,
                is_ranged=is_ranged,
                distance=s.dist,
                target_hp_before=target_hp_before,
            )
            # Scan forward per atk_dice + def_choice + nuovo HP
            j = i + 1
            min_hp = target_hp_before
            while j < len(steps):
                sj = steps[j]
                # Se inizia un nuovo episodio (DECLARE_ATTACK), termina questo
                if sj.raw_type == "DECLARE_ATTACK":
                    break
                # Aggiorno hp_target visto fino ad ora
                hp_t = sj.hp_b if target == "B" else sj.hp_a
                if hp_t < min_hp:
                    min_hp = hp_t
                if sj.raw_type == "CHOOSE_ATTACKER_DICE":
                    try:
                        ep.atk_dice = int(sj.event.split("[")[1].rstrip("]"))
                    except Exception:
                        pass
                elif sj.raw_type == "CHOOSE_DEFENSE":
                    try:
                        inner = sj.event.split("[")[1].rstrip("]")
                        parts = inner.split()
                        ep.def_type = parts[0]
                        for p in parts[1:]:
                            if p.startswith("d"):
                                ep.def_dice = int(p[1:])
                            elif p.startswith("w/"):
                                ep.parry_with = p[2:]
                    except Exception:
                        pass
                # Se siamo abbastanza avanti (>=8 step dal DECLARE) o cambia round, chiudo episodio
                if sj.round != s.round and j > i + 4:
                    break
                j += 1
            ep.target_hp_after = min_hp
            ep.damage = max(0, target_hp_before - min_hp)
            ep.hit = ep.damage > 0
            episodes.append(ep)
            i = j
            continue
        i += 1
    return episodes


def _event_to_str(ev) -> str:
    """Compatta un GameEvent in stringa human-readable."""
    if ev is None:
        return "?"
    t = ev.type
    if t == "DECLARE_ATTACK":
        kind = "RANGED" if ev.is_ranged else "MELEE"
        return f"DECL_ATK[{kind} {ev.weapon_id} mode={ev.attack_mode_idx}]"
    if t == "CHOOSE_ATTACKER_DICE":
        return f"ATK_DICE[{ev.dice_n}]"
    if t == "CHOOSE_DEFENSE":
        parts = [ev.defense_type]
        if ev.dice_n:
            parts.append(f"d{ev.dice_n}")
        if ev.parry_with:
            parts.append(f"w/{ev.parry_with}")
        return f"DEF[{' '.join(parts)}]"
    if t == "MOVE":
        return f"MOVE[->{ev.target_hex.q},{ev.target_hex.r}]"
    if t == "RELOAD":
        return f"RELOAD[d{ev.dice_n}]"
    if t == "START_TURN":
        return f"START_TURN[s_dice={ev.slancio_dice} imp2sl={ev.impeto_to_slancio}]"
    if t == "BID_MOVEMENT":
        return f"BID[{ev.amount}]"
    if t == "TOGGLE_DEFENSIVE":
        return "TOGGLE_DEF"
    if t == "CHOOSE_CARICA":
        return f"CARICA[{ev.amount}]"
    return t


# ──────────────────────────────────────────────────────────────────────────
# MatchReplay
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class MatchReplay:
    label: str
    build_a: BuildSpec
    build_b: BuildSpec
    nets: List[AdvNet]
    metadata: Dict[str, Any]
    max_rounds: int = 12

    @classmethod
    def from_dir(cls, model_dir: str | Path, max_rounds: int = 12) -> "MatchReplay":
        model_dir = Path(model_dir)
        meta_path = model_dir / "metadata.json"
        meta = json.load(open(meta_path))

        ba = load_build(meta["build_a"], "A")
        bb = load_build(meta["build_b"], "B")

        nets = []
        for p in range(2):
            net = AdvNet().to(DEVICE)
            net.load_state_dict(torch.load(model_dir / f"adv_net_p{p}.pt", map_location=DEVICE))
            net.eval()
            nets.append(net)

        return cls(label=meta["label"], build_a=ba, build_b=bb, nets=nets, metadata=meta, max_rounds=max_rounds)

    def _make_game(self, seed: int) -> HexTacticsAbstractGame:
        g = HexTacticsAbstractGame.from_build_specs(self.build_a, self.build_b, seed=seed, max_rounds=self.max_rounds)
        g.variable_initial_state = True
        return g

    def _policy(self, net: AdvNet, state, mask: np.ndarray) -> np.ndarray:
        cfr = state._cfr_state
        gs = cfr.game_state
        cur = state.current_player()
        fa = "A" if cur == PLAYER_A else "B"
        feat = np.array(
            build_obs_v2(gs, agent_faction=fa, history_self=[], history_enemy=[],
                         enforce_simultaneous_privacy=False),
            dtype=np.float32,
        )
        x = torch.from_numpy(feat).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            r = net(x).cpu().numpy()[0]
        return _reg_to_pol(r, mask)

    def _trace_step(self, st, ev) -> TraceStep:
        gs = st._cfr_state.game_state
        units = list(gs.units.values())
        ua = next((u for u in units if u.faction == "A"), None)
        ub = next((u for u in units if u.faction == "B"), None)
        cur = st.current_player()
        return TraceStep(
            round=gs.round,
            phase=gs.phase,
            player="A" if cur == PLAYER_A else "B",
            event=_event_to_str(ev),
            raw_type=ev.type if ev else "?",
            hp_a=ua.hp if ua else 0,
            hp_b=ub.hp if ub else 0,
            sl_a=ua.slancio if ua else 0,
            sl_b=ub.slancio if ub else 0,
            imp_a=ua.impeto if ua else 0,
            imp_b=ub.impeto if ub else 0,
            d_a=ua.dadi_azione if ua else 0,
            d_b=ub.dadi_azione if ub else 0,
            dist=hex_distance(ua.position, ub.position) if (ua and ub) else 0,
            weap_loaded_a=ua.weapon_loaded if ua else True,
            weap_loaded_b=ub.weapon_loaded if ub else True,
            in_def_stance_a=ua.defensive_stance if ua else False,
            in_def_stance_b=ub.defensive_stance if ub else False,
        )

    def simulate_one(self, seed: int) -> GameTrace:
        g = self._make_game(seed)
        st = g.new_initial_state()
        rng = np.random.default_rng(seed)
        trace = GameTrace(seed=seed)
        while not st.is_terminal():
            cur = st.current_player()
            if cur < 0:
                l = st.legal_actions()
                if not l:
                    break
                st.apply_action(l[0])
                continue
            legal = st.legal_actions()
            events = st._model.get_legal_events(st._cfr_state)
            mask = np.zeros(MAX_ACTIONS, dtype=np.float32)
            for a in legal:
                mask[a] = 1
            ps = self._policy(self.nets[cur], st, mask)
            a = int(rng.choice(MAX_ACTIONS, p=ps))
            ev = events[a] if a < len(events) else None
            trace.steps.append(self._trace_step(st, ev))
            st.apply_action(a)
        if st.is_terminal():
            trace.returns = list(st.returns())
        trace.episodes = _extract_episodes(trace)
        return trace

    def simulate(self, n_games: int = 50, seed_base: int = 42) -> List[GameTrace]:
        return [self.simulate_one(seed_base + i * 7919) for i in range(n_games)]

    # ── Aggregation ──

    def aggregate(self, traces: List[GameTrace]) -> Dict[str, Any]:
        n = len(traces)
        wins_a = sum(1 for t in traces if t.winner == "A")
        wins_b = sum(1 for t in traces if t.winner == "B")
        draws = n - wins_a - wins_b

        events_by_player = {"A": Counter(), "B": Counter()}
        atk_dice_by_player = {"A": Counter(), "B": Counter()}
        def_choice_by_player = {"A": Counter(), "B": Counter()}
        first_atk_dist = {"A": [], "B": []}
        rounds_per_game = []
        final_hp = {"A": [], "B": []}

        for t in traces:
            seen_first = {"A": False, "B": False}
            for s in t.steps:
                p = s.player
                events_by_player[p][s.raw_type] += 1
                if s.raw_type == "CHOOSE_ATTACKER_DICE":
                    try:
                        d = int(s.event.split("[")[1].rstrip("]"))
                        atk_dice_by_player[p][d] += 1
                    except Exception:
                        pass
                if s.raw_type == "CHOOSE_DEFENSE":
                    try:
                        inner = s.event.split("[")[1].rstrip("]")
                        dtype = inner.split()[0]
                        def_choice_by_player[p][dtype] += 1
                    except Exception:
                        pass
                if s.raw_type == "DECLARE_ATTACK" and not seen_first[p]:
                    first_atk_dist[p].append(s.dist)
                    seen_first[p] = True
            if t.steps:
                rounds_per_game.append(t.n_rounds)
                final_hp["A"].append(t.hp_a_final)
                final_hp["B"].append(t.hp_b_final)

        # Combat episodes statistics
        combat = {"A": {"n": 0, "hits": 0, "dmg_total": 0, "ranged": 0, "melee": 0,
                        "by_def": Counter(), "dmg_when_hit": []},
                  "B": {"n": 0, "hits": 0, "dmg_total": 0, "ranged": 0, "melee": 0,
                        "by_def": Counter(), "dmg_when_hit": []}}
        for t in traces:
            for ep in t.episodes:
                c = combat[ep.attacker]
                c["n"] += 1
                if ep.hit:
                    c["hits"] += 1
                    c["dmg_when_hit"].append(ep.damage)
                c["dmg_total"] += ep.damage
                if ep.is_ranged:
                    c["ranged"] += 1
                else:
                    c["melee"] += 1
                # outcome chiave: difesa scelta (None per ranged)
                key = ep.def_type if ep.def_type else "n/a"
                # marker speciale: hit/parato
                key += "_hit" if ep.hit else "_blocked"
                c["by_def"][key] += 1

        def _combat_summary(c):
            if c["n"] == 0:
                return {"n_attempts": 0}
            return {
                "n_attempts": c["n"],
                "hit_rate": c["hits"] / c["n"],
                "dmg_total": c["dmg_total"],
                "dmg_per_attempt": c["dmg_total"] / c["n"],
                "dmg_per_hit_mean": float(np.mean(c["dmg_when_hit"])) if c["dmg_when_hit"] else 0,
                "dmg_per_hit_max": int(np.max(c["dmg_when_hit"])) if c["dmg_when_hit"] else 0,
                "ranged_attempts": c["ranged"],
                "melee_attempts": c["melee"],
                "outcomes_by_defense": dict(c["by_def"].most_common()),
            }

        return {
            "label": self.label,
            "n_games": n,
            "wins_A": wins_a,
            "wins_B": wins_b,
            "draws": draws,
            "v_a_proxy": (wins_a - wins_b) / n if n else None,
            "v_a_train": self.metadata.get("v_a_final"),
            "events_A": dict(events_by_player["A"].most_common()),
            "events_B": dict(events_by_player["B"].most_common()),
            "atk_dice_A": dict(atk_dice_by_player["A"]),
            "atk_dice_B": dict(atk_dice_by_player["B"]),
            "def_choice_A": dict(def_choice_by_player["A"]),
            "def_choice_B": dict(def_choice_by_player["B"]),
            "first_atk_dist_A_mean": float(np.mean(first_atk_dist["A"])) if first_atk_dist["A"] else None,
            "first_atk_dist_B_mean": float(np.mean(first_atk_dist["B"])) if first_atk_dist["B"] else None,
            "first_atk_dist_A_n": len(first_atk_dist["A"]),
            "first_atk_dist_B_n": len(first_atk_dist["B"]),
            "rounds_per_game_mean": float(np.mean(rounds_per_game)) if rounds_per_game else None,
            "rounds_per_game_max": int(np.max(rounds_per_game)) if rounds_per_game else None,
            "hp_A_final_mean": float(np.mean(final_hp["A"])) if final_hp["A"] else None,
            "hp_B_final_mean": float(np.mean(final_hp["B"])) if final_hp["B"] else None,
            "combat_A": _combat_summary(combat["A"]),
            "combat_B": _combat_summary(combat["B"]),
        }

    # ── Per-round aggregation (modal flow narrative) ──

    def aggregate_by_round(self, traces: List[GameTrace], max_rounds: int = 8) -> Dict[int, Dict[str, Any]]:
        """Per ogni round R, per ogni player P, aggrega:
        - frequenza eventi (% partite in cui appaiono in quel round)
        - stato medio fine-round: HP, slancio, impeto, distanza
        - sequenza tipica di azioni (es. "START_TURN → MOVE×3 → DECL_ATK[RANGED]")

        Output: {round: {"A": {...}, "B": {...}, "n_games": ...}}
        """
        per_round: Dict[int, Dict[str, Any]] = {}
        # Per ogni (round, player) raccolgo: lista di eventi, last step state
        for r in range(1, max_rounds + 1):
            per_round[r] = {
                "A": {"events_per_game": [], "end_state": {"hp": [], "sl": [], "imp": [], "dist": [], "in_def": []}},
                "B": {"events_per_game": [], "end_state": {"hp": [], "sl": [], "imp": [], "dist": [], "in_def": []}},
                "n_games_reaching": 0,
                "n_games_ending_here": 0,
            }
        for trace in traces:
            if not trace.steps:
                continue
            steps_by_round: Dict[int, List[TraceStep]] = {}
            for s in trace.steps:
                steps_by_round.setdefault(s.round, []).append(s)
            max_r = max(steps_by_round.keys())
            for r, steps in steps_by_round.items():
                if r > max_rounds:
                    continue
                per_round[r]["n_games_reaching"] += 1
                if r == max_r:
                    per_round[r]["n_games_ending_here"] += 1
                # Suddividi per player
                ev_a, ev_b = [], []
                for s in steps:
                    info_types = {"MOVE", "DECLARE_ATTACK", "CHOOSE_ATTACKER_DICE", "CHOOSE_DEFENSE",
                                  "RELOAD", "BID_MOVEMENT", "TOGGLE_DEFENSIVE", "CHOOSE_CARICA"}
                    if s.raw_type not in info_types:
                        continue
                    target_list = ev_a if s.player == "A" else ev_b
                    target_list.append(s.event)
                per_round[r]["A"]["events_per_game"].append(ev_a)
                per_round[r]["B"]["events_per_game"].append(ev_b)
                last_step = steps[-1]
                per_round[r]["A"]["end_state"]["hp"].append(last_step.hp_a)
                per_round[r]["A"]["end_state"]["sl"].append(last_step.sl_a)
                per_round[r]["A"]["end_state"]["imp"].append(last_step.imp_a)
                per_round[r]["A"]["end_state"]["dist"].append(last_step.dist)
                per_round[r]["A"]["end_state"]["in_def"].append(last_step.in_def_stance_a)
                per_round[r]["B"]["end_state"]["hp"].append(last_step.hp_b)
                per_round[r]["B"]["end_state"]["sl"].append(last_step.sl_b)
                per_round[r]["B"]["end_state"]["imp"].append(last_step.imp_b)
                per_round[r]["B"]["end_state"]["dist"].append(last_step.dist)
                per_round[r]["B"]["end_state"]["in_def"].append(last_step.in_def_stance_b)
        # Compatto in stats: frequenza eventi, end-state mean
        out = {}
        for r in range(1, max_rounds + 1):
            ng = per_round[r]["n_games_reaching"]
            if ng == 0:
                continue
            entry: Dict[str, Any] = {
                "n_games_reaching": ng,
                "n_games_ending_here": per_round[r]["n_games_ending_here"],
            }
            for p in ("A", "B"):
                ev_lists = per_round[r][p]["events_per_game"]
                # Frequenza eventi (per categoria)
                cat_counter: Counter = Counter()
                detail_counter: Counter = Counter()
                for ev_list in ev_lists:
                    cats_seen = set()
                    for ev in ev_list:
                        cat = ev.split("[")[0].strip()
                        cats_seen.add(cat)
                        detail_counter[ev] += 1
                    for cat in cats_seen:
                        cat_counter[cat] += 1
                end = per_round[r][p]["end_state"]
                entry[p] = {
                    "n_games": ng,
                    "events_freq": [(cat, cnt, cnt/ng) for cat, cnt in cat_counter.most_common()],
                    "events_detail_top": detail_counter.most_common(8),
                    "n_actions_per_round_mean": float(np.mean([len(ev) for ev in ev_lists])),
                    "hp_end_mean": float(np.mean(end["hp"])),
                    "sl_end_mean": float(np.mean(end["sl"])),
                    "imp_end_mean": float(np.mean(end["imp"])),
                    "dist_end_mean": float(np.mean(end["dist"])),
                    "in_def_pct": float(np.mean(end["in_def"])),
                }
            out[r] = entry
        return out

    def render_round_narrative(self, traces: List[GameTrace], max_rounds: int = 8) -> str:
        """Render testuale del flow modale per round."""
        out = []
        out.append(f"## Flow modale {self.label} ({len(traces)} sim)")
        out.append("")
        out.append(f"_A: {self.build_a.weapon} + {self.build_a.offhand} / {self.build_a.armor}_  ")
        out.append(f"_B: {self.build_b.weapon} + {self.build_b.offhand} / {self.build_b.armor}_")
        out.append("")
        per_round = self.aggregate_by_round(traces, max_rounds=max_rounds)
        for r, entry in sorted(per_round.items()):
            ng = entry["n_games_reaching"]
            ng_end = entry["n_games_ending_here"]
            survival_pct = 100 * ng / len(traces)
            ending_pct = 100 * ng_end / len(traces)
            out.append(f"### Round {r}  ·  raggiunto {ng}/{len(traces)} ({survival_pct:.0f}%) · finisce qui {ng_end}/{len(traces)} ({ending_pct:.0f}%)")
            out.append("")
            for p in ("A", "B"):
                d = entry[p]
                out.append(f"**Player {p}**: {d['n_actions_per_round_mean']:.1f} azioni/round")
                # Eventi modali con %
                evs = []
                for cat, cnt, freq in d["events_freq"]:
                    if freq >= 0.3:  # solo se appare in ≥30% delle partite
                        evs.append(f"`{cat}` ({100*freq:.0f}%)")
                if evs:
                    out.append(f"- Azioni tipiche: {', '.join(evs)}")
                # Top eventi dettagliati (escludo MOVE singoli che sono rumore decisionale)
                tactical = [(ev, cnt) for ev, cnt in d["events_detail_top"]
                            if not ev.startswith("MOVE[")]
                top_detail = [f"`{ev}`×{cnt}" for ev, cnt in tactical[:5] if cnt >= ng * 0.15]
                if top_detail:
                    out.append(f"- Eventi tattici: {', '.join(top_detail)}")
                out.append(f"- Fine round: HP medio **{d['hp_end_mean']:.1f}**, slancio **{d['sl_end_mean']:.1f}**, impeto **{d['imp_end_mean']:.1f}**, distanza **{d['dist_end_mean']:.1f} hex**, in_def_stance {100*d['in_def_pct']:.0f}%")
                out.append("")
        return "\n".join(out)

    # ── Selection of representative traces ──

    def select_representative(self, traces: List[GameTrace], k: int = 4) -> List[Tuple[str, GameTrace]]:
        """Seleziona partite rappresentative: vittoria A veloce, vittoria A lunga, vittoria B (se esiste), draw lungo.

        Returns: list di (categoria, trace) tuple.
        """
        wins_a = [t for t in traces if t.winner == "A"]
        wins_b = [t for t in traces if t.winner == "B"]
        draws = [t for t in traces if t.winner == "draw"]

        chosen = []
        if wins_a:
            wa_fast = min(wins_a, key=lambda t: t.n_rounds)
            wa_long = max(wins_a, key=lambda t: t.n_rounds)
            chosen.append(("A_win_fastest", wa_fast))
            if wa_long is not wa_fast and wa_long.n_rounds >= wa_fast.n_rounds + 2:
                chosen.append(("A_win_longest", wa_long))
        if wins_b:
            wb_med = sorted(wins_b, key=lambda t: t.n_rounds)[len(wins_b) // 2]
            chosen.append(("B_win", wb_med))
        if draws:
            d_long = max(draws, key=lambda t: t.n_rounds)
            chosen.append(("draw_longest", d_long))
        return chosen[:k]

    # ── Markdown rendering ──

    def render_summary(self, stats: Dict[str, Any]) -> str:
        out = []
        out.append(f"## {stats['label']}")
        out.append("")
        out.append(f"- A: `{self.build_a.weapon}` + `{self.build_a.offhand}` / `{self.build_a.armor}`"
                   + (f" + lancio {list(self.build_a.thrown_inventory)}" if self.build_a.thrown_inventory else ""))
        out.append(f"- B: `{self.build_b.weapon}` + `{self.build_b.offhand}` / `{self.build_b.armor}`"
                   + (f" + lancio {list(self.build_b.thrown_inventory)}" if self.build_b.thrown_inventory else ""))
        out.append("")
        out.append("| Metric | A | B |")
        out.append("|---|---|---|")
        n = stats["n_games"]
        out.append(f"| Wins | {stats['wins_A']} ({100*stats['wins_A']/n:.0f}%) | {stats['wins_B']} ({100*stats['wins_B']/n:.0f}%) |")
        out.append(f"| Draws (totale) | {stats['draws']} ({100*stats['draws']/n:.0f}%) | — |")
        out.append(f"| HP finale medio | {stats['hp_A_final_mean']:.1f} | {stats['hp_B_final_mean']:.1f} |")
        out.append(f"| 1° atk distance | "
                   + (f"{stats['first_atk_dist_A_mean']:.1f}" if stats['first_atk_dist_A_mean'] else "—")
                   + f" ({stats['first_atk_dist_A_n']}/{n})"
                   + " | "
                   + (f"{stats['first_atk_dist_B_mean']:.1f}" if stats['first_atk_dist_B_mean'] else "—")
                   + f" ({stats['first_atk_dist_B_n']}/{n}) |")
        out.append(f"| Atk dice prefs | {stats['atk_dice_A']} | {stats['atk_dice_B']} |")
        out.append(f"| Def choice | {stats['def_choice_A']} | {stats['def_choice_B']} |")
        out.append(f"| TOGGLE_DEF count | {stats['events_A'].get('TOGGLE_DEFENSIVE', 0)} | {stats['events_B'].get('TOGGLE_DEFENSIVE', 0)} |")
        out.append(f"| MOVE count | {stats['events_A'].get('MOVE', 0)} | {stats['events_B'].get('MOVE', 0)} |")
        out.append(f"| RELOAD count | {stats['events_A'].get('RELOAD', 0)} | {stats['events_B'].get('RELOAD', 0)} |")
        out.append(f"| BID count | {stats['events_A'].get('BID_MOVEMENT', 0)} | {stats['events_B'].get('BID_MOVEMENT', 0)} |")
        out.append("")
        out.append(f"**Round medi**: {stats['rounds_per_game_mean']:.1f} (max {stats['rounds_per_game_max']})")
        out.append(f"**V_a sim**: {stats['v_a_proxy']:+.3f}  **V_a train**: {stats['v_a_train']:+.3f}")
        out.append("")
        out.append("### Combat episodes (per-attacker)")
        out.append("")
        ca, cb = stats.get("combat_A", {}), stats.get("combat_B", {})
        out.append("| Metric | A | B |")
        out.append("|---|---|---|")
        out.append(f"| Attacks attempted | {ca.get('n_attempts',0)} | {cb.get('n_attempts',0)} |")
        out.append(f"| Hit rate (hits / attempts) | "
                   + (f"{100*ca.get('hit_rate',0):.1f}%" if ca.get('n_attempts') else "—")
                   + " | "
                   + (f"{100*cb.get('hit_rate',0):.1f}%" if cb.get('n_attempts') else "—")
                   + " |")
        out.append(f"| Damage / attempt | "
                   + (f"{ca.get('dmg_per_attempt',0):.2f}" if ca.get('n_attempts') else "—")
                   + " | "
                   + (f"{cb.get('dmg_per_attempt',0):.2f}" if cb.get('n_attempts') else "—")
                   + " |")
        out.append(f"| Damage / hit (mean / max) | "
                   + (f"{ca.get('dmg_per_hit_mean',0):.1f} / {ca.get('dmg_per_hit_max',0)}" if ca.get('n_attempts') else "—")
                   + " | "
                   + (f"{cb.get('dmg_per_hit_mean',0):.1f} / {cb.get('dmg_per_hit_max',0)}" if cb.get('n_attempts') else "—")
                   + " |")
        out.append(f"| Ranged / Melee attempts | "
                   + (f"{ca.get('ranged_attempts',0)}/{ca.get('melee_attempts',0)}" if ca.get('n_attempts') else "—")
                   + " | "
                   + (f"{cb.get('ranged_attempts',0)}/{cb.get('melee_attempts',0)}" if cb.get('n_attempts') else "—")
                   + " |")
        out.append("")
        out.append(f"**Outcomes A** (def_type → hit/blocked count): `{ca.get('outcomes_by_defense', {})}`")
        out.append("")
        out.append(f"**Outcomes B**: `{cb.get('outcomes_by_defense', {})}`")
        return "\n".join(out)

    def render_narrative(self, trace: GameTrace, max_rounds_show: int = 12) -> str:
        """Rendering narrativo turn-by-turn di una singola partita."""
        out = []
        out.append(f"### Trace seed={trace.seed} — winner: **{trace.winner}** ({trace.n_rounds} round)")
        out.append("")
        # Raggruppo per round
        by_round: Dict[int, List[TraceStep]] = {}
        for s in trace.steps:
            by_round.setdefault(s.round, []).append(s)
        # Header iniziale: stato pre-partita
        if trace.steps:
            s0 = trace.steps[0]
            out.append(f"_Stato iniziale: A HP={s0.hp_a} sl={s0.sl_a} imp={s0.imp_a} | B HP={s0.hp_b} sl={s0.sl_b} imp={s0.imp_b} | dist={s0.dist} hex_")
            out.append("")
        for r in sorted(by_round.keys())[:max_rounds_show]:
            out.append(f"#### Round {r}")
            out.append("")
            # Prendo solo gli eventi "informativi" (no fasi auto-resolve)
            info_events = ["MOVE", "DECLARE_ATTACK", "CHOOSE_ATTACKER_DICE", "CHOOSE_DEFENSE",
                          "RELOAD", "BID_MOVEMENT", "TOGGLE_DEFENSIVE", "CHOOSE_CARICA", "START_TURN"]
            for s in by_round[r]:
                if s.raw_type not in info_events:
                    continue
                # Stato compatto
                hp = f"hp[A={s.hp_a}/B={s.hp_b}]"
                sl = f"sl[A={s.sl_a}/B={s.sl_b}]"
                stance = ""
                if s.in_def_stance_a or s.in_def_stance_b:
                    flags = []
                    if s.in_def_stance_a: flags.append("A_DEF")
                    if s.in_def_stance_b: flags.append("B_DEF")
                    stance = f" [{','.join(flags)}]"
                out.append(f"- **{s.player}** dist={s.dist} {hp} {sl}{stance}: `{s.event}`")
            out.append("")
        # Esito
        out.append(f"**Esito**: {trace.winner}, HP finali A={trace.hp_a_final} B={trace.hp_b_final}, returns={trace.returns}")
        return "\n".join(out)

    def render_full_report(self, traces: List[GameTrace], n_narrative: int = 4) -> str:
        stats = self.aggregate(traces)
        out = []
        out.append(self.render_summary(stats))
        out.append("")
        out.append("## Partite rappresentative")
        out.append("")
        reps = self.select_representative(traces, k=n_narrative)
        for cat, t in reps:
            out.append(f"### Categoria: `{cat}`")
            out.append("")
            out.append(self.render_narrative(t))
            out.append("")
        return "\n".join(out)


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Replay e analisi narrativa di un matchup Deep CFR.")
    ap.add_argument("model_dir", help="Path a deep_cfr_<label>/ con metadata.json + adv_net_p[01].pt")
    ap.add_argument("--n", type=int, default=50, help="Numero partite da simulare (default 50)")
    ap.add_argument("--seed", type=int, default=42, help="Seed base (default 42)")
    ap.add_argument("--out", default=None, help="File markdown di output (se omesso, stampa stdout)")
    ap.add_argument("--n-narrative", type=int, default=4, help="Numero partite rappresentative narrate (default 4)")
    ap.add_argument("--summary-only", action="store_true", help="Solo stats aggregate (no narrative)")
    ap.add_argument("--by-round", action="store_true",
                    help="Output flow modale per round (cosa fa A/B tipicamente al T1, T2, ecc.)")
    args = ap.parse_args()

    mr = MatchReplay.from_dir(args.model_dir)
    print(f"Loaded: {mr.label} (V_a_train={mr.metadata.get('v_a_final', '?')})", file=sys.stderr)
    print(f"Simulating {args.n} games...", file=sys.stderr)
    traces = mr.simulate(n_games=args.n, seed_base=args.seed)
    print(f"Done. Aggregating + rendering...", file=sys.stderr)

    if args.by_round:
        report = mr.render_summary(mr.aggregate(traces)) + "\n\n" + mr.render_round_narrative(traces)
    elif args.summary_only:
        report = mr.render_summary(mr.aggregate(traces))
    else:
        report = mr.render_full_report(traces, n_narrative=args.n_narrative)

    if args.out:
        with open(args.out, "w") as f:
            f.write(report)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(report)


if __name__ == "__main__":
    main()

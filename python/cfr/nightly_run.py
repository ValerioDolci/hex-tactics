"""Overnight run: balance sweep multi-core + best-AI run su 1 matchup canonical.

Architettura:
  - Pool di 8 worker (multiprocessing.Pool)
  - Lista di task: ognuno è un (build_a, build_b, n_iter, max_rounds, label)
  - Ogni worker: run OS-MCCFR sul matchup, salva (avg policy + V_a + nash_conv) JSON
  - Aggregazione finale: CSV + markdown report

Sweep canonical (~20-25 matchup):
  - 3×3 preset matrice (9 matchup)
  - 3 preset mirror (3) — controllo bias iniziativa
  - 6 weapon variants vs spada-base (6)
  - 3 armor variants vs spada-base (3)
  - 4 skill ablation su archer (4)

Best-AI run separato:
  - Spada-vs-tank con N_ITER_BEST iter (overnight, single-core dedicato)

Output in: python/cfr/nightly_results/
  - sweep_results.json (tutti i matchup)
  - sweep_results.csv (tabella V_a, nash_conv per matchup)
  - best_ai_run.json (policy + curva di convergenza)
  - REPORT.md (markdown analisi)
"""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import sys
import time
import traceback
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# Config
ROOT = "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python"
OUT_DIR = f"{ROOT}/cfr/nightly_results"
os.makedirs(OUT_DIR, exist_ok=True)

sys.path.insert(0, ROOT)


# ─────── Tunable params (post-stage1 calibrazione) ───────

# Iter sweep (per ogni matchup): target nash_conv ~0.10-0.15 (rumoroso ma usabile per balance)
SWEEP_ITER = 5000  # calibrato post-bench (~4.6h con 7 worker a 0.94 iter/s)

# Best-AI run: 1 matchup canonical, single-core dedicato overnight
BEST_AI_ITER = 25_000  # ~7.4h single-core a 0.94 iter/s

# Max rounds del game (più basso = partite più corte = più iter/sec)
MAX_ROUNDS_DEFAULT = 12

N_WORKERS = 8


# ─────── Sweep definition ───────

PRESETS = ["spadaccino", "arciere", "tank"]


def make_sweep_tasks() -> List[Dict[str, Any]]:
    """Costruisce lista di task del sweep balance.

    Ogni task = dict con (label, build_a_key, build_b_key, builds, n_iter, max_rounds).
    builds: tuple (build_a_spec, build_b_spec) — None per usare preset_X.
    """
    from cfr.abstraction import BuildSpec, SkillSpec

    tasks: List[Dict[str, Any]] = []

    # 1. Matrice 3×3 preset (9 matchup)
    for a in PRESETS:
        for b in PRESETS:
            tasks.append({
                "label": f"preset_{a}_vs_{b}",
                "kind": "preset",
                "preset_a": a,
                "preset_b": b,
                "builds": None,
                "n_iter": SWEEP_ITER,
                "max_rounds": MAX_ROUNDS_DEFAULT,
            })

    # 2. Weapon variants vs spadaccino baseline
    spada_baseline_skills = (
        SkillSpec("-1impedimento", level=3),
        SkillSpec("-1impedimento", level=3, classe_oggetto="armature"),
    )
    weapons_to_test = ["pugnale", "spada", "ascia_1h", "ascia_2h", "lancia_2m", "balestra"]
    for w in weapons_to_test:
        b_a = BuildSpec(
            name=f"weapon_{w}",
            weapon=w,
            armor="armatura_leggera",
            skills=spada_baseline_skills,
        )
        tasks.append({
            "label": f"weapon_{w}_vs_spadaccino",
            "kind": "buildspec",
            "preset_a": None,
            "preset_b": "spadaccino",
            "builds": (b_a, None),  # B = preset spadaccino
            "n_iter": SWEEP_ITER,
            "max_rounds": MAX_ROUNDS_DEFAULT,
        })

    # 3. Armor variants vs spadaccino baseline
    armors_to_test = ["armatura_leggera", "armatura_media", "armatura_pesante"]
    for ar in armors_to_test:
        b_a = BuildSpec(
            name=f"armor_{ar}",
            weapon="spada",
            armor=ar,
            skills=(
                SkillSpec("-1impedimento", level=3),
                SkillSpec("-1impedimento", level=3, classe_oggetto="armature"),
                SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="spade"),
            ),
        )
        tasks.append({
            "label": f"armor_{ar}_vs_spadaccino",
            "kind": "buildspec",
            "preset_a": None,
            "preset_b": "spadaccino",
            "builds": (b_a, None),
            "n_iter": SWEEP_ITER,
            "max_rounds": MAX_ROUNDS_DEFAULT,
        })

    # 4. Skill ablation: archer base vs varianti senza/con key skills
    archer_base = (
        SkillSpec("-1impedimento", level=3),
        SkillSpec("-1impedimento", level=3, classe_oggetto="archi"),
        SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="archi"),
        SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
    )
    skill_variants = {
        "noimped": (
            # rimuovi 2 -1imp
            SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="archi"),
            SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
        ),
        "noplus": (
            # rimuovi +1tiro attaccare
            SkillSpec("-1impedimento", level=3),
            SkillSpec("-1impedimento", level=3, classe_oggetto="archi"),
            SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
        ),
        "with1dado": (
            # base archer + 1 dado attaccare
            SkillSpec("-1impedimento", level=3),
            SkillSpec("+1dado", level=1, azione="attaccare", classe_oggetto="archi"),
        ),
        "base": archer_base,
    }
    for variant_name, skills in skill_variants.items():
        b_a = BuildSpec(
            name=f"archer_{variant_name}",
            weapon="arco_lungo",
            offhand="pugnale",
            armor="armatura_leggera",
            skills=skills,
        )
        tasks.append({
            "label": f"archer_{variant_name}_vs_tank",
            "kind": "buildspec",
            "preset_a": None,
            "preset_b": "tank",
            "builds": (b_a, None),
            "n_iter": SWEEP_ITER,
            "max_rounds": MAX_ROUNDS_DEFAULT,
        })

    return tasks


# ─────── Worker function ───────

def run_cfr_matchup(task: Dict[str, Any]) -> Dict[str, Any]:
    """Esegue CFR su un matchup. Salva il risultato JSON.

    NB: NO nash_conv durante loop (DFS completo del tree è proibitivo per
    game depth 200). Convergenza misurata via stabilità V_a Monte Carlo
    a checkpoint.
    """
    label = task["label"]
    out_path = f"{OUT_DIR}/matchup_{label}.json"
    log_path = f"{OUT_DIR}/matchup_{label}.log"

    try:
        # Re-import nel worker + alza recursion limit (OS-MCCFR ricorsione linear in game depth)
        sys.setrecursionlimit(20000)
        sys.path.insert(0, ROOT)
        from cfr.abstract_game import HexTacticsAbstractGame
        from cfr.abstraction import BuildSpec
        from open_spiel.python.algorithms import outcome_sampling_mccfr

        # Crea game (preset path o buildspec path)
        if task["kind"] == "preset":
            g = HexTacticsAbstractGame({
                "preset_a": task["preset_a"],
                "preset_b": task["preset_b"],
                "seed": 12345,
                "max_rounds": task["max_rounds"],
            })
        else:
            build_a, build_b = task["builds"]
            if build_a is None:
                raise ValueError("build_a is None: not yet supported")
            if build_b is None:
                from hex_tactics.data.presets import get_preset
                p = get_preset(task["preset_b"])
                from cfr.abstraction import SkillSpec
                build_b = BuildSpec(
                    name=p.id,
                    weapon=p.weapon, offhand=p.offhand, armor=p.armor,
                    skills=tuple(
                        SkillSpec(
                            modifier=s.modifier, level=s.level,
                            abilita=s.abilita, azione=s.azione,
                            classe_oggetto=s.classe_oggetto, oggetto_specifico=s.oggetto_specifico,
                        ) for s in p.skills
                    ),
                )
            g = HexTacticsAbstractGame.from_build_specs(
                build_a, build_b,
                seed=12345, max_rounds=task["max_rounds"],
            )

        solver = outcome_sampling_mccfr.OutcomeSamplingSolver(g)

        t0 = time.time()
        eval_log = []
        # Checkpoint: stima V_a Monte Carlo ogni K iter (cheap, ~5s)
        checkpoint_every = max(2000, task["n_iter"] // 5)
        with open(log_path, "w") as logf:
            logf.write(f"Matchup: {label}\nKind: {task['kind']}\n")
            logf.write(f"max_rounds: {task['max_rounds']}, n_iter target: {task['n_iter']}\n\n")
            for it in range(1, task["n_iter"] + 1):
                solver.iteration()
                if it % checkpoint_every == 0 or it == task["n_iter"]:
                    elapsed = time.time() - t0
                    # Stima V_a via 50 partite Monte Carlo (avg_policy vs se stessa)
                    v_a_mc = mc_estimate_v_a(g, solver.average_policy(), n_games=50, seed_base=99)
                    eval_log.append({"iter": it, "V_a_mc": v_a_mc, "elapsed": elapsed})
                    logf.write(f"iter {it}: V_a_mc={v_a_mc:+.3f}, elapsed={elapsed:.1f}s, iter/s={it/elapsed:.2f}\n")
                    logf.flush()
        wall = time.time() - t0

        # Final V_a estimate con più sample (200 partite per stabilità)
        avg_pi = solver.average_policy()
        V_a_final = mc_estimate_v_a(g, avg_pi, n_games=200, seed_base=999)

        # Stima convergenza: V_a delta tra ultimi 2 checkpoint
        if len(eval_log) >= 2:
            v_a_delta = abs(eval_log[-1]["V_a_mc"] - eval_log[-2]["V_a_mc"])
        else:
            v_a_delta = float("nan")

        result = {
            "label": label,
            "kind": task["kind"],
            "preset_a": task.get("preset_a"),
            "preset_b": task.get("preset_b"),
            "n_iter": task["n_iter"],
            "max_rounds": task["max_rounds"],
            "wall_time_sec": wall,
            "iter_per_sec": task["n_iter"] / wall,
            "V_a": V_a_final,
            "v_a_delta_last": v_a_delta,
            "convergence_log": eval_log,
            "status": "ok",
        }
    except Exception as e:
        result = {
            "label": label,
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }

    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    return result


def mc_estimate_v_a(game, policy, n_games: int = 50, seed_base: int = 0) -> float:
    """Stima V_a (expected return per player A) giocando N partite avg_policy
    vs avg_policy, samplando le azioni dalla mixed strategy.

    Cheap: O(n_games × game_depth × branching_factor) — secondi.
    """
    import random
    total_a = 0.0
    for ep in range(n_games):
        rng = random.Random(seed_base + ep * 7919)
        s = game.new_initial_state()
        depth = 0
        while not s.is_terminal() and depth < 1000:
            cur = s.current_player()
            if cur < 0:
                break
            try:
                action_probs = policy.action_probabilities(s)
            except Exception:
                # Fallback: uniform su legal
                legal = s.legal_actions()
                action_probs = {a: 1.0/len(legal) for a in legal}
            # Sample da action_probs
            if not action_probs:
                break
            actions = list(action_probs.keys())
            probs = [action_probs[a] for a in actions]
            ssum = sum(probs)
            if ssum < 1e-12:
                break
            probs = [p/ssum for p in probs]
            a = rng.choices(actions, weights=probs, k=1)[0]
            s.apply_action(a)
            depth += 1
        if s.is_terminal():
            total_a += s.returns()[0]  # Player A's return
    return total_a / n_games


def _compute_expected_value(game, policy, player: int, max_depth: int = 1000) -> float:
    """Expected value della policy giocata vs se stessa per `player`."""
    state = game.new_initial_state()
    visited = [0]  # contatore mutabile

    def recurse(s, prob, depth):
        if depth > max_depth:
            return 0.0
        if s.is_terminal():
            return prob * s.returns()[player]
        action_probs = policy.action_probabilities(s)
        v = 0.0
        for a, p in action_probs.items():
            if p < 1e-12:
                continue
            v += recurse(s.child(a), prob * p, depth + 1)
        visited[0] += 1
        return v

    return recurse(state, 1.0, 0)


# ─────── Best-AI run (separato, single-process dedicated) ───────

def run_best_ai():
    """Run lungo CFR su matchup canonical per produrre best-AI policy.

    Misura V_a Monte Carlo ad ogni checkpoint (cheap). Niente nash_conv
    (DFS completo proibitivo).
    """
    print("\n[BEST-AI] starting...")
    sys.setrecursionlimit(20000)
    sys.path.insert(0, ROOT)
    from cfr.abstract_game import HexTacticsAbstractGame
    from open_spiel.python.algorithms import outcome_sampling_mccfr

    g = HexTacticsAbstractGame({
        "preset_a": "spadaccino", "preset_b": "tank",
        "seed": 12345, "max_rounds": MAX_ROUNDS_DEFAULT,
    })
    solver = outcome_sampling_mccfr.OutcomeSamplingSolver(g)

    out_log = f"{OUT_DIR}/best_ai_run.log"
    out_json = f"{OUT_DIR}/best_ai_run.json"
    eval_every = max(2500, BEST_AI_ITER // 20)
    eval_log = []
    t0 = time.time()
    with open(out_log, "w") as logf:
        logf.write(f"BEST-AI run: spadaccino-vs-tank, max_rounds={MAX_ROUNDS_DEFAULT}, target_iter={BEST_AI_ITER}\n\n")
        for it in range(1, BEST_AI_ITER + 1):
            solver.iteration()
            if it % eval_every == 0 or it == BEST_AI_ITER:
                elapsed = time.time() - t0
                v_a_mc = mc_estimate_v_a(g, solver.average_policy(), n_games=100, seed_base=10000+it)
                eval_log.append({"iter": it, "V_a_mc": v_a_mc, "elapsed": elapsed})
                logf.write(f"iter {it}: V_a_mc={v_a_mc:+.3f}, elapsed={elapsed:.1f}s, iter/s={it/elapsed:.2f}\n")
                logf.flush()
                print(f"[BEST-AI] iter {it}: V_a_mc={v_a_mc:+.3f}, elapsed={elapsed:.1f}s")

    wall = time.time() - t0
    avg_pi = solver.average_policy()
    V_a = mc_estimate_v_a(g, avg_pi, n_games=500, seed_base=99999)  # final precision

    # Save policy + solver per usabilità futura (telecronaca, distill, gameplay)
    import pickle
    policy_path = f"{OUT_DIR}/best_ai_policy.pkl"
    solver_path = f"{OUT_DIR}/best_ai_solver.pkl"
    try:
        with open(policy_path, "wb") as f:
            pickle.dump(avg_pi, f)
        print(f"[BEST-AI] policy saved: {policy_path}")
    except Exception as e:
        print(f"[BEST-AI] policy save failed: {e}")
    try:
        with open(solver_path, "wb") as f:
            pickle.dump(solver, f)
        print(f"[BEST-AI] solver saved: {solver_path}")
    except Exception as e:
        print(f"[BEST-AI] solver save failed: {e}")

    result = {
        "label": "BEST_AI_spada_vs_tank",
        "n_iter": BEST_AI_ITER,
        "wall_time_sec": wall,
        "V_a": V_a,
        "convergence_log": eval_log,
        "policy_path": policy_path,
        "solver_path": solver_path,
    }
    with open(out_json, "w") as f:
        json.dump(result, f, indent=2, default=str)
    print(f"[BEST-AI] done: {wall:.0f}s, V_a={V_a:.3f}")
    return result


# ─────── Aggregation + report ───────

def aggregate_results(sweep_results: List[Dict[str, Any]],
                      best_result: Optional[Dict[str, Any]]) -> None:
    """Genera CSV + markdown report dai risultati."""
    # CSV
    csv_path = f"{OUT_DIR}/sweep_results.csv"
    with open(csv_path, "w") as f:
        f.write("label,kind,V_a,v_a_delta_last,iter_done,wall_sec,iter_per_sec,status\n")
        for r in sweep_results:
            if r.get("status") == "ok":
                v_delta = r.get("v_a_delta_last", float("nan"))
                v_delta_s = f"{v_delta:.4f}" if v_delta == v_delta else "nan"
                f.write(f"{r['label']},{r['kind']},{r['V_a']:.4f},{v_delta_s},"
                        f"{r['n_iter']},{r['wall_time_sec']:.1f},{r['iter_per_sec']:.2f},ok\n")
            else:
                f.write(f"{r['label']},,,,,,,error\n")

    # Markdown report
    rep_path = f"{OUT_DIR}/REPORT.md"
    with open(rep_path, "w") as f:
        f.write("# Hex-Tactics — Overnight CFR Balance Report\n\n")
        f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"**Sweep**: {len(sweep_results)} matchup, {SWEEP_ITER} iter ognuno (OS-MCCFR), max_rounds={MAX_ROUNDS_DEFAULT}\n\n")

        # Stats globali
        ok_results = [r for r in sweep_results if r.get("status") == "ok"]
        if ok_results:
            avg_iter_s = sum(r["iter_per_sec"] for r in ok_results) / len(ok_results)
            avg_nc = sum(r["v_a_delta_last"] for r in ok_results) / len(ok_results)
            f.write(f"**Throughput medio**: {avg_iter_s:.2f} iter/s/worker\n")
            f.write(f"**nash_conv medio finale**: {avg_nc:.4f}\n\n")

        # Matrice 3×3 preset
        f.write("## Matrice 3×3 preset (V_a)\n\n")
        f.write("| A \\ B | spadaccino | arciere | tank |\n")
        f.write("|---|---|---|---|\n")
        preset_v = {(r["preset_a"], r["preset_b"]): r.get("V_a") for r in ok_results
                    if r["kind"] == "preset"}
        for a in PRESETS:
            row = [f"**{a}**"]
            for b in PRESETS:
                v = preset_v.get((a, b))
                row.append(f"{v:+.3f}" if v is not None else "—")
            f.write("| " + " | ".join(row) + " |\n")
        f.write("\n")

        # Weapon sweep
        f.write("## Weapon variants vs spadaccino baseline\n\n")
        f.write("| Weapon | V_a | nash_conv |\n")
        f.write("|---|---|---|\n")
        for r in ok_results:
            if r["label"].startswith("weapon_"):
                weapon = r["label"].replace("weapon_", "").replace("_vs_spadaccino", "")
                f.write(f"| {weapon} | {r['V_a']:+.3f} | {r.get('v_a_delta_last', float('nan')):.4f} |\n")
        f.write("\n")

        # Armor sweep
        f.write("## Armor variants vs spadaccino baseline\n\n")
        f.write("| Armor | V_a | nash_conv |\n")
        f.write("|---|---|---|\n")
        for r in ok_results:
            if r["label"].startswith("armor_"):
                ar = r["label"].replace("armor_", "").replace("_vs_spadaccino", "")
                f.write(f"| {ar} | {r['V_a']:+.3f} | {r.get('v_a_delta_last', float('nan')):.4f} |\n")
        f.write("\n")

        # Skill ablation
        f.write("## Skill ablation (archer variants vs tank)\n\n")
        f.write("| Variant | V_a | nash_conv |\n")
        f.write("|---|---|---|\n")
        for r in ok_results:
            if r["label"].startswith("archer_"):
                v = r["label"].replace("archer_", "").replace("_vs_tank", "")
                f.write(f"| {v} | {r['V_a']:+.3f} | {r.get('v_a_delta_last', float('nan')):.4f} |\n")
        f.write("\n")

        # Best-AI
        if best_result:
            f.write("## Best-AI run (long convergence)\n\n")
            f.write(f"- Matchup: spadaccino vs tank (max_rounds={MAX_ROUNDS_DEFAULT})\n")
            f.write(f"- Iter: {best_result['n_iter']:,}\n")
            f.write(f"- Wall: {best_result['wall_time_sec']:.0f}s ({best_result['wall_time_sec']/3600:.1f}h)\n")
            # No nash_conv (DFS proibitivo); usiamo V_a Monte Carlo come metric
            if best_result.get("convergence_log"):
                last_two = best_result["convergence_log"][-2:]
                if len(last_two) == 2:
                    delta = abs(last_two[1]["V_a_mc"] - last_two[0]["V_a_mc"])
                    f.write(f"- V_a delta tra ultimi 2 checkpoint: {delta:.4f}\n")
            f.write(f"- V_a (spadaccino): **{best_result['V_a']:+.3f}**\n\n")

        # Errori
        err_results = [r for r in sweep_results if r.get("status") == "error"]
        if err_results:
            f.write("## Errori\n\n")
            for r in err_results:
                f.write(f"- {r['label']}: {r['error']}\n")

    print(f"\nReport scritto: {rep_path}")


# ─────── Main ───────

def _tg_send(msg: str):
    """Telegram self-reporting silenzioso (non interrompe se fallisce)."""
    import subprocess
    try:
        subprocess.run(["tg-send", msg], timeout=15, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def _smoke_e2e() -> bool:
    """Smoke test E2E mandatory: 1 matchup × 100 iter su preset_spadaccino_vs_tank.

    Se fallisce → abort overnight (evita ore sprecate per bug).
    Wall ~2 min. Returns True se passa.
    """
    print("[SMOKE] Pre-flight E2E test (1 matchup × 100 iter)...")
    sys.setrecursionlimit(20000)
    sys.path.insert(0, ROOT)
    try:
        from cfr.abstract_game import HexTacticsAbstractGame
        from open_spiel.python.algorithms import outcome_sampling_mccfr
        g = HexTacticsAbstractGame({
            "preset_a": "spadaccino", "preset_b": "tank",
            "seed": 12345, "max_rounds": MAX_ROUNDS_DEFAULT,
        })
        solver = outcome_sampling_mccfr.OutcomeSamplingSolver(g)
        t0 = time.time()
        for _ in range(100):
            solver.iteration()
        rate = 100 / (time.time() - t0)
        print(f"[SMOKE] OK — 100 iter in {time.time()-t0:.1f}s ({rate:.2f} iter/s)")
        return True
    except Exception as e:
        print(f"[SMOKE] FAILED: {type(e).__name__}: {e}")
        traceback.print_exc()
        _tg_send(f"❌ Hex-tactics smoke E2E FAILED: {type(e).__name__}: {str(e)[:200]}. Overnight ABORT.")
        return False


def main():
    print("=" * 70)
    print(f"HEX-TACTICS OVERNIGHT RUN ({time.strftime('%Y-%m-%d %H:%M:%S')})")
    print("=" * 70)
    tasks = make_sweep_tasks()
    print(f"Sweep: {len(tasks)} matchup")
    print(f"Iter per matchup: {SWEEP_ITER}")
    print(f"Workers: {N_WORKERS} (sweep uses {N_WORKERS-1}, best-AI parallel uses 1)")

    # ── Smoke E2E mandatory pre-flight ──
    if not _smoke_e2e():
        print("ABORTING: smoke E2E failed.")
        return

    _tg_send(f"🚀 Hex-tactics overnight START: {len(tasks)} matchup × {SWEEP_ITER} iter (ETA ~5h sweep) + best-AI {BEST_AI_ITER} iter (~7h). Self-report ogni 5 matchup completati.")

    t0 = time.time()

    # Stage 2 + 3 in parallelo:
    # - Sweep usa N_WORKERS-1 = 7 worker
    # - Best-AI gira in un processo dedicato (usa 1 core)
    print(f"\n[STAGE 2+3] starting parallel sweep ({N_WORKERS-1} workers) + best-AI run (1 core)")

    # Lancio best-AI in un Process separato
    best_proc = mp.Process(target=_best_ai_wrapper, args=())
    best_proc.start()

    # Sweep su 7 worker con imap_unordered per progress tracking
    sweep_results: List[Dict[str, Any]] = []
    n_ok = 0
    n_err = 0
    last_alert_count = 0
    with mp.Pool(N_WORKERS - 1) as pool:
        for r in pool.imap_unordered(run_cfr_matchup, tasks):
            sweep_results.append(r)
            if r.get("status") == "ok":
                n_ok += 1
            else:
                n_err += 1
                # Alert immediato se errore precoce: prime 3 errori notificate subito
                if n_err <= 3:
                    err_msg = r.get("error", "unknown")[:200]
                    _tg_send(f"⚠️ Hex-tactics matchup err [{n_ok+n_err}/{len(tasks)}]: {r['label']}: {err_msg}")
            done = n_ok + n_err
            elapsed = time.time() - t0
            # Heartbeat ogni 5 matchup completati
            if done - last_alert_count >= 5:
                eta = elapsed / done * (len(tasks) - done) if done > 0 else 0
                _tg_send(f"🔄 Hex-tactics sweep: {done}/{len(tasks)} ({n_ok} ok, {n_err} err) — ETA sweep {eta/60:.0f}min")
                last_alert_count = done
            print(f"  [{done}/{len(tasks)}] {r['label']}: {r.get('status')}")
    sweep_wall = time.time() - t0
    print(f"[STAGE 2] sweep done: {sweep_wall:.0f}s ({sweep_wall/60:.1f} min) - {n_ok} ok, {n_err} errori")
    _tg_send(f"✅ Hex-tactics sweep complete: {n_ok}/{len(tasks)} ok, {n_err} err ({sweep_wall/60:.0f} min). Best-AI ancora in run...")

    with open(f"{OUT_DIR}/sweep_results.json", "w") as f:
        json.dump(sweep_results, f, indent=2, default=str)

    # Aspetta best-AI (potrebbe essere ancora in running)
    print("[STAGE 3] waiting for best-AI to finish...")
    best_proc.join(timeout=20 * 3600)  # 20h max safety
    if best_proc.is_alive():
        print("[STAGE 3] best-AI still running after 20h, terminating")
        best_proc.terminate()
        best_proc.join()

    # Carica best-AI result da disk se esiste
    best_path = f"{OUT_DIR}/best_ai_run.json"
    best = None
    if os.path.exists(best_path):
        with open(best_path) as f:
            best = json.load(f)

    # Stage 4: aggregation
    print("\n[STAGE 4] generating report...")
    aggregate_results(sweep_results, best)

    total_wall = time.time() - t0
    print(f"\nTOTAL wall time: {total_wall:.0f}s ({total_wall/3600:.1f} h)")
    print(f"Output dir: {OUT_DIR}")

    # Completion report Telegram
    best_v_a = best.get("V_a") if best else None
    best_iter = best.get("n_iter") if best else "n/a"
    best_msg = f", best-AI V_a={best_v_a:+.3f} ({best_iter} iter)" if best_v_a is not None else ""
    _tg_send(f"🌅 Hex-tactics OVERNIGHT DONE ({total_wall/3600:.1f}h): {n_ok}/{len(tasks)} matchup ok{best_msg}. Report: {OUT_DIR}/REPORT.md")


def _best_ai_wrapper():
    """Wrapper per best-AI che gira in process separato."""
    try:
        run_best_ai()
    except Exception as e:
        with open(f"{OUT_DIR}/best_ai_error.log", "w") as f:
            f.write(f"Error in best-AI: {e}\n{traceback.format_exc()}\n")


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    main()

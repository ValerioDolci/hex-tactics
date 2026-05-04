"""Re-run dei 10 matchup arciere/balestra-related dopo fix bug bounds.

Lancia 7 worker paralleli su:
  - 3 matchup preset arciere row (vs spada, vs arciere, vs tank)
  - 2 matchup preset opponent (spada vs arciere, tank vs arciere)
  - 1 weapon (balestra vs spadaccino)
  - 4 archer ablation (vs tank)

Output in nightly_results/post_fix/
"""
from __future__ import annotations
import json, multiprocessing as mp, os, sys, time, traceback
sys.path.insert(0, "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python")

ROOT = "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python"
OUT_DIR = f"{ROOT}/cfr/nightly_results/post_fix"
os.makedirs(OUT_DIR, exist_ok=True)

SWEEP_ITER = 5000
MAX_ROUNDS = 12
# Mac M4 ha 4 perf core + 6 eff core. Usiamo 4 worker per stare nei perf
# (best-AI già usa 1 perf core, totale 5 active → margine per eff workers su altre attività).
# Trade-off: meno parallelismo ma 3x throughput per worker = aggregate +60%.
N_WORKERS = 4


def make_archer_tasks():
    from cfr.abstraction import BuildSpec, SkillSpec
    tasks = []

    # Preset matchup arciere-related (5)
    archer_preset_pairs = [
        ("arciere", "spadaccino"),
        ("arciere", "arciere"),
        ("arciere", "tank"),
        ("spadaccino", "arciere"),
        ("tank", "arciere"),
    ]
    for a, b in archer_preset_pairs:
        tasks.append({
            "label": f"preset_{a}_vs_{b}",
            "kind": "preset",
            "preset_a": a, "preset_b": b,
            "builds": None,
            "n_iter": SWEEP_ITER,
            "max_rounds": MAX_ROUNDS,
        })

    # Weapon balestra (ranged)
    spada_baseline_skills = (
        SkillSpec("-1impedimento", level=3),
        SkillSpec("-1impedimento", level=3, classe_oggetto="armature"),
    )
    b_balestra = BuildSpec(name="weapon_balestra", weapon="balestra",
                          armor="armatura_leggera", skills=spada_baseline_skills)
    tasks.append({
        "label": "weapon_balestra_vs_spadaccino",
        "kind": "buildspec",
        "preset_a": None, "preset_b": "spadaccino",
        "builds": (b_balestra, None),
        "n_iter": SWEEP_ITER, "max_rounds": MAX_ROUNDS,
    })

    # Archer ablation (4)
    archer_base = (
        SkillSpec("-1impedimento", level=3),
        SkillSpec("-1impedimento", level=3, classe_oggetto="archi"),
        SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="archi"),
        SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
    )
    skill_variants = {
        "noimped": (
            SkillSpec("+1tiro", level=2, azione="attaccare", classe_oggetto="archi"),
            SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
        ),
        "noplus": (
            SkillSpec("-1impedimento", level=3),
            SkillSpec("-1impedimento", level=3, classe_oggetto="archi"),
            SkillSpec("+1tiro", level=1, azione="slancio", abilita="agilità"),
        ),
        "with1dado": (
            SkillSpec("-1impedimento", level=3),
            SkillSpec("+1dado", level=1, azione="attaccare", classe_oggetto="archi"),
        ),
        "base": archer_base,
    }
    for variant_name, skills in skill_variants.items():
        b_a = BuildSpec(name=f"archer_{variant_name}", weapon="arco_lungo",
                       offhand="pugnale", armor="armatura_leggera", skills=skills)
        tasks.append({
            "label": f"archer_{variant_name}_vs_tank",
            "kind": "buildspec",
            "preset_a": None, "preset_b": "tank",
            "builds": (b_a, None),
            "n_iter": SWEEP_ITER, "max_rounds": MAX_ROUNDS,
        })

    return tasks


def run_one(task):
    """Esegui CFR + MC V_a su un task. Salva JSON."""
    label = task["label"]
    out_path = f"{OUT_DIR}/matchup_{label}.json"
    log_path = f"{OUT_DIR}/matchup_{label}.log"
    try:
        sys.setrecursionlimit(20000)
        sys.path.insert(0, ROOT)
        from cfr.abstract_game import HexTacticsAbstractGame
        from cfr.abstraction import BuildSpec, SkillSpec
        from cfr.nightly_run import mc_estimate_v_a
        from open_spiel.python.algorithms import outcome_sampling_mccfr

        if task["kind"] == "preset":
            g = HexTacticsAbstractGame({
                "preset_a": task["preset_a"], "preset_b": task["preset_b"],
                "seed": 12345, "max_rounds": task["max_rounds"],
            })
        else:
            build_a, build_b = task["builds"]
            if build_b is None:
                from hex_tactics.data.presets import get_preset
                p = get_preset(task["preset_b"])
                build_b = BuildSpec(
                    name=p.id, weapon=p.weapon, offhand=p.offhand, armor=p.armor,
                    skills=tuple(SkillSpec(modifier=s.modifier, level=s.level,
                        abilita=s.abilita, azione=s.azione,
                        classe_oggetto=s.classe_oggetto, oggetto_specifico=s.oggetto_specifico)
                        for s in p.skills),
                )
            g = HexTacticsAbstractGame.from_build_specs(build_a, build_b,
                seed=12345, max_rounds=task["max_rounds"])

        solver = outcome_sampling_mccfr.OutcomeSamplingSolver(g)
        t0 = time.time()
        eval_log = []
        with open(log_path, "w") as logf:
            logf.write(f"POST-FIX matchup: {label} | iter={task['n_iter']} mr={task['max_rounds']}\n\n")
            for it in range(1, task["n_iter"] + 1):
                solver.iteration()
                if it % 1000 == 0 or it == task["n_iter"]:
                    elapsed = time.time() - t0
                    v_a_mc = mc_estimate_v_a(g, solver.average_policy(), n_games=50, seed_base=99)
                    eval_log.append({"iter": it, "V_a_mc": v_a_mc, "elapsed": elapsed})
                    logf.write(f"iter {it}: V_a_mc={v_a_mc:+.3f}, elapsed={elapsed:.0f}s, it/s={it/elapsed:.2f}\n")
                    logf.flush()
        wall = time.time() - t0

        avg_pi = solver.average_policy()
        V_a = mc_estimate_v_a(g, avg_pi, n_games=200, seed_base=999)

        result = {
            "label": label, "kind": task["kind"],
            "preset_a": task.get("preset_a"), "preset_b": task.get("preset_b"),
            "n_iter": task["n_iter"], "max_rounds": task["max_rounds"],
            "wall_time_sec": wall, "iter_per_sec": task["n_iter"]/wall,
            "V_a": V_a, "convergence_log": eval_log,
            "status": "ok", "engine_post_fix": True,
        }
    except Exception as e:
        result = {"label": label, "status": "error",
                  "error": str(e), "traceback": traceback.format_exc()}
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    return result


def _tg(msg):
    import subprocess
    try:
        subprocess.run(["tg-send", msg], timeout=15, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def main():
    tasks = make_archer_tasks()
    # Skip task già completati (preset_arciere_vs_arciere già done in run precedente)
    done_labels = set()
    for f in os.listdir(OUT_DIR):
        if f.startswith("matchup_") and f.endswith(".json"):
            try:
                d = json.load(open(os.path.join(OUT_DIR, f)))
                if d.get("status") == "ok":
                    done_labels.add(d["label"])
            except Exception:
                pass
    tasks = [t for t in tasks if t["label"] not in done_labels]
    print(f"POST-FIX RE-RUN ({time.strftime('%Y-%m-%d %H:%M:%S')})")
    print(f"Skipping {len(done_labels)} already done: {done_labels}")
    print(f"Matchup: {len(tasks)} remaining | iter={SWEEP_ITER} | workers={N_WORKERS}")
    for t in tasks:
        print(f"  - {t['label']}")
    _tg(f"🔧 RE-RUN POST-FIX bounds: {len(tasks)} matchup arciere/balestra × {SWEEP_ITER} iter su {N_WORKERS} worker. ETA ~1.5-2h. Heartbeat ogni 3 matchup completati.")

    t0 = time.time()
    results = []
    n_ok = 0; n_err = 0
    last_alert = 0
    with mp.Pool(N_WORKERS) as pool:
        for r in pool.imap_unordered(run_one, tasks):
            results.append(r)
            if r.get("status") == "ok":
                n_ok += 1
            else:
                n_err += 1
                _tg(f"⚠️ Post-fix err: {r['label']}: {r.get('error','?')[:150]}")
            done = n_ok + n_err
            print(f"  [{done}/{len(tasks)}] {r['label']}: {r.get('status')} V_a={r.get('V_a','?')}")
            if done - last_alert >= 3:
                _tg(f"🔄 Post-fix: {done}/{len(tasks)} ({n_ok} ok, {n_err} err)")
                last_alert = done
    wall = time.time() - t0
    print(f"\nDONE in {wall:.0f}s ({wall/60:.1f}min): {n_ok} ok, {n_err} err")

    # Save aggregato
    with open(f"{OUT_DIR}/sweep_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    # Quick comparison vs pre-fix
    print("\n=== PRE-FIX vs POST-FIX comparison ===")
    print(f"{'matchup':<45} {'pre':>8} {'post':>8} {'delta':>8}")
    pre_fix_dir = "/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python/cfr/nightly_results"
    for r in results:
        if r.get("status") != "ok": continue
        label = r["label"]
        pre_path = f"{pre_fix_dir}/matchup_{label}.json"
        if os.path.exists(pre_path):
            pre_d = json.load(open(pre_path))
            pre_v = pre_d.get("V_a", float("nan"))
            post_v = r["V_a"]
            delta = post_v - pre_v if isinstance(pre_v, (int, float)) else float("nan")
            print(f"{label:<45} {pre_v:>+8.3f} {post_v:>+8.3f} {delta:>+8.3f}")

    _tg(f"✅ Post-fix RE-RUN done ({wall/60:.0f}min): {n_ok}/{len(tasks)} ok. Confronto pre/post in log.")


if __name__ == "__main__":
    mp.set_start_method("spawn", force=True)
    main()

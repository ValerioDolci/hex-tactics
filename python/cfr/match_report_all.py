"""Genera report markdown completi (summary + narrative) per tutti i matchup.

Default: legge tutti i deep_cfr_*/ in nightly_results/ e produce un file MD
unico in `reports/match_dynamics_<timestamp>.md`. Una sezione per matchup.

Usage:
    python -m cfr.match_report_all                            # tutti, n=50
    python -m cfr.match_report_all --filter lanc_              # solo che inizia con "lanc_"
    python -m cfr.match_report_all --skip-deprecated           # esclude quelli deprecated (vedi DEPRECATED)
    python -m cfr.match_report_all --n 100 --n-narrative 3     # custom

Output: 1 file MD con TOC + summary di ogni matchup + 2-3 partite narrate.
"""

from __future__ import annotations

import argparse
import sys
import os
from datetime import datetime
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
_PYTHON_ROOT = _THIS_DIR.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

from cfr.match_replay import MatchReplay


# Modelli pre-fix (lanciere_vs_spa, giav_vs_arc) — non rappresentano regole correnti.
DEPRECATED = {
    "lanciere_vs_spa",   # pre-fix throw single-use
    "giav_vs_arc",       # pre-fix throw single-use
    "spaScudo_vs_arc",   # alternativa (non parte del set canonico)
    "v2",                # legacy senza metadata coerente
}


def main():
    ap = argparse.ArgumentParser(description="Genera report multi-matchup")
    ap.add_argument(
        "--root",
        default="cfr/nightly_results",
        help="Cartella radice con i deep_cfr_* (relative to python/ root)",
    )
    ap.add_argument("--n", type=int, default=50, help="N partite per matchup (default 50)")
    ap.add_argument("--n-narrative", type=int, default=3, help="Partite narrate per matchup (default 3)")
    ap.add_argument("--filter", default=None, help="Solo label che contiene questa stringa")
    ap.add_argument("--skip-deprecated", action="store_true", help="Salta i modelli deprecated")
    ap.add_argument("--out", default=None, help="File MD output (default: reports/match_dynamics_<ts>.md)")
    ap.add_argument("--summary-only", action="store_true", help="Niente narrative, solo summary")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        print(f"ERROR: root {root} not found. cwd={os.getcwd()}", file=sys.stderr)
        sys.exit(1)

    dirs = sorted([d for d in root.iterdir() if d.is_dir() and d.name.startswith("deep_cfr_")])
    if args.filter:
        dirs = [d for d in dirs if args.filter in d.name]
    if args.skip_deprecated:
        dirs = [d for d in dirs if d.name[len("deep_cfr_"):] not in DEPRECATED]

    if not dirs:
        print("Nessun matchup trovato dopo il filtro.", file=sys.stderr)
        sys.exit(1)

    print(f"Trovati {len(dirs)} matchup da analizzare ({args.n} sim/match).", file=sys.stderr)

    out_path = Path(args.out) if args.out else _PYTHON_ROOT.parent / "reports" / f"match_dynamics_{datetime.now().strftime('%Y-%m-%d_%H%M')}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    sections = []
    sections.append(f"# Match Dynamics Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    sections.append("")
    sections.append(f"Generato da `cfr.match_report_all` su `{root}`. {len(dirs)} matchup, {args.n} sim/match.")
    sections.append("")
    sections.append("## Indice")
    sections.append("")
    for d in dirs:
        label = d.name[len("deep_cfr_"):]
        anchor = label.replace("_", "-")
        sections.append(f"- [{label}](#{anchor})")
    sections.append("")
    sections.append("---")
    sections.append("")

    for i, d in enumerate(dirs, 1):
        label = d.name[len("deep_cfr_"):]
        print(f"[{i}/{len(dirs)}] {label}...", file=sys.stderr, flush=True)
        try:
            mr = MatchReplay.from_dir(d)
            traces = mr.simulate(n_games=args.n)
            if args.summary_only:
                section = mr.render_summary(mr.aggregate(traces))
            else:
                section = mr.render_full_report(traces, n_narrative=args.n_narrative)
        except Exception as e:
            section = f"## {label}\n\n_ERRORE durante il caricamento/simulazione_: `{e}`"
        sections.append(section)
        sections.append("")
        sections.append("---")
        sections.append("")

    with open(out_path, "w") as f:
        f.write("\n".join(sections))

    print(f"\nReport scritto: {out_path}", file=sys.stderr)
    print(f"Apri con: open {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()

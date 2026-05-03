"""Genera report Markdown da output JSON di balance_weapons/armors/skills.

Output: /tmp/balance_report.md (e .html via heredoc se vuoi).

Uso:
  /Users/flaviacasini/claude-bot/venv/bin/python3 -u python/scripts/generate_balance_report.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime

WEAPONS_JSON = "/tmp/balance_weapons.json"
ARMORS_JSON = "/tmp/balance_armors.json"
SKILLS_JSON = "/tmp/balance_skills.json"
OUT_MD = "/tmp/balance_report.md"


def emoji_for_wr(wr: float, low: float = 0.40, high: float = 0.60) -> str:
    if wr > high + 0.10:
        return "🔥"  # OP
    if wr > high:
        return "📈"  # forte
    if wr < low - 0.10:
        return "❄️"  # UP debole
    if wr < low:
        return "📉"  # debole
    return "✅"  # bilanciato


def render_weapons(d: dict) -> str:
    lines = ["## ⚔️ Armi\n"]
    lines.append(f"_{d['n_ep']} ep per cella, matrice {len(d['weapons'])}×{len(d['weapons'])}_\n")
    lines.append("### Ranking globale (wr A vs tutte le armi)\n")
    lines.append("| Arma | wr A | Stato |")
    lines.append("|---|---:|:---:|")
    ranking = sorted(d["weapon_global_wr"].items(), key=lambda x: -x[1])
    for w, wr in ranking:
        lines.append(f"| `{w}` | {wr:.3f} | {emoji_for_wr(wr)} |")
    lines.append("")
    lines.append("### Mirror match (wr A in stessa arma — atteso ≈ 0.5)\n")
    lines.append("| Arma | wr A | ties |")
    lines.append("|---|---:|---:|")
    for w in d["weapons"]:
        cell = d["matrix"].get(f"{w}__VS__{w}")
        if cell:
            wr = cell["wins_a"] / cell["n"]
            lines.append(f"| `{w}` | {wr:.3f} | {cell['ties']} |")
    lines.append("")
    lines.append("### Matrice completa (wr A: riga vs colonna)\n")
    headers = ["A\\B"] + [w[:8] for w in d["weapons"]]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "---|" * len(headers))
    for wA in d["weapons"]:
        row = [wA[:12]]
        for wB in d["weapons"]:
            cell = d["matrix"].get(f"{wA}__VS__{wB}")
            if cell:
                wr = cell["wins_a"] / cell["n"]
                row.append(f"{wr:.2f}")
            else:
                row.append("–")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    return "\n".join(lines)


def render_armors(d: dict) -> str:
    lines = ["## 🛡 Armature\n"]
    lines.append(f"_{d['n_ep']} ep per cella_\n")
    lines.append("### Ranking globale\n")
    lines.append("| Armatura | wr A | Stato |")
    lines.append("|---|---:|:---:|")
    ranking = sorted(d["armor_global_wr"].items(), key=lambda x: -x[1])
    for a, wr in ranking:
        lines.append(f"| `{a}` | {wr:.3f} | {emoji_for_wr(wr)} |")
    lines.append("")
    lines.append("### Mirror match (atteso ≈ 0.5)\n")
    lines.append("| Armatura | wr A | ties |")
    lines.append("|---|---:|---:|")
    for a in d["armors"]:
        cell = d["matrix"].get(f"{a}__VS__{a}")
        if cell:
            wr = cell["wins_a"] / cell["n"]
            lines.append(f"| `{a}` | {wr:.3f} | {cell['ties']} |")
    lines.append("")
    lines.append("### Matrice completa\n")
    headers = ["A\\B"] + d["armors"]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "---|" * len(headers))
    for aA in d["armors"]:
        row = [aA]
        for aB in d["armors"]:
            cell = d["matrix"].get(f"{aA}__VS__{aB}")
            if cell:
                wr = cell["wins_a"] / cell["n"]
                row.append(f"{wr:.2f}")
            else:
                row.append("–")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    return "\n".join(lines)


def render_skills(d: dict) -> str:
    lines = ["## 🎯 Skills\n"]
    lines.append(f"_{d['n_ep']} ep per loadout, vs baseline (no skill)_\n")
    lines.append("### Ranking efficacia per 100 exp (vantaggio vs baseline / costo)\n")
    lines.append("| Loadout | Costo | wr A vs baseline | Vantaggio | Eff/100exp | Stato |")
    lines.append("|---|---:|---:|---:|---:|:---:|")
    nonzero = [r for r in d["results"] if r["cost"] > 0]
    for r in sorted(nonzero, key=lambda x: -x["eff_per_100exp"]):
        eff = r["eff_per_100exp"]
        flag = "🔥" if eff > 0.05 else ("📉" if eff < 0.01 else "✅")
        lines.append(
            f"| `{r['name']}` | {r['cost']} | {r['wr_a']:.3f} | "
            f"{r['advantage']:+.3f} | {eff:+.4f} | {flag} |"
        )
    # Baseline self-match (sanity)
    base = next((r for r in d["results"] if r["cost"] == 0), None)
    if base:
        lines.append("")
        lines.append(f"_Baseline mirror match: wr A = {base['wr_a']:.3f} (atteso ≈ 0.5)_\n")
    return "\n".join(lines)


def main():
    parts = [
        f"# 🎲 hex-tactics — Balance Report",
        f"_{datetime.now().strftime('%Y-%m-%d %H:%M')}_",
        "",
        "Generato da `balance_weapons.py` + `balance_armors.py` + `balance_skills.py` "
        "usando il **DT distillato v16** (self-play training) come AI per entrambi i lati.",
        "",
        "**Legenda**: 🔥 OP / 📈 forte / ✅ bilanciato / 📉 debole / ❄️ UP",
        "",
    ]
    if os.path.exists(WEAPONS_JSON):
        with open(WEAPONS_JSON) as f:
            parts.append(render_weapons(json.load(f)))
    else:
        parts.append("## ⚔️ Armi\n_Run balance_weapons.py per generare i dati._\n")
    if os.path.exists(ARMORS_JSON):
        with open(ARMORS_JSON) as f:
            parts.append(render_armors(json.load(f)))
    else:
        parts.append("## 🛡 Armature\n_Run balance_armors.py per generare i dati._\n")
    if os.path.exists(SKILLS_JSON):
        with open(SKILLS_JSON) as f:
            parts.append(render_skills(json.load(f)))
    else:
        parts.append("## 🎯 Skills\n_Run balance_skills.py per generare i dati._\n")

    md = "\n".join(parts)
    with open(OUT_MD, "w") as f:
        f.write(md)
    print(f"[done] {OUT_MD} ({len(md)} char)")


if __name__ == "__main__":
    main()

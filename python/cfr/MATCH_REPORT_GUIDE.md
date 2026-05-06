# Match Replay & Report — guida

> Sistema riusabile per analizzare le dinamiche turn-by-turn dei matchup Deep CFR.

## Comandi base

Tutti i comandi vanno eseguiti **dalla cartella `python/`** del progetto:

```bash
cd /Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python
```

### 1. Singolo matchup

```bash
# Report completo (summary + 4 partite narrate) → stdout
python -m cfr.match_replay cfr/nightly_results/deep_cfr_lanc_inv_vs_spa --n 50

# Salva su file
python -m cfr.match_replay cfr/nightly_results/deep_cfr_lanc_inv_vs_spa \
    --n 50 --n-narrative 4 --out /tmp/lanc_vs_spa.md

# Solo summary (no narrative)
python -m cfr.match_replay cfr/nightly_results/deep_cfr_lanc_inv_vs_spa --summary-only
```

### 2. Tutti i matchup in un report unico

```bash
# Default: 50 sim/match, 3 narrative, esclude deprecated, scrive in reports/
python -m cfr.match_report_all --skip-deprecated

# Solo summary aggregato (più veloce)
python -m cfr.match_report_all --skip-deprecated --summary-only

# Filtro per nome (es. solo lanciere)
python -m cfr.match_report_all --filter lanc_

# Custom params
python -m cfr.match_report_all --n 100 --n-narrative 5 --out reports/my_report.md
```

## Output

Ogni report contiene per ogni matchup:

1. **Summary table**: wins/draws, HP finali, distanza al 1° attacco, dice prefs, def choice, contatori `TOGGLE_DEFENSIVE`/`MOVE`/`RELOAD`/`BID`, V_a sim vs V_a train
2. **Partite rappresentative** narrate turn-by-turn:
   - `A_win_fastest`: vittoria A più veloce
   - `A_win_longest`: vittoria A più lunga
   - `B_win`: vittoria B mediana
   - `draw_longest`: draw più lungo (se presenti)

## Narrazione modale per round (post-2026-05-06 update)

Per produrre una narrazione tipo:

> "Al primo turno il tank carica ma tiene X slancio pronto, l'arciere si tiene a distanza, attiva def stance, lancia ranged a Y. Al secondo turno l'iniziativa si inverte..."

usa `--by-round` nel CLI:

```bash
python -m cfr.match_replay <model_dir> --n 50 --by-round --out /tmp/byround.md
```

Output: per ogni round R, per ogni player A/B:
- Frequenza categorie evento (% partite in cui appare)
- Eventi tattici dettagliati (esclude singoli MOVE step)
- Stato medio fine-round: HP, slancio, impeto, distanza, % in_def_stance
- N. partite che raggiungono / finiscono in quel round

Poi delegare a un subagent per traduzione narrativa italiana, prompt template:

```
Trasforma in narrazione italiana il "flow modale per round" di un matchup hex-tactics.

Path dati: <byround.md>

Convenzione:
- A = <build A>
- B = <build B>

REGOLE GIOCO (per senso meccanico):
- Round 1 ordine = chi ha più impeto. Tutti partono impeto 14.
- START_TURN: recupera dadi, slancio→impeto, tiro slancio 0-2d.
- Movimento: 1° hex gratis, gli altri costano 1 slancio.
- TOGGLE_DEF: con scudo, raddoppia parry.fixed passive (anti-ranged).
- DECL_ATK: scelte ATK_DICE e CHOOSE_DEFENSE simultanee, private.
- BID_MOVEMENT: regola V2 universale — TUTTE le armi melee con reach >= 1 triggerano l'asta (era "solo lance reach >= 4" in M-1 deprecata).

Per ogni round 1..6 scrivi 6-10 righe in italiano fluido che racconti:
- Chi ha iniziativa (più impeto)
- Cosa fa A in modo TIPICO (>50% partite) — racconta, non elencare percentuali
- Cosa fa B in modo TIPICO
- Cosa succede a HP / distanza / slancio
- Decisioni "non ovvie" della policy CFR (es. perché TOGGLE_DEF in quel momento?)

Stile: scorrevole, leggibile, NIENTE tabelle, NIENTE %, NIENTE elenchi puntati.
Solo prosa descrittiva. Termina con sintesi (3-4 righe) dell'esito tipico.
```

## Combat episodes (post-2026-05-06 update)

Dal `match_replay.py` v2 in poi, la sezione `### Combat episodes` nel summary contiene per ciascun player:
- `n_attempts`, `hit_rate`, `damage / attempt`, `damage / hit (mean / max)`
- `ranged / melee attempts`
- `outcomes_by_defense`: dict del tipo `{'parry_blocked': N, 'parry_hit': N, 'dodge_blocked': N, ...}`

Questi dati sono il fondamento dell'analisi meccanica: ogni claim del subagent deve essere ancorato a uno di questi numeri.

## Template per subagent (v2 — anchoring meccanico forzato)

Quando si vuole delegare l'analisi narrativa a un subagent, usare:

```
Subagent type: general-purpose
Description: "Match X dynamics analysis"
Prompt:
"""
Analizza con RIGORE MECCANICO le dinamiche di un matchup hex-tactics. Il tuo compito non è descrivere "cosa fa A e B" — è SPIEGARE I NUMERI con riferimento alle regole.

Path report: <path/al/report/markdown>
Path regole: /Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/CLAUDE.md

CONTESTO BUILD:
- A: <weapon, offhand, armor, scudo SI/NO, throw inventory> (estrai dal report)
- B: <stesso>

REGOLE IMPORTANTI (per ancoraggio):
- Schivata morde solo VARIABILE; parata morde TUTTO ma serve arma idonea (pugnale 1D6+0 debole)
- Ranged + lancio: NON c'è schivata/parata attiva. Difese passive: slancio + scudo.parry.fixed (-4/-8/-12) + armor.RD
- Defensive stance raddoppia parry.fixed scudo (×2)
- BID_MOVEMENT si attiva SOLO contro armi reach ≥4 (lance 2m=4, lance 3m=6) — se vedi BID con armi senza reach, è un BUG
- 3 dadi attack: lo spadaccino baseline NON ha skill +1dadomax — se sceglie 3 dadi, è anomalia da segnalare

OUTPUT desiderato (max 350 parole, ogni claim deve avere un numero ancorato):

1. **Verdetto numerico** (3 righe):
   - WR A/B/Draw, V_a_sim vs V_a_train (gap?)
   - Round medi
   - HP finale medio (se asimmetrico, evidenzia)

2. **Combat efficiency** (4 righe — usa la sezione "Combat episodes" del report):
   - Hit rate A vs B (es. "A 63%, B 40%")
   - Damage / attempt A vs B
   - Damage / hit (mean e max)
   - Quale player è più "efficiente"? Quanto?

3. **Defense breakdown** (3-4 righe — usa "outcomes_by_defense"):
   - Cosa para B (es. "parry_blocked 18 / parry_hit 9 = 67% successo parata")
   - Cosa schiva (dodge_blocked / dodge_hit)
   - Quando B "non si difende" (none_hit count) — perché?

4. **Pattern strategico** (3-4 righe — solo se serve a spiegare i numeri):
   - Distanza primo attacco A vs B (citata)
   - Uso TOGGLE_DEFENSIVE (citato)
   - Anomalie? (es. spa con 3 dadi, BID senza reach → SEGNALA come potenziali bug)

5. **Spiegazione meccanica** (3 righe):
   - Quale specifica regola spiega il +X wr% di A su B?
   - Es: "A scudo medio (parry.fixed 8) sottrae -8 al fisso del lancio B" oppure "A ha hit rate 1.6x perché B non può parare ranged"

6. **Game design** (2 righe):
   - 1 fix concreto + valore atteso V_a post-fix (best guess)

REGOLE DI STILE:
- Niente "il PG kita strategicamente" — sostituisci con "A muove per X turni, distanza media Y hex, hit rate Z%"
- Niente note generiche tipo "balance issue" — devi specificare la meccanica responsabile
- Cita SEED specifici per le partite narrate
- Se vedi un dato anomalo o inspiegabile, dichiaralo: "ANOMALIA: X non spiegabile dalle regole"

Output: SCRIVI L'ANALISI INLINE, NON salvare file (la policy non lo permette).
"""
```

## Lista DEPRECATED

Modelli vecchi non rappresentativi delle regole correnti:
- `lanciere_vs_spa` (pre-fix throw single-use)
- `giav_vs_arc` (pre-fix throw single-use)
- `spaScudo_vs_arc` (build alternativa, non standard)
- `v2` (legacy senza metadata coerente)

Usa `--skip-deprecated` per escluderli.

## Performance

- **1 matchup, 50 sim**: ~10-15 secondi
- **1 matchup, 100 sim**: ~25-30 secondi
- **30 matchup × 50 sim**: ~10-15 minuti (parallelizzazione futura possibile)

## File chiave

- `python/cfr/match_replay.py`: classe `MatchReplay` core (load model, simulate, render)
- `python/cfr/match_report_all.py`: wrapper CLI per multi-matchup
- `python/cfr/MATCH_REPORT_GUIDE.md`: questo file

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

## Template per subagent

Quando si vuole delegare l'analisi narrativa a un subagent, usare:

```
Subagent type: general-purpose
Description: "Match X dynamics analysis"
Prompt:
"""
Analizza le dinamiche di gioco di un matchup hex-tactics dal report Deep CFR.

Path report: <path/al/report/markdown>

Il report contiene:
- Summary stats di N partite simulate con la policy CFR
- 3-4 partite rappresentative narrate turn-by-turn (categorie: A_win_fastest, A_win_longest, B_win, draw_longest)

Output desiderato (max 300 parole):
1. **Verdetto**: chi vince, di quanto (% wr), quanto sono lunghe le partite (round medi)
2. **Strategia di A**: cosa fa A nei turni iniziali e finali, quando e da quanto attacca, uso difensiva
3. **Strategia di B**: stesso ma per B, focus su cosa fa quando perde
4. **Fase decisiva**: in che round si decide tipicamente la partita, qual è l'azione chiave
5. **Note di game design**: se emergono pattern utili per balancing (es. armi/skill che dominano)

Sii conciso e diretto. Cita esempi specifici dalle partite (es. "A_win_fastest: lanciere chiude in 2 round con 1 lancio + finisher") ma non parafrasare l'intera trace.
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

# Metodologia AI & Balancing — hex-tactics

> Documento metodologico per testare AI, preset PG e parametri di gioco in modo riproducibile e quantitativo. Da consultare quando si vuole valutare un cambio (nuovo preset, nuova skill, modifica regole, AI alternativa).

---

## 1. Architettura AI

Il progetto supporta **3 implementazioni di AI**, tutte interscambiabili via configurazione `AiConfig.modeA / modeB`:

| AI | Tipo | Costo runtime | Pro | Contro |
|---|---|---|---|---|
| **`heuristic`** | Decision tree euristico (`basicAi.ts`) | <1ms | Semplice, deterministico, base | Tattiche limitate, solo "se in mischia attacca, sennò muovi" |
| **`utility`** | Scoring funzioni (`utilityAi.ts`) | <1ms | Configurabile via pesi, prevedibile | Quality limitata da chi scrive le funzioni |
| **`mcts`** | Monte Carlo Tree Search (`mctsAi.ts`) | ~50-100ms/decisione | Esplora futuro, scopre tattiche | Richiede budget iterazioni alto, branching da limitare |

### Pattern di selezione AI

```ts
import { runBattle, AiConfig } from 'scripts/simulate';

const config: AiConfig = {
  modeA: 'utility',
  modeB: 'heuristic',
  mctsConfig: { iterations: 200, rolloutMaxEvents: 100 }, // solo se uno usa mcts
};
const result = runBattle('spadaccino', 'arciere', /*seed*/ 1234, /*maxRounds*/ 30, /*verbose*/ false, /*deployHexDist*/ 5, config);
```

---

## 2. Sim harness — Cosa misuriamo

`scripts/simulate.ts` raccoglie per ogni battaglia un **`SimResult`** con:

- **Outcome**: winner (A/B/draw/timeout), rounds, events totali
- **HP finali**: `unitsHpFinal: { A, B }`
- **Combat stats** (per fazione):
  - `meleeAttempts`, `rangedAttempts`
  - `hits` (colpi a segno)
  - `parriesSuccessful` / `parriesFailed`
  - `dodgesSuccessful` / `dodgesFailed`
  - `damageDealt` (post-RD), `damageAbsorbed` (RD)
  - `slancioPenaltyDealt` (impeto/slancio drenato all'avversario)
  - `moves`, `reloadsAttempted`, `reloadsSuccessful`
  - `endTurnsPassive` (turni passati senza fare nulla)
- **Bias**: `firstPlayer` (A o B) — chi ha giocato per primo nel round 1

Aggregato su N battaglie: `analyzeMatchup(results)` produce **`MatchupAnalysis`** con:
- Win rate A/B, draw rate, timeout rate
- Avg rounds, avg events
- **Hit rate** A/B (% colpi a segno su tentativi)
- **Parry/dodge success rate** A/B
- **DPR** (Damage Per Round)
- Avg attacchi mischia/ranged, mosse, slancio penalty
- `firstPlayerWinRate` (50% = no bias, deviazioni indicano vantaggio iniziativa)
- `firstPlayerWasA` (50% = no bias di seed)

---

## 3. Metodologia di test per balancing

### A. Test di bilanciamento di un preset

```bash
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "REPORT OTTIMIZZAZIONE"
```

Genera matrice 3×3 di tutti i preset × 100 sim/cella, salva in `/tmp/sim-traces/_REPORT_OTTIMIZZAZIONE.md` con:
- Tabella sintetica (DPR, hit rate, parate, schivate, turni passivi, bias iniziativa)
- **Insight automatici**: rilevamento di sbilanciamenti, stalli, parate troppo affidabili, hit rate basso
- Suggerimenti di ottimizzazione (5 leve di game design)

### B. Test simmetria mirror match

Per verificare se un preset ha bias di iniziativa intrinseca, controlla il `firstPlayerWinRate` su 100+ sim mirror:
- **45-55%**: nessun bias significativo
- **<35% o >65%**: bias gameplay vero (es. arco mirror, chi va secondo vince 72%)
- `firstPlayerWasA` deve essere ~50% (verifica niente bias di seed sull'ordine)

### C. Test confronto AI

```bash
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "FULL TOURNAMENT"
```

Esegue mirror match per ogni preset × ogni coppia di AI:
- 3 preset × 9 (3×3) AI combos × 30 sim = 810 battaglie
- Report in `/tmp/sim-traces/_AI_FULL_TOURNAMENT.md`

Verdetto AI: l'AI che vince consistentemente > 55% contro heuristic è "strategica utile". Sotto, è equivalente o peggiore.

### D. Test trace dettagliato

```bash
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "verbose trace"
```

Salva trace passo-passo (round, eventi, stato unità, tiri specifici) in `/tmp/sim-traces/<preset>-vs-<preset>-seedN.md` per debug visivo di una battaglia.

---

## 4. Soglie diagnostiche dai dati

Dalle simulazioni baseline (preset 2000 exp, AI heuristic, deploy 5 hex):

| Metrica | Range "sano" | Range "problematico" |
|---|---|---|
| Timeout rate | < 30% | > 50% (stallo) |
| Avg rounds | 3-15 | < 2 (instakill) o > 25 (stallo) |
| Hit rate aggressore | 30-70% | < 20% (attacchi sprecati) o > 90% (no difese efficaci) |
| Parry success | 30-60% | > 80% (parata troppo affidabile) |
| Dodge success | 20-50% | > 70% (schivata troppo facile) |
| DPR aggressore | 1-5 | > 8 (one-shot) o < 0.3 (incapacitato) |
| Win rate matchup | 35-65% A | < 20% A (build sbilanciata) |
| firstPlayerWinRate (mirror) | 40-60% | < 30% o > 70% (bias gameplay) |
| Passive turn rate | < 20% | > 30% (AI bloccata) |

**Trigger automatici** in `generateOptimizationReport`:
- 🔁 Stallo: timeout > 50% AND DPR totale < 1
- 🛡 Parry power: parrySuccess > 80%
- 🎯 Attacchi sprecati: hitRate < 20% AND attempts > 2/partita
- 💤 Passività: passiveTurnRate > 30%
- ⚖ Bias iniziativa: |firstPlayerWinRate − 0.5| > 0.15

---

## 5. Procedura per testare un nuovo preset

1. **Definisci** il preset in `src/data/presets.ts` con somma exp = 2000
2. **Run baseline test**: `RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "REPORT OTTIMIZZAZIONE"`
3. **Confronta** il preset nuovo vs quelli esistenti:
   - Win rate vs ognuno (target 35-65%)
   - DPR (target 1-5)
   - firstPlayerWinRate in mirror (target 40-60%)
4. **Trova** outlier (insight automatici nel report)
5. **Itera**: aggiusta skill/equip e ripeti

## 6. Procedura per testare nuove regole o costi skill

1. **Modifica** `src/data/skills.ts` o `src/core/combat.ts`
2. **Run** `npx vitest run` per verificare 152+ test verdi (regression)
3. **Run** `RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "REPORT OTTIMIZZAZIONE"` per re-misurare
4. **Diff** numerico vs baseline (puoi tenere copia di `_REPORT_OTTIMIZZAZIONE.md` precedente)
5. **Decisione**: se i numeri migliorano (meno timeout, meno outlier) → applica, altrimenti rollback

---

## 7. Limiti noti

- **Sim AI vs AI ≠ playtesting umano**: l'AI gioca in modo deterministico (a parità di seed), non riproduce errori/creatività umani
- **Dati a 2 unità (1v1)**: scenari multi-unit non testati
- **Mappa fissa**: 24×18, hexSize 32. Cambi di mappa richiedono re-test
- **Preset fissi**: 3 baseline. Per validare build custom, vanno aggiunti come preset e testati
- **MCTS lento**: ~50-100ms/decisione; non usabile in real-time (UI). Usabile in sim offline per validazione

---

## 8. File chiave

| File | Cosa fa |
|---|---|
| `src/ai/basicAi.ts` | Heuristic AI (decision tree) |
| `src/ai/utilityAi.ts` | Utility AI (scoring) |
| `src/ai/mctsAi.ts` | MCTS con UCB1 + reward shaping |
| `src/ai/legalMoves.ts` | Generatore mosse legali (per Utility/MCTS) |
| `scripts/simulate.ts` | Sim harness (`runBattle`, `analyzeMatchup`, ...) |
| `tests/sim/balance.test.ts` | Test runner sim (RUN_SIM=1 attiva) |
| `/tmp/sim-traces/` | Output dei test (report markdown + trace verbose) |

---

## 9. Roadmap migliorie AI (priorità)

1. **MCTS tuning**: aumentare iterations, ridurre branching MOVE (oggi ~5 hex-target, futuro 2-3 con pruning), accelerare rollout
2. **Utility AI weights**: estrarre pesi come parametri, fare hyperparameter search via grid sui matchup
3. **NN/AlphaZero**: solo se MCTS+tuning rimane sotto utility. Richiede TensorFlow.js + training infra
4. **AI multi-mano**: estendere quando l'attacco offhand sarà implementato

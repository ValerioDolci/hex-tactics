# AI Results — Tournament Findings

> Risultati del tournament 3 preset × 3 AI mirror match (810 battaglie, 17 min).
> Da consultare assieme a `AI_METHODOLOGY.md` per metodologia.

---

## Verdetto sintetico

| AI | Pro | Contro | Quando usarla |
|---|---|---|---|
| **Utility** ⭐ | Gioco si CHIUDE quasi sempre, decisioni informate, deterministico, veloce | Pesi tarati a mano | **DEFAULT per il gioco e per benchmark balancing** |
| **Heuristic** | Veloce, semplice | 60-100% timeout in mischia, decisioni miopi | Baseline di confronto, debug |
| **MCTS** | Concettualmente migliore | 100% timeout in molti matchup, lento (50-100ms/decisione), peggio di Utility coi tuning attuali | Solo offline per validazione, post-tuning |

**Decisione operativa**: l'AI di default per il gioco produttivo è **Utility**. La heuristic resta come fallback / baseline di confronto.

---

## Risultati dettagliati (mirror match, 30 sim/cella)

### Spadaccino mirror (HP 20, scudo medio, arm leggera)

| AI A | AI B | Win A | Win B | TO | Avg rounds |
|---|---|---|---|---|---|
| heuristic | heuristic | 13% | 23% | **63%** | 3.4 |
| heuristic | utility | 30% | 3% | 67% | 3.3 |
| heuristic | mcts | 3% | 0% | 97% | 1.9 |
| utility | heuristic | 3% | 53% | 43% | 5.3 |
| **utility** | **utility** | **57%** | **43%** | **0%** | 5.8 |
| utility | mcts | 20% | 10% | 70% | 24.6 |
| mcts | heuristic | 0% | 0% | 100% | 4.0 |
| mcts | utility | 7% | 17% | 77% | 26.1 |
| mcts | mcts | 0% | 0% | 100% | 31.0 |

**Insight**: solo `utility vs utility` chiude il gioco al 100%. Ogni altra combinazione produce timeout significativo.

### Arciere mirror

| AI A | AI B | Win A | Win B | TO | Avg rounds |
|---|---|---|---|---|---|
| heuristic | heuristic | 53% | 47% | 0% | 1.0 |
| (tutte le altre 8 combinazioni) | | 53% | 47% | 0% | 1.0 |

**Insight cruciale**: nel mirror arciere, **l'AI è irrilevante**. Tutti producono identico 53/47/0 in 1 round perché chi spara per primo (vince iniziativa) infligge danno massivo (DPR ~10) e decide la partita. Il bias 53/47 è il bias gameplay già documentato (chi va secondo dovrebbe vincere → ma con DPR così alta, chi va primo finisce).

### Tank mirror (mazza, scudo medio, arm media)

| AI A | AI B | Win A | Win B | TO | Avg rounds |
|---|---|---|---|---|---|
| heuristic | heuristic | 0% | 0% | **100%** | 2.6 |
| heuristic | utility | 13% | 0% | 87% | 3.9 |
| heuristic | mcts | 7% | 0% | 93% | 15.6 |
| utility | heuristic | 7% | 93% | **0%** | 7.5 |
| **utility** | **utility** | **47%** | **53%** | **0%** | 6.1 |
| utility | mcts | 7% | 0% | 93% | 29.2 |
| mcts | heuristic | 0% | 3% | 97% | 29.5 |
| mcts | utility | 3% | 3% | 93% | 29.5 |
| mcts | mcts | 0% | 0% | 100% | 31.0 |

**Insight**: di nuovo, solo `utility vs utility` chiude al 100%. Heuristic vs Heuristic in mirror tank = 100% timeout. Asimmetria utility-vs-heuristic interessante: 7%-93% (heuristic vince da B).

---

## Analisi delle cause

### Perché Utility vince

L'Utility AI valuta l'utilità di ogni mossa con una funzione composita (`scoreMove` in `src/ai/utilityAi.ts`):

```
score = damageDealt × w1 + closeDistance × w2 + selfHp × w3 + saveDice × w4 + ...
```

In particolare per la fase **CHOOSE_DEFENSE**, considera attaccante (variabile, fissa, dadi) e sceglie schivata vs parata in base al tipo di attacco. Risultato: difese più adatte al contesto → meno turni passivi → gioco si chiude.

### Perché Heuristic stallo

Heuristic sceglie SEMPRE parata se ha scudo idoneo, indipendentemente dall'attaccante. Risultato: **due tank con scudo medio si parano l'un l'altro all'infinito** (parry success ~95%).

### Perché MCTS stallo

MCTS espande l'albero ma con **branching alto** (5-6 hex MOVE × 2 modi attacco × 2-3 tipi difesa) e **iterazioni 200**: ogni mossa è esplorata ~10-20 volte, troppo poco per stat significative. Inoltre il rollout euristico finisce spesso in timeout/draw, fornendo segnali deboli.

**Tuning futuro per MCTS**:
- Iterazioni 1000-2000 (5-10× tempo, ~250-500ms/decisione)
- Pruning legalMoves: max 2-3 hex MOVE candidati
- Reward shaping più aggressivo (peso forte su damage delta vs HP enemy)

---

## Raccomandazioni operative

1. **AI di gioco produttivo**: Utility (con pesi `DEFAULT_WEIGHTS`). Implementare in `BattleScene.ts` come opzione configurabile.
2. **Test di bilanciamento**: usare Utility vs Utility come baseline. Se modifichi una skill o un preset, ri-runna `RUN_SIM=1 npx vitest run -t "REPORT OTTIMIZZAZIONE"` e confronta.
3. **MCTS rimandato**: utile come strumento di validazione offline una volta tunato. Non necessario per gameplay.
4. **Mirror arciere**: il bias 53/47 è strutturale (chi spara primo vince per DPR alta). Eventuale fix è game design (non AI): ad esempio limitare DPR ranged a contatto.

---

## Numeri chiave per metodologia

- **Soglia "AI funzionale"**: > 80% delle mirror match producono un vincitore (timeout < 20%)
- **Utility raggiunge 100%** (per spadaccino e tank mirror)
- **Heuristic 0-37%** (60-100% TO)
- **MCTS 0-3%** (97-100% TO)

Quando si testa una nuova versione del gioco (regole, costi skill, preset), questi sono i target:
- Mirror match con Utility AI: timeout < 30%
- Asymmetric matchups con Utility AI: win rate vincitore tra 35% e 70% (no instant-win)
- Avg rounds: 3-15 (non instant, non infinito)

---

## Riproduzione

```bash
# Tournament base 3 AI × spadaccino (10 min)
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "AI TOURNAMENT"

# Tournament esteso 3 AI × 3 preset (17 min)
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "FULL TOURNAMENT"

# Report ottimizzazione (con Utility) — 100 sim/matchup (5 min)
RUN_SIM=1 npx vitest run tests/sim/balance.test.ts -t "REPORT OTTIMIZZAZIONE"
```

Output in `/tmp/sim-traces/`:
- `_AI_TOURNAMENT_spadaccino.md`
- `_AI_FULL_TOURNAMENT.md`
- `_REPORT_OTTIMIZZAZIONE.md`
- `_REPORT_OTTIMIZZAZIONE_VICINI.md`

---

**Tutti i 152 test unitari restano verdi durante tutto il workflow** (i sim sono on-demand via `RUN_SIM=1`).

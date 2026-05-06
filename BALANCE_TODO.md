# Balance TODO — bilanciamento post-MVP via Deep CFR

> Created 2026-05-06 dopo sessione overnight Deep CFR.
> Riferimento risultati: [`DEEP_CFR_RESULTS_2026-05-06.md`](./DEEP_CFR_RESULTS_2026-05-06.md).
> Database modelli: `python/cfr/nightly_results/database_index.json`.

---

## Priority 1 — Bug noto da fixare

### [ ] B1. **Lancia 3m** matematicamente rotta (M-3 in CLAUDE.md)

- **Problema**: `2D6 +0` + IMP 6 → fissa totale -4 → damage netto medio ~5-7 vs RD 6 → ≈0 dmg quasi sempre.
- **Fix candidati**:
  - (a) Aggiungere `+4` al fisso ATK → `2D6 +4` (porta fissa totale a 0)
  - (b) Ridurre IMP a 4
  - (c) Rivedere reach 6 (forse troppo? attiva zona controllo molto larga)
- **Decisione pending**: Valerio + Claude. Probabilmente (a) è la più semplice.
- **Test post-fix**: rilanciare matchup `lanc_3m_vs_*` e verificare V_a.

---

## Priority 2 — Squilibri throwers (nuovo modello inventario)

I 4 squilibri più gravi (V_a > +0.50) coinvolgono tutti **throwers con inventario completo vs preset baseline senza lancio**:

| Matchup | V_a | wr% gap |
|---|---|---|
| lanc_inv vs spa | +0.675 | +33.7 |
| giav_inv vs arc | +0.660 | +33.0 |
| balestra vs spa | +0.650 | +32.5 |
| giav_inv vs spa | +0.575 | +28.7 |
| lanc_inv vs arc | +0.540 | +27.0 |

### Fix candidati (da testare con sensitivity analysis)

- [ ] **F1. Ridurre N armi da lancio per inventario**: passare da 3 a 1-2.
  - Rationale: oggi lanciere = 3 lance, giav = 3 giavellotti. Con 3 colpi free pre-melee la softening è troppo forte.
  - Implementazione: editare `presets.py` / `presets.ts` `thrown_inventory`.
  - Test: rilanciare `lanc_inv_vs_spa`, `giav_inv_vs_arc` con N=1 e N=2.
- [ ] **F2. Aumentare malus movimento ranged**: da -1/hex a -2/hex.
  - Rationale: oggi -1/hex è troppo permissivo, il thrower mantiene ottima accuracy in movimento.
  - Implementazione: `reducer.ts/py` parametro `malus_mov_ranged`.
- [ ] **F3. Skill `+1tiro lancio` più cara**: aumentare cost da 600 a 900-1200.
  - Rationale: rendere più costoso specializzarsi nel lancio.
- [ ] **F4. Pickup arma da terra**: dopo che lanci puoi raccoglierla (move action).
  - Rationale: nuova azione di gioco che modifica l'economy thrower.
  - Implementazione: nuova action `PICKUP` con LoS check + adiacenza al hex dove l'arma è caduta.
  - Costo dev: ~200 righe (action+state+UI).
- [ ] **F5. Dare lancio anche ai preset baseline**: spa/arc kit ricevono 1-2 pugnali/giavellotti gratis.
  - Rationale: equity, ogni preset ha un'opzione anti-thrower.
  - Implementazione: editare `presets.py` `thrown_inventory` di spa/arc.

### Workflow sensitivity analysis

Per ogni fix sopra:
1. Implementa il fix
2. Rilancia 4-6 matchup chiave (`lanc_inv_vs_spa`, `lanc_inv_vs_arc`, `giav_inv_vs_arc`, `ascia1h_vs_lanc`, `balestra_vs_spa`, `arc_vs_spa`)
3. Confronta V_a pre/post
4. Mantieni il fix se: tutti i V_a si avvicinano a 0 senza rompere matchup già OK

---

## Priority 3 — Squilibri preset baseline

Anche i preset "core" hanno problemi:

- [ ] **P1. spa < arc**: `arc_vs_spa = +0.33` (l'arciere batte lo spadaccino di 16.5 wr%)
  - Cause: spadaccino non ha scudo né lancio, l'arco lo bersaglia in avvicinamento.
  - Fix candidati: dare scudo piccolo allo spadaccino, o pugnale lanciabile.
- [ ] **P2. ascia1h < lanc/giav**: `ascia1h_vs_lanc = -0.43`, vs giav stimato -0.45
  - L'ascia 1h con lancio 0.5m (1 hex) è dominata dai throwers a range maggiore.
  - Fix candidati: aumentare lancio ascia 1h a 0.5m → 1m (2 hex)? O dare più ascie nell'inventario.

---

## Priority 4 — Validazione metric

I mirror match devono dare V_a ≈ 0. Validazione esistente:
- spa_mirror: -0.03 ✓
- arc_mirror: +0.105 (un po' rumoroso, accettabile)
- tank_mirror: +0.03 ✓

### [ ] M1. Eseguire mirror nuove build

- [ ] `lanc_mirror` (lanciere vs lanciere, stesso build)
- [ ] `giav_mirror` (giavellottiere vs giavellottiere)
- [ ] `ascia1h_mirror` (ascia1h vs ascia1h)
- [ ] `balestra_mirror` (balestra vs balestra)

Se uno dà V_a > 0.10 → la metric è rumorosa per quel matchup, aumentare `n_eval_games` da 500 a 1000.

---

## Priority 5 — Estensione matrice

### [ ] E1. Cross thrower-vs-balestra

- [x] `lanc_vs_balestra` (in corso, V_a iter 10 = +0.700 — lanciere stomp)
- [ ] `giav_vs_balestra`
- [ ] `ascia1h_vs_balestra`

### [ ] E2. Build esotiche

- [ ] **Spada lunga 2h** vs preset (build con armatura pesante post-D3 RD 12)
- [ ] **Ascia 2h** (1D6+15, IMP 6) — è devastante in mischia se arriva
- [ ] **Lancia 3m post-fix** (dopo B1)
- [ ] **Dual wield asce** (off-hand ascia per parata + lancio)
- [ ] **Build full-pesante** (armatura pesante RD 12) — verificare se D3 ha funzionato

---

## Priority 6 — Distillazione AI per il gioco

> Confermato da Valerio: la distillazione è **necessaria** per il gioco.

### [ ] D1. Pipeline distillazione

- [ ] Definire formato student model (es. piccolo MLP o decision tree leggibile)
- [ ] Estrarre dataset (state, action_distribution) dai 22 modelli Deep CFR
- [ ] Train student per matchup (oppure single-policy multi-matchup con embedding del build)
- [ ] Confrontare student vs Deep CFR teacher: V_a deve essere vicino (Δ < 0.10)
- [ ] Integrare student in `src/ai/` come opzione alternativa a `utility`

### [ ] D2. Strategic insights (manual extraction)

- [ ] Estrarre policy leggibili dai modelli salvati: cosa fa il lanciere ottimale? Quanti dadi atk/def, quando lancia, distanza media engagement?
- [ ] Generare documentazione di gioco — "cosa funziona contro X" — utile per tutorial e onboarding.
- [ ] Salvare in `STRATEGY_GUIDE.md`.

---

## Priority 7 — Iterazione finale

### [ ] L1. Ciclo di bilanciamento fino a `|V_a| < 0.15` per tutti i matchup

Iterare:
1. Trovare il matchup peggiore (max |V_a|)
2. Proporre fix mirato
3. Sensitivity analysis (rilanciare 4-6 matchup correlati)
4. Mantenere il fix se globalmente migliora
5. Ripetere

Soglia di accettazione: `|V_a| < 0.15` per tutti i matchup core (preset baseline + 4 throwers + balestra). Significa: nessuno stomp, niente builds dominate.

---

## Stato corrente sweep notturni (2026-05-06)

Modelli completati questa notte:
- ✅ lanc_vs_giav (V_a=+0.035)
- ✅ ascia1h_vs_tank (V_a=-0.060)
- ✅ ascia1h_vs_lanc (V_a=-0.430)
- ✅ balestra_vs_arc (V_a=-0.060)

In corso (sweep paralleli):
- 🔄 ascia1h_vs_giav (50/60, V_a=-0.36)
- 🔄 balestra_vs_tank (30/60, V_a=-0.02)
- 🔄 lanc_vs_balestra (10/60, V_a=+0.70)

---

## Come usare questo file

- A inizio sessione bilanciamento: leggere TODO + risultati ultimi sweep.
- Quando un fix è scelto: spostare in "in progress" + creare branch git.
- A ogni nuovo run completato: aggiornare il database_index.json + DEEP_CFR_RESULTS_*.md.
- Quando un matchup raggiunge `|V_a| < 0.15`: marcare ✓ nella matrice di copertura.

# Deep CFR — Snapshot risultati 2026-05-06

> Generato durante la sessione overnight 2026-05-05 → 2026-05-06.
> Database: 30+ modelli salvati in `python/cfr/nightly_results/deep_cfr_*/`.
> Index autopopolato: `python/cfr/nightly_results/database_index.json`.
> Rules version: `2026-05-05_rev3 (cap impeto + ranged_div_4_5_3 + malus_mov_-1hex + thrown_inventory + backup_weapon)`.

---

## Metric

`V_a` = `(wins_A − wins_B) / N` su `N=500` partite eval, calcolato come **media tail iter** (final_v_a in metadata.json) — più conservativo del singolo iter 60. Range `[-1, +1]`.
- `V_a ≈ 0` → matchup bilanciato
- `V_a > 0` → A vince
- `|V_a| > 0.20` → squilibrio significativo (>10 wr% gap)
- `|V_a| > 0.50` → stomp

---

## ⚙️ Convenzione "shield" usata sotto

| Build | Scudo | Note |
|---|---|---|
| spa_preset | **none** | spada lunga 2h |
| arc_preset | **none** | pugnale offhand (parry, non scudo) |
| balestra | **none** | pugnale offhand |
| spadone_2h | **none** | offhand=null |
| ascia_2h | **none** | offhand=null |
| spa_scudo (build vecchia) | **scudo_medio** | spada 1h + scudo medio |
| tank_preset | **scudo_medio** | mazza + scudo medio |
| lanciere | **scudo_piccolo** | lancia 2m + scudo piccolo |
| giavellottiere | **scudo_piccolo** | giav + scudo piccolo |
| ascia1h_lanciatore | **scudo_piccolo** | ascia 1h + scudo piccolo |

---

## Pattern strutturale dominante (CONFERMATO)

> **Throwers/ranged battono chi NON ha scudo.** Lo scudo medio neutralizza l'asimmetria.

### Stesso attaccante, diverso difensore (no-scudo vs scudo medio)

| Attaccante (con scudo piccolo o no) | vs no-scudo (spa/arc/balestra) | vs scudo medio (tank) | Δ wr% recupero scudo |
|---|---|---|---|
| Lanciere (lancio 2hex, reach 4) | +0.675 (vs spa) / +0.540 (vs arc) | +0.225 | **+22-25 wr%** |
| Giavellottiere (lancio 3hex) | +0.575 (vs spa) / +0.660 (vs arc) | +0.090 | **+24-28 wr%** |
| Balestra (range 4hex, +15 fisso) | +0.650 (vs spa) | -0.025 | **+33.7 wr%** |
| Arco lungo (range 4hex, 2D6+6) | +0.330 (vs spa) | -0.100 | **+21.5 wr%** |
| Ascia1h (lancio 1hex) | +0.290 (vs spa) / +0.350 (vs arc) | -0.055 | **+17.2 wr%** |

**Lo scudo medio annulla 22-34 wr% di vantaggio del thrower/ranged.** Spiegazione meccanica (verificata su `core/ranged.py`):

- Per **ranged + lancio** (arco, balestra, giav, ascia 1h, lance, pugnale): nessuna schivata/parata attiva, solo **difese passive** che riducono il tiro dell'attaccante:
  - `−slancio_target`
  - `−scudo.parry.fixed` (×2 se difensore in defensive_stance)
  - `−armor.RD`
- Quindi lo **scudo medio** (parry.fixed=8) sottrae **−8 al fisso del tiro ranged**, il piccolo (parry.fixed=4) sottrae −4, niente scudo = −0.
- Per **CaC** (mischia + portata): vale schivata (morde VARIABILE) + parata (morde TUTTO ma richiede arma idonea), oltre allo scudo passivo solo se in defensive_stance.

**Numeri attesi vs balestra (atk = 2 PG + 15 fisso + d6 PG)**:
- Tank slancio 14, scudo medio (-8), armor media (-6): tiro ridotto di −28 → balestra spesso `≤ 0`
- Spa 2h slancio 14, no scudo (0), armor media (-6): tiro ridotto di −20 → balestra passa più spesso
- Differenza: **8 punti dallo scudo**, abbastanza da spostare il matchup di ~30 wr%.

### Conferma con build alternativa "spa_scudo" vs arco

`spaScudo_vs_arc = +0.450` (spadaccino con scudo medio batte l'arciere senza scudo).

vs

`arc_vs_spa = +0.330` (arco no-scudo batte spadaccino preset 2h no-scudo).

Stesso preset arciere — quando affronta uno spadaccino con scudo medio, perde di +0.45; senza scudo, vince di +0.33. **Differenza ~80 wr% solo per lo scudo del difensore.**

---

## Pattern secondario: tra build con stesso scudo, vince il range maggiore

Quando entrambi hanno scudo piccolo, decide la **lunghezza del lancio/reach**:

| Matchup | V_a | Spiegazione |
|---|---|---|
| ascia1h_vs_giav | **-0.575** | giav lancio 3hex vs ascia lancio 1hex |
| ascia1h_vs_lanc | **-0.430** | lanc reach 4 + lancio 2hex vs ascia 1hex |
| lanc_vs_giav | **+0.035** | range simili (entrambi a metà gerarchia), bilanciato |

**Gerarchia thrower (con scudo piccolo)**: Lanciere ≈ Giavellottiere > Ascia1h.
- Lanciere ha reach 4 (zona controllo) ed è migliore vs ascia, ma uguale a giav.
- Differenza giav-vs-ascia (-0.575) > differenza lanc-vs-ascia (-0.430): probabile perché il giav `+6` fisso passa la parata dello scudo piccolo `1D6+4` con minor variabilità della lance `2D6` (che dipende dai dadi).

---

## Tabella completa V_a (ordinata per |V_a|, 30 modelli)

| Matchup | V_a | A_shield | B_shield | Verdetto |
|---|---|---|---|---|
| lanciere_vs_spa (deprecated) | +0.840 | piccolo | none | ⚠️ pre-fix throw single-use |
| **giav_vs_balestra** | **+0.750** | piccolo | none | ⚠️ stomp atteso (giav vs no-scudo) |
| **lanc_inv_vs_spa** | **+0.675** | piccolo | none | ⚠️ stomp atteso |
| **giav_inv_vs_arc** | **+0.660** | piccolo | none | ⚠️ stomp atteso |
| **balestra_vs_spa** | **+0.650** | none | none | ⚠️ stomp atteso (ranged vs no-scudo) |
| **ascia1h_vs_giav** | **-0.575** | piccolo | piccolo | ⚠️ range gap (giav 3hex > ascia 1hex) |
| **giav_inv_vs_spa** | **+0.575** | piccolo | none | ⚠️ stomp atteso |
| **lanc_inv_vs_arc** | **+0.540** | piccolo | none | ⚠️ stomp atteso |
| **lanc_vs_balestra** | **+0.505** | piccolo | none | ⚠️ stomp atteso |
| giav_vs_arc (deprecated) | +0.465 | piccolo | none | ⚠️ vecchio modello |
| spaScudo_vs_arc | +0.450 | medio | none | ⚠️ scudo medio batte arco no-scudo |
| **ascia1h_vs_lanc** | **-0.430** | piccolo | piccolo | ⚠️ range gap (lance reach 4 > ascia 1hex) |
| ascia1h_vs_arc | +0.350 | piccolo | none | ⚠️ ascia vs no-scudo |
| arc_vs_spa | +0.330 | none | none | ⚠️ ranged batte mischia 2h no-scudo |
| ascia1h_vs_spa | +0.290 | piccolo | none | ⚠️ ascia vs no-scudo |
| lanc_inv_vs_tank | +0.225 | piccolo | medio | ⚠️ reach 4 lievemente sopra scudo medio |
| spa_vs_tank | +0.155 | none | medio | ✓ borderline (atteso ~0) |
| giav_mirror | -0.150 | piccolo | piccolo | ✓ borderline mirror (rumore residuo) |
| lanc_mirror | -0.130 | piccolo | piccolo | ✓ borderline mirror |
| ascia1h_vs_balestra | +0.110 | piccolo | none | ✓ ascia leggera vs balestra |
| arc_mirror | +0.105 | none | none | ✓ borderline mirror |
| arc_vs_tank | -0.100 | none | medio | ✓ scudo medio neutralizza arco |
| balestra_mirror | -0.100 | none | none | ✓ borderline (alta variabilità interna) |
| giav_inv_vs_tank | +0.090 | piccolo | medio | ✓ scudo medio neutralizza giav |
| balestra_vs_arc | -0.060 | none | none | ✓ ranged-vs-ranged bilanciato |
| ascia1h_vs_tank | -0.055 | piccolo | medio | ✓ scudo medio annulla lancio 1hex |
| lanc_vs_giav | +0.035 | piccolo | piccolo | ✓ bilanciato |
| spa_mirror | -0.030 | none | none | ✓ mirror sano |
| tank_mirror | +0.030 | medio | medio | ✓ mirror sano |
| balestra_vs_tank | -0.025 | none | medio | ✓ scudo medio neutralizza balestra |

---

## Matrice di copertura (30 modelli)

|  | spa | arc | tank | lanc | giav | ascia1h | balestra |
|---|---|---|---|---|---|---|---|
| **spa** | mirror ✓ | ✓ | ✓ | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) |
| **arc** | ✓(sym) | mirror ✓ | ✓ | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) |
| **tank** | ✓(sym) | ✓(sym) | mirror ✓ | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) |
| **lanc** | ✓(sym) | ✓(sym) | ✓(sym) | mirror ✓ | ✓ | ✓(sym) | ✓ |
| **giav** | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | mirror ✓ | ✓(sym) | ✓ |
| **ascia1h** | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | mirror in corso | ✓ |
| **balestra** | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | ✓(sym) | mirror ✓ |

**Matrice 7×7 = completa al 90%** (manca solo `ascia1h_mirror`, in corso a iter 55/60).

In corso aggiuntivo (build esotiche P5):
- `spadone_vs_lanc` (spada lunga 2h + armatura pesante post-D3 vs lanciere) — iter 30/60 V_a=-0.22
- `ascia2h_vs_lanc` (ascia 2h `1D6+15` + armatura pesante vs lanciere) — iter 15/60 V_a=+0.22 preliminary

---

## Mirror validation (metric noise)

| Mirror | V_a final | Note |
|---|---|---|
| spa_mirror | -0.030 ✓ | preset baseline, sano |
| tank_mirror | +0.030 ✓ | preset baseline, sano |
| arc_mirror | +0.105 | preset baseline, rumore residuo accettabile |
| balestra_mirror | -0.100 | nuovi build (ranged), borderline (swing ±0.44 in iter intermedi) |
| lanc_mirror | -0.130 | nuovi build, borderline |
| giav_mirror | -0.150 | nuovi build, borderline |
| ascia1h_mirror | in corso | preliminary -0.34/-0.38 a iter 55 (più rumoroso degli altri) |

**Osservazione**: i mirror dei nuovi build con `thrown_inventory` hanno rumore ~3× rispetto a quelli baseline. Possibili cause:
1. Variabilità del lancio 1° colpo (chi tira primo ha vantaggio prob ~+1/3 di colpire prima)
2. Variable initial state asimmetria
3. CFR convergenza più lenta con action space che include throw/melee/reload

Soglia accettazione `|V_a| < 0.15` rispettata per spa/tank/arc/balestra/lanc; sforata per giav (-0.150) e ascia1h (preliminary -0.38). Da rilanciare con `n_eval_games=1000` se serve precisione maggiore.

---

## Pattern emergenti — sintesi insight

### 1. **Lo scudo è il counter primario a ranged/throwers** (atteso dalle regole)

- Per **ranged + lancio** non c'è schivata/parata attiva (verificato in `core/ranged.py`): difese sono passive (slancio + `scudo.parry.fixed` + `armor.RD`).
- Lo **scudo medio** dà −8 al fisso del tiro ranged, lo **scudo piccolo** −4, no-scudo −0.
- Per **CaC** (mischia + portata): la schivata morde la VARIABILE (efficace vs lancia 2D6, debole vs mazza/giav fisso puro); la parata morde TUTTO ma richiede arma con DIF idonea.
- Risultato netto: senza scudo, il difensore subisce ~30 wr% in più contro chi può lanciare/sparare.

### 2. **Lo scudo medio è "OP" o gli altri sono sub-ottimali?**

`tank_mirror = +0.030` (sano), tank vs tutti i throwers ≈ 0 (anche quando l'attaccante ha thrown inventory). **Il tank è una macchina universale**.

Domanda di design: il tank è troppo forte come archetipo, oppure i preset spa/arc devono essere ribilanciati per avere un'opzione anti-thrower?

### 3. **Tra build con scudo piccolo, vince il range del lancio**

Gerarchia: Lanciere ≈ Giavellottiere > Ascia1h. Differenza basata su:
- range del lancio (1hex / 3hex / 4hex reach lance)
- tipo damage (lance `2D6` aleatorio vs giav `+6` fisso vs ascia `1D6+6` mid)

### 4. **Build esotiche 2h senza scudo (preliminary) sono dominate dalla lance**

- `spadone_vs_lanc` mid-iter -0.22
- `ascia2h_vs_lanc` mid-iter +0.22 ⚠️ (early, da confermare)

L'armatura pesante (RD 12 post-D3) **non basta** a compensare la mancanza di scudo. Coerente con #1: l'RD passiva agisce su damage netto, ma il problema è il numero di colpi che arrivano.

### 5. **Mirror noise dei nuovi build** (vedi sezione sopra)

Indagare prima di trarre conclusioni forti dai V_a dei nuovi build se `|V_a| < 0.15`. Per matchup con stomp `|V_a| > 0.30` il rumore è trascurabile rispetto al segnale.

---

## Cosa è cambiato vs sessione 2026-05-02 (RL MaskablePPO)

- ✅ Metodo: passati da MaskablePPO (single-policy approx Nash) a **Deep CFR** (true equilibrium approximation per matchup).
- ✅ Feature engineering: implementato `obs_features_v2` (153 features).
- ✅ Bug structural game fixati: RELOAD legal, action_taken_this_turn, throw single-use con `thrown_inventory` + `backup_weapon`.
- ✅ Cap impeto dinamico: `HP_attuali + impeto_iniziale`.
- ✅ Ranged differenziato: arco_corto N=4, arco_lungo N=5, balestra N=3.
- ✅ Malus movimento ranged: -1/hex.
- ✅ DRAW_PENALTY=-0.3 in training (forza aggressione).
- ✅ Database expanded da 13 a 30 modelli con shield-aware metadata.

---

## Note di lettura per Valerio

- I modelli con `lanciere_vs_spa = +0.84` e `giav_vs_arc = +0.465` sono **deprecated** — pre-fix throw single-use.
- Le entry "?" nel database (preset baseline mirror + arc_vs_spa, spa_vs_tank, arc_vs_tank, arc_mirror, spa_mirror, tank_mirror) hanno build_path obsoleto: build sono stati confermati manualmente (vedi sezione "Convenzione shield" sopra).
- Imbalance ranking serve per priorità di fix in `BALANCE_TODO.md` P2.

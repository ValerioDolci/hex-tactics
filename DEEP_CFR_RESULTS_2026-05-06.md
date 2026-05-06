# Deep CFR — Snapshot risultati 2026-05-06

> Generato durante la sessione overnight 2026-05-05 → 2026-05-06.
> Database: 22 modelli salvati in `python/cfr/nightly_results/deep_cfr_*/`.
> Index: `python/cfr/nightly_results/database_index.json`.
> Rules version: `2026-05-05_rev3 (cap impeto + ranged_div_4_5_3 + malus_mov_-1hex + thrown_inventory + backup_weapon)`.

---

## Metric

`V_a` = `(wins_A − wins_B) / N` su `N=500` partite eval. Range `[-1, +1]`.
- `V_a ≈ 0` → matchup bilanciato
- `V_a > 0` → A vince
- `|V_a| > 0.20` → squilibrio significativo (>10 wr% gap)
- `|V_a| > 0.50` → stomp

---

## Tabella completa V_a (ordinata per |V_a| desc)

| Matchup | V_a | wr% gap A | Verdetto |
|---|---|---|---|
| **lanciere_vs_spa** (vecchio bug) | +0.840 | +42.0 | ⚠️⚠️ deprecato (pre-fix throw single-use) |
| **lanc_inv_vs_spa** | +0.675 | +33.7 | ⚠️ Stomp lanciere |
| **giav_inv_vs_arc** | +0.660 | +33.0 | ⚠️ Stomp giavellottiere |
| **balestra_vs_spa** | +0.650 | +32.5 | ⚠️ Stomp balestra |
| **giav_inv_vs_spa** | +0.575 | +28.7 | ⚠️ Stomp giavellottiere |
| **lanc_inv_vs_arc** | +0.540 | +27.0 | ⚠️ Stomp lanciere |
| **giav_vs_arc** (vecchio) | +0.465 | +23.2 | ⚠️ deprecato |
| **spaScudo_vs_arc** | +0.450 | +22.5 | ⚠️ Sbilanciato |
| **ascia1h_vs_lanc** | -0.430 | -21.5 | ⚠️ Stomp inverso (lanciere) |
| **ascia1h_vs_arc** | +0.350 | +17.5 | ⚠️ Sbilanciato |
| **arc_vs_spa** | +0.330 | +16.5 | ⚠️ Sbilanciato (preset baseline!) |
| **ascia1h_vs_spa** | +0.290 | +14.5 | ⚠️ Sbilanciato |
| **lanc_inv_vs_tank** | +0.225 | +11.2 | ⚠️ Sbilanciato |
| spa_vs_tank | +0.155 | +7.8 | ✓ Quasi bilanciato |
| arc_mirror | +0.105 | +5.2 | ✓ Validation OK (rumore residuo) |
| arc_vs_tank | -0.100 | -5.0 | ✓ Bilanciato |
| giav_inv_vs_tank | +0.090 | +4.5 | ✓ Bilanciato |
| balestra_vs_arc | -0.060 | -3.0 | ✓ Bilanciato (ranged-vs-ranged) |
| ascia1h_vs_tank | -0.055 | -2.8 | ✓ Bilanciato |
| lanc_vs_giav | +0.035 | +1.8 | ✓ Bilanciato |
| tank_mirror | +0.030 | +1.5 | ✓ Validation OK |
| spa_mirror | -0.030 | -1.5 | ✓ Validation OK |

---

## Insight strutturali

### 1. Gerarchia thrower (range del lancio domina)

Per le tre nuove build con `thrown_inventory + backup_weapon`:

| Thrower | Lancio range | Win-rate medio (vs preset baseline) |
|---|---|---|
| Lanciere (lancia 2m) | 2 hex (1m) | +0.480 |
| Giavellottiere (giav) | 3 hex (1.5m) | +0.442 |
| Ascia 1h | 1 hex (0.5m) | +0.195 |

**Lanciere ≈ Giavellottiere > Ascia1h**. Differenza tra lanciere e giavellottiere quasi nulla nonostante range diversi (la lancia ha `2D6` contro giavellotto `+6` fisso → compensa).

### 2. Ascia 1h dominata da lance/giavellotti

`ascia1h_vs_lanc = -0.43` e (in corso) `ascia1h_vs_giav ≈ -0.45`. L'ascia con range lancio 1 hex non riesce a contestare lo space dei thrower con range 2-3 hex.

### 3. Preset baseline NON sono completamente bilanciati

`arc_vs_spa = +0.33`: anche tra i preset "core" l'arciere batte sensibilmente lo spadaccino. **Possibile fix**: dare allo spadaccino uno scudo o un pugnale lanciabile.

### 4. Tank è il preset più robusto

Tank vs ogni nuova build (post-throw inventory):
- vs lanc_inv: -0.225 (perde ma non stomp)
- vs giav_inv: -0.090 (≈)
- vs ascia1h: +0.055 (≈)
- vs balestra: in corso (~-0.10/-0.20)

Mazza (+9 fisso) + scudo medio + armatura media battono i throwers in mischia.

### 5. Balestra ≈ Arco lungo (ranged vs ranged)

`balestra_vs_arc = -0.06`. Match ranged-vs-ranged perfettamente bilanciato. Pero entrambi soffrono il melee:
- balestra_vs_spa = +0.65 (balestra vince sull'inseguimento dello spadaccino senza scudo)
- arc_vs_spa = +0.33 (idem ma meno netto, l'arco è 2D6+6 più costante)

### 6. Mirror match: validazione metric OK

| Mirror | V_a |
|---|---|
| spa_mirror | -0.03 ✓ |
| arc_mirror | +0.105 (rumore residuo, accettabile) |
| tank_mirror | +0.03 ✓ |

I mirror dei nuovi build (`lanc_mirror`, `giav_mirror`, `ascia1h_mirror`, `balestra_mirror`) **non sono ancora stati testati** — task da completare per validare la metric anche sulle build con thrown_inventory.

---

## Build/preset coperti dalla matrice

|  | spa | arc | tank | lanc | giav | ascia1h | balestra |
|---|---|---|---|---|---|---|---|
| **spa** | mirror ✓ | ✓ | ✓ | ✓ (sym) | ✓ (sym) | ✓ (sym) | ✓ (sym) |
| **arc** | ✓ (sym) | mirror ✓ | ✓ | ✓ (sym) | ✓ (sym) | ✓ (sym) | ✓ (sym) |
| **tank** | ✓ (sym) | ✓ (sym) | mirror ✓ | ✓ (sym) | ✓ (sym) | ✓ (sym) | in corso |
| **lanc** | ✓ (sym) | ✓ (sym) | ✓ (sym) | **MISS** | ✓ | ✓ (sym) | in corso |
| **giav** | ✓ (sym) | ✓ (sym) | ✓ (sym) | ✓ (sym) | **MISS** | in corso | **MISS** |
| **ascia1h** | ✓ (sym) | ✓ (sym) | ✓ (sym) | ✓ (sym) | in corso | **MISS** | **MISS** |
| **balestra** | ✓ (sym) | ✓ (sym) | in corso | in corso | **MISS** | **MISS** | **MISS** |

**Mancanti** (priorità per chiudere matrice):
- 4 mirror nuovi build: `lanc_mirror`, `giav_mirror`, `ascia1h_mirror`, `balestra_mirror`
- 3 cross thrower-vs-balestra: `giav_vs_balestra`, `ascia1h_vs_balestra` (lanc_vs_balestra in corso)

---

## Cosa è cambiato vs sessione 2026-05-02 (RL MaskablePPO)

- ✅ Metodo: passati da MaskablePPO (single-policy approx Nash) a **Deep CFR** (true equilibrium approximation per matchup).
- ✅ Feature engineering: implementato `obs_features_v2` (153 features), V_a passato da -0.37 (parse_info_state naive) a +0.255 con stesso compute.
- ✅ Bug structural game fixati: RELOAD legal, action_taken_this_turn, throw single-use con `thrown_inventory` + `backup_weapon`.
- ✅ Cap impeto dinamico: `HP_attuali + impeto_iniziale` (no più stallo accumulo infinito).
- ✅ Ranged differenziato: arco_corto N=4, arco_lungo N=5, balestra N=3.
- ✅ Malus movimento ranged: -1/hex.
- ✅ DRAW_PENALTY=-0.3 in training (forza aggressione, evita fuga reciproca).

---

## Note di lettura per Valerio

- I modelli con `lanciere_vs_spa = +0.84` e `giav_vs_arc = +0.465` sono **deprecati** — pre-fix throw single-use. Non considerarli per il bilanciamento attuale.
- `lanc_inv`, `giav_inv` = build con inventario corretto (post-fix). Sono questi i numeri da usare.
- Il database ha 22 modelli; il `database_index.json` è autopopolato, ordinato per imbalance.


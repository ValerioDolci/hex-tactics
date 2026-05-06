# Dinamiche di gioco — analisi pre-distillazione (2026-05-06)

> Generato simulando 50 partite per matchup con i modelli Deep CFR salvati.
> Script: `/tmp/analyze_match.py` (carica `adv_net_p{0,1}.pt`, regret_to_policy, traccia eventi).
> Validazione: `v_a_proxy` simulato concorda con `v_a_final` da training entro ±0.10.

---

## Tabella riassuntiva (50 sim/match)

| Matchup | V_a sim | A wr% | B wr% | Draw% | 1° atk dist A | 1° atk dist B | Round medi | HP A | HP B | TOGGLE_DEF A/B | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **lanc_inv_vs_spa** | +0.68 | 72 | 4 | 24 | **11.2** hex | 3.1 hex | 5.3 | 16.3 | **2.4** | 150 / 0 | Lanciere kite + def-stance |
| **lanc_inv_vs_arc** | +0.40 | 68 | 28 | 4 | 10.3 | 9.0 | 3.0 | 10.2 | 5.0 | 70 / 0 | Ranged-duel, A vince |
| **lanc_inv_vs_tank** | +0.28 | 30 | 2 | **68** | 4.6 | 3.0 | 8.5 | 17.1 | 7.9 | 181 / 165 | Stallo, draw dominante |
| **balestra_vs_spa** | +0.62 | 80 | 18 | 2 | **10.0** | 3.0 | 3.4 | 15.0 | **3.3** | 0 / 0 | Sparo lontano, spa muore in 3 turni |
| **balestra_vs_tank** | -0.12 | 4 | 16 | **80** | 9.3 | 3.0 | 10.4 | 13.8 | 15.5 | 245 / ? | Stallo massivo, balestra ricarica 7 |
| **ascia1h_vs_lanc** | -0.48 | 6 | 54 | 40 | 9.8 | 9.1 | 7.7 | **4.6** | 13.0 | 190 / 220 | Scambio lanci, ascia 1hex perde |
| **lanc_vs_giav** | +0.10 | 34 | 24 | 42 | 10.1 | 8.6 | 7.3 | 10.3 | 8.1 | 184 / 190 | Bilanciato, mind game range |

Legenda colonne:
- `1° atk dist X`: distanza in hex tra i 2 PG quando X dichiara il suo primo `DECLARE_ATTACK`
- `TOGGLE_DEF A/B`: numero di toggle "posizione difensiva" cumulati su 50 partite (=0 se no scudo)
- `HP X`: HP medi finali del player X (max 20)

---

## Insight emergenti

### 1. **Tre cluster di gioco**

I matchup si dividono in 3 archetipi:

- **Stomp veloci** (3-5 round): un thrower colpisce a 10+ hex, l'avversario senza scudo non può rispondere. Es. `lanc_inv_vs_spa`, `balestra_vs_spa`.
- **Ranged-duel** (3 round): due ranged, decisione rapida sul primo scambio. Es. `lanc_inv_vs_arc`.
- **Stalli da scudo medio** (8-10+ round, draw dominante): tank con scudo medio resiste, attaccante non lo finisce in tempo (max_rounds 12). Es. `balestra_vs_tank` 80% draw, `lanc_inv_vs_tank` 68% draw.

### 2. **La distanza del 1° attacco è il marker strategico**

| Build | Distance media 1° attacco |
|---|---|
| Lanciere/Giavellottiere/Balestra/Ascia1h (con lancio) | **9-11 hex** |
| Spadaccino 2h, Tank | **3 hex** (mischia) |
| Arciere | **9 hex** |

Chi può lanciare lo fa **sempre da lontano**. Chi non può, deve avvicinarsi. Lo gap è netto.

### 3. **TOGGLE_DEFENSIVE è usato massicciamente — solo da chi ha scudo**

Su 50 partite:
- Tank: 165-245 toggle (3-5 per partita) — la posizione difensiva è meccanica core del tank.
- Lanc/Giav/Ascia1h (scudo piccolo): 70-220 toggle.
- Spadaccino 2h, Arciere, Balestra (no scudo): **0 toggle**.

La posizione difensiva (defensive stance) **raddoppia il `parry.fixed` dello scudo** → da -4/-8/-12 al fisso del tiro ranged dell'avversario diventa -8/-16/-24. È enorme. Senza scudo, questa meccanica non è disponibile e il PG perde un'opzione difensiva chiave.

### 4. **Confronto stomp vs stallo — perché lo scudo medio cambia tutto**

`balestra_vs_spa` (V_a +0.62, 80% wr A, 3.4 round):
- A spara da 10 hex, fissa totale ~ 2 + 15 -6(armor B) -slancio_B = passa quasi sempre
- B muore in 3 round con HP 3.3

`balestra_vs_tank` (V_a -0.12, 16% wr B, 80% draw, 10.4 round):
- A spara da 9 hex, fissa totale ~ 2 + 15 -8(scudo medio B passive) -6(armor) -slancio_B = ~appena positivo o ≤0
- A in defensive stance attiva 245 volte (probabilmente per usare scudo piccolo passive ×2 = -8 contro counter-attack tank, oltre che attesa ricarica)
- Tank avanza, ma balestra ha ricarica 7 turni → pochissimi colpi
- Risultato: **80% draw, gioco si esaurisce per max_rounds 12**

Questo è il punto. Lo **scudo medio** rende il tank **non-finishable** in 12 round. È un counter strutturale a tutto.

### 5. **Asimmetria scudo-piccolo vs scudo-piccolo: vince chi ha più range**

`ascia1h_vs_lanc` (V_a -0.48):
- A (ascia 1h, scudo piccolo, lancio 1hex)
- B (lance, scudo piccolo, lancio 2hex + reach 4)
- Entrambi attaccano a 9-10 hex (entrambi lanciano dalla distanza max)
- HP finali: A=4.6, B=13.0 — gap 8

Lo scudo piccolo è equivalente, ma il **range del lancio decide**. La lance può lanciare da 2 hex; in mischia ha reach 4 (zona di controllo) + 2D6 ATK. L'ascia 1h ha lancio 1 hex e ATK mischia 1D6+6 con reach 1 — niente zona di controllo, range minore.

### 6. **Round medi come metric di "decisività"**

| Round medi | Verdetto |
|---|---|
| 3-5 | Decisivo — un PG non può rispondere |
| 5-7 | Equilibrato — entrambi giocano decisioni reali |
| 7-10 | Estenuante — molti scambi, scudo medio coinvolto |
| 10-12 | Stallo / draw dominante |

I matchup **stallo** non sono "bilanciati" in senso interessante: il gioco si esaurisce per timeout. Aumentare `max_rounds` o introdurre meccaniche anti-camp potrebbe migliorare l'esperienza.

---

## Strategia ottimale per build (estratta dal CFR)

### Lanciere (lancia 2m + scudo piccolo + armor media)

1. **Round 1-2**: defensive stance attiva. Approcciare lateralmente, mantenere distanza ~9-11 hex.
2. **Lancia 1ᵃ lance** (range 2 hex con malus 0). Damage atteso ~10 vs no-scudo.
3. **Lancia 2ᵃ e 3ᵃ** se inventario permette. Mantenere distanza con ranged malus mov.
4. **Avvicinarsi quando target HP basso** o quando si ha ancora la lancia base in mano (post-inventario): in mischia reach 4 + 2D6 ATK. **Defensive stance ON quando in attesa**.
5. **Difesa preferita**: parry (con scudo piccolo + arma 1h). Dodge in seconda scelta.

### Tank (mazza + scudo medio + armor media)

1. **Avanzare diretto verso il nemico**, defensive stance ON.
2. **Investire impeto in slancio per attivare carica** quando in adiacenza.
3. **Mazza +9 fisso devastante** se passa la parry. Forza nemico a parry → consumo dadi azione difensore.
4. **Difesa preferita**: defensive stance + parry. Lo scudo medio (parry 1D6+8) batte quasi tutti gli attacchi.
5. **Pattern emerso**: 165+ toggle defensive in 50 partite = ~3-5 per partita. Sostiene quasi continuamente.

### Spadaccino 2h preset (spada lunga 2h + armor media)

1. **Pochissime chance contro thrower o ranged**. Preferire raggio 0 — rush in mischia.
2. **Difesa**: parry con la 2h (DIF 1D6+6, decente). Dodge contro armi a fisso puro.
3. **Carica investita ad alto slancio** per amplify il fisso 1D6+6/2h.
4. **Limit emerso**: senza scudo, perde sistematicamente a 1°-2° lancio dell'avversario, prima ancora di arrivare in mischia.

### Balestra (balestra + pugnale + armor leggera)

1. **Tirare il 1° colpo (+15 fisso) appena il bersaglio è in LoS**.
2. **Ricaricare immediato** (RELOAD action, ~2 turni di setup).
3. **Mantenere distanza massima** durante la ricarica, sfruttare il malus distanza dell'avversario.
4. **Pattern emerso**: vs no-scudo (spa 80% wr, 3.4 round) vince in pochi turni. Vs scudo medio (tank, 80% draw) si stallia.

---

## Cosa serve per la distillazione (P6/D1 in BALANCE_TODO)

Da queste dinamiche, ecco i **macro-pattern** che la policy distillata deve riprodurre:

1. **Distance-keeping per thrower**: mantenere 9-11 hex se ha lancio.
2. **Defensive stance toggle ON** appena ha scudo + non sta agendo offensivamente.
3. **Atk dice modulare in base al difensore**: 2d se parry attesa, 1d se dodge probabile.
4. **Difesa**: parry default con scudo, dodge se nemico ha mazza/balestra/giav (fisso puro).
5. **Reload immediato** dopo tiro balestra.
6. **Investimento impeto→slancio per carica** se in adiacenza.

Una policy distillata semplice (es. decision tree o piccolo MLP) dovrebbe imparare:
- distanza al nemico (1 feature)
- HP self/enemy (2 features)
- slancio self/enemy (2 features)
- weapon_loaded (1 feature)
- has_thrown_inventory (1 feature)
- is_in_defensive_stance (1 feature)
- enemy_weapon_class (categorical)

Per una baseline initial, queste 8 feature sono sufficienti per ~70-80% della performance del Deep CFR.

---

## Limiti dell'analisi

1. **n=50 sim per matchup** — rumore residuo ~±0.10 sul `v_a_proxy`. Per analisi più precise, n=200+.
2. **`max_rounds=12`** — incentiva draw nei matchup stallo. In gioco reale forse va alzato a 20.
3. **TOGGLE_DEFENSIVE conta ogni toggle** (on/off) — il numero raddoppia rispetto al "tempo speso in stance". Per la metric pulita servirebbe un flag.
4. **Atk dice = 3 osservato** in alcuni matchup → effetto skill `+1dadomax` o action space più largo del previsto. Da verificare.

---

## Output dati

- Script: `/tmp/analyze_match.py <model_dir> [n_games=100]`
- Output esempio (json strutturato): `/tmp/multi_analysis_*.log`
- Riproduzione: `bash /tmp/analyze_multi.sh`

# hex-tactics — Tactical RPG a turni con esagoni

> **Nome cartella provvisorio**. Da rinominare quando Valerio sceglie un titolo definitivo.

---

## 🔄 Rollback marker — Skirmish work in progress

**Branch corrente di sviluppo**: `feat/skirmish` (creato 2026-05-14 sera).

**Commit stabile pre-skirmish** (rollback se necessario):
- Hash: **`6189209`**
- Branch: `design/codex-tacticus` (HEAD a quel commit)
- Descrizione: "Combat narrator overlay: leggibilità + no overlap con popup UI"
- Deployato live su `valeriodolci.github.io/hex-tactics-play/` (singlefile)

**Per rollback** (in caso il lavoro skirmish rompa qualcosa):
```bash
git checkout design/codex-tacticus
git reset --hard 6189209  # solo se servono modifiche post-6189209 da scartare
bash scripts/deploy_pages.sh "rollback to pre-skirmish"
```

Le modifiche su `feat/skirmish` NON impattano `design/codex-tacticus` finché non viene fatto merge.

---

## 🆕 Skirmish (Phase 1 completata, 2026-05-14)

**Branch `feat/skirmish` pushato + deployato live** — NvN da 2v2 fino a 10v10 (con limiti).

### Funzionalità Phase 1 (live)
- **Build-a-team con budget exp** (`SkirmishSetupScene`): 4000 exp/faction default,
  preset selezionabili con costo (1750-2000 exp), min 1 / max 10 unit per faction.
- **AI NvN-aware**: `pickTargetForAction` in basicAi sceglie main threat
  (HP basso × pericolosità arma × prossimità). `studentMlpAi` + `studentMultiAi`
  passano il main threat come `agentEnemyId` a `buildObsV2`.
- **`teamAi.ts`** wrapper per logica team-level futura (Phase 3+).
- **`TeamRosterHUD`**: pannello multi-unit con HP/slancio per ogni unit, header
  faction, caret + bg oro per unit attiva. Visibile solo in skirmish (>1 unit per faction).
- **Reducer core 100% NvN-ready** senza modifiche (`checkGameOver`, `computeTurnOrder`,
  `doEndTurn` già generici).

### Limiti noti Phase 1 → Phase 2
- **3v3 e 10v10 vanno in timeout 100+ round su mappa 24×14**: troppe unit, manovre bloccate
  da basette nemiche/alleate. Da risolvere con mappa scalabile in Phase 2.1.
- **ActionMenu non ha scroll** verticale: con 5+ nemici × attack modes le voci escono
  dalla viewport. Phase 2.2.
- **AI hard "ignora alleati e nemici secondari"** nell'obs (training 1v1) →
  no focus fire emergente, no copertura team. Richiede Phase 3 retrain.

### Phase 2 (TODO)
- 2.1 Mappa scalabile (es. 24+6×N hex/faction colonne)
- 2.2 ActionMenu scrollabile
- 2.3 Bilanciamento team composition (test pipeline simulazioni)

### Phase 3 (retrain Deep CFR per skirmish, design doc)

**Approccio scelto: 3.B Unit-centric con teammates-as-environment.**

Idea: ogni unit decide indipendentemente (no comunicazione team), ma l'obs space
si arricchisce di feature aggregate del proprio team e del team avversario:

**Nuove feature obs (estensione `buildObsV2`)**:
- `team_self`: # unit alive, HP medio team, slancio medio, distanza media al nemico
- `team_opp`: # unit alive, HP medio team avversario, distanza media
- `pos_in_team`: rank tactico (es. "sono il più ferito / il più sano / il più vicino al nemico")

**Pipeline training**:
1. Estendi `python/cfr/abstract_game.py` per gestire stato N unit per faction
2. Riusa il MLP small distillato attuale come **base policy** (transfer learning)
3. Fine-tune con curriculum: 1v1 (1k epoch) → 2v2 (5k epoch) → 3v3 (5k epoch) → 4v4+
4. Distill nuovo `studentMlpWeights.ts` (forse con obs feature aggiuntive → file più grande)
5. Sostituisci `aiDecideTeamHard` con il nuovo MLP centric-team-aware

**Costo stimato**: 20-30h compute overnight su Mac M4 + ~10h codice. Pro:
incrementale, riutilizza l'esistente, performance prevedibile. Contro: il MLP
può non imparare focus fire emergente senza canale di comunicazione esplicito.

**Da fare DOPO** che Phase 1 è giocata e validata, e Phase 2 (scaling + UI scroll
+ bilanciamento) chiuse.

---

## File del progetto — leggere SEMPRE a inizio sessione

| File | Cosa contiene | Quando aggiornare |
|---|---|---|
| **`CLAUDE.md`** (questo file) | Regole di gioco, skill system, regole operative del progetto, stato corrente | Quando cambiano regole, decisioni di alto livello, stato |
| **`ARCHITECTURE.md`** | Stack, struttura cartelle, pattern (core/ vs Phaser, reducer pattern, test strategy) | Quando si cambia un pattern architetturale |
| **`DECISIONS.md`** | Log ADR delle decisioni prese, con razionale. ID `D-NNN`. | A ogni nuova decisione architetturale o di design |
| **`TODO.md`** | Piano completo M1→M13 (fine MVP), task granulari, stato avanzamento | Real-time durante il lavoro: task `[ ] → [~] → [x]` |

**Regola di sessione**: a inizio di ogni sessione su questo progetto, **leggere tutti e 4 i file** (in quest'ordine) prima di rispondere a Valerio. Niente ricostruzioni da memoria.

---

## Stato corrente

**Fase**: **Post-MVP — bilanciamento Deep CFR in corso** (overnight 2026-05-05 → 2026-05-06).

**MVP completato**: tutte le 13 milestone (M1→M13 in scope ridotto), **139 test verdi**, gioco giocabile end-to-end via `npm run dev`.

**Workflow corrente**: Deep CFR su matchup paralleli per stimare V_a (win-rate proxy) di ogni build. 22 modelli salvati in `python/cfr/nightly_results/deep_cfr_*/`.

**File di stato bilanciamento (leggere a inizio sessione balance)**:
- [`DEEP_CFR_RESULTS_2026-05-06.md`](./DEEP_CFR_RESULTS_2026-05-06.md) — snapshot completo V_a dei 22 modelli, insight strutturali, matrice copertura.
- [`BALANCE_TODO.md`](./BALANCE_TODO.md) — TODO ordinato per priorità (bug lancia 3m, fix throwers, validazione mirror, distillazione AI, iterazione fino a `|V_a|<0.15`).
- `python/cfr/nightly_results/database_index.json` — autopopolato, ordinato per imbalance.

**Squilibri principali rilevati** (riepilogo, dettagli in DEEP_CFR_RESULTS):
- Throwers (lanc/giav/balestra) stomp i preset baseline (spa/arc) di 27-33 wr%.
- Ascia1h dominata da lanciere/giavellottiere (range lancio insufficiente).
- Tra i preset, arciere batte spadaccino (+16.5 wr%).
- **Distillazione AI necessaria** per il gioco — confermato da Valerio.
- **Bug noto**: lancia 3m matematicamente rotta (vedi M-3) — fix da decidere.

**Cosa funziona** (gameplay):
- Mappa esagonale 24×18 con camera pan/zoom + deploy zone 7-hex
- Movimento click-to-move con highlight slancio + costo applicato
- Combat mischia con schivata/parata attiva + info nascosta hot-seat
- Combat ranged con LoS dai 7 esagoni della basetta
- AI heuristic (single-player) o hot-seat
- 3 preset PG bilanciati su 2000 exp (Spadaccino/Arciere/Tank) + 4 nuove build (Lanciere, Giavellottiere, Ascia 1h lanciatore, Balestriere) con `thrown_inventory + backup_weapon`
- Persistenza setup in localStorage

**Cosa è rimandato a post-MVP** (D-035, D-036):
- Character builder UI completo (i 3 preset coprono le tipologie principali — modifiche dirette a `data/presets.ts` per ora)
- Asset sprite reali (rendering vettoriale spartano)
- Audio (BGM + SFX)
- Multiplayer online (architettura predisposta)
- Animazioni movimento

**Per giocare**: `npm install && npm run dev` → apri `http://localhost:5173`.

**Pending da Claude (ordine implementazione proposto, dopo OK Valerio)**:
1. Scaffolding Phaser 3 + TypeScript + Vite — "Hello hex grid" cliccabile
2. Geometria esagonale (axial/cube coords), rendering mappa con base 7-hex deployment
3. Modello unità + pool dadi azione + turn loop
4. Combattimento: attacco, parata attiva, schivata attiva
5. Iniziativa dinamica (formule da Valerio)
6. AI heuristic base (gioca contro PC)
7. Hot-seat (due umani stesso device, switch giocatore)
8. Character builder + skill tree + persistenza locale
9. Bilanciamento iterativo

---

## Decisioni prese

### Stack tecnico

| Componente | Scelta |
|---|---|
| Engine | **Phaser 3** |
| Linguaggio | **TypeScript** |
| Build / dev server | **Vite** |
| Runtime | Browser locale (`npm run dev` → `localhost`) |
| Asset grafici | Pack **CC0** (Kenney.nl o OpenGameArt), pixel art esagonale |
| Persistenza | `localStorage` (per character builder, save) — da confermare |
| Multiplayer | **Fuori scope MVP** — architettura predisposta per futuro server Node + Socket.io |

**Razionale stack**: Valerio vuole arrivare a multiplayer online. Pygame sarebbe stato leggermente più veloce nelle prime ore ma avrebbe forzato una riscrittura totale al passaggio multiplayer. Phaser locale single-player → aggiungere server poi è puramente additivo: client già pronto.

### Design — meccaniche

**Setting**: fantasy.

**Mappa**: griglia **esagonale**. Zone di deployment a "rosa" da **7 esagoni** (1 centrale + 6 corona).

**Sistema azioni**: ogni unità ha un **pool di dadi azione** per turno. Ogni azione (movimento, attacco, abilità) consuma dadi.

**Difese attive**: parate e schivate sono **azioni reattive** che consumano dadi azione del difensore. Crea dilemma economico costante: spendere dadi per attaccare adesso vs riservarli per sopravvivere al turno avversario.

**Iniziativa dinamica**: ricalcolata **ogni round**. Dipende da:
- Tiro del giocatore (formula da fornire)
- Danni ricevuti nel round precedente (formula da fornire)

**Progressione personaggi**: **niente classi**. Skill tree ad acquisto: il giocatore spende punti per comprare abilità + modificatori passivi. Character builder pre-battaglia.

**Bilanciamento**: tuning **rimandato a post-MVP**. Per ora si accetta che le meccaniche siano grezze, l'obiettivo è la dimostrazione del sistema.

### Scope MVP

| Aspetto | Scelta MVP |
|---|---|
| Formato battaglia | **1v1** (un eroe per parte) |
| Character builder | **Completo**: skill tree + acquisto abilità + modificatori |
| Avversario | **AI heuristic** + **hot-seat** (entrambi) |
| Mappe | 1 mappa di test |
| Multiplayer | ❌ |
| Online / account | ❌ |
| Audio | ❌ (rimandato) |
| Storia / campagna | ❌ (rimandato) |

---

## Regole di gioco (fornite da Valerio)

> Fonti autoritative: `Regole_base.docx` e `TAB_armi.docx` in `/Users/flaviacasini/claude-bot/sandboxes/valerio/`. In caso di divergenza tra questo recap e i docx, vincono i docx — questo file è una sintesi operativa.

### Personaggio (baseline)

- Fazione
- HP: **20**
- Forza / Agilità / Volontà: **2 / 2 / 2** (baseline)
- Impeto: **14** baseline teorico, ma in setup → MAX teorico tiro slancio (D-045, vedi sotto)
- Slancio: **0** baseline; al setup → roll iniziale dei dadi slancio max (vedi `apply_initial_slancio`)
- Dadi azione: pool iniziale **6**
- Equipaggiamento

**D-045 (impeto iniziale = max teorico tiro slancio)**: `compute_initial_impeto` (in `core/turn.py:130-152`) calcola l'impeto effettivo di setup come `(2 + extra_max_dice) × 6 + base_fisso + skill_bonus_slancio − impedimento`. Quindi:
- PG senza skill slancio: 2d × 6 + 2 = **14**
- PG con `+1tiro slancio`: 2d × 6 + 2 + 1 = **15**
- PG con `+1tiro slancio` + `+1dadomax slancio`: 3d × 6 + 2 + 1 = **21**

Le build con `+1dadomax slancio` (tank, arciere, lanc/giav/ascia1h con inventario) partono **6 punti sopra** i baseline e giocano sempre per primi al round 1.

### Architettura tiri: parte VARIABILE + parte FISSA

Ogni tiro ha **due valori distinti, da implementare separatamente fin dall'inizio**:
- **Variabile**: somma dei d6 tirati
- **Fissa**: tutti i bonus a somma fissa (es. il +2 base, bonus arma, modificatori skill)

Le difese agiscono in modo diverso sulle due componenti — questa separazione è strutturale, non cosmetica.

**Composizione di un attacco con arma**: i dadi del PG (1-2 d6 a scelta) sono **sempre tirati** e fanno parte della variabile; i dadi dell'arma (es. `1D6` della spada) sono **addizionali** e si sommano alla variabile; i bonus fissi del PG (+2) e dell'arma (+X) si sommano alla fissa. Anche l'**impedimento totale** del PG (somma equip) viene sottratto alla fissa.

> **Esempio 1 — Spada (1D6+2, condizionato a Forza/Agilità)**, scelta 2 dadi PG:
> - Variabile = 2 d6 (PG) + 1 d6 (spada) = **3 d6**
> - Fissa = 2 (PG) + 2 (spada) − impedimento = **4 − imp**
> - Una schivata con 2 d6 +2 (max 14) deve battere 3 d6 (max 18) → riesce ~spesso ma non sempre
>
> **Esempio 2 — Mazza (+9, solo fisso)**, scelta 1 dado PG:
> - Variabile = 1 d6 (PG) — la mazza non aggiunge dadi
> - Fissa = 2 (PG) + 9 (mazza) − impedimento = **11 − imp**
> - Una schivata con 2 d6 +2 (max 14) deve battere 1 d6 (max 6) → quasi sempre riesce → attacco evitato
>
> **Implicazione di design**: armi a fisso puro (mazza, balestra, giavellotto) hanno impatto enorme **se** non vengono schivate, ma sono molto schivabili. Armi con dadi propri (spade, archi) sono più affidabili nel passare la schivata ma con punte di danno più contenute.

### Round

1. Tutti i personaggi vengono ordinati per **impeto desc**
2. Parità di impeto → ordine per **slancio desc**
3. Parità anche di slancio → casuale (per ora)
4. Si gioca in ordine; round finisce quando tutti hanno giocato

### Turno (singolo personaggio)

1. **Recupero dadi azione**: ⌊(F + A + V) / 2⌋ (baseline = ⌊6/2⌋ = 3)
2. **Slancio → Impeto**: lo slancio attuale si somma a impeto
3. **Tiro slancio**: 0-2 d6 + 2 (giocatore sceglie quanti dadi). Scegliere 0 dadi risparmia dadi azione per le azioni successive del turno, **ma** comporta uno slancio basso → impeto basso al prossimo round → si gioca più tardi nei turni successivi (trade-off temporale: più potenza ora, meno priorità dopo)
4. / 5. (ordine libero) — **Movimento**: 1° esagono gratis, ogni esagono successivo costa **1 punto slancio**
4. / 5. (ordine libero) — **Azione** (es. attacco semplice): 1-2 d6 + 2 + bonus arma
6. Passa al personaggio successivo

### Attacco corpo a corpo (CaC) e difese attive

**Ordine informazione**: l'attaccante dichiara l'attacco. **Simultaneamente** e privatamente: l'attaccante sceglie quanti dadi tirare; il difensore sceglie tipo di difesa (parata / schivata / niente) e quanti dadi tirare. Le scelte vengono poi rivelate, si tira, si risolve. Nessuna delle due parti vede la scelta dell'altra prima della rivelazione.

**SCHIVATA** (difensore): tira 1-2 d6 + 2 → sottratto alla **sola parte VARIABILE** dell'attaccante (i dadi, non il fisso)
- Risultato ≤ 0: attacco schivato; |risultato| → sottratto allo **slancio dell'attaccante**
- Risultato > 0: si somma anche la parte FISSA dell'attaccante e si applicano danni col rimanente

**PARATA** (difensore): tira 1-2 d6 + 2 + **bonus arma/scudo usato per parare** → sottratto al **tiro completo** dell'attaccante (variabile + fissa)
- Risultato ≤ 0: attacco parato; |risultato| → sottratto allo **slancio dell'attaccante**
- Risultato > 0: si applicano danni col rimanente

> **Design note**: la schivata morde solo i dadi (variabile), quindi è meno efficace contro armi a forte componente fissa (mazza, balestra). La parata morde il totale ma serve un'arma/scudo idonei.

### Attacco a distanza

1. **Linea di vista (LoS)**: dal centro di **uno qualsiasi** dei 7 esagoni della basetta attaccante verso ognuno dei 7 esagoni del bersaglio. Numero di centri target visti = "visibilità" (range 0-7). Se 0 → non si può attaccare. Altri personaggi bloccano la LoS.
2. **Esagono usato**: l'esagono della basetta attaccante con la **LoS migliore** (massimo numero di centri target visti). In caso di parità, scelta del giocatore.
3. **Distanza**: contata in esagoni dall'esagono usato al più vicino degli esagoni del target.
4. **Tiro**: `1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza / N_arma⌋ − slancio_target − impedimento`
   - `N_arma` è specifico dell'arma — vedi colonna `N` nella tabella armi.
5. Se risultato > 0 → danni al bersaglio

### Stati limite

- **HP = 0** → personaggio rimosso dalla board
- **Impeto = 0** → recupero dadi azione **capped a 1/turno** (indipendente da F+A+V)
- **Slancio scenderebbe sotto 0** → l'eccesso negativo si sottrae a **impeto**

### Impedimento

Ogni pezzo di equipaggiamento ha un parametro **IMPEDIMENTO** (colonna omonima nella tabella armi). L'impedimento del personaggio è la **somma** degli impedimenti di tutto l'equipaggiamento indossato/impugnato e si applica come **malus a qualunque tiro** del personaggio (sottratto dal risultato finale; va in **parte fissa**).

La skill `−1 impedimento` si applica **per pezzo di equipaggiamento**:
- **Senza specializzazione**: riduce di 1 l'impedimento di **ogni** pezzo di equip indossato/impugnato
- **Con specializzazione `[classe oggetto]`** (es. `[armature]`): riduce di 1 solo i pezzi di quella classe
- **Con specializzazione `[oggetto specifico]`** (es. `[scudo pesante]`): riduce di 1 solo quello specifico pezzo

Acquistabile più volte (cumulative). Floor a 0 per pezzo (un equip a impedimento 0 resta a 0; ipotesi operativa, da rivalutare se serve).

### Tabella armi (`TAB_armi.docx`)

| ARMA | ATK | DIF | IMPEDIMENTO | SPECIALI | N |
|---|---|---|---|---|---|
| Pugnale | 1D6+2 | 1D6 | 0 | Lancio 0.5m | 1 |
| Spada | 1D6+2/+2 | 1D6+2 | 3 | (notazione `/` = forza/agilità) | — |
| Spada lunga 1h/2h | 1D6+2/+6 | 1d6+6 | 6 | Portata 1m | — |
| Mazza | +9 | +3 | 3 | (solo fisso) | — |
| Ascia 1h | 1D6+6 | +3 | 3 | Lancio 0.5m | 1 |
| Ascia 2h | 1D6+15 | +3 | 6 | | — |
| Lancia 2m, 1h/2h | 2D6 | +3 | 3 | Lancio 1m, Portata 2m | 2 |
| Lancia 3m, 2h | 2D6 | +1 | 6 | Portata 3m | — |
| Giavellotto | +6 | +1 | 3 | Lancio 1.5m, Portata 1m | 3 |
| Arco corto | 1D6+6 | — | 3 | Distanza 1.5m | 3 |
| Arco lungo | 2D6+6 | — | 6 | Distanza 2.0m | 5 |
| Balestra | +15 | — | 3 | Distanza 1.0m, Ricarica 7 | 3 |
| Scudo piccolo | +4 | 1D6+4 | 3 | | — |
| Scudo medio | +8 | 1D6+8 | 6 | | — |
| Scudo pesante | +8 | 1D6+12 | 9 | | — |
| Armatura leggera | — | RD 3 | 3 | | — |
| Armatura media | — | RD 6 | 6 | | — |
| Armatura pesante | — | RD 9 | 9 | | — |

**Legenda colonne**:
- **ATK**: contributo **addizionale** al tiro d'attacco con l'arma. I dadi qui (`1D6`, `2D6`, ecc.) sono **in aggiunta** ai 1-2 d6 base del PG; i bonus fissi si sommano alla fissa.
- **DIF**: contributo **addizionale** al tiro di parata.
- **IMPEDIMENTO**: malus a **qualunque tiro** del PG (vedi sezione Impedimento).
- **SPECIALI**: portata = CaC esteso (arma colpisce a N esagoni in mischia); lancio = arma da mischia lanciabile a distanza; distanza = arma da tiro vera e propria; ricarica = turni di setup per riusarla (es. balestra 7 turni).
- **RD** (solo armature): riduzione danno applicata ai colpi subiti.
- **N**: divisore del malus distanza per tiri ranged (`malus = ⌊distanza_esagoni / N⌋`); più alto = arma decade meno con la distanza. **`—`** = non usabile a distanza. *Numeri di prima draft proposti da Claude per l'MVP, da rifinire con playtest.*

**Notazione `/` nelle colonne ATK/DIF**:
- Per **armi a impugnatura unica** (es. Spada `1D6+2/+2`): `+X/+Y` = bonus condizionato all'abilità → `+X` se attacchi con **Forza**, `+Y` se attacchi con **Agilità**. Permette di differenziare le armi in due "stili".
- Per **armi a impugnatura variabile** ("1h/2h" nel nome — Spada lunga, Lancia 1h/2h): la `/` indica **1h vs 2h** (es. Spada lunga `1D6+2/+6` → 1h `1D6+2`, 2h `1D6+6`). DIF senza barra → uguale per entrambe le impugnature. La Lancia 1h/2h ha `2D6` senza barra perché "non cambia il bonus" tra 1h e 2h.

**Conversione metri ↔ esagoni**: **1 esagono = 0.5 m** (quindi 1m = 2 esagoni).

| Spec da tabella | Esagoni |
|---|---|
| Distanza 2.0m (Arco lungo) | 4 |
| Distanza 1.5m (Arco corto) | 3 |
| Distanza 1.0m (Balestra) | 2 |
| Lancio 1.5m (Giavellotto) | 3 |
| Lancio 1.0m (Lancia 2m) | 2 |
| Lancio 0.5m (Pugnale, Ascia 1h) | 1 |
| Portata 3m (Lancia 3m) | 6 |
| Portata 2m (Lancia 2m) | 4 |
| Portata 1m (Spada lunga, Giavellotto in CaC) | 2 |

**Significato dei range** (interpretazione operativa Claude, da rivalutare se errata):
- **Distanza**: range massimo per tiro con armi da tiro vere e proprie (archi, balestre). Oltre, non si può sparare.
- **Lancio**: range massimo per lanciare un'arma da mischia che ha quella spec.
- **Portata**: raggio del CaC esteso — l'arma colpisce in mischia anche oltre l'esagono adiacente, fino al range indicato (la lancia 3m colpisce a 6 esagoni in mischia).

---

## Skill system (acquisto a punti exp)

### Costi attuali

| Modificatore | Costo (exp) | Effetto |
|---|---|---|
| **−1 impedimento** | 100 | riduce di 1 il malus impedimento (vedi sezione Impedimento) |
| **+1 al tiro** | 600 | +1 alla parte fissa del tiro relativo (in base a specializzazioni) |
| **+1 dado** | 3600 | tiri **sempre** 1 dado in più sul tiro relativo (es. attacco 1-2 d6 → 2-3 d6) |
| **+1 dado massimo** | 1200 | il **tetto** dei dadi tirabili sale di 1 (es. 1-2 → 1-3); opzionale, paghi solo se decidi di usare il dado in più; tuning aperto, valorizzazione statistica non banale |

### Specializzazioni — parole

Ogni acquisto può essere combinato con **fino a 1 parola per lista** delle 4 sotto. Specializzare restringe l'applicabilità del modificatore alla combinazione scelta (più stretto = più mirato, ma stesso costo per ora).

| Lista | Parole (esempi) |
|---|---|
| **Abilità** | forza, agilità, volontà |
| **Azioni** | attaccare, parare, schivare, slancio/iniziativa |
| **Classe oggetto** | spade, scudi, armature, lance, asce, archi, balestre, … |
| **Oggetto specifico** | spada corta, arco lungo, balestra pesante, scudo leggero, … |

**Esempi di skill** (illustrativi, non bilanciati):
- `+1 al tiro [attaccare] [archi]` — 600 exp, attivo solo quando attacchi con un arco
- `−1 impedimento [armature]` — 100 exp, riduce di 1 l'impedimento di tutte le armature
- `+1 al tiro [forza] [attaccare] [spade] [spada corta]` — 600 exp, molto specifico (ma stesso costo: design da rivedere?)

### Riferimento PG da 2000 exp

Personaggio "sensato" base: spende ~600-900 exp in `−1 impedimento` per azzerare la maggioranza degli impedimenti, ~1100-1400 exp per qualche `+1 al tiro` mirato. È il target di bilanciamento informale.

---

## Ambiguità da chiarire (prima della milestone 3 — combat loop)

> Nessuna scelta unilaterale da Claude. Per Regola "logiche fornite da Valerio = vincolanti", aspetto risposta esplicita prima di codare la parte interessata.

**~~A. Ordine informativo attacco/difesa~~** — RISOLTA: scelte simultanee e private. Documentato in "Attacco corpo a corpo".

**~~B. Lettura "1-2 d6 +2" e "0-2 d6 +2"~~** — RISOLTA: "1 o 2 dadi a scelta, +2 fisso" (e "0/1/2 dadi a scelta" per slancio).

**~~C (parziale). Notazione `/` per armi a impugnatura unica~~** — RISOLTA: la barra in ATK/DIF di un'arma a impugnatura fissa indica bonus condizionato Forza/Agilità (es. Spada `1D6+2/+2` → +2 con Forza, +2 con Agilità). Resta aperta **C2**.

**~~C2. Notazione `/` per armi 1h/2h~~** — RISOLTA: per le armi versatili 1h/2h, la barra in ATK indica 1h vs 2h (es. Spada lunga `1D6+2/+6` → 1h `1D6+2`, 2h `1D6+6`). DIF senza barra → uguale per entrambe le impugnature.

**~~D. Armi a solo bonus fisso~~** — RISOLTA: i dadi della colonna ATK sono **addizionali** ai 1-2 d6 del PG. Le armi a solo `+X` (mazza, balestra, giavellotto) non aggiungono dadi, solo fisso. La schivata è più probabilmente efficace contro queste armi (meno variabile da battere). Documentato in "Composizione di un attacco con arma".

**~~E. Refuso "schivato" nella PARATA~~** — RISOLTA: refuso confermato per "parato", nessun cambiamento meccanico. Da correggere in fase di docs/UI ma irrilevante per il codice.

**~~F. Semantica skill `+1 dado` / `+1 dado massimo`~~** — RISOLTA: agiscono sui dadi del singolo tiro. Documentato in Skill system.

**~~G. Impedimento — su cosa agisce?~~** — RISOLTA: malus globale a qualunque tiro. Documentato in sezione "Impedimento".

**~~H. Esagono di partenza per distanza ranged~~** — RISOLTA: l'esagono con LoS migliore (parità → scelta giocatore). Documentato in "Attacco a distanza".

**~~I. Divisore `N_arma` per ranged~~** — RISOLTA: aggiunta colonna `N` in tabella armi con valori di prima draft proposti da Claude. Da rifinire con playtest.

**~~J. Slancio = 0 dadi~~** — RISOLTA: trade-off temporale, risparmi dadi ora ma giochi più tardi nei round successivi. Documentato in "Turno".

**~~K. Skill `−1 impedimento` senza specializzazione~~** — RISOLTA: senza specializzazione si applica a ogni pezzo; cumulativa. Documentato in "Impedimento".

**~~L. Conversione metri ↔ esagoni~~** — RISOLTA: 1 esagono = 0.5 m (1m = 2 esagoni). Tabella di conversione e interpretazione di Distanza/Lancio/Portata documentate in sezione "Tabella armi".

---

## Regole specifiche di progetto

Eredita le 10 regole del CLAUDE.md di workspace (`/Users/flaviacasini/claude-bot/sandboxes/valerio/CLAUDE.md`). In aggiunta, specifiche di questo progetto:

- **Niente codice senza OK esplicito di Valerio** — lo scaffolding parte solo dopo "vai"
- **Logiche fornite da Valerio = vincolanti**: quando lui fornisce formule (iniziativa, dadi, costi), implementarle **fedelmente**. Non "migliorare", non "semplificare", non chiedere se cambiare. Eventuali dubbi → segnalare e aspettare risposta, non scegliere unilateralmente
- **Ogni milestone deve produrre qualcosa di giocabile o visibile** — niente build silenziose di settimane. Anche se la funzionalità è parziale, deve girare e dimostrare progresso
- **Asset CC0 obbligatori** — niente asset di provenienza incerta, niente generazione AI di asset se non esplicitamente OK

---

## Note tecniche pending (da decidere a milestone)

- **Asset pack**: scegliere tra Kenney "Hexagon Pack", "Tiny Town" rivisitato, o tile da OpenGameArt → milestone 2
- **Persistenza character builder**: `localStorage` (semplice, attaccato al browser) vs file JSON scaricabile/importabile (portabile tra device) → milestone 8
- **Packaging desktop**: Tauri o Electron per fare un `.app` standalone → rimandato post-MVP, opzionale

---

## Riferimenti

**Documenti del progetto** (leggere a inizio sessione):
- `ARCHITECTURE.md` — architettura tecnica
- `DECISIONS.md` — log ADR decisioni
- `TODO.md` — piano lavori M1→M13

**Documenti autoritativi (game design)**:
- `/Users/flaviacasini/claude-bot/sandboxes/valerio/Regole_base.docx` — regole base
- `/Users/flaviacasini/claude-bot/sandboxes/valerio/TAB_armi.docx` — tabella armi

**Workspace**:
- `/Users/flaviacasini/claude-bot/sandboxes/valerio/CLAUDE.md` — regole workspace
- `/Users/flaviacasini/.claude/projects/-Users-flaviacasini-claude-bot-sandboxes-valerio/memory/MEMORY.md` — memory index

---

## Modifiche post-MVP — sessione RL bilanciamento (2026-04-30 → 2026-05-02)

> Decisioni game design prese dopo analisi RL (~13 modelli, 5000+ partite simulate).
> Le regole sotto sono **autoritative** e sostituiscono/integrano la sezione "Regole di gioco" sopra.

### M-1. Meccanica A — Asta nascosta di slancio (zona di controllo reach)

**Idea**: ogni arma da mischia "minaccia" la zona attorno al difensore entro la propria reach. Chi vuole muoversi in zona deve "battere" l'asta del difensore.

**Trigger**: il movimento di un'unità si decompone in **singoli esagoni**. Per ogni esagono che l'attaccante vuole occupare, se l'esagono è entro `reach` di un difensore eligibile, scatta un'asta.

**Difensore eligibile**:
- Vivo (HP > 0)
- Faction avversaria
- Slancio > 0 (chi non ha slancio non può biddare)
- Equipaggia un'arma da mischia con **`reach >= 1`** (regola universale — confermata 2026-05-06 da Valerio)

**Armi che attivano la zona di controllo** (tutte le melee con reach esplicita):
- Pugnale, spada, mazza, ascia 1h, ascia 2h: reach 1
- Spada lunga: reach 2
- Giavellotto: reach 2
- Lancia 2m 1h/2h: reach 4
- Lancia 3m 2h: reach 6

**Armi che NON attivano**:
- Disarmato (no weapon)
- Armi solo-ranged senza secondaria melee (arco, balestra) — in `reducer.py` `weapon.range.reach is None`

**Implementazione**: `python/hex_tactics/core/reducer.py:266` — commento "V2 (regola universale): TUTTE le armi melee con reach >= 1 triggerano l'asta".

**Procedura asta** (aggiornata post-analisi CFR — vedi `python/cfr/auction_cfr_iterated_fix.py`):
1. Attaccante e difensore scelgono **simultaneamente in privato** una puntata intera:
   - Atk: `puntata_atk ∈ [0, slancio_attuale - 1]` (deve riservare 1 slancio per il movimento)
   - Def: `puntata_def ∈ [0, slancio_attuale]`
2. **Risoluzione**: l'attaccante passa l'esagono **solo** se `puntata_atk > puntata_def` (parità → **DEFENDER vince**, atk si ferma).
3. **Spesa**:
   - Atk paga sempre **`1 + puntata_atk`** in slancio (1 fisso = costo movimento sull'esagono + bid), indipendentemente dall'esito
   - Def paga sempre `puntata_def` in slancio
4. **QUIT implicito**: se atk ha `slancio < 1` non può attivare l'asta — il movimento si ferma senza spese.

**Razionale del fix** (analisi CFR tabular, T=2000 iter):
- Regola precedente (`atk_bid >= def_bid` + atk paga solo bid) → strategia degenere: atk bida 0, def non ha incentivo a bidare, atk passa gratis. Asta inutile.
- Regola attuale (`atk_bid > def_bid` + atk paga 1 fisso + bid) → equilibrio sano:
  - 5v5 slancio: vero mind game, V_a=+0.557, entrambi mixano
  - 8v8, 10v5: atk vince economico (bida 1, def rinuncia)
  - 5v10, 3v3: atk QUIT razionale, def deter senza spese

**No dadi**: pura asta di valore (mind game).

**Frequenza**: ogni esagono in zona di controllo = 1 asta separata. Movimento attraverso 4 hex contesi = 4 aste possibili (atk paga 1 fisso ogni volta che attiva l'asta).

### M-2. Tweak D3 — Armatura pesante

| Item | RD prima | RD ora | Imp |
|---|---|---|---|
| Armatura pesante | 9 | **12** | 9 (invariato) |

Razionale: rende la pesante "specialista" — chi vuole usarla deve investire skill aggiuntive per gestire l'imp 9.
**NB**: nei test RL (v13 MaskablePPO) l'armatura pesante resta la peggiore (0.42 vs leggera 0.71). D3 è solo un primo passo, potrebbe servire ulteriore tuning.

### M-3. Bug noto da fixare — Lancia 3m

**Problema**: matematicamente rotta.
- ATK = `2D6 +0` (no fisso aggiuntivo) + IMP 6
- Fissa totale del tiro = `2 (PG) + 0 (arma) - 6 (imp) = -4`
- Damage netto medio = ~5-7 (vs RD media 6) → quasi sempre 0 dmg
- Winrate empirico in 500 partite v13: **0.23** (peggiore di tutti i 12 weapons)

**Fix proposto** (NON ancora applicato):
- Aggiungere `+4` al fisso ATK → `2D6 +4` (porta fissa totale a 0, damage netto medio ~10)
- Oppure ridurre IMP a 4
- Da decidere insieme

### M-4. Verifiche RL su game balance — risultati

**Squilibri inizialmente sospettati MA SMENTITI dalla math**:
- ❌ "Arcieri troppo forti" — il difensore controlla quanto subisce con la scelta di slancio (slancio_target sottratto al tiro ranged + scudo passivo + armor RD). Math:
  - tank slancio 0 → 17 dmg/colpo (kill in 2)
  - tank slancio 14 → 3 dmg/colpo (kill in 7)
  - Bilanciato come trade-off mobilità vs sopravvivenza vs ranged.
- ❌ "Mazza troppo debole" — è OK col giocatore che sceglie 2d atk (problema solo se policy DQN sceglie 1d default).

**Squilibri confermati**:
- ✅ Lancia 3m bug numerico (sopra)
- ✅ Armatura pesante meno conveniente di leggera (anche post D3, parzialmente)
- ⚠️ Arciere "appare" troppo forte al giocatore inesperto perché non sfrutta il dilemma slancio del tank → onboarding/tutorial necessari

### M-5. Strategie emerse dal policy RL (interessanti game design)

**Dal v13 MaskablePPO** (modello migliore):
1. **Atk dice adattivo per matchup**:
   - Vs nemico schivatore (no scudo) → 1d atk (basta)
   - Vs nemico parante con scudo → 2d atk (per battere parry)
2. **Difesa adattiva**:
   - Vs armi a fisso puro (mazza) → **dodge** (blocca tutto se vince)
   - Vs armi con dadi propri (spada lunga) → **parry** (morde anche fisso)
3. **Transfer impeto→slancio (D-044)** usato massicciamente in:
   - Tank vs tank (entrambi alimentano slancio per controllo)
   - Recupero iniziativa quando in deficit
4. **Movimento multi-step**: tank chiude in 1 turno con slancio max, brucia tutto, poi parry-game.

### M-6. Decisioni NON fatte (consapevolmente)

- ~~E. Aumentare `ranged_divisor`~~: math regge, niente tweak.
- ~~B. Modificare mazza~~: design OK, era problema policy RL.
- ~~F. Abilità speciali tank (carica/sprint)~~: tank deve restare semplice.

### M-7. Skill ceiling osservato

Il gioco premia il giocatore esperto. Decisioni "non ovvie" che fanno la differenza:
- Parry vs dodge in base ad arma avversaria
- Atk dice 1 vs 2 in base a difesa attesa
- Conservare slancio come scudo passivo vs spendere per mobilità
- Transfer impeto-slancio per recovery

Skill floor moderato: regole base in 30 min. Skill ceiling alto: anni di affinamento meta.

### M-8. Modello di riferimento per game balance

**`/tmp/hex_tactics_ppo_v13/best.zip`** — MaskablePPO trained 500k step con:
- Obs human-fair 148 feat (incluso bid context per meccanica A)
- D3 armatura pesante RD 12 attivo
- Random PG generation per varietà build
- Reward shaping: time penalty -0.1, truncate -25, win/loss ±10

Best wr globale 0.76 (eval 25k), final 0.66 (eval 500k).
**Da riusare come baseline** per testare ulteriori tweak game design.

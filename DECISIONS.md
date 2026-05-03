# hex-tactics — Decisioni (ADR log)

> Decisioni prese sul progetto, con contesto, scelta e razionale. Stile **Architecture Decision Record**.
> Una decisione, una volta presa, **resta finché non è esplicitamente cambiata**. Questo documento è il riferimento per evitare di rimettere in discussione cose già chiuse (Regola 10 del workspace).

**Convenzione**: ogni decisione ha ID `D-NNN`, data, stato (`ACTIVE` / `SUPERSEDED` / `REJECTED`), contesto, decisione, conseguenze.

---

## D-001 — Stack: Phaser 3 + TypeScript + Vite (browser locale)

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: tactical RPG a turni, MVP locale ma piano finale è multiplayer online. Trade-off tra Pygame (più rapido all'inizio in stack già usato dall'utente) e Phaser/JS (riusabile per multiplayer).
- **Decisione**: **Phaser 3 + TypeScript + Vite**. Browser locale, niente server in MVP.
- **Razionale**: l'MVP in Pygame avrebbe richiesto riscrittura totale al passaggio multiplayer. Phaser locale → aggiungere server (Node + Socket.io) post-MVP è puramente additivo. La sovrapposizione con Python di altri progetti del workspace è un costo accettabile.
- **Alternative scartate**: Pygame (ottimo per single-player ma forza riscrittura), Godot/Unity (richiedono editor visuale, contraddicono "tutto da codice"), Pyxel (troppo costretto graficamente).
- **Conseguenze**: dipendenza da `npm`/`node`, asset CC0 da URL/pacchetto, deploy futuro su Fly.io o equivalente.

---

## D-002 — Architettura: separazione `core/` puro vs Phaser

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: serve poter testare la matematica del combat senza emulare browser, e poter riusare la logica lato server quando arriverà multiplayer.
- **Decisione**: tutto il `src/core/` è **TypeScript puro senza dipendenze da Phaser**. Phaser vive solo in `src/scenes/` e `src/ui/`. Le scene leggono lo stato e disegnano; mai logica di gioco lì.
- **Razionale**: testabilità (Vitest puro), portabilità (server reuse), sostituibilità motore grafico.
- **Conseguenze**: disciplina forte negli import (lint check da considerare), un po' più di boilerplate, ma compounding wins man mano che il codice cresce.

---

## D-003 — Pattern di stato: `GameState` immutabile + reducer + eventi

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: serve un modo pulito di gestire le transizioni di stato (turno, attacchi, difese), debuggabile e replicabile.
- **Decisione**: stato globale **immutabile**, modificato solo da una funzione `reduce(state, event) → newState`. Tutte le interazioni passano da eventi tipizzati.
- **Razionale**:
  - Replay/undo gratis (log eventi → ricostruzione)
  - Multiplayer: server applica gli stessi reducer ai client events
  - AI è funzione pura `(state) → event`, testabile in isolamento
  - Bug più facili da riprodurre (stato sempre osservabile)
- **Conseguenze**: leggera verbosità nelle creazioni di nuovi oggetti, mitigabile con helper o librerie tipo Immer (decisione D-007 da prendere).

---

## D-004 — Tiri implementati come `{variable: int[], fixed: int}`

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: le regole distinguono esplicitamente parte **variabile** (dadi) e parte **fissa** (bonus). La schivata morde solo la variabile, la parata morde tutto. Le regole future si appoggeranno su questa distinzione.
- **Decisione**: ogni tiro è strutturato come due valori distinti, mai sommati prima della risoluzione difensiva. Tipo `Roll = { variable: number[]; fixed: number }`.
- **Razionale**: rispetto fedele del design del gioco; estendibilità per regole future.
- **Conseguenze**: tutte le funzioni che producono tiri devono restituire la struttura, non un numero.

---

## D-005 — Asset CC0 obbligatori (Kenney.nl o OpenGameArt)

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: serve grafica decente senza creare asset da zero, senza problemi di licenza, senza generazione AI.
- **Decisione**: pacchetti **CC0** (public domain) — preferenza Kenney.nl per coerenza estetica. Niente asset di provenienza incerta. Niente generazione AI di asset salvo OK esplicito.
- **Razionale**: licenze chiare, qualità nota, quantità sufficiente.
- **Conseguenze**: scelta del pack alla milestone 2 (geometria/mappa) — opzioni: Kenney "Hexagon Pack", "Tiny Town" rivisitato, OpenGameArt mix.

---

## D-006 — Persistenza character builder: `localStorage`

- **Data**: 2026-04-29
- **Stato**: ACTIVE (rivalutabile)
- **Contesto**: il PG costruito col character builder deve essere salvato per il prossimo lancio.
- **Decisione**: `localStorage` del browser. Chiave dedicata, struttura JSON.
- **Razionale**: zero-config, sufficiente per MVP single-device. Quando passeremo a multiplayer/server arriverà la persistenza serverside.
- **Conseguenze**: il save è legato al browser specifico (perdita se cambi browser/PC). Non blocca l'MVP. Eventuale export/import JSON da file aggiungibile dopo.

---

## D-007 — Test runner: Vitest, target >80% coverage sul `core/`

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: il combat math è il cuore del gioco, va testato. Phaser layer no.
- **Decisione**: **Vitest** (compatibile con Vite, sintassi Jest-like). Coverage target >80% su `src/core/`. Niente test su `scenes/` o `ui/`.
- **Razionale**: cost-benefit favorevole sul `core/`, troppo costoso sul layer grafico (che si valida visualmente).
- **Conseguenze**: ogni feature del `core/` arriva con test. Il TODO.md riflette questo (ogni milestone "core" include task "test").

---

## D-008 — Random number generator: seed-able, isolato

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: i test devono essere deterministici. I tiri devono essere riproducibili a fini debug e replay.
- **Decisione**: tutte le chiamate random passano da `src/utils/rng.ts`. RNG seed-able (es. Mulberry32 o simile, lightweight). Ogni `GameState` può avere un seed associato per riproducibilità.
- **Razionale**: test stabili, replay possibili, debug più facile.
- **Conseguenze**: niente `Math.random()` sparso nel codice — solo via `rng`.

---

## D-009 — AI MVP: solo heuristic decision tree, niente ML

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: l'AI nell'MVP serve come avversario di playtest, non come sfida sofisticata.
- **Decisione**: AI base con decision tree euristico (priorità: attacca il bersaglio più conveniente, parà se a basso HP, schiva se senza arma da parata, ecc.). Niente reinforcement learning, MCTS o simili.
- **Razionale**: scope MVP. AI sofisticata può venire dopo, basta che il `core/` sia ben separato (lo è).
- **Conseguenze**: l'AI sarà battibile abbastanza facilmente. Voluto.

---

## D-010 — Niente packaging desktop in MVP

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: si potrebbe usare Tauri o Electron per fare un `.app` standalone.
- **Decisione**: **rimandato post-MVP**. L'MVP gira via `npm run dev` o `npm run build` + `npm run preview`.
- **Razionale**: scope MVP. Packaging aggiunge complicazioni (firma, icone, distribuzione) inutili per dimostrare meccaniche.
- **Conseguenze**: per giocare bisogna avere `node` installato + clonare il repo. Accettabile per Valerio sul Mac M4.

---

## D-011 — Niente repository GitHub finché Valerio non lo dice

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: Valerio ha esplicitamente detto "no aspetta a mettere lì poi vediamo dopo MVP locale".
- **Decisione**: il progetto resta locale finché Valerio non chiede di pushare su GitHub.
- **Razionale**: rispetto della regola 10 (decisioni scartate non si ripropongono).
- **Conseguenze**: niente CI/CD, niente backup automatico — Valerio è responsabile di backup locale se vuole.

---

## D-012 — Numeri "N_arma" per malus distanza ranged: prima draft Claude

- **Data**: 2026-04-29
- **Stato**: ACTIVE (tuning aperto)
- **Contesto**: Valerio ha delegato a Claude la prima proposta di valori per la colonna `N` della tabella armi.
- **Decisione**: valori proposti: Pugnale=1, Ascia 1h=1, Lancia 2m=2, Giavellotto=3, Arco corto=3, Arco lungo=5, Balestra=3.
- **Razionale**: armi specializzate per la distanza (archi) decadono meno; armi da lancio improvvisato (pugnale, ascia) decadono molto.
- **Conseguenze**: da rifinire con playtest. Documentato in `CLAUDE.md` sezione "Tabella armi".

---

## D-013 — Conversione metri ↔ esagoni: 1 esagono = 0.5 m

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: la `TAB_armi.docx` usa metri, la griglia è in esagoni. Serve un rapporto.
- **Decisione**: **1 esagono = 0.5 metri** (1m = 2 esagoni). Definito da Valerio.
- **Razionale**: scelta del designer.
- **Conseguenze**: tutte le distanze in tabella armi sono convertite esattamente (es. arco lungo 2.0m = 4 esagoni). Tabella di conversione in `CLAUDE.md`.

---

## D-014 — MVP: 1v1, character builder completo, AI + hot-seat

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: serve definire scope MVP per non strapparsi i capelli.
- **Decisione**:
  - Formato: **1v1** (un eroe per parte)
  - Character builder: **completo** (skill tree + acquisto + specializzazioni)
  - Avversario: **AI heuristic + hot-seat** entrambi
  - 1 mappa di test
  - No multiplayer, no audio, no storia, no campagna
- **Razionale**: dimostra le meccaniche senza esplodere lo scope.
- **Conseguenze**: dopo l'MVP si valuta cosa espandere (più mappe, multiplayer, storia, ecc.).

---

## D-015 — "Ordine informativo attacco/difesa": scelte simultanee a info nascosta

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: il testo delle regole base era ambiguo. Valerio ha chiarito.
- **Decisione**: l'attaccante dichiara l'attacco; **simultaneamente e privatamente** entrambi scelgono (attaccante: numero dadi; difensore: tipo difesa + numero dadi). Si rivelano insieme, si tira, si risolve.
- **Razionale**: design intenzionale per dilemma economico (info nascosta su entrambi i lati).
- **Conseguenze**: in hot-seat richiede una "schermata di passaggio" tra le due scelte (per non far vedere all'altro). In AI vs umano l'AI decide internamente, niente schermo intermedio.

---

## D-016 — Skill `+1 dado` vs `+1 dado massimo`: agiscono sui dadi del singolo tiro

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: ambiguità iniziale sull'interpretazione dei due skill.
- **Decisione**:
  - `+1 dado` = il PG **tira sempre 1 dado in più** sul tiro relativo alla specializzazione.
  - `+1 dado massimo` = il **tetto** dei dadi tirabili sale di 1 (tiro standard 1-2 → 1-3); opzionale.
- **Razionale**: chiarito da Valerio. Spiega anche la differenza di costi (3600 vs 1200).
- **Conseguenze**: implementazione: ogni tiro tipizzato sa quale skill applicare e modifica il range dadi prima del tiro.

---

## D-017 — Impedimento: malus globale a tutti i tiri, somma equip

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: ambiguità iniziale.
- **Decisione**: ogni equip ha valore IMPEDIMENTO; il totale del PG è la somma degli equip indossati/impugnati; si applica come malus a **qualunque tiro** del PG (in parte fissa, sottratto al risultato).
- **Razionale**: chiarito da Valerio.
- **Conseguenze**: la skill `−1 impedimento` lavora **per pezzo** (vedi D-018).

---

## D-018 — Skill `−1 impedimento`: per pezzo, specializzabile, cumulativa

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: come si applica l'acquisto della skill?
- **Decisione**:
  - Senza specializzazione: −1 a **ogni** pezzo di equip
  - Con specializzazione `[classe oggetto]`: −1 solo ai pezzi di quella classe
  - Con specializzazione `[oggetto specifico]`: −1 solo a quel pezzo
  - Acquistabile più volte (cumulative)
  - Floor 0 per pezzo (un equip a impedimento 0 non scende sotto)
- **Razionale**: chiarito da Valerio. Floor 0 è ipotesi operativa Claude (sensata).
- **Conseguenze**: il character builder mostra impedimento finale per pezzo dopo le skill.

---

## D-019 — Mappa default 24×18, hexSize 32

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE
- **Contesto**: Valerio ha indicato "la mappa deve essere sicuramente più grande". Il default M1 era 12×8.
- **Decisione**: 24×18 esagoni con hexSize 32 px, padding 80. Risoluzione canvas 1280×800.
- **Razionale**:
  - 432 esagoni totali, abbastanza per gameplay tattico significativo
  - Con 1 esagono = 0.5m → mappa 12m × 9m, sensato per scenari di scaramuccia
  - hexSize 32 lascia margine: a zoom 1.0 si vede tutto sullo schermo, niente strict scrolling
- **Conseguenze**: serve camera con pan/zoom (vedi D-021). I numeri restano in `config.ts`, modificabili a parametro.

---

## D-020 — Geometria: pointy-top + axial + offset odd-r per layout

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE
- **Contesto**: scelta di orientation e sistemi di coordinate.
- **Decisione**:
  - Esagoni **pointy-top** (vertici alto/basso, caratteristico di tactical RPG)
  - Coordinate **axial** (q, r) come canonico interno
  - **Offset odd-r** solo per layout rettangolare iniziale (riga dispari shiftata a destra)
  - Algoritmi standard di Red Blob Games (cube rounding, ecc.)
- **Razionale**: pointy-top più letto come "tattico fantasy"; axial è il sistema più ergonomico per pathfinding/distance/line.
- **Conseguenze**: tutta la libreria `core/hex/` è axial-first; conversioni offset↔axial e pixel↔axial in `coords.ts`.

---

## D-021 — Camera con pan (WASD/frecce + drag tasto dx) e zoom (rotella)

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE
- **Contesto**: con mappa 24×18 servono controlli camera. QoL essenziale.
- **Decisione**:
  - Pan: WASD + frecce (continui su keypress) e drag con tasto destro/medio del mouse
  - Zoom: rotella mouse, range 0.5×–2.0× con step 0.1
  - Bounds della camera = dimensioni del mondo della mappa (no infinite scroll)
  - Pan con WASD: velocità 600 px/sec divisa per zoom (più zoom → pan più lento, più preciso)
- **Razionale**: tre input redundancy (tastiera, drag, rotella) coprono diverse preferenze; bounds evitano "perdere" la mappa.
- **Conseguenze**: HexBoard usa `pointer.worldX/worldY` (non `x/y`) per essere camera-aware. Click sinistro per selezione, destro/medio per pan — niente collisione di intenti.

---

## D-022 — Asset grafici: rimandati a M5/M6 (quando servono sprite unità)

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE — supersedes D-pending-A
- **Contesto**: M2 prevede potenzialmente la scelta di un pack tile esagonale.
- **Decisione**: continuare con **rendering vettoriale** (Phaser Graphics) per griglia, deploy zone e — quando arriveranno — unità (cerchi colorati). Pack asset (Kenney o equivalente) viene integrato solo a M6 quando serviranno sprite di combattimento (mischia animata, ranged).
- **Razionale**: tile asset esagonali aggiungono lavoro di alignment e shading senza valore funzionale per le milestone "core". Vector è veloce, sufficientemente pulito, lascia il focus sulla logica.
- **Conseguenze**: estetica spartana fino a M6, ma 100% funzionale. Eventuale pack scelto ed integrato dopo, se Valerio non lo vuole prima.

---

## D-023 — Deploy zones visualizzate come basette 7-hex su lati opposti

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE
- **Contesto**: serve visualizzare le aree dove le unità verranno schierate.
- **Decisione**: due zone fisse, ognuna è una basetta 7-hex (1 centrale + 6 corona). Default a `col=2, row=⌊rows/2⌋` (fazione A, blu) e `col=cols−3, row=⌊rows/2⌋` (fazione B, rosso). Centrate verticalmente.
- **Razionale**: simmetria, distanza significativa (~20 esagoni di gap), esattamente 7 hex come da regole di gioco (basetta = LoS source).
- **Conseguenze**: in milestone successive, le posizioni potranno essere parametrizzate o rese editabili da setup pre-battaglia.

---

## D-024 — A* implementato con linear scan dell'open set

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE (rivalutabile se serve perf)
- **Contesto**: l'A* su griglia hex richiede priority queue. Implementare un binary heap aggiunge ~80 righe.
- **Decisione**: implementazione naive con `Array.find` + linear scan per estrarre il minimo. Su 432 esagoni con path tipici di 5-15 hex, la complessità è banale.
- **Razionale**: KISS. Heap si aggiunge se mai vedremo lag (improbabile su scala MVP).
- **Conseguenze**: API di `findPath` invariata, sostituibile in trasparenza se serve.

---

## D-025 — QoL M2: etichette coordinate hex toggle (G), click-deselect

- **Data**: 2026-04-29 (M2)
- **Stato**: ACTIVE
- **Contesto**: scope "aggiungi tutti i QoL che ritieni sensati" (Valerio).
- **Decisione**:
  - Tasto **G** = toggle delle etichette coordinate `(q, r)` su ogni esagono (debug visuale)
  - Click sinistro su hex già selezionato = deseleziona
  - Click sinistro fuori dalla griglia = deseleziona
- **Razionale**: aiutano debug e fluidità d'uso; banali da implementare.
- **Conseguenze**: documentati in help text dell'UI.

---

## D-026 — Immer NO, immutabilità manuale via spread

- **Data**: 2026-04-29 (M3)
- **Stato**: ACTIVE — supersedes D-pending-B
- **Contesto**: pattern reducer richiede stato immutabile. Immer è la libreria standard per evitare boilerplate, ma aggiunge una dipendenza e un layer di magia.
- **Decisione**: gestire l'immutabilità a mano con spread operator. Helper `updateUnit`, `appendLog` in `state.ts` per le mutazioni più comuni.
- **Razionale**:
  - GameState non è enorme (units record + log + pendingAction)
  - Il numero di mutazioni "interessanti" è limitato (turno, attacco, mossa, danni)
  - KISS: niente magia, debug più diretto
- **Conseguenze**: alcuni reducer più verbose, ma codice più trasparente. Se un giorno cresce il caso, si introduce Immer in trasparenza.

---

## D-027 — RollSpec separato da Roll: spec di tiro vs risultato

- **Data**: 2026-04-29 (M3)
- **Stato**: ACTIVE
- **Contesto**: nei dati statici (armi, scudi) descriviamo "tiri 1d6+4 per parare" ma è una *specifica*, non un risultato. Inizialmente avevo modellato tutto come `Roll = {variable: number[], fixed: number}` con array placeholder `[0]` — semanticamente sporco.
- **Decisione**: introdotto tipo `RollSpec = {dice: number, fixed: number}` per le specifiche statiche. `Roll` resta il risultato concreto (con i d6 tirati). Conversione: `makeRoll(rng, spec.dice, spec.fixed)`.
- **Razionale**: chiarezza semantica, type system ti dice se stai usando una spec o un risultato.
- **Conseguenze**: archi/balestre `parry: null` invece del sentinel `-Infinity`. Più pulito.

---

## D-028 — Modello AttackMode: stat 'forza'/'agilità'/'either' + label per UI

- **Data**: 2026-04-29 (M3)
- **Stato**: ACTIVE
- **Contesto**: la notazione `/` nelle armi ha tre significati (forza/agilità per spada, 1h/2h per spada lunga, niente per lancia 1h/2h).
- **Decisione**: ogni `Weapon` ha `attackModes: AttackMode[]` con campo `stat: Stat | 'either'` e `label` per UI.
  - Spada: 2 modi `[{stat: 'forza', ...}, {stat: 'agilità', ...}]`, stessa diceVariable/fixedBonus
  - Spada lunga: 2 modi `[{label: '1 mano', stat: 'either', fixedBonus: 2}, {label: '2 mani', stat: 'either', fixedBonus: 6}]`
  - Lancia 1h/2h: 1 modo unico
- **Razionale**: copre tutti i casi senza un modello tassonomico complicato. UI mostra le label, il combat applica stat e bonus selezionati.
- **Conseguenze**: il character builder e l'UI di attacco mostreranno un picker dei modi disponibili.

---

## D-029 — Slancio→impeto a inizio turno: lo slancio viene azzerato dopo la somma

- **Data**: 2026-04-29 (M5)
- **Stato**: ACTIVE — interpretazione operativa Claude (da confermare con Valerio)
- **Contesto**: la regola dice "lo slancio si somma a impeto", ma poi "tiro nuovo slancio 0-2 d6 +2". Se lo slancio non si azzerasse, accumulerebbe ad ogni turno (impeto += slancio_corrente, e lo slancio cresce). Insostenibile.
- **Decisione**: a inizio turno applico la sequenza:
  1. `impeto += slancio`
  2. `slancio = 0`
  3. tiro nuovo → `slancio = totale_tiro` (può essere negativo, in tal caso si propaga a impeto col floor 0)
- **Razionale**: l'unico significato sensato della regola. Senza azzerare, ogni turno l'impeto cresce di slancio_iniziale + slancio_tirato → diverge.
- **Conseguenze**: l'impeto è la "memoria di iniziativa" cumulativa; lo slancio è il buffer di turno. Se Valerio voleva interpretazione diversa, da rivedere.

---

## D-030 — Dadi azione spesi = quelli scelti dal giocatore (no skill)

- **Data**: 2026-04-29 (M5)
- **Stato**: ACTIVE
- **Contesto**: le skill `+1 dado` aggiungono un dado al tiro. Conta come dado azione speso?
- **Decisione**: il PG paga **solo i dadi scelti** (es. attacco 2 dadi → 2 dadi azione spesi); i dadi aggiunti da `+1 dado` sono "gratis" (sono il vantaggio della skill).
- **Razionale**: le skill `+1 dado` costano 3600 exp — un valore enorme che giustifica un beneficio "gratis" sul piano dei costi azione.
- **Conseguenze**: implementato in `reducer.ts > doResolveCombat`.

---

## D-031 — Reducer style: validazione minimale, illegal-action → log e stato invariato

- **Data**: 2026-04-29 (M5)
- **Stato**: ACTIVE
- **Contesto**: il reducer riceve eventi dal client/AI e potrebbe ricevere azioni illegali (es. attacco fuori turno).
- **Decisione**: validazione minimale (controlli "ovvi": fase coerente, unit esistente, slancio sufficiente per movimento, basetta non sovrapposta). In caso di illegale: ritorna stato invariato con log warning. Niente errori thrown.
- **Razionale**: la robustezza è preferibile a crash. Il client UI dovrebbe non emettere illegali, ma in caso non lo facesse il gioco non si pianta.
- **Conseguenze**: chi consuma il reducer deve sapere che il newState potrebbe essere identico al prev se l'evento è invalid.

---

## D-032 — Ranged: niente difesa attiva (no schivata/parata)

- **Data**: 2026-04-29 (M8)
- **Stato**: ACTIVE — interpretazione operativa Claude
- **Contesto**: le regole base parlano di schivata/parata solo per "corpo a corpo"; per il ranged elencano solo la formula del tiro con malus distanza/visibilità/slancio_target.
- **Decisione**: gli attacchi ranged saltano la fase `awaiting-defense` e applicano direttamente i danni post-RD. Il malus `slancio_target` rappresenta già la "evasività" del bersaglio.
- **Razionale**: lettura naturale del testo. Lascia spazio in M11+ per eventuale skill `+1 al tiro [schivare]` su ranged se Valerio decide di estenderlo.
- **Conseguenze**: implementato in `reducer.ts > doChooseAttackerDice` (skip awaiting-defense per pa.isRanged). Verificare con Valerio se vuole abilitare schivata anti-ranged.

---

## D-033 — LoS: tiebreaker per fromHex = min distanza al target

- **Data**: 2026-04-29 (M8)
- **Stato**: ACTIVE
- **Contesto**: tra i 7 esagoni della basetta attaccante con la stessa LoS migliore, quale scegliere?
- **Decisione**: tra quelli con `max visibility`, prendere quello con `min distance` al target.
- **Razionale**: sensato come default — l'arciere "si sposta sull'angolo della basetta più favorevole alla precisione". Altrimenti il sistema sceglierebbe l'hex più lontano (peggiore malus distanza).
- **Conseguenze**: scelto automaticamente dalla `computeLoS`. Eventuale override manuale (giocatore sceglie da quale hex sparare) si può aggiungere in M13 polish.

---

## D-034 — UnitSprite vettoriale (cerchio colorato + label HP) per MVP

- **Data**: 2026-04-29 (M6)
- **Stato**: ACTIVE — supersedes parte di D-022
- **Contesto**: rendering unità nell'MVP.
- **Decisione**: cerchio colorato (blu fazione A, rosso fazione B) con label nome sopra e HP/impeto/slancio sotto. Animazioni minime: flash giallo quando colpita, numero danno fluttuante.
- **Razionale**: zero-dipendenze esterne, immediato, leggibile. Asset sprite veri arrivano in post-MVP.
- **Conseguenze**: estetica spartana ma 100% funzionale.

---

## D-035 — M9+M10 streamlined: preset PG hardcoded invece di character builder UI completo

- **Data**: 2026-04-29 (M10)
- **Stato**: ACTIVE — scope-cut deliberato
- **Contesto**: l'M10 originale prevedeva un character builder UI completo (skill tree con acquisto + specializzazioni). È un task grosso. Per chiudere l'MVP in tempi sostenibili, ho fatto uno scope-cut.
- **Decisione**: 3 preset PG hardcoded in `data/presets.ts`:
  - **Spadaccino**: spada + scudo medio + armatura leggera, 5 skill (−1 imp + 2× +1 tiro)
  - **Arciere**: arco lungo + pugnale offhand + armatura leggera, 9 skill specializzate (−1 imp arco × 6, +1 tiro archi × 2)
  - **Tank**: mazza + scudo pesante + armatura pesante, 9 skill (−1 imp ovunque + 2× +1 tiro parare)
- **Razionale**:
  - Ogni preset dimostra una "rotta" diversa (mischia bilanciata, ranged specialista, tank parata-mania)
  - Skill bilanciate intorno al riferimento 2000 exp
  - Demo immediata delle meccaniche skill+specializzazione anche senza UI builder
- **Conseguenze**:
  - Il sistema skill+specializzazioni è 100% funzionante (testato), solo l'UI builder manca
  - Post-MVP: il char builder UI vero è un'aggiunta naturale che riusa tutto il backend già pronto
  - Valerio può modificare i preset direttamente in `presets.ts`

---

## D-036 — M13 polish: scope minimo, post-MVP per asset/audio

- **Data**: 2026-04-29 (M13)
- **Stato**: ACTIVE
- **Contesto**: MVP funzionante e giocabile. Polish ulteriore va in coda.
- **Decisione**: in M13 ho incluso polish "essenziale" (animazione hit, log, handoff). Asset sprite reali, audio, animazioni movimento → post-MVP.
- **Razionale**: meglio chiudere l'MVP shippabile + Telegram di stato che protrarre con feature non bloccanti.
- **Conseguenze**: il gioco è giocabile end-to-end, esteticamente vettoriale-spartano. Pronto per playtest da parte di Valerio.

---

## D-037 — Slancio target ranged: modificatore passivo, NON consumato

- **Data**: 2026-04-29
- **Stato**: ACTIVE — confermato da Valerio
- **Contesto**: nel tiro ranged, lo slancio del target è sottratto al tiro come "evasività dinamica". Domanda: il target consuma slancio quando viene preso a bersaglio?
- **Decisione**: lo slancio del target viene **sottratto al tiro** dell'attaccante (modificatore passivo) ma **non viene consumato**: il valore di slancio del target resta invariato dopo il tiro.
- **Razionale**: lo slancio rappresenta movimento già fatto / readiness. È un modifier statico al tiro avversario, non una risorsa spesa.
- **Conseguenze**: già implementato così in `composeRangedAttackRoll` (`combined.fixed -= target.slancio`, target read-only). Verificato.

---

## D-038 — Phase guards reducer: rejectEvent con log warning

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: review Sonnet ha segnalato che eventi out-of-phase (UI doppio-click rapido, race condition tra dispatch) erano rifiutati silenziosamente con `return state` — l'utente non vede perché un click va perso.
- **Decisione**: introdotti helper `rejectEvent(state, type, reason)` e `ensurePhase(state, type, allowed[])` in `reducer.ts`. Tutti i guard di phase ora restituiscono uno stato con log warning esplicito (`[reducer] evento 'X' rifiutato: ...`).
- **Razionale**: debug visibile durante playtest, niente eccezioni thrown (server multiplayer-ready: stato sempre coerente).
- **Conseguenze**: 5 nuovi test coprono i casi edge (MOVE durante turn-start, CHOOSE_DEFENSE durante choosing-action, END_TURN con pendingAction, DECLARE_ATTACK doppio, diceN negativo). 147 test verdi totali. Aggiunto anche skip-cadute nel `doEndTurn` per futuro 4v4.

---

## D-039 — Ricarica balestra: tiro abilità Forza vs difficoltà 7 (non turni di cooldown)

- **Data**: 2026-04-29
- **Stato**: ACTIVE
- **Contesto**: la `TAB_armi.docx` indica per la balestra "Distanza 1.0m, Ricarica 7". Inizialmente interpretato come "7 turni di cooldown" — interpretazione errata (vedi audit).
- **Decisione corretta** (Valerio): la "Ricarica 7" è la **difficoltà di un tiro di abilità** richiesto per ricaricare l'arma dopo lo sparo.
  - Stat: **Forza**
  - Tiro: 1-2 d6 + 2 fissi (come tutti i tiri)
  - Costa dadi azione (D-030)
  - Successo: arma carica, può sparare al prossimo turno
  - Fallimento: nessuna penalità, ritenta al prossimo turno
  - Skill applicabili: specializzazione `[azione: ricaricare]` (nuova ActionType), `[forza]`, `[balestre]`, `[balestra]`
  - Stato iniziale partita: arma **carica**
  - Arma scarica: l'azione "Spara" non è disponibile fino alla ricarica
- **Implementazione**:
  - Nuovo campo `Unit.weaponLoaded: boolean` (default true)
  - Nuovo evento `RELOAD {unitId, diceN}`
  - Handler `doReload` nel reducer con phase guard
  - `canFireRanged` rifiuta se `!attacker.weaponLoaded` per armi con `range.reload`
  - Post-shoot in `doResolveCombat`: se arma con reload, `weaponLoaded = false`
  - UI: `BattleScene.showActionMenu` aggiunge "Ricarica X" se scarica; rimuove "Spara X" se scarica (via `canFireRanged`)
  - AI: in `aiDecideAction`, se balestra scarica → emette `RELOAD` invece di restare bloccata
- **Conseguenze**: 5 nuovi test (152 verdi totali). La balestra ora rispetta il design previsto (alto fisso ma rateo di fuoco basso/incerto).

---

## D-042 — Scudo: bonus passivo anche contro attacchi a distanza

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: D-032 stabiliva che gli attacchi ranged non hanno difese attive (no parry/dodge come azione). Ma Valerio ha chiarito: lo scudo "copre parte del corpo" e dovrebbe offrire protezione **passiva** contro frecce e tiri.
- **Decisione**: nel tiro ranged dell'attaccante, viene sottratto il `parry.fixed` dello scudo equipaggiato dal difensore (slot offhand). I dadi del scudo NON sono tirati (è passivo, non un'azione che spende dadi).
- **Razionale**:
  - Realismo: uno scudo fisicamente blocca le frecce
  - Asimmetria con armi parry-capable: l'arma da mischia (es. spada lunga con `parry: 1d6+6`) NON dà bonus passivo perché non copre il corpo. Solo gli scudi sì.
  - Solo `parry.fixed` (no dadi) perché è una protezione costante non dipendente dal tiro
- **Conseguenze**:
  - Tiro ranged ora: `1-2 d6 + 2 + dadi_arma + bonus_arma + visibilità − ⌊dist/N⌋ − slancio_target − impedimento − scudo_passivo`
  - Tank con scudo medio (1d6+8): -8 al tiro arciere
  - Spadaccino con scudo medio: -8
  - Arciere con pugnale (no scudo): nessun bonus
  - Implementato in `src/core/ranged.ts:composeRangedAttackRoll`

---

## D-043 — Ranged: armatura passiva al tiro (single application, "il tiro è il danno")

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: per gli attacchi ranged non esistono difese attive (D-032). Le difese passive — scudo (D-042), armatura, slancio — devono comparire al check del tiro stesso, non al damage stage. Valerio chiarisce: *"il tiro È il danno, non ci sono due istanze, è una sola"*.
- **Decisione**: contro ranged la `damageReduction` (RD) dell'armatura del difensore viene sottratta al **tiro** dell'attaccante (parte fissa). Il damage stage NON applica una seconda volta RD per ranged (single application). Per il melee la regola classica resta invariata: RD applicata al damage finale dopo difesa attiva.
- **Razionale**:
  - Coerenza fisica: contro ranged non c'è "tiro vs difesa", solo soglie passive (visibilità/distanza/scudo/armatura/slancio). Il numero finale del tiro è l'unica grandezza che conta → naturalmente "è il danno".
  - Slancio diventa una **contro-misura naturale** al ranged: PG con slancio alto è meno bersagliabile (era già nel codice ma ora si vede meglio l'intent di design).
  - Evita l'ambiguità "double-dip" (RD al tiro + RD al damage) che over-nerferebbe il ranged.
- **Conseguenze**:
  - Tiro ranged ora: `1-2 d6 + 2 + dadi_arma + bonus_arma + visibilità − ⌊dist/N⌋ − slancio_target − impedimento − scudo_passivo − RD_armatura_target`
  - Spadaccino con armatura leggera (RD 3) + scudo medio (8): −11 totale al tiro arciere
  - Tank con armatura media (RD 6) + scudo medio (8): −14 totale al tiro arciere
  - Arciere con armatura leggera (RD 3) + pugnale: −3 totale (no scudo)
  - Implementato in `src/core/ranged.ts:composeRangedAttackRoll` (sottrazione al tiro) e `src/core/reducer.ts:RESOLVE_COMBAT` (bypass `applyDamageWithArmor` per ranged)

---

## D-044 — Transfer impeto→slancio dopo il tiro slancio (1:1, gratuita)

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: lo slancio è la principale contro-misura passiva contro ranged (D-043: ogni +1 slancio = -1 al tiro nemico). Ma il tiro slancio è 0-2d6+2: massimo 14 senza skill. Spesso non basta. Inoltre dopo il tiro, il giocatore vuole un meccanismo per *spendere* la propria priorità (impeto) per *aumentare ulteriormente* la mobilità/difesa di questo round.
- **Decisione**: subito dopo il tiro slancio (e immutabilmente dopo), il giocatore può trasferire N punti da `impeto` a `slancio` con tasso 1:1, gratuito (non costa dadi azione).
  - **Floor scelta volontaria**: 0 punti impeto (non puoi trasferire più impeto di quanto ne hai). L'impeto può andare sotto 0 SOLO per colpi subiti (regola precedente sui penalty slancio); se `impeto < 0` e `|impeto| == hp_residui` → svenuto/incapacitato (futuro D-045).
  - **Cap superiore slancio**: il valore massimo teorico del tiro slancio SENZA impedimento = `(2 + extraMax_skill) * 6 + 2 + flat_bonus_skill`. **L'impedimento non entra nel cap** (chiarimento Valerio): penalizza il tiro reale ma non lo "spazio" massimo dello slancio nel personaggio. Senza questa esclusione un PG pesante non potrebbe quasi mai usare il transfer in modo significativo. Es. baseline = 14; con `+1 [agilità][slancio]` = 15; con `+1 dado max [slancio]` = 21.
  - **Tempo**: subito dopo il tiro slancio, parte di START_TURN. Non si può cambiare dopo.
- **Razionale**:
  - Chiude il loop strategico: l'impeto (priorità nei round futuri) diventa una valuta convertibile in slancio (mobilità + difesa passiva contro ranged questo round).
  - Trade-off chiaro: ottimizzi questo round, paghi nei prossimi (impeto basso → giochi più tardi).
  - Coerente con D-043: contro un arciere in vista, posso spendere 8 impeto per portare slancio da 7 a 15 → tolgo 8 al tiro nemico, evito il one-shot, sopravvivo per chiudere in mischia.
- **Conseguenze**:
  - Implementato in `src/core/turn.ts:applyTurnStart` con parametro `impetoToSlancio` opzionale (default 0)
  - Aggiunta `getMaxSlancioRoll(unit)` come cap del transfer
  - `START_TURN` event esteso con `impetoToSlancio?: number`
  - `legalMoves`: emessi varianti `{slancioDice: 2, impetoToSlancio: 3|6|9}` se impeto disponibile
  - `utilityAi`: in presenza di minaccia ranged (nemico con arma ranged in LoS), preferisce max slancio + transfer; altrimenti regola classica (max dadi se lontano, 0 in mischia)

---

## D-045 — Round 0 di setup: tiro slancio iniziale prima del round 1

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: prima di questa regola, ogni unit partiva con `slancio = 0`. Nel round 1, se l'arciere giocava per primo per ordine impeto, sparava prima che il difensore potesse alzare slancio → kill al primo colpo (D-043 inutile). Valerio chiarisce: *"a turno 0 la prima cosa che si fa è lanciare slancio, e poi si gioca normalmente. Se non sei preso di sorpresa non devi avere slancio 0"*.
- **Decisione**: prima del round 1 esiste un "round 0" di setup automatico. Ogni unit `alive` tira slancio (sempre 2d6+2 + skill bonus − impedimento, nessuna scelta giocatore). Non si recuperano dadi azione, non si applica slancio→impeto (slancio iniziale è 0 → no impatto), non c'è transfer impeto→slancio.
  - **Tempo**: avviene contemporaneamente a tutte le unit, una sola volta al setup del game (in `createInitialState`).
  - **Default**: max dadi (2d). Non interattivo perché "tanto è gratis".
  - **Eccezione futura "preso di sorpresa"**: salta questo passaggio e parte con slancio 0. Rimandato a regola futura.
- **Razionale**:
  - Lo slancio iniziale > 0 attiva D-043 fin dal round 1 (l'arciere subisce malus al tiro anche al primo colpo).
  - Coerente con la fiction: i PG entrano in battaglia in movimento, già "carichi", non da fermi.
  - Determina anche l'ordine turno round 1 (impeto + slancio); con slancio diverso da 0 si rompe più spesso la parità di impeto.
- **Conseguenze**:
  - Nuova funzione `src/core/turn.ts:applyInitialSlancio(unit, rng)` — solo tiro slancio, no recovery
  - `src/core/state.ts:createInitialState` chiama `applyInitialSlancio` per ogni unit alive
  - Spadaccino baseline: slancio iniziale ~ 2d6+2−4 imp = ~5-10 (avg 6)
  - Tank baseline: ~ 2d6+2−7 imp = ~2-7 (avg 4)
  - Arciere baseline: ~ 2d6+2−1 imp = ~8-13 (avg 10)
  - **Atteso shift sim**: arciere domina di meno; spadaccino sopravvive il primo tiro nel round 1; tank ancora fragile (slancio basso per imp alto → leva D-044 transfer)

---

## D-046 — Sistema costi skill con livelli + dimezzamento per specializzazione

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: il sistema iniziale aveva costi flat per skill (es. -1imp = 100, +1tiro = 600), permetteva l'acquisto multiplo della stessa skill specializzata (con cost fissato manualmente), e la specializzazione costava uguale a non-spec. Risultato: preset come spadaccino con `-1imp [spade] ×3` (illegale e sub-ottimale). Valerio ha chiarito le regole reali del sistema skill.
- **Decisione**:
  - Ogni skill ha un **livello** (`level: number`, default 1). Un livello N significa che il modificatore è applicato N volte (-3imp toglie 3 punti di impedimento dal pezzo applicabile; +2tiro = +2 fissa al tiro matchante).
  - **Costo per livello**: incremento raddoppia ogni livello.
    `total_cost(level) = base * (2^level - 1)` — lv1=1×base, lv2=3×base, lv3=7×base, lv4=15×base, lv5=31×base, lv6=63×base.
  - **Dimezzamento per specializzazione**: ogni specializzazione presente (Abilità / Azione / Classe oggetto / Oggetto specifico) dimezza il costo cumulativamente.
    `final_cost = ceil(total_cost(level) / 2^specCount)` — 1 spec /2, 2 spec /4, 3 spec /8, 4 spec /16.
  - **Vincolo unicità**: non puoi acquistare la stessa skill identica (stesso modifier + stessa combinazione di spec) più volte. Per cumulare, sali di livello.
  - **Esempi**:
    - `-3imp` lv3 no spec = 100 × 7 = **700 exp**
    - `-3imp [scudi]` lv3 1 spec = 700/2 = **350 exp**
    - `+1tiro [attaccare][spade]` lv1 2 spec = 600/4 = **150 exp**
    - `+2tiro [parare][scudi]` lv2 2 spec = (600 × 3)/4 = **450 exp**
    - `+1dadomax [slancio][agilità]` lv1 2 spec = 1200/4 = **300 exp**
- **Razionale**:
  - Sistema progressione scalabile: skill basse sono economiche, alte costano molto (curva di power impedisce stacking eccessivo).
  - Specializzazione = sconto, ma applicabilità ristretta: trade-off chiaro.
  - Spec cumulative: incentiva build mirate (sniper di una specifica arma costa pochissimo).
- **Conseguenze**:
  - `src/entities/Skill.ts`: aggiunto campo `level: number` ad `AcquiredSkill`. Funzioni `computeSkillCost`, `countSpecializations`, `skillKey`, `validateSkillSet`.
  - `src/core/stats.ts`: `getImpedimentTotal` somma `level` invece di `.length`. Idem `countFlatBonuses`, `countMaxDiceExtra`, `countForcedExtraDice`.
  - **Preset riprogettati a 2000 exp validi**:
    - Spadaccino: -3imp + -3imp [scudi] + +2tiro [parare/scudi] + +1tiro [attaccare/spade] + +1tiro [slancio/agilità] + +1tiro [schivare/agilità] = 1950 exp, imp 0
    - Arciere: -3imp + -3imp [archi] + +2tiro [attaccare/archi] + +1tiro [slancio/agilità] + +1dadomax [slancio/agilità] = 1950 exp, imp 0
    - Tank: -3imp + -3imp [scudi] + -3imp [armature] + +1tiro [parare/scudi] + +1tiro [slancio/agilità] + +1dadomax [slancio/agilità] = 2000 exp, imp 0

---

## D-047 — Armi con bonus condizionato a stat: con 2 dadi PG si attivano entrambi

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: armi con notazione `X/Y` per ATK (es. spada `1D6+2/+2`) hanno bonus condizionato a stat (Forza vs Agilità). Il sistema iniziale modellava queste armi con 2 attackModes separati e l'AI sceglieva uno dei due ⇒ singola stat. Valerio chiarisce: *"se l'attaccante usa due dadi PG, può usare un dado di forza e uno di agilità e quindi la spada diventa 3d6+6+skill"*.
- **Decisione**: per armi con 2 attackModes con `stat: 'forza'` e `stat: 'agilità'` (notazione `X/Y` con bonus condizionati), se l'attaccante sceglie ≥2 dadi PG, il fixedBonus dell'altro mode si aggiunge al tiro. Esempio spada con 2d PG e mode "Forza" scelto:
  - 2d6 (PG) + 1d6 (spada) + 2 (PG fisso) + 2 (Forza, da mode 0) + 2 (Agilità, da mode 1) = 3d6+6
  - +skill (`+1 attaccare spade`) = 3d6+7 atteso
- **Razionale**:
  - Ricompensa il giocatore per investire 2 dadi PG nell'attacco (vs riservarli per difesa)
  - Permette alle armi "X/Y" di esprimere il loro pieno potenziale, distinguendole da quelle "+9 puro" (mazza) o "1d6+6 fisso" (arco corto)
  - Coerente con la fiction: un colpo a due mani sfrutta sia forza che agilità
- **Conseguenze**:
  - Implementato in `src/core/combat.ts:composeAttackRoll`. Detection automatica: se ≥2 mode esistenti con stat 'forza' e 'agilità' (non 'either'), aggiunge il fixedBonus dell'altro mode
  - Atteso impatto: spadaccino vs tank si riequilibra (damage spada con 2d aumenta di +4 fisso)
  - Skill-bonus delle stat (es. `+1 [forza]`) non si addiziona — il match skill avviene su una sola stat per ctx, è il bonus ARMA a duplicarsi

---

## D-048 — Contraccolpo: subire danni → perdere slancio (raw, pre-RD)

- **Data**: 2026-04-30
- **Stato**: ACTIVE
- **Contesto**: la regola "Slancio < 0 → eccesso a impeto" esisteva ma non c'era una sorgente di malus oltre alla penalty per attacco mancato (schivata/parata vincente per il difensore). Valerio chiarisce: *"manca solo la regola che fa danni allo slancio uguali ai danni subiti, anche quelli assorbiti dall'armatura. Rappresenta il contraccolpo ricevuto"*.
- **Decisione**: quando un'unità subisce un colpo a segno (hit > 0), perde **slancio = `rawDamage`** (PRE-RD), non l'effective damage post-armatura.
  - L'armatura riduce gli HP persi ma non il "contraccolpo" che destabilizza.
  - Vale sia per melee sia per ranged (per ranged D-043: rawDamage = damage applicato, perché single application).
  - Se lo slancio andasse sotto 0, l'eccesso si sottrae a `impeto` (regola esistente, applicata da `applySlancioPenalty`).
- **Razionale**:
  - Crea una **spirale di degradazione**: chi subisce molti colpi diventa progressivamente più lento → più colpibile → spirale di sconfitta. Coerente con la fiction.
  - Trasforma le armature in un investimento "HP-only", non "stamina-saving".
  - Riequilibra le partite lunghe: vince chi gestisce meglio l'impeto, non solo chi para meglio.
- **Conseguenze**:
  - Implementato in `src/core/reducer.ts:RESOLVE_COMBAT` (dopo `applyDamageWithArmor`, applica `applySlancioPenalty(target, rawDamage)`)
  - Skip se target è già caduto (no slancio a unit morte)
  - Atteso forte impatto sui ritmi: matchup vs ranged molto più decisi (l'arciere infligge 13-16 raw → svuota slancio del bersaglio in 1-2 colpi); matchup melee più "snowball" (chi prende il primo colpo perde slancio → para meno → snowball).

---

## D-052 — Asta zona di controllo: tie a difensore + costo fisso 1 slancio per atk

- **Data**: 2026-05-03
- **Stato**: ACTIVE — supersede della procedura asta precedente in M-1
- **Contesto**: la procedura M-1 originale ("atk vince le parità" + "atk paga solo il bid") è stata stress-testata con CFR tabular (script `python/cfr/auction_cfr_iterated_fix.py`, T=2000 iter). Risultato: equilibrio degenere — atk può sempre puntare 0, def non ha incentivo a bidare, atk passa gratis. L'asta non protegge nulla.
- **Decisione**: nuova procedura asta:
  1. Atk bid in `[0, slancio - 1]` (deve riservare 1 slancio per il movimento), def bid in `[0, slancio]`
  2. **Atk vince solo se `bid_a > bid_b`** (parità → def)
  3. Atk paga sempre `1 + bid_a` (1 fisso movimento + bid), def paga `bid_b`
  4. Atk con `slancio < 1` non può attivare l'asta (movimento si ferma)
- **Razionale**: stesso CFR sweep mostra ora un equilibrio sano:
  - 5v5: V_a=+0.557, mind game vero (entrambi mixano)
  - 8v8 / 10v5: V_a=+0.800, atk bida 1 minimo, def rinuncia
  - 5v10 / 3v3: atk QUIT razionale, def deter naturale senza spese
- **Conseguenze**:
  - Modifiche in `src/core/reducer.ts` (motore TS) e `python/hex_tactics/core/reducer.py` (motore Python)
  - Test `tests/core/phase1.test.ts` aggiornati (asserzioni slancio)
  - Sezione "M-1. Meccanica A — Asta nascosta di slancio" in CLAUDE.md aggiornata
  - File CFR `python/cfr/auction_cfr_iterated_fix.py` resta il "source of truth" del modello matematico

---

## Decisioni pending (da prendere ad un certo punto)

> Non bloccano lo scaffolding M1, ma vanno chiuse durante le milestone successive.

- **D-pending-A**: scelta del pack asset esatto (Kenney "Hexagon Pack" vs altro) → **deadline: M2 (geometria/mappa)**
- **D-pending-B**: usare libreria di immutabilità (es. Immer) o gestire a mano? → **deadline: M3 (modello dati core)**
- **D-pending-C**: dimensioni mappa di default (12×8? 14×10?) → **deadline: M2**
- **D-pending-D**: visualizzazione "scelta dadi nascosta" in hot-seat → schermata di passaggio o blur? → **deadline: M6 (combat in mischia)**
- **D-pending-E**: nome definitivo del progetto (al momento `hex-tactics`) → **a discrezione di Valerio**
- **D-pending-F**: gap nella `TAB_armi.docx` (5 righe vuote) → segnaposto per altre armi che Valerio aggiungerà o ignorabili?

---

## Come aggiornare questo file

Ogni volta che si prende una decisione architetturale o di design rilevante:
1. Aggiungere nuova entry `D-NNN` (incrementa l'ID più alto)
2. Compilare contesto, decisione, razionale, conseguenze
3. Stato `ACTIVE` di default
4. Se sostituisce una precedente, marcare la vecchia come `SUPERSEDED` con riferimento alla nuova
5. Se l'idea viene scartata in fase decisionale, registrarla comunque come `REJECTED` con razionale (utile per non riproporla)

**Niente decisione è "implicita"**: se si sta prendendo una scelta che impatta il design, va scritta qui.

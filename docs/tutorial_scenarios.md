# Tutorial interattivo — definizione scenari

> Bozza per review. 9 scenari sequenziali, ognuno 2-5 min, ognuno introduce **un solo concetto** nuovo.
> Ogni scenario è giocabile e ha un **obiettivo concreto**. Gli "step" sono prompt didattici (overlay) che il giocatore vede a ondate.

---

## Pattern comune di ogni scenario

Per ogni scenario specifico abbiamo:

- **Setup**: stato iniziale della battaglia (preset, posizioni, stat, slancio iniziale, equip, fazione AI/umano).
- **Concetto chiave**: il singolo nuovo concetto introdotto.
- **Obiettivo**: condizione di completamento.
- **Steps**: la sequenza di hint/azioni che il giocatore segue.
- **Hint UI**: testi degli overlay didattici.
- **Pre-requisiti**: scenari da completare prima.
- **Successo / Fallimento**: cosa succede.

I primi scenari hanno il nemico in modalità **passiva** (non si muove, non attacca). I successivi alzano la difficoltà gradualmente.

---

## T1 — Muoviti

**Concetto chiave**: muoversi sulla griglia, costo del movimento in slancio.

**Setup**:
- A: Spadaccino (umano). Posizione: centro-sinistra. Slancio iniziale forzato: 5.
- B: nessun nemico. C'è invece un esagono "obiettivo" (bandierina) a 4 hex di distanza dall'attaccante.
- Pre-condizione: turno A, fase `choosing-action`.

**Obiettivo**: raggiungere l'esagono bandierina con un solo movimento.

**Steps**:
1. Overlay: *"Benvenuto in hex-tactics. Il tuo eroe è quello blu. Devi raggiungere la bandierina arancione."*
2. Overlay (con freccia che punta al bottone "Muovi"): *"Clicca sul pulsante 'Muovi' a destra."*
3. Overlay (sull'highlight): *"Gli esagoni gialli sono dove puoi arrivare. Più sei lontano, più slancio spendi (1 esagono gratis, poi 1 punto slancio per ogni esagono)."*
4. Overlay (puntando alla bandierina): *"Clicca sulla bandierina."*
5. **Successo**: overlay *"Bravo! Hai mosso 4 hex: 1 gratis + 3 pagati. Lo slancio è sceso di 3."*

**Note design**: il primo scenario è puro tutorial UI, niente meccanica complessa. Il giocatore impara: bottone Muovi, highlight, click destinazione, costo slancio.

---

## T2 — Scegli quanti dadi di slancio

**Concetto chiave**: il tiro slancio è una scelta strategica. 0 = risparmi dadi ma resti immobile. 2 = mobilità ora ma costa 2 dadi azione.

**Setup**:
- A: Spadaccino (umano). Posizione: centro-sinistra. Slancio iniziale forzato: 0.
- B: nemico passivo (Spadaccino AI immobile). Posizione: centro-destra, **a 6 hex di distanza** dal giocatore.
- Pre-condizione: turno A, fase `turn-start` → DiceChoiceUI per slancio.

**Obiettivo**: arrivare adiacente al nemico (entro 1 hex) **in questo turno**.

**Steps**:
1. Overlay: *"All'inizio di ogni turno scegli quanti dadi tirare per lo slancio. Più dadi = più mobilità, ma costa più dadi azione."*
2. Overlay (sui bottoni 0/1/2): *"Tira 2 dadi per avere abbastanza slancio per chiudere la distanza."*
3. Click "2" → overlay *"Hai tirato e ottenuto X di slancio."*
4. Overlay: *"Ora muoviti verso il nemico finché non sei adiacente."*
5. Click "Muovi" → click su esagono adiacente al nemico.
6. **Successo**: overlay *"Sei in mischia. Nel prossimo scenario impari ad attaccare."*

**Variante didattica**: se il giocatore prova "0" dadi per primi → game gli mostra che non ha abbastanza slancio per arrivare → overlay *"Con 0 slancio puoi muovere solo 1 hex. Ti servono almeno 4 punti slancio per arrivare. Riprova."*

---

## T3 — Attacca

**Concetto chiave**: dichiarazione attacco + dadi PG + fissa arma. Anatomia del tiro.

**Setup**:
- A: Spadaccino (umano). Posizione: adiacente a B. Slancio: 3.
- B: nemico passivo (HP 8, armatura leggera, **non si difende**). Posizione: adiacente.
- Pre-condizione: turno A, fase `choosing-action`.

**Obiettivo**: KO il nemico in un attacco (con 2 dadi).

**Steps**:
1. Overlay: *"Il nemico è a portata. Clicca sul pulsante di attacco."*
2. Click sull'azione "Attacca" → DiceChoiceUI.
3. Overlay (sui dadi): *"Più dadi tiri = più probabile colpire forte. Ma costa più dadi azione."*
4. Overlay: *"Tira 2 dadi per essere sicuro di KOarlo."*
5. Click "2" → battaglia si risolve, nemico KO.
6. Overlay sul risultato: *"Hai tirato Xd6 + Y fissi = Z totali. Il nemico ha 8 HP, hai fatto Z danni (meno la riduzione armatura)."*
7. **Successo**: overlay *"Vittoria. Hai imparato la formula base. Nel prossimo scenario il nemico si difenderà."*

**Note design**: B configurato con HP basso e `defenseType=none` di default per non confondere. Il messaggio post-attacco mostra esplicitamente la decomposizione variabile/fissa per ancorare il concetto del cap. 6 del manuale.

---

## T4 — Schiva

**Concetto chiave**: la schivata morde solo la **variabile** dell'attaccante. Costa dadi azione ma può azzerare un colpo.

**Setup**:
- A: giocatore (Spadaccino con pugnale, **niente scudo**, armatura leggera). HP iniziale: 12 (per pressione).
- B: AI con **mazza** (fisso puro +9). Adiacente. Sta per attaccare.
- Pre-condizione: turno B, AI dichiara attacco mischia → fase `awaiting-defense`.

**Obiettivo**: schivare l'attacco con 2 dadi.

**Steps**:
1. Overlay: *"Il nemico ha una mazza: arma a fisso puro. Niente dadi propri, ma se passa fa molti danni."*
2. Overlay (sul menu difesa): *"La mazza ha pochi dadi tirati: la **schivata** è perfetta. Se vinci, blocchi anche il +9 fisso."*
3. Click "Schivata" → DiceChoiceUI.
4. Click "2" → risolve.
5. Se schivato: overlay *"Hai schivato! La mazza tira solo 1 dado (la sua variabile). Battendolo blocchi tutto. Niente danni."*
6. Se non schivato (RNG sfortunato): overlay *"Hai mancato la schivata. La variabile passa, e a quella si somma il +9 fisso."* — il tutorial offre re-try con seed fissato a successo.

**Successo**: schivata riuscita, HP intatto, overlay *"Schivata = sottrai variabile. Nel prossimo impari la parata."*

---

## T5 — Para

**Concetto chiave**: la parata morde il **totale**. Conviene contro armi a dadi propri.

**Setup**:
- A: giocatore (Tank con scudo medio). HP iniziale: 12.
- B: AI con spada lunga 2h (1d6+6, dadi propri). Adiacente, attacca.
- Pre-condizione: fase `awaiting-defense`.

**Obiettivo**: parare con scudo + 2 dadi.

**Steps**:
1. Overlay: *"La spada lunga ha sia dadi propri sia fissa. La schivata morderebbe solo i dadi. Meglio la parata: morde tutto."*
2. Overlay (sul menu): *"Hai uno scudo medio. Clicca 'Parata (Scudo medio)'."*
3. Click parata → DiceChoiceUI.
4. Overlay: *"Lo scudo medio aggiunge 1d6+8 alla tua parata. Tira 2 dadi PG per blindare."*
5. Click "2" → risolve.
6. **Successo**: overlay *"Parata = sottrai totale. Lo scudo è il tuo migliore amico contro armi 'normali'."*

**Variante**: dopo aver parato, il gioco mostra side-by-side il confronto: *"Se avessi schivato qui, avresti bloccato solo i dadi propri (≈4-7 di variabile media), ma il +6 fisso sarebbe passato lo stesso. La parata era la scelta giusta."*

---

## T6 — Spara (ranged)

**Concetto chiave**: linea di vista, malus distanza, slancio_target come difesa primaria contro ranged.

**Setup**:
- A: giocatore (Arciere con arco lungo). Posizione: bordo sinistro. Slancio iniziale: 0.
- B: Tank AI con scudo medio + armatura media. Posizione: 6 hex di distanza, slancio 0.
- Niente ostacoli sulla mappa (LoS = 7).

**Obiettivo**: colpire il tank a distanza.

**Steps**:
1. Overlay: *"Sei un arciere. Le armi a distanza non si possono parare attivamente — il difensore può solo aumentare lo slancio per rendere difficile colpirlo."*
2. Overlay sull'azione "Spara": *"L'opzione 'Spara' mostra visibilità (LoS) e distanza. Visibilità 7 = LoS perfetta. Distanza 6 hex × N=5 → −1 al tiro."*
3. Click "Spara" → DiceChoiceUI con breakdown completo.
4. Click "2" → risolve.
5. **Successo**: overlay *"Hai colpito! Nota il breakdown: visibilità +7, distanza −1, scudo passive −8, armatura −6. La parte **slancio_target** era 0 perché il tank non si è mosso. Se lui avesse 8 di slancio, avresti mancato."*

**Step bonus**: il turno dopo, il tank tira 2 dadi slancio. Il giocatore prova a sparare di nuovo: il tiro è ridotto. Overlay: *"Vedi? Il tank ha alzato lo slancio per difendersi dal ranged."*

---

## T7 — Carica

**Concetto chiave**: avvicinarsi al nemico = bonus alla fissa = costa slancio. Mind game con la difesa avversaria.

**Setup**:
- A: giocatore (Spadaccino). Posizione: 3 hex dal nemico. Slancio iniziale: 5. positionAtTurnStart settato.
- B: AI (Tank con scudo medio). Adiacente al giocatore solo se il giocatore si avvicina di 3 hex. Userà parata.

**Obiettivo**: usare la carica per battere la parata di B.

**Steps**:
1. Overlay: *"Il tank davanti a te usa lo scudo medio per parare. Se attacchi senza carica, la parata è quasi imbattibile."*
2. Overlay: *"Ma se ti avvicini in carica, ogni esagono percorso = +1 alla fissa. Muoviti di 3 hex verso il tank."*
3. Click Muovi, scegli hex adiacente.
4. Click "Attacca" → fase `awaiting-carica` → DiceChoiceUI carica.
5. Overlay: *"Hai 3 carica disponibili (avvicinati 3 hex). Costa 3 slancio. Vuoi usarli tutti?"*
6. Click "3" → poi 2 dadi PG → risoluzione.
7. **Successo**: overlay *"Con +3 alla fissa hai battuto la parata. Senza carica, sarebbe stata neutralizzata. Mind game: il tank parerà se aspetta. Lo punisci se carichi."*

---

## T8 — Posizione difensiva

**Concetto chiave**: lo scudo come muro fisico. ×2 RD passive vs ×2 imp.

**Setup**:
- A: giocatore (Tank con scudo medio). HP: 18. Posizione: avanzato. Slancio: 0.
- B: Arciere AI a 4 hex con arco corto. Sparerà 2 turni di seguito.

**Obiettivo**: sopravvivere 2 attacchi ranged senza perdere più di 6 HP.

**Steps**:
1. Overlay: *"Sei sotto fuoco di un arciere. Hai uno scudo medio. Puoi entrare in **posizione difensiva**: lo scudo passa da +8 RD ranged a +16 RD ranged. Ma il suo impedimento raddoppia."*
2. Overlay (sul menu): *"Clicca '🛡 Posizione difensiva'."*
3. Click → stance attiva. Overlay: *"Vedi l'anello dorato? Sei in stance. Adesso il tuo scudo blocca passivamente +16 ai colpi ranged."*
4. Passa turno. AI spara → infligge poco/zero danno.
5. Round successivo: AI spara di nuovo → idem.
6. **Successo**: overlay *"Sopravvissuto! Senza stance avresti perso ~12 HP. Con stance hai perso ~3-5. Trade-off: i tuoi attacchi ora sono peggiori (imp scudo raddoppiato). Esci dalla stance prima di colpire."*

---

## T9 — Asta movimento (zona di controllo)

**Concetto chiave**: bid privato simultaneo. Niente dadi, solo lettura del nemico.

**Setup**:
- A: giocatore (Spadaccino, slancio 6). Posizione: a 5 hex da B.
- B: AI con **lancia 3m (reach 6)**, slancio 4. AI biddera con strategia "min(2, slancio/4)+1" (deterministico per esercizio).

**Obiettivo**: passare l'esagono di controllo per arrivare a colpire il lanciere.

**Steps**:
1. Overlay: *"Il nemico ha una lancia 3m: minaccia tutti gli esagoni entro 6 hex (zona di controllo). Per attraversare devi vincere un'asta segreta di slancio."*
2. Overlay: *"Tu e il nemico scegliete una puntata in privato. Vince chi punta di più (parità → tu). Entrambi pagate la propria puntata."*
3. Click "Muovi" → scegli hex adiacente al nemico (entro la zona di reach 6).
4. Phase `awaiting-attacker-bid` → DiceChoiceUI con scelte 0..6.
5. Overlay: *"Quanto slancio sei disposto a investire? Tu hai 6, lui ha 4. Se punti 4 vinci sicuro... ma a quel punto sei senza slancio."*
6. Suggerimento: punta 2 (probabile vittoria, costo limitato).
7. Risoluzione asta (B AI bidda 2 secondo strategia → parità → A vince).
8. **Successo**: overlay *"Hai passato l'esagono! Hai pagato 2 slancio, lui pure. Ora sei adiacente e puoi attaccare."*
9. Step finale: *"Mind game: contro un AI prevedibile è facile. Contro un umano è una sfida psicologica. Spesso conviene NON tentare il passaggio."*

---

## T10 — Tutorial completato (free play unlock)

**Concetto chiave**: hai imparato. Vai a giocare.

**Setup**: schermata di completion. No battaglia.

**Steps**:
1. Overlay celebrativo: *"Hai completato i 9 scenari. Ora conosci tutte le meccaniche di hex-tactics."*
2. Riepilogo: lista dei concetti coperti (movimento, slancio, attacco, schivata, parata, ranged, carica, stance, asta).
3. Bottoni:
   - "Battaglia libera" → main menu
   - "Rivedi un tutorial" → torna alla lista scenari
   - "Manuale" → ManualScene

---

## Note implementative (per la Fase B)

### Architettura proposta

- **`TutorialMenuScene`**: lista dei 9 scenari con stato (completato / in_progress / locked). Save state in localStorage.
- **`BattleScene` con flag `tutorialMode: ScenarioId`**: riusa tutta la logica esistente. Quando attiva, applica:
  - Setup state pre-fatto da `data/tutorial.ts` (preset, posizioni, slancio iniziale).
  - **Lock azioni non rilevanti**: per T1 nasconde tutto tranne "Muovi". Per T2 mostra solo slancio + Muovi. Etc.
  - **Overlay step-by-step**: lista di step con `trigger` (al raggiungimento di una condizione, mostra il next overlay).
  - **Obiettivo check**: condizione di successo per scenario.

### Struttura file proposta

```
src/data/tutorial.ts         — definizioni scenari (setup + steps + obiettivi)
src/scenes/TutorialMenuScene.ts
src/ui/TutorialOverlay.ts    — il box hint con freccia + testo + bottone "Avanti"
src/persistence/storage.ts   — aggiunge save di completion stato
```

### Trigger overlay

Ogni step ha un `trigger` (lambda → boolean su state). Quando si verifica, l'overlay corrente si chiude e quello successivo appare. Esempi:
- `trigger: (state) => state.units[playerId].position equals targetHex` (T1)
- `trigger: (state) => state.phase === 'choosing-action' && state.units[playerId].slancio >= 4` (T2)
- `trigger: (state) => state.units[enemyId].hp === 0` (T3)
- `trigger: (state) => state.phase === 'awaiting-carica'` (T7)

### Obiettivo terminale

Ogni scenario ha un `objective` lambda che ritorna `'success' | 'fail' | 'pending'`. Dopo ogni dispatch, viene valutato:
- `success` → mostra overlay finale + sblocca next.
- `fail` → mostra messaggio + offre re-try.
- `pending` → continua.

---

## Tempistica realistica per Fase B (implementazione)

- ManualScene + scrittura testi finali in TS: 4h
- TutorialMenuScene + gating + save state: 2h
- TutorialOverlay UI (freccia + testo + bottone): 2h
- 9 scenari × ~1h ciascuno (setup + steps + tuning): 9h
- Polish, bug fixing, layout responsivo: 3h

**Tot: ~20h** (in 2-3 sessioni di lavoro).

Per ridurre il rischio, propongo di implementare **prima T1, T2, T3** come MVP (~6h), poi review insieme per aggiustare il pattern, poi T4-T9 a ritmo industriale.

# hex-tactics — TODO MVP

> Piano di lavoro **completo da qui a fine MVP**. 9 milestone aggregate, task granulari per ognuna.
> Convenzione: `[ ]` pending, `[~]` in progress, `[x]` done, `[-]` skipped/superseded.
>
> **Regola operativa**: quando si chiude un task → flippare `[ ] → [x]` immediatamente. Quando si scopre un task durante l'implementazione → aggiungerlo nella milestone giusta. Quando una milestone è chiusa → riepilogare risultati nello "Stato avanzamento" in cima.

---

## Stato avanzamento

| Milestone | Stato | Note |
|---|---|---|
| **Pre-M1** Setup decisioni | `[x]` | CLAUDE.md, ARCHITECTURE.md, DECISIONS.md, TODO.md scritti |
| **M1** Scaffolding & Hello hex | `[x]` | Phaser+TS+Vite OK, griglia 12×8 pointy-top renderizzata, hover/click funzionanti, dev server `localhost:5173` |
| **M2** Geometria & mappa | `[x]` | core/hex completo (distance, line, pathfinding, base) + 34 test passati. Mappa 24×18, camera pan/zoom, deploy zone 7-hex blu/rosso visualizzate. QoL: tasto G coordinate, click-deselect |
| **M3** Modello dati & RNG | `[x]` | RNG Mulberry32, dice {variable,fixed}, RollSpec, Equipment/Skill/Unit types, 12 armi/3 scudi/3 armature/skill catalog, GameState. 75 test verdi |
| **M4** Engine tiri & combat math | `[x]` | core/stats (impedimento per pezzo + floor 0, count* skill helpers) e core/combat (compose Attack/Dodge/Parry, resolve Dodge/Parry/NoDef, applyDamageWithArmor). 114 test verdi |
| **M5** Turn loop & Round | `[x]` | events.ts + turn.ts + round.ts + reducer.ts. Pure reducer end-to-end con START_ROUND/START_TURN/MOVE/DECLARE_ATTACK/CHOOSE_*/RESOLVE_COMBAT/END_*. Battaglia 1v1 simulata in test integrazione → game-over. 120 test verdi |
| **M6** Combat in mischia + UI | `[x]` | UnitSprite vettoriale, HUD, ActionMenu, DiceChoiceUI, CombatLog, HandoffOverlay. Flusso completo dichiarazione→dadi→difesa→risoluzione |
| **M7** Movimento | `[x]` | reachableHexes con passable predicate, highlight ciano, click-to-move, costo slancio applicato. Annulla movimento |
| **M8** Combat ranged + LoS | `[x]` | core/ranged.ts: computeLoS dai 7 esagoni con tiebreak min-distance, canFireRanged, composeRangedAttackRoll. Reducer skipa awaiting-defense per ranged (D-032). 127 test verdi |
| **M9+M10** (streamlined) Preset PG + persistenza | `[x]` | 3 preset (Spadaccino/Arciere/Tank) bilanciati su 2000 exp. Persistenza scelte battaglia in localStorage. Char builder full UI rimandato (D-035). |
| **M11** AI heuristic | `[x]` | basicAi.ts: decideAction (mischia→ranged→muovi→passa), decideAttackerDice, decideDefense (HP-aware parry/dodge), decideSlancio. 12 test verdi. Wired in BattleScene con delay 600ms |
| **M12** MainMenu + game flow | `[x]` | MainMenuScene con scelta preset+modalità per fazione A/B, BootScene→MainMenu→Battle. Setup salvato in localStorage. Title screen completo |
| **M13** Polish & playtest | `[~]` | base done: flash hit + numero danni fluttuante, log scrollabile, handoff hot-seat. Ulteriore polish (sprite asset, audio, animazioni movimento) post-MVP |

**TOTALE: 153 test verdi (~280ms exec). MVP shippabile.**

### Post-MVP fasi (in corso)
| Fase | Stato | Note |
|---|---|---|
| **AI Optim** (D-046..D-048 + AI matchup-aware) | `[x]` | 12 GA matchup-specific eseguiti, AI Utility GA-tuned. Q-learning step B insufficiente |
| **Python port** (engine + RL avanzato) | `[~]` | Scaffolding + RNG portato (parità verificata). Vedi `python/TODO.md` per dettaglio P0..P15 |

---

## M1 — Scaffolding & "Hello hex grid" ✅

**Obiettivo**: progetto inizializzato, server di sviluppo funzionante, una griglia esagonale visibile e cliccabile sullo schermo.
**Done quando**: `npm run dev` apre il browser, vedo una griglia esagonale, cliccando su un esagono cambia colore.

- [x] `npm init` + `npm i` Phaser 3, TypeScript, Vite, Vitest, ESLint, Prettier
- [x] `tsconfig.json` strict
- [x] `vite.config.ts` base + path alias (`@/core`, `@/data`, ecc.)
- [x] `vitest.config.ts`
- [x] `.eslintrc.cjs` + `.prettierrc`
- [x] Struttura cartelle come da `ARCHITECTURE.md`
- [x] `index.html` + `src/main.ts` boot Phaser
- [x] `src/scenes/BootScene.ts` (loading minimale)
- [x] `src/scenes/BattleScene.ts` placeholder
- [x] `src/ui/HexBoard.ts` rendering griglia 12×8 esagoni geometrici (forma vettoriale, no asset ancora)
- [x] Highlight hover + click sull'esagono
- [x] `README.md` con istruzioni `npm run dev`
- [x] Smoke test: si apre, si vede la griglia, si clicca

**Note di chiusura M1**:
- Stack: Phaser 3.80.1, TypeScript 5.4, Vite 5.4.21, Vitest 1.4. Node 25.9 testato OK.
- Geometria: pointy-top, axial coords, offset (odd-r) per layout. Codice base in `src/core/hex/coords.ts` (espandibile in M2 con distance, line, A*).
- Hit detection: `pixelToAxial` con `axialRound` (cube-rounding standard), filtro su lista celle valide → hover/click su esagoni della griglia, fuori dalla griglia restituisce null.
- 203 pacchetti npm installati, 4 vulnerabilità moderate (deprecate transitive di eslint 8) — non bloccanti per MVP locale.
- Tempo wall ~30 min dall'OK al rendering verificato (install + scrittura + smoke test).
- `tsc --noEmit` pulito, dev server up in 290ms, tutti i moduli serviti correttamente.

---

## M2 — Geometria esagonale & Mappa ✅

**Obiettivo**: libreria geometria hex completa e testata. Mappa di battaglia con zone deploy a "rosa" da 7 esagoni.
**Done quando**: tutte le funzioni `core/hex/` testate, mappa visibile con due deploy zone.

- [x] `core/hex/coords.ts`: tipi Axial, Cube, conversioni
- [x] `core/hex/coords.ts`: hex→pixel, pixel→hex (per click handling)
- [x] `core/hex/distance.ts`: distanza esagonale (cube)
- [x] `core/hex/line.ts`: raster di esagoni tra A e B (algoritmo standard, per LoS)
- [x] `core/hex/pathfinding.ts`: A* su griglia hex (con costi pluggabili) + `reachableHexes` per highlight movimento
- [x] **Test**: `tests/core/hex.test.ts` — 34 test passati in 4ms
- [x] Definizione "basetta 7-hex" come funzione `getBaseHexes(center)` in `core/hex/base.ts`
- [x] Decisione D-022: **rimandato pack asset** a M5/M6 (geometria vettoriale fino a quando servono unità)
- [x] Decisione D-019: **dimensioni mappa** 24×18, hexSize 32
- [x] Visualizzazione delle 2 deploy zone (basette 7-hex evidenziate, blu/rosso, su lati opposti centrate)
- [-] Decisione D-pending-B: **Immer o no** per immutabilità → spostato a M3 (più sensato decidere lì)

**QoL aggiunti M2**:
- [x] Camera con pan (WASD/frecce + drag tasto destro) e zoom (rotella) — D-021
- [x] Tasto G → toggle etichette coordinate `(q,r)` sugli esagoni
- [x] Click su hex selezionato → deseleziona; click fuori griglia → deseleziona
- [x] HexBoard camera-aware (worldX/worldY)
- [x] Pan speed scala con zoom (più precisione a zoom alto)
- [x] Disabilitato context menu del browser sul canvas (non interrompe il drag-pan)

**Note di chiusura M2**:
- 5 nuovi file in `core/hex/` (coords, distance, line, pathfinding, base) totali ~440 righe
- Test suite Vitest: 34 test, 100% pass, 4ms exec
- TypeScript strict + no warnings, dev server hot reload trasparente
- Decisioni formalizzate: D-019 (mappa), D-020 (geometria), D-021 (camera), D-022 (asset rinviati), D-023 (deploy zones), D-024 (A* naive), D-025 (QoL hex labels + deselect)

---

## M3 — Modello dati & RNG

**Obiettivo**: tipi runtime di tutto il dominio (Unit, Equipment, Skill), RNG seed-able, dati statici (armi/scudi/armature/skill) caricati.
**Done quando**: si può istanziare un `Unit` baseline equipaggiato dalla `data/`, RNG riproducibile.

- [ ] `core/dice.ts`: tipo `Roll = { variable: number[]; fixed: number }`
- [ ] `utils/rng.ts`: RNG seed-able (Mulberry32 o equivalente)
- [ ] `core/dice.ts`: `rollDice(n, rng) → number[]`
- [ ] `entities/Unit.ts`: tipo `Unit` con tutti i campi (HP, F/A/V, impeto, slancio, dadi, equip, skills, fazione, posizione)
- [ ] `entities/Equipment.ts`: tipi `Weapon`, `Shield`, `Armor` con tutte le proprietà tabella
- [ ] `entities/Skill.ts`: tipo skill acquistata (modificatore + specializzazioni)
- [ ] `data/weapons.ts`: tutte le 12 armi della tabella, con notazione `/` mappata correttamente (forza/agilità per spada, 1h/2h per spada lunga e lancia, ecc.)
- [ ] `data/shields.ts`: 3 scudi
- [ ] `data/armors.ts`: 3 armature
- [ ] `data/skills.ts`: 4 modificatori base + 4 liste parole specializzazione
- [ ] `core/state.ts`: tipo `GameState` completo + factory `createInitialState`
- [ ] **Test**: `tests/core/dice.test.ts`, `tests/core/state.test.ts`

---

## M4 — Engine tiri & combat math

**Obiettivo**: tutta la matematica del combat in `core/`, testata. Schivata, parata, danni con RD, impedimento applicato. **Senza UI**.
**Done quando**: data una situazione, le funzioni producono il risultato corretto secondo le regole.

- [ ] `core/combat.ts`: `composeAttackRoll(attacker, weapon, useStat: 'forza'|'agilità', diceN) → Roll`
- [ ] `core/combat.ts`: `resolveDodge(attackRoll, dodgeRoll) → { hit: bool, residual?: number, slancioPenaltyToAttacker: number }`
- [ ] `core/combat.ts`: `resolveParry(attackRoll, parryRoll) → ...`
- [ ] `core/combat.ts`: `applyDamage(target, damage, armor) → newHp` (con RD)
- [ ] `core/stats.ts`: `getImpedimentTotal(unit) → number` (somma equip, applica skill `−1 impedimento` con specializzazioni)
- [ ] Applicazione impedimento ai tiri (sottratto in fissa)
- [ ] Applicazione skill `+1 al tiro`, `+1 dado`, `+1 dado massimo` con matching specializzazioni
- [ ] **Test**: `tests/core/combat.test.ts` con casi documentati nel `CLAUDE.md` (es. spada 2 dadi vs schivata 2 dadi, mazza vs schivata, ecc.)
- [ ] **Test**: edge case slancio negativo → impeto, HP=0 rimozione

---

## M5 — Turn loop & Round

**Obiettivo**: state machine completa di round e turno. Stato avanza correttamente, ordine impeto/slancio rispettato.
**Done quando**: una battaglia simulata "finta" (senza UI, in test) gira N round con N turni e finisce con uno dei due eliminato.

- [ ] `core/turn.ts`: `startTurn(state, unitId) → newState` (recupero dadi, slancio→impeto, tiro slancio)
- [ ] `core/turn.ts`: `endTurn(state) → newState`
- [ ] `core/round.ts`: `computeTurnOrder(units) → unitId[]` (impeto desc, slancio desc, casuale)
- [ ] `core/round.ts`: `endRound(state) → newState`
- [ ] `core/state.ts`: phase machine (`turn-start` → `choosing-action` → ... → `turn-end`)
- [ ] `core/events.ts`: tipi eventi
- [ ] `core/state.ts`: `reduce(state, event) → newState`
- [ ] Stati limite: HP=0 → unit removed; impeto=0 → recupero capped a 1
- [ ] **Test**: `tests/core/turn.test.ts`, `tests/core/round.test.ts`
- [ ] **Test integrazione**: simula una battaglia 1v1 con AI random, verifica termina

---

## M6 — Combat in mischia + UI base

**Obiettivo**: il giocatore può attaccare un'unità avversaria adiacente con un'arma da mischia, scegliere dadi, vedere la difesa, vedere il risultato.
**Done quando**: cliccando un'unità avversaria adiacente posso fare un attacco completo end-to-end.

- [ ] `ui/UnitSprite.ts`: rendering unità con HP/slancio/impeto visibili
- [ ] `ui/HUD.ts`: HUD con dadi disponibili del PG corrente, slancio, impeto, HP
- [ ] `ui/ActionMenu.ts`: menu "Attacco / Difesa / Movimento / Passa turno"
- [ ] `ui/DiceChoiceUI.ts`: scelta dadi (slider/bottoni 1/2)
- [ ] **Decisione D-pending-D**: scelta UX per info nascosta (modale "Premi quando pronto"? Schermata di passaggio?)
- [ ] Flusso: dichiarazione attacco → scelta dadi attaccante (privata) → scelta difesa+dadi difensore (privata) → rivelazione → tiro → risoluzione → log
- [ ] `ui/CombatLog.ts`: log scrollabile (chi attacca chi, risultati tiri, danni)
- [ ] Animazioni minime (flash sull'unità colpita, numero danno fluttuante)
- [ ] Smoke test: una battaglia mischia-only completa giocabile (1v1 hot-seat)

---

## M7 — Movimento

**Obiettivo**: un'unità può muoversi sulla mappa pagando slancio.
**Done quando**: durante il proprio turno il giocatore può cliccare una destinazione e l'unità si muove pagando slancio.

- [ ] Integrazione A* per movimento
- [ ] Highlight esagoni raggiungibili (in base a slancio disponibile + 1 gratis)
- [ ] Click-to-move su esagone valido
- [ ] Costo slancio: 1° esagono gratis, poi 1 slancio per esagono
- [ ] Animazione movimento (interpolazione su path)
- [ ] Aggiornamento posizione in `GameState`
- [ ] Bloccare il movimento se non ci sono abbastanza punti slancio
- [ ] Permettere ordine libero "muovi poi attacca" o "attacca poi muovi"
- [ ] **Test**: `tests/core/movement.test.ts` (range raggiungibile, costo)

---

## M8 — Combat ranged + LoS

**Obiettivo**: armi a distanza funzionanti con calcolo LoS dai 7 esagoni della basetta.
**Done quando**: con un arco/balestra posso colpire un'unità a distanza, vedendo correttamente visibilità e malus.

- [ ] `core/ranged.ts`: `computeLoS(attackerUnit, targetUnit, board) → { visibility: number, fromHex: HexCoord }`
  - Itera i 7 esagoni della basetta attaccante
  - Per ognuno, conta quanti centri target sono visibili (line raster, blocco da altre unità)
  - Sceglie l'esagono con LoS migliore (parità → primo trovato, o scelta giocatore in UI)
- [ ] `core/ranged.ts`: `composeRangedAttackRoll(attacker, weapon, target, los, distance) → Roll`
  - Formula: `dadi PG + dadi arma + bonus_arma + visibilità − ⌊distanza/N_arma⌋ − slancio_target − impedimento`
- [ ] Cap range massimo: `Distanza` arma in esagoni → oltre, niente attacco
- [ ] Gestione "Lancio" per armi mischia lanciabili (alternativa a CaC)
- [ ] Gestione "Ricarica" (es. Balestra 7 turni)
- [ ] UI: target highlight con info (visibilità X/7, distanza Y, malus calcolato)
- [ ] **Test**: `tests/core/ranged.test.ts` con scenari (target dietro a unità, target a max range, ecc.)

---

## M9 — Equipaggiamento & Impedimento (UI)

**Obiettivo**: il giocatore può equipaggiare/cambiare equipaggiamento. Impedimento totale visibile e applicato.
**Done quando**: nella character builder o pre-battaglia posso scegliere armi/scudi/armature e l'impedimento è applicato.

- [ ] `ui/EquipmentPanel.ts`: lista equip disponibili, drag/drop o lista cliccabile
- [ ] Validazione: max 1 arma principale, 1 scudo o 2a arma, 1 armatura
- [ ] Calcolo impedimento totale visualizzato in tempo reale
- [ ] Effetto impedimento applicato a tutti i tiri (già in `core/`, qui solo wiring UI)
- [ ] Visualizzazione "ATK: ... DIF: ... IMP: ..." per equip selezionato
- [ ] Save dell'equipaggiamento in `localStorage` con il PG

---

## M10 — Skill tree & Character builder

**Obiettivo**: schermata completa di creazione PG con acquisto skill ed exp.
**Done quando**: posso creare un PG da zero, spendere exp in skill con specializzazioni, salvarlo, ricaricarlo.

- [ ] `scenes/CharBuilderScene.ts`
- [ ] UI: nome, fazione, allocazione F/A/V (baseline 2/2/2 modificabile? — verifica con Valerio se è fisso)
- [ ] UI: pool exp configurabile (default 2000 come riferimento)
- [ ] UI: lista skill acquistabili con costi
- [ ] UI: per ogni skill, picker delle specializzazioni (max 1 per lista, 4 liste)
- [ ] UI: lista skill già acquistate, exp speso, exp residuo
- [ ] Validazione: floor impedimento 0 dopo `−1 impedimento` per pezzo
- [ ] `persistence/storage.ts`: save/load PG da `localStorage`
- [ ] Lista PG salvati nel main menu (selezione battle PG)
- [ ] **Test**: `tests/core/skills.test.ts` (applicazione skill ai tiri con/senza specializzazioni)

---

## M11 — AI heuristic

**Obiettivo**: avversario AI giocabile. Single-player vs CPU funzionante.
**Done quando**: posso giocare contro l'AI fino alla fine di una partita.

- [ ] `ai/basicAi.ts`: funzione `decide(state, myUnitId) → GameEvent`
- [ ] Decision tree:
  - Se HP basso e ho parata buona → posizione difensiva
  - Se nemico in range CaC → attacca con scelta dadi euristica
  - Se nemico in range ranged e ho arma ranged → spara
  - Altrimenti → muovi verso nemico più vicino
- [ ] Scelta difesa AI: parà se ha arma idonea e attacco temibile, schiva altrimenti, niente difesa se dadi a 0
- [ ] Scelta dadi attaccante: euristica HP-aware (più dadi se può finire il bersaglio)
- [ ] **Test**: `tests/ai/basicAi.test.ts` (scenari deterministici con seed)

---

## M12 — Hot-seat & game flow completo

**Obiettivo**: passaggio fluido tra giocatori in hot-seat. Schermate menu / vittoria. Modalità AI vs umano e umano vs umano selezionabili.
**Done quando**: dal menu posso scegliere "vs AI" o "hot-seat", giocare, vedere schermata vittoria, tornare al menu.

- [ ] `scenes/MainMenuScene.ts`: "Nuova partita" / "Carica PG" / "Costruisci PG"
- [ ] Selezione modalità: vs AI / hot-seat
- [ ] Selezione PG (entrambi i lati)
- [ ] Schermata "Passa al giocatore X" tra turni in hot-seat (per nascondere info)
- [ ] `scenes/GameOverScene.ts`: vittoria/sconfitta + "Rigioca" / "Menu"
- [ ] Game state reset corretto a ogni nuova partita
- [ ] Polish flusso: nessun softlock, transizioni fluide

---

## M13 — Polish & playtest

**Obiettivo**: bug fix, tuning numeri, miglioramenti minori UX. MVP shippabile.
**Done quando**: Valerio gioca 5+ partite senza incontrare bug bloccanti, le meccaniche "girano" correttamente.

- [ ] Playtest sessione 1 — annotare bug
- [ ] Bug fix wave 1
- [ ] Tuning numeri arma `N_arma` (post-playtest)
- [ ] Tuning costi exp se serve
- [ ] Migliorie UI/UX minori
- [ ] Playtest sessione 2 — verifica
- [ ] Documentare nel `README.md` come giocare
- [ ] **MVP CHIUSO**

---

## Backlog (post-MVP, da pianificare dopo)

- Multiplayer online (server Node + Socket.io, deploy Fly.io)
- Più mappe, terreno con copertura/ostacoli
- Audio (BGM + SFX)
- Storia / campagna
- Salvataggio partite in corso
- Più archetipi di abilità (oltre i 4 base)
- Packaging desktop (Tauri)
- Repository GitHub pubblico
- Modalità 2v2, 3v3, 4v4
- Bilanciamento approfondito post-feedback

---

## Come usare questo file

- A **inizio sessione**: leggere `CLAUDE.md`, `DECISIONS.md`, **questo file** (`TODO.md`) — capire dov'è il punto
- **Durante** il lavoro: aggiornare `[ ] → [~] → [x]` task per task
- A **fine sessione / fine milestone**: aggiornare la tabella "Stato avanzamento", aggiungere note rilevanti
- Quando emerge nuovo lavoro non previsto: aggiungere il task nella milestone giusta (mai sopprimere lavoro fatto)

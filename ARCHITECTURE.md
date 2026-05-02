# hex-tactics — Architettura

> Documento di architettura tecnica. Per le **regole di gioco** vedi `CLAUDE.md`. Per le **decisioni** vedi `DECISIONS.md`. Per il **piano di lavoro** vedi `TODO.md`.

---

## Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Engine grafico | **Phaser 3** | 2D scene/sprite/input |
| Linguaggio | **TypeScript** | strict mode, no `any` salvo casi giustificati |
| Build / dev server | **Vite** | hot reload, build prod ottimizzato |
| Test runner | **Vitest** | unit test sul `core/` (logica pura, no Phaser) |
| Linter | **ESLint** + **Prettier** | config standard tipescript-eslint |
| Persistenza | **localStorage** | character builder save/load |
| Asset | **CC0** (Kenney.nl o equivalenti) | tile esagonali pixel art + UI base |
| Runtime | Browser locale (`npm run dev` → `http://localhost:5173`) | no server in MVP |

**Node**: 18+ (per Vite 5 / TypeScript 5).

---

## Principio cardine: separazione `core/` vs Phaser

Il codice è diviso in **due metà rigorosamente separate**:

### `src/core/` — logica pura

- **Zero dipendenze da Phaser**
- Solo TypeScript puro
- Tutto testabile con Vitest senza browser
- Contiene: geometria esagonale, dadi, combat math, turn loop, state machine, AI

### `src/scenes/` + `src/ui/` — rendering & input

- Dipende da Phaser
- Si limita a: rendering dello stato, cattura input, dispatch di intenti al `core/`
- **Nessuna logica di gioco qui** — solo "leggi lo stato e disegnalo", "leggi l'input e crea un evento"

### Razionale

1. **Testabilità**: la matematica del combat è il cuore — deve avere copertura test alta. Vitest puro non ha bisogno di emulare un browser.
2. **Multiplayer-ready**: quando aggiungeremo il server Node (post-MVP), lo stesso `core/` viene riutilizzato lato server come **sorgente di verità autoritativa**. Niente refactor, niente "ma la logica è dentro il render".
3. **Sostituibilità**: se un domani Phaser non basta più (es. passaggio a Babylon o canvas raw), si sostituisce solo lo strato grafico.

---

## Struttura cartelle

```
hex-tactics/
├── public/
│   └── assets/
│       ├── sprites/                # tile, unit, decorazioni
│       ├── ui/                     # icone, frame, hud
│       └── fonts/
│
├── src/
│   ├── main.ts                     # entrypoint Phaser (boot config)
│   ├── config.ts                   # config game (dimensioni, costanti tuning)
│   │
│   ├── core/                       # ----- LOGICA PURA, NO PHASER -----
│   │   ├── hex/
│   │   │   ├── coords.ts           # Axial / Cube coords
│   │   │   ├── distance.ts         # distanza esagonale
│   │   │   ├── line.ts             # raster di esagoni tra A e B (per LoS)
│   │   │   └── pathfinding.ts      # A* su griglia hex
│   │   ├── dice.ts                 # tipo Roll = {variable: int[], fixed: int}
│   │   ├── combat.ts               # composizione attacchi/difese, danni
│   │   ├── ranged.ts               # LoS dai 7 esagoni, calcolo tiro a distanza
│   │   ├── turn.ts                 # sequenza turno (recovery, slancio→impeto, ...)
│   │   ├── round.ts                # ordine impeto/slancio, end-of-round
│   │   ├── state.ts                # GameState type + reducer principale
│   │   ├── events.ts               # tipi evento (ATTACK, MOVE, DEFEND, …)
│   │   └── stats.ts                # calcolo stat derivate (impedimento, dadi recupero)
│   │
│   ├── data/                       # dati statici (read-only)
│   │   ├── weapons.ts              # da TAB_armi.docx
│   │   ├── shields.ts
│   │   ├── armors.ts
│   │   └── skills.ts               # def skill base + costi exp + parole spec.
│   │
│   ├── entities/                   # tipi runtime
│   │   ├── Unit.ts                 # PG: hp, F/A/V, impeto, slancio, dadi, equip, skills
│   │   ├── Equipment.ts            # weapon, shield, armor
│   │   └── Skill.ts                # skill acquistata + specializzazioni
│   │
│   ├── ai/
│   │   └── basicAi.ts              # heuristic decision tree
│   │
│   ├── scenes/                     # ----- PHASER -----
│   │   ├── BootScene.ts            # caricamento asset
│   │   ├── MainMenuScene.ts        # menu iniziale
│   │   ├── CharBuilderScene.ts     # builder PG con skill tree
│   │   ├── BattleScene.ts          # battaglia (la scena principale)
│   │   └── GameOverScene.ts        # vittoria/sconfitta
│   │
│   ├── ui/                         # componenti UI Phaser-based
│   │   ├── HexBoard.ts             # rendering griglia + highlight
│   │   ├── UnitSprite.ts           # sprite + animazioni unità
│   │   ├── HUD.ts                  # HP/slancio/impeto/dadi visibili
│   │   ├── ActionMenu.ts           # menu azioni del turno
│   │   ├── DiceChoiceUI.ts         # scelta dadi (info nascosta)
│   │   └── CombatLog.ts            # log scrollabile eventi
│   │
│   ├── persistence/
│   │   └── storage.ts              # save/load PG da localStorage
│   │
│   └── utils/
│       ├── rng.ts                  # wrapper random (testabile, seed-able)
│       └── types.ts                # type helpers
│
├── tests/                          # vitest
│   ├── core/
│   │   ├── hex.test.ts
│   │   ├── dice.test.ts
│   │   ├── combat.test.ts
│   │   ├── ranged.test.ts
│   │   ├── turn.test.ts
│   │   └── round.test.ts
│   └── ai/
│       └── basicAi.test.ts
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

---

## Pattern di stato: `GameState` + reducer

### Modello dati

```typescript
type GameState = {
  round: number
  turnOrder: UnitId[]          // calcolato a inizio round
  currentTurnIdx: number
  units: Record<UnitId, Unit>
  board: { width: number; height: number }
  phase: 'turn-start' | 'choosing-action' | 'declaring-attack'
       | 'awaiting-defense' | 'resolving' | 'turn-end' | 'round-end' | 'game-over'
  pendingAction?: PendingAction  // dati per la fase corrente
  log: LogEntry[]
}
```

### Reducer

```typescript
function reduce(state: GameState, event: GameEvent): GameState
```

- **Pure function**: stesso input → stesso output, no side effects
- Tutti i cambi di stato passano da qui
- Nessuna scena Phaser modifica direttamente lo stato — solo dispatch eventi

### Eventi tipici

```
DECLARE_ATTACK { attackerId, targetId, weaponId }
CHOOSE_ATTACK_DICE { n }
CHOOSE_DEFENSE { type: 'parry' | 'dodge' | 'none', diceN }
RESOLVE_COMBAT
MOVE_UNIT { unitId, targetHex }
ROLL_INITIATIVE { unitId, n }
END_TURN
END_ROUND
```

### Razionale

- **Replay/undo gratis**: in caso di bug, log degli eventi → si ricostruisce
- **Multiplayer-ready**: il server (futuro) riceve eventi da client, li valida, li applica con stesso reducer, broadcast del nuovo stato
- **AI**: la basicAi è una funzione pura `(state) → event` — facile testare

---

## Flusso di una battaglia (sequenza tipica)

```
[BootScene] preload asset
   ↓
[MainMenuScene] "Nuova partita" / "Carica PG"
   ↓
[CharBuilderScene] (se nuovo) costruisci PG → save su localStorage
   ↓
[BattleScene]
   inizializza GameState (units, board, deploy 7-hex)
   loop:
     calcola turnOrder (impeto desc, slancio desc)
     per ogni unità nel turnOrder:
       if alive:
         turn-start: recupero dadi, slancio→impeto, tiro slancio
         choosing-action: input giocatore (o AI)
         se ATTACK:
           declaring-attack: scelta dadi attaccante (privata)
           awaiting-defense: scelta tipo difesa + dadi difensore (privata)
           resolving: rivela, tira, applica danni
         se MOVE: applica costo slancio, aggiorna posizione
         turn-end: cleanup
     round-end: incrementa round, reset stato di round
     check vittoria → GameOverScene
   ↓
[GameOverScene] vittoria/sconfitta + return al menu
```

---

## Test strategy

### Unit (Vitest, su `core/`)

Coverage target MVP: **>80% del `core/`**.

- `hex.test.ts`: distanza, conversioni axial↔cube↔pixel, A*, line raster
- `dice.test.ts`: tiri variabile/fissa separati, RNG seed-able
- `combat.test.ts`: composizione attacco con arma, schivata, parata, danni con RD
- `ranged.test.ts`: LoS dai 7 esagoni, malus distanza, esagono usato
- `turn.test.ts`: recupero dadi, slancio→impeto, slancio negativo→impeto
- `round.test.ts`: ordering corretto, end-of-round
- `basicAi.test.ts`: scelte sensate in scenari tipo

### Smoke E2E (manuale, browser)

- Battaglia completa giocabile
- Character builder funzionante
- Save/load PG

### NO test su Phaser layer
Non ne vale il costo per un MVP. Si valida visualmente.

---

## Convenzioni di codice

- **TypeScript strict**: `strict: true`, `noImplicitAny`, `strictNullChecks`
- **Naming**: camelCase per variabili/funzioni, PascalCase per tipi/classi, SCREAMING_SNAKE per costanti
- **File**: un export principale per file (eccetto `data/` e `utils/`)
- **Immutabilità nel `core/`**: niente mutazioni dirette di `GameState` — sempre nuovo oggetto
- **Random**: tutte le chiamate random passano da `utils/rng.ts` con seed → test deterministici

---

## Linee guida architetturali (lookahead)

Cose che teniamo a mente **fin dall'inizio** anche se non implementate subito:

1. **Multiplayer**: `core/` è già il "server brain" del futuro. Mai metterci codice browser-specific.
2. **Networking layer**: quando ci sarà, sarà solo: client → invia evento → server (chiama reducer) → broadcast nuovo stato. Niente da rifare nel `core/`.
3. **Spectator mode**: lo stato è derivabile interamente, quindi un terzo client può essere observer "gratis".
4. **Replay**: log eventi salvabile → riproducibilità.
5. **Modding/balancing**: tutti i numeri (costi exp, bonus armi, formule di malus) vivono in `data/` o `config.ts`. Mai hardcoded nelle funzioni.

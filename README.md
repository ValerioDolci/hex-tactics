# hex-tactics

Tactical 1v1 RPG su griglia esagonale — TypeScript + Phaser 3 + AI distillata da Deep CFR equilibrium.

🎮 **Gioca subito**: <https://valeriodolci.github.io/hex-tactics-play/>

> Documentazione completa: [`CLAUDE.md`](./CLAUDE.md) (regole + stato), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`DECISIONS.md`](./DECISIONS.md), [`TODO.md`](./TODO.md).

## Requisiti

- Node 18+ (testato su 25.9)
- npm

## Avvio

```bash
npm install        # solo la prima volta
npm run dev        # avvia dev server su http://localhost:5173
```

Apri `http://localhost:5173` nel browser.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | dev server con hot reload |
| `npm run build` | build production in `dist/` |
| `npm run preview` | preview del build production |
| `npm test` | test unit (Vitest) |
| `npm run test:watch` | test in watch mode |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Come si gioca

1. **Main menu**: scegli per ogni fazione (A blu sx, B rosso dx) un preset (Spadaccino / Arciere / Tank) e la modalità (Umano / AI). Per le fazioni AI è disponibile la difficoltà:
   - **Facile** — heuristic basicAi
   - **★ Difficile (Deep CFR)** — MLP small distillato dal Deep CFR multi-matchup (197K params, sync, pesi inline base64; ~70% top-1 match con teacher equilibrium). Disponibile anche in build singlefile/mobile.
   - **★★ Expert (Deep CFR full)** — modello Deep CFR full (1.4M params, ONNX 3.5 MB caricato async via `onnxruntime-web` + WASM). Disponibile solo in build multi-file (desktop/dev): non bundlato in singlefile per evitare 25 MB di WASM inline.
   Click "Inizia battaglia".
2. **Battaglia**: a ogni turno, un'unità di una fazione si muove e/o agisce.
3. **Comandi**:
   - Click esagono → seleziona
   - WASD/frecce → pan camera
   - Rotella mouse → zoom
   - Tasto destro + drag → pan camera
   - Tasto **G** → toggle etichette coordinate
   - Tasto **Spazio** → passa turno (se in choosing-action)
4. **Flusso turno**:
   - Schermata "Sono pronto" (hot-seat: nasconde info al giocatore precedente)
   - Scelta dadi slancio (0..2)
   - Menu azioni: attacca / muovi / passa turno
   - Per attacchi: scelta dadi attaccante (privata) → handoff → scelta difensore (privata) → risoluzione

## Stato MVP — feature

✅ Mappa esagonale 24×18 pointy-top, camera pan/zoom
✅ Deploy zone 7-hex visibili
✅ Movimento con highlight raggiungibili e costo slancio (1° gratis)
✅ Combat mischia con schivata e parata attiva (info nascosta hot-seat)
✅ Combat ranged con LoS dai 7 esagoni della basetta
✅ 12 armi, 3 scudi, 3 armature dalla `TAB_armi.docx`
✅ Skill system: 4 modificatori × 4 liste specializzazioni
✅ 3 preset PG bilanciati su 2000 exp
✅ AI heuristic (single-player vs CPU)
✅ AI Expert: Deep CFR distilled (24 matchup, avg gap 7.8 wr% vs teacher equilibrium)
✅ Hot-seat (PvP locale stesso device)
✅ Persistenza setup in localStorage

## Stato MVP — non incluso (post-MVP)

⏸ Character builder UI completo (i preset coprono le 3 tipologie principali)
⏸ Asset sprite reali (rendering vettoriale per ora)
⏸ Audio (BGM + SFX)
⏸ Storia / campagna
⏸ Multiplayer online (architettura predisposta — vedi `ARCHITECTURE.md`)

## Test

```bash
npm test
```

**Stato attuale: 139 test passati in ~200ms.**

Coverage del `src/core/`:
- `hex/` (coords, distance, line, pathfinding, base) — 34 test
- `dice` (RNG seed-able, Roll arithmetic) — 16 test
- `stats` (impedimento per pezzo + skill modifiers) — 16 test
- `combat` (compose Attack/Dodge/Parry, resolve, danni) — 23 test
- `ranged` (LoS, canFire, composeRangedAttackRoll) — 7 test
- `state` (factory, updateUnit, appendLog) — 5 test
- `reducer` (turn flow, combat flow, game over) — 6 test
- `data` (12 armi/3 scudi/3 armature) — 20 test
- `ai` (basicAi: action/dice/defense/slancio) — 12 test

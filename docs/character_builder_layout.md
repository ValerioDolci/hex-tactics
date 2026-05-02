# Character Builder — Layout & Flow UX

> Design della scena `CharacterBuilderScene` e dell'integrazione con `MainMenuScene` / `BattleScene`.
> Pattern: tre sezioni verticali (Equip / Skills / Summary) + sub-panel modali per scelte complesse.

---

## Goal

Permettere al giocatore di costruire un personaggio custom da zero, scegliendo:
1. Equipaggiamento: arma principale + offhand + armatura
2. Skill: i 4 modificatori con specializzazioni opzionali, costi cumulativi, max 2000 exp
3. Salvare la build con un nome, riusarla per battaglie successive

---

## Layout schematico

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Indietro       Crea personaggio                            [📁 Carica build]│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ EQUIPAGGIAMENTO ─────────────────┐  ┌─ RIEPILOGO ────────────────────┐  │
│  │ Arma principale: [Spada lunga 2h ▼]│  │ HP: 20                         │  │
│  │   ATK: 1d6+6 (con forza)           │  │ F/A/V: 2/2/2                   │  │
│  │   IMP: 6                            │  │ Impeto base: 14                │  │
│  │                                     │  │ Impedimento totale: 9          │  │
│  │ Offhand:        [niente          ▼] │  │   (con skills: 3)              │  │
│  │                                     │  │                                 │  │
│  │ Armatura:       [Armatura media  ▼] │  │ Exp spesa: 1850 / 2000         │  │
│  │   RD: 6                             │  │ ████████████████████░░  92%   │  │
│  │   IMP: 6                            │  │                                 │  │
│  └────────────────────────────────────┘  │ ✓ Build valida                 │  │
│                                            └────────────────────────────────┘  │
│                                                                              │
│  ┌─ SKILL ACQUISTATE ──────────────────────────────────────────────────────┐ │
│  │ • -3imp [armature] (350 exp)                              [×]            │ │
│  │ • -3imp generico (700 exp)                                [×]            │ │
│  │ • +2 al tiro [attaccare][spade] (300 exp)                 [×]            │ │
│  │ • +1 dadomax [slancio][agilità] (300 exp)                 [×]            │ │
│  │                                                                          │ │
│  │                                              [+ Aggiungi skill]          │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Nome build: [______________]            [💾 Salva]   [🎮 Usa per battaglia]│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Sezione 1 — Equipaggiamento

Tre dropdown (o bottoni con popup), uno per slot:

### Arma principale
Lista delle 12 armi (`spada`, `spada_lunga`, `lancia_2m`, ecc.). Quando l'utente seleziona, sotto il dropdown si mostra:
- ATK del modo principale
- DIF/parry
- Impedimento (raw, prima delle skill)
- Note speciali (reach, lancio, ecc.)

### Offhand
- "Mano vuota" (nessuno)
- 12 armi (per dual-wield / parata seconda arma)
- 3 scudi

Selezione = vincoli automatici (es. arma 2h main → offhand greyed out + tooltip "Arma a 2 mani: nessun offhand").

### Armatura
- "Nessuna" + 3 armature (leggera/media/pesante)

Sotto: RD + Impedimento + note (es. "tweak D3" sulla pesante).

---

## Sezione 2 — Skill acquistate

Lista verticale delle skill correntemente nella build. Per ognuna:
- Descrizione testuale (es. `-3 impedimento [armature]`)
- Costo (in exp, calcolato live)
- Bottone "rimuovi" (×)

In fondo: bottone `[+ Aggiungi skill]` che apre il **sub-panel di acquisto skill**.

### Sub-panel: Aggiungi skill

Modale centrato sopra il builder. 3 step inline:

```
┌─ Aggiungi skill ────────────────────────────────────────────┐
│                                                              │
│ 1. Modificatore                                              │
│   ◉ -1 impedimento  (100 exp/lv1)                            │
│   ○ +1 al tiro       (600 exp/lv1)                           │
│   ○ +1 dado          (3600 exp/lv1)                          │
│   ○ +1 dado massimo  (1200 exp/lv1)                          │
│                                                              │
│ 2. Livello                                                   │
│   [1] [2] [3] [4] [5] [6]                                    │
│                                                              │
│ 3. Specializzazioni (max 1 per lista — dimezza il costo)     │
│   Abilità:      [nessuna ▼]                                  │
│   Azione:       [nessuna ▼]                                  │
│   Classe ogg.:  [armature ▼]                                 │
│   Oggetto sp.:  [nessuno ▼]                                  │
│                                                              │
│ Costo calcolato: 350 exp                                     │
│                                                              │
│                              [Annulla]  [Conferma]           │
└──────────────────────────────────────────────────────────────┘
```

**Note di design**:
- Default modifier: `-1 impedimento` (è la più frequente).
- Livelli da 1 a 6 (cap pratico: lv6 di -1imp costa 6300 exp ⇒ già più del budget).
- Lista classe oggetto: derivata dinamicamente dagli `EquipCategory` (`spade`, `scudi`, `armature`, `lance`, `asce`, `archi`, `balestre`, `pugnali`, `mazze`, `giavellotti`).
- Lista oggetto specifico: derivata dai 12 ID arma + 3 scudi + 3 armature.
- Costo aggiornato in real-time al cambio di livello/spec.
- Validazione: la skill non deve duplicare una già presente (usiamo `skillKey`).

---

## Sezione 3 — Riepilogo

Pannello a destra (sticky, sempre visibile). Mostra:
- HP, F/A/V (statici, baseline 20 / 2/2/2)
- Impeto base (14)
- Impedimento totale: `raw` + `(con skills: ridotto)`
- Exp spesa: `X / 2000` con barra colorata
  - Verde sotto 80%
  - Arancione 80-100%
  - Rosso oltre 100% (build invalida)
- Stato build:
  - ✓ Valida (costo OK, niente duplicati)
  - ✗ Invalida (con dettaglio errori)

---

## Bottoni footer

- **Nome build**: input text. Default placeholder `"Custom #1"`.
- **💾 Salva**: salva la build corrente in localStorage. Se nome esiste, chiede conferma sovrascrittura.
- **🎮 Usa per battaglia**: torna a MainMenuScene preselezionando questa build per la fazione corrente.
- **📁 Carica build** (header): apre un dialog con la lista delle build salvate. Click su una → carica.
- **← Indietro**: torna a MainMenuScene scartando le modifiche (con conferma se non salvato).

---

## Storage

```ts
// src/data/builds.ts
export interface CharacterBuild {
  id: string;       // generated UUID-like
  name: string;     // user-provided
  weaponId: string;
  offhandId?: string;  // undefined = mano vuota
  armorId?: string;    // undefined = nessuna armatura
  skills: AcquiredSkill[];
}
```

Storage key: `hexTactics.customBuilds` → array di `CharacterBuild`.

---

## Integrazione MainMenuScene

Modifico la sezione preset:

```
Fazione A:
  Preset:
    [Spadaccino] [Arciere] [Tank] [+ Build custom...]
  └── (se è selezionata una build custom)
      [Custom #1: Spada lunga + arm.media + 4 skill] [Modifica] [×]
```

Click su "Build custom..." → apre dialog di scelta:
- Nuova build → vai a `CharacterBuilderScene`
- Carica esistente → mostra lista, click → seleziona

Se selezionata una build custom invece di un preset, il `BattleSetup` salva `customBuildA: build` (o B). `BattleScene.setupGameState` controlla:
1. Se `customBuildA` presente → usa `unitFromBuild(...)`
2. Altrimenti → `unitFromPreset(presetA, ...)`

Aggiungo helper `unitFromBuild(build, faction, position) → Unit`.

---

## Cambiamenti BattleSetup

```ts
// Prima:
interface BattleSetup {
  presetA: string;
  presetB: string;
  modeA: 'human' | 'ai';
  modeB: 'human' | 'ai';
}

// Dopo:
interface BattleSetup {
  presetA: string;
  presetB: string;
  modeA: 'human' | 'ai';
  modeB: 'human' | 'ai';
  customBuildA?: CharacterBuild;  // se presente, ignora presetA
  customBuildB?: CharacterBuild;
}
```

---

## Validazione build

Una build è valida se:
1. `weaponId` esiste in `WEAPONS` (obbligatoria)
2. `offhandId`, se presente, esiste in `WEAPONS` o `SHIELDS`. Se main weapon è 2h, offhand deve essere `undefined`.
3. `armorId`, se presente, esiste in `ARMORS`.
4. Skill set valido (`validateSkillSet`).
5. Costo totale skill ≤ 2000 exp.
6. Niente skill duplicate (stessa `skillKey`).

Validazione mostrata live nel pannello Riepilogo.

---

## Flow del giocatore

1. Click "Crea personaggio" da MainMenu.
2. Builder si apre con setup di default (es. spada nuda + armatura leggera + 0 skill = ~0 exp).
3. Sceglie equip → vede stat aggiornate live.
4. Aggiunge skill una alla volta tramite sub-panel.
5. Tiene d'occhio la barra exp.
6. Inserisce un nome.
7. Clicca "Salva" → build persistita in localStorage.
8. Clicca "Usa per battaglia" → torna a MainMenu con la build pre-selezionata per la fazione corrente.

---

## Limiti accettati per l'MVP

- **Una sola build attiva per fazione**: niente multi-character/squadre.
- **Specializzazioni: dropdown statici**: il giocatore deve sapere cosa scegliere. In futuro: tooltip esplicativi.
- **Validazione live**: solo costo + duplicati. Validazioni semantiche (es. "skill su arma che non hai") sono solo warning, non blockanti.
- **Niente preview "vs preset"**: il giocatore non vede una stima del power-level. In futuro: simulatore di battaglia rapido.
- **Layout responsivo**: per ora target 1280×720 desktop. Mobile/tablet → polish post-MVP.

---

## Prossimi step (Fase B)

1. `src/data/builds.ts`: tipo + storage helpers + `unitFromBuild()`
2. `src/scenes/CharacterBuilderScene.ts`: scena UI principale + sub-panel skill
3. Modifica `src/scenes/MainMenuScene.ts`: bottone "Build custom" + visualizzazione build attiva
4. Modifica `src/scenes/BattleScene.ts`: usa `unitFromBuild` se `customBuildA/B` presente
5. Modifica `src/persistence/storage.ts`: extend `BattleSetup` con `customBuildA/B`
6. Register `CharacterBuilderScene` in `main.ts`

/**
 * Definizioni dei 9 scenari del tutorial interattivo.
 *
 * Ogni scenario è un mini-battaglia con setup pre-fatto + sequenza di "step"
 * (overlay didattici) con trigger condizionali.
 *
 * Il tutorial è guidato, NON aperto: il giocatore segue gli step in ordine.
 * Il `BattleScene` con `tutorialMode: scenarioId` legge questo file e:
 *  - applica il setup state iniziale
 *  - mostra il primo overlay
 *  - su ogni dispatch di evento, valuta il trigger del prossimo step
 *    e avanza l'overlay se la condizione è verificata
 *  - alla fine valuta `objective(state)` per success/fail.
 */

import type { GameState } from '@core/state';

export interface TutorialStep {
  /** ID interno (debug) */
  id: string;
  /** Testo visualizzato nell'overlay */
  text: string;
  /**
   * Coordinata UI a cui puntare la freccia (opzionale).
   * Se 'action-menu': punta al menu in alto-destra
   * Se 'dice-ui': punta al box DiceChoiceUI al centro
   * Se {x, y}: coord assoluta in canvas
   */
  arrow?: 'action-menu' | 'dice-ui' | 'self-unit' | 'enemy-unit' | { x: number; y: number };
  /**
   * Condizione che fa avanzare allo step successivo.
   * Se non specificata, lo step avanza al click su "Avanti".
   */
  trigger?: (state: GameState) => boolean;
  /**
   * Se true, lo step richiede SOLO il click su "Avanti" (no condizioni).
   * Default: false (cioè aspetta trigger).
   */
  manualAdvance?: boolean;
}

export interface TutorialScenario {
  id: string;
  title: string;
  shortDescription: string;
  /**
   * Patch dello state iniziale dopo che BattleScene ha creato lo state base.
   * Questa funzione viene chiamata DOPO `createInitialState` per applicare
   * forzature (slancio iniziale, posizioni custom, equip override).
   */
  applySetup: (state: GameState) => void;
  /**
   * Preset PG da usare per A e B (es. 'spadaccino', 'tank').
   * Posizioni standard (left/right) le applica BattleScene.
   */
  presetA: string;
  presetB: string;
  modeA: 'human' | 'ai';
  modeB: 'human' | 'ai';
  steps: TutorialStep[];
  /**
   * Obiettivo terminale.
   * Ritorna 'success' / 'fail' / 'pending'.
   */
  objective: (state: GameState) => 'success' | 'fail' | 'pending';
}

// Helpers per riconoscere unità in state senza hardcoding ID (formato: "{faction}-{presetId}")
function findFactionUnit(state: GameState, faction: 'A' | 'B'): string | null {
  for (const u of Object.values(state.units)) {
    if (u.faction === faction) return u.id;
  }
  return null;
}

// =====================================================================
// T1 — Muoviti
// =====================================================================
const T1: TutorialScenario = {
  id: 't1-muoviti',
  title: 'T1 — Muoviti',
  shortDescription: 'Impara a muoverti sulla griglia.',
  presetA: 'spadaccino',
  presetB: 'spadaccino',
  modeA: 'human',
  modeB: 'human',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    a.slancio = 6;
    a.dadiAzione = 9;
    // B è "obiettivo statico": lo posizioniamo a 4 hex davanti ad A.
    // A è in (col 2 → axial q=-2, r=9). Mettiamo B a (col 6 → q=2, r=9).
    b.position = { q: 2, r: 9 };
    b.alive = true;
    b.hp = 1; // KO con un colpo se attaccato (per scenari futuri)
    b.slancio = 0;
    b.dadiAzione = 0;
    b.actionTakenThisTurn = true; // così non agisce
  },
  steps: [
    {
      id: 'welcome',
      text: 'Benvenuto in hex-tactics! Il tuo eroe è quello blu. C\'è un nemico a 4 esagoni: raggiungilo.',
      manualAdvance: true,
    },
    {
      id: 'click-move-hex',
      text: 'Clicca su "Muovi" nel menu a destra, poi clicca su un esagono adiacente al nemico (gli esagoni gialli sono dove puoi arrivare).',
      arrow: 'action-menu',
      // Trigger automatico: si avanza quando A si è effettivamente avvicinato al nemico
      trigger: (s) => {
        const aId = findFactionUnit(s, 'A');
        const bId = findFactionUnit(s, 'B');
        if (!aId || !bId) return false;
        const a = s.units[aId];
        const b = s.units[bId];
        const dq = a.position.q - b.position.q;
        const dr = a.position.r - b.position.r;
        const distance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
        return distance <= 2;
      },
    },
    {
      id: 'success-msg',
      text: 'Ottimo! Hai mosso. Lo slancio si riduce di 1 per ogni esagono dopo il primo (che è gratis).',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return 'pending';
    const a = state.units[aId];
    const b = state.units[bId];
    // Successo: A è entro 1 hex (mischia) di B
    const dq = a.position.q - b.position.q;
    const dr = a.position.r - b.position.r;
    const distance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
    if (distance <= 1) return 'success';
    return 'pending';
  },
};

// =====================================================================
// T2 — Slancio: scegli i dadi
// =====================================================================
const T2: TutorialScenario = {
  id: 't2-slancio',
  title: 'T2 — Scegli lo slancio',
  shortDescription: 'Lo slancio è la tua mobilità. Scegli quanti dadi tirare.',
  presetA: 'spadaccino',
  presetB: 'spadaccino',
  modeA: 'human',
  modeB: 'human',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    a.slancio = 0; // forziamo slancio iniziale 0 per costringere il tiro
    b.position = { q: 4, r: 9 }; // 6 hex circa
    b.alive = true;
    b.hp = 20;
    b.slancio = 0;
    b.dadiAzione = 0;
    b.actionTakenThisTurn = true;
  },
  steps: [
    {
      id: 'intro',
      text: 'A inizio turno scegli quanti dadi di slancio tirare. Più dadi = più mobilità. Ma costa dadi azione.',
      manualAdvance: true,
    },
    {
      id: 'roll-2',
      text: 'Tira 2 dadi: avrai abbastanza slancio per chiudere la distanza.',
      arrow: 'dice-ui',
      manualAdvance: true,
    },
    {
      id: 'now-move',
      text: 'Ora muoviti verso il nemico. Vedrai gli esagoni raggiungibili evidenziati.',
      arrow: 'action-menu',
      manualAdvance: true,
    },
    {
      id: 'done',
      text: 'Fatto! Più alto era lo slancio, più hex potevi percorrere. Trade-off: hai speso 2 dadi azione, ne hai meno per attaccare/difenderti.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return 'pending';
    const a = state.units[aId];
    const b = state.units[bId];
    const dq = a.position.q - b.position.q;
    const dr = a.position.r - b.position.r;
    const distance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
    if (distance <= 2) return 'success'; // entro reach spada lunga
    return 'pending';
  },
};

// =====================================================================
// T3 — Attacca
// =====================================================================
const T3: TutorialScenario = {
  id: 't3-attacca',
  title: 'T3 — Attacca',
  shortDescription: 'Dichiara un attacco mischia. Anatomia del tiro.',
  presetA: 'spadaccino',
  presetB: 'spadaccino',
  modeA: 'human',
  modeB: 'ai', // AI ma passivo
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    // Avvicina A a B per essere già in mischia
    a.position = { q: 1, r: 9 };
    a.positionAtTurnStart = { q: 1, r: 9 };
    a.slancio = 3;
    a.dadiAzione = 9;
    b.position = { q: 2, r: 9 };
    b.alive = true;
    b.hp = 10; // basso per KO veloce
    b.slancio = 0;
    b.dadiAzione = 0;
    b.actionTakenThisTurn = true; // B non agisce (passive)
  },
  steps: [
    {
      id: 'intro',
      text: 'Il nemico è adiacente. Clicca sull\'azione di attacco con la spada lunga.',
      arrow: 'action-menu',
      manualAdvance: true,
    },
    {
      id: 'pick-dice',
      text: 'Scegli 2 dadi PG per essere sicuro. Il tiro mostra il breakdown: dadi PG + dadi arma + bonus arma − impedimento.',
      arrow: 'dice-ui',
      manualAdvance: true,
    },
    {
      id: 'no-defense',
      text: 'Il nemico non si difende (per scenario didattico). L\'attacco passa pieno.',
      manualAdvance: true,
    },
    {
      id: 'success',
      text: 'Vittoria! Hai imparato la formula base. Variabile (dadi) + Fissa (bonus) = totale. Nei prossimi tutorial il nemico si difenderà.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const bId = findFactionUnit(state, 'B');
    if (!bId) return 'pending';
    const b = state.units[bId];
    if (!b.alive || b.hp <= 0) return 'success';
    return 'pending';
  },
};

// =====================================================================
// T4 — Schiva
// =====================================================================
const T4: TutorialScenario = {
  id: 't4-schiva',
  title: 'T4 — Schiva',
  shortDescription: 'La schivata morde solo la variabile. Devastante contro armi a fisso puro.',
  presetA: 'spadaccino',
  presetB: 'tank',
  modeA: 'human',
  modeB: 'ai',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    // A: posizione vicina a B per essere a portata di B
    a.position = { q: 1, r: 9 };
    a.positionAtTurnStart = { q: 1, r: 9 };
    a.slancio = 0;
    a.dadiAzione = 4;
    a.hp = 18;
    // B: tank con mazza adiacente, slancio alto per giocare prima di A
    b.position = { q: 2, r: 9 };
    b.slancio = 8;
    b.impeto = 30; // gioca prima di A → fa partire B in turno
    b.dadiAzione = 4;
    b.hp = 20;
    b.actionTakenThisTurn = false;
  },
  steps: [
    {
      id: 'intro',
      text: 'Il nemico ha la mazza: arma a fisso puro (+9 fissi, niente dadi propri). Se passa fa molti danni — ma è facilissima da schivare.',
      manualAdvance: true,
    },
    {
      id: 'wait-attack',
      text: 'Il tank attaccherà ora. Quando ti chiederà la difesa, scegli "Schivata" con 2 dadi: blocchi anche tutto il +9 fissa.',
      manualAdvance: true,
    },
    {
      id: 'finish',
      text: 'Schivata = sottrai variabile. Contro armi a dadi propri (spada, arco) è meno efficace: vedi T5 per la parata.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    if (!aId) return 'pending';
    const a = state.units[aId];
    // Successo: A ha schivato (HP intatto o quasi) E ha agito (turno passato)
    // Heuristic: dopo che B ha attaccato, se A ha ancora >= 14 HP → schivata riuscita.
    if (a.hp >= 14 && state.round >= 1 && !state.pendingAction) {
      // Verifica che B abbia almeno provato un attacco (azione consumata)
      const bId = findFactionUnit(state, 'B');
      if (bId && state.units[bId].actionTakenThisTurn) return 'success';
    }
    if (a.hp < 8) return 'fail'; // schivata fallita / cose strane
    return 'pending';
  },
};

// =====================================================================
// T5 — Para
// =====================================================================
const T5: TutorialScenario = {
  id: 't5-para',
  title: 'T5 — Para',
  shortDescription: 'La parata morde il totale. Ottima contro armi a dadi propri.',
  presetA: 'tank',
  presetB: 'spadaccino',
  modeA: 'human',
  modeB: 'ai',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    a.position = { q: 1, r: 9 };
    a.positionAtTurnStart = { q: 1, r: 9 };
    a.slancio = 0;
    a.dadiAzione = 5;
    a.hp = 18;
    b.position = { q: 2, r: 9 };
    b.slancio = 8;
    b.impeto = 30; // B attacca per primo
    b.dadiAzione = 5;
    b.hp = 20;
    b.actionTakenThisTurn = false;
  },
  steps: [
    {
      id: 'intro',
      text: 'Sei un tank con scudo medio. Il nemico ha una spada lunga: dadi propri + fissa. Parare blocca tutto, schivare bloccherebbe solo i dadi.',
      manualAdvance: true,
    },
    {
      id: 'choose-parry',
      text: 'Quando ti chiederà la difesa, scegli "Parata (Scudo medio)" con 2 dadi.',
      manualAdvance: true,
    },
    {
      id: 'finish',
      text: 'Parata = sottrai totale. Lo scudo aggiunge 1d6+8 alla tua difesa.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return 'pending';
    const a = state.units[aId];
    if (a.hp >= 14 && state.round >= 1 && !state.pendingAction) {
      if (state.units[bId].actionTakenThisTurn) return 'success';
    }
    if (a.hp < 6) return 'fail';
    return 'pending';
  },
};

// =====================================================================
// T6 — Spara
// =====================================================================
const T6: TutorialScenario = {
  id: 't6-spara',
  title: 'T6 — Spara',
  shortDescription: 'LoS, malus distanza, slancio_target. Le difese passive del bersaglio.',
  presetA: 'arciere',
  presetB: 'tank',
  modeA: 'human',
  modeB: 'human', // passivo (per evitare contromosse AI)
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    // Arciere posizionato a 6 hex dal tank (entro distanza arco lungo = 4 hex / N=5)
    a.position = { q: -2, r: 9 };
    a.positionAtTurnStart = { q: -2, r: 9 };
    a.slancio = 4;
    a.dadiAzione = 9;
    a.hp = 20;
    b.position = { q: 4, r: 9 }; // 6 hex
    b.slancio = 0; // 0 slancio = niente difesa contro ranged
    b.dadiAzione = 0;
    b.hp = 20;
    b.actionTakenThisTurn = true;
  },
  steps: [
    {
      id: 'intro',
      text: 'Sei un arciere. Le armi ranged non si possono parare/schivare attivamente. Il difensore si protegge con slancio alto, scudo passivo, armatura.',
      manualAdvance: true,
    },
    {
      id: 'fire',
      text: 'Il tank è a 6 hex con slancio 0: bersaglio facile. Clicca "Spara" e tira 2 dadi PG.',
      arrow: 'action-menu',
      manualAdvance: true,
    },
    {
      id: 'finish',
      text: 'Hai sparato. Nota nel log il breakdown: visibilità (LoS), malus distanza, scudo passive, armatura. Se il tank avesse alzato lo slancio, avresti mancato.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const bId = findFactionUnit(state, 'B');
    const aId = findFactionUnit(state, 'A');
    if (!bId || !aId) return 'pending';
    const a = state.units[aId];
    // Successo: A ha consumato la sua azione del turno (ha sparato, hit o miss)
    if (a.actionTakenThisTurn) return 'success';
    return 'pending';
  },
};

// =====================================================================
// T7 — Carica
// =====================================================================
const T7: TutorialScenario = {
  id: 't7-carica',
  title: 'T7 — Carica',
  shortDescription: 'Avvicinarsi al nemico = bonus alla fissa. Costa slancio.',
  presetA: 'spadaccino',
  presetB: 'tank',
  modeA: 'human',
  modeB: 'human',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    // Spadaccino a 3 hex dal tank, slancio 5 → può avvicinarsi e caricare
    a.position = { q: -1, r: 9 };
    a.positionAtTurnStart = { q: -1, r: 9 };
    a.slancio = 5;
    a.dadiAzione = 7;
    a.hp = 20;
    b.position = { q: 2, r: 9 };
    b.slancio = 0;
    b.dadiAzione = 0;
    b.hp = 16; // basso per KO con carica
    b.actionTakenThisTurn = true;
  },
  steps: [
    {
      id: 'intro',
      text: 'Il tank ha lo scudo medio: la sua parata sarebbe imbattibile. Ma se ti avvicini in carica, ogni hex ti dà +1 alla fissa. Muoviti di 3 hex verso il tank, poi attacca.',
      arrow: 'action-menu',
      manualAdvance: true,
    },
    {
      id: 'pick-charge',
      text: 'Sei in mischia: clicca "Attacca". Apparirà la scelta della carica — usane 3 punti per battere la parata.',
      arrow: 'action-menu',
      // Auto-avanza quando entriamo nella fase carica
      trigger: (s) => s.phase === 'awaiting-carica',
    },
    {
      id: 'finish',
      text: 'Hai imparato la carica. Mind game: il difensore parerà aspettandosi un attacco standard. Tu lo punisci col bonus di chiusura.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    if (!aId) return 'pending';
    const a = state.units[aId];
    if (a.actionTakenThisTurn) return 'success';
    return 'pending';
  },
};

// =====================================================================
// T8 — Posizione difensiva
// =====================================================================
const T8: TutorialScenario = {
  id: 't8-stance',
  title: 'T8 — Posizione difensiva',
  shortDescription: 'Lo scudo come muro fisico. ×2 RD passive vs ×2 imp.',
  presetA: 'tank',
  presetB: 'arciere',
  modeA: 'human',
  modeB: 'human',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    a.position = { q: 1, r: 9 };
    a.positionAtTurnStart = { q: 1, r: 9 };
    a.slancio = 0;
    a.dadiAzione = 6;
    a.hp = 18;
    b.position = { q: 5, r: 9 };
    b.slancio = 0;
    b.dadiAzione = 0;
    b.hp = 20;
    b.actionTakenThisTurn = true;
  },
  steps: [
    {
      id: 'intro',
      text: 'Sei un tank sotto fuoco di un arciere a 6 hex. Hai uno scudo medio. Puoi entrare in posizione difensiva: il tuo scudo blocca passivamente +16 ai colpi ranged (×2 il suo bonus parry).',
      manualAdvance: true,
    },
    {
      id: 'click-stance',
      text: 'Clicca "🛡 Posizione difensiva" nel menu azioni.',
      arrow: 'action-menu',
      // Auto-avanza quando la stance è attiva
      trigger: (s) => {
        const aId = findFactionUnit(s, 'A');
        return aId != null && s.units[aId].defensiveStance;
      },
    },
    {
      id: 'finish',
      text: 'Vedi l\'anello dorato attorno alla basetta? Sei in stance. Trade-off: l\'imp dello scudo raddoppia, quindi i tuoi tiri saranno peggiori. Esci dalla stance prima di colpire.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    if (!aId) return 'pending';
    const a = state.units[aId];
    if (a.defensiveStance) return 'success';
    return 'pending';
  },
};

// =====================================================================
// T9 — Asta movimento
// =====================================================================
const T9: TutorialScenario = {
  id: 't9-asta',
  title: 'T9 — Asta movimento',
  shortDescription: 'Le lance creano zone di controllo. Bid privato simultaneo.',
  presetA: 'spadaccino',
  presetB: 'tank', // patchiamo l'arma a lancia_3m
  modeA: 'human',
  modeB: 'ai',
  applySetup: (state) => {
    const aId = findFactionUnit(state, 'A');
    const bId = findFactionUnit(state, 'B');
    if (!aId || !bId) return;
    const a = state.units[aId];
    const b = state.units[bId];
    a.position = { q: -2, r: 9 };
    a.positionAtTurnStart = { q: -2, r: 9 };
    a.slancio = 6;
    a.dadiAzione = 6;
    a.hp = 20;
    // B con lancia 3m (reach 6), slancio per essere "eligible" come difensore zona
    b.position = { q: 4, r: 9 }; // 6 hex
    b.weapon = 'lancia_3m';
    b.offhand = undefined;
    b.slancio = 4;
    b.dadiAzione = 4;
    b.hp = 20;
    b.actionTakenThisTurn = true;
  },
  steps: [
    {
      id: 'intro',
      text: 'Il nemico ha una lancia 3m: minaccia tutti gli esagoni entro 6 hex (zona di controllo). Per attraversare devi vincere un\'asta segreta di slancio.',
      manualAdvance: true,
    },
    {
      id: 'move',
      text: 'Muoviti di 1 hex verso il lanciere. Si aprirà l\'asta nascosta.',
      arrow: 'action-menu',
      // Auto-avanza quando l'asta scatta
      trigger: (s) => s.phase === 'awaiting-attacker-bid',
    },
    {
      id: 'bid',
      text: 'Scegli quanti punti slancio biddare. Vince chi punta più alto (parità → tu). Entrambi pagate.',
      arrow: 'dice-ui',
      // Auto-avanza dopo la risoluzione (fase torna a choosing-action)
      trigger: (s) => s.phase === 'choosing-action' && !s.moveInProgress,
    },
    {
      id: 'finish',
      text: 'Asta risolta. Mind game puro: contro un avversario prevedibile è facile. Spesso conviene NON tentare il passaggio se non sei pronto a pagare.',
      manualAdvance: true,
    },
  ],
  objective: (state) => {
    const aId = findFactionUnit(state, 'A');
    if (!aId) return 'pending';
    const a = state.units[aId];
    // Successo se A ha pagato slancio (è entrato in asta) — verifica A.slancio < 6 dopo dispatch BID
    if (a.slancio < 6 && state.phase === 'choosing-action') return 'success';
    return 'pending';
  },
};

export const TUTORIAL_SCENARIOS: TutorialScenario[] = [T1, T2, T3, T4, T5, T6, T7, T8, T9];

export function getScenario(id: string): TutorialScenario | undefined {
  return TUTORIAL_SCENARIOS.find((s) => s.id === id);
}

/** True se tutti gli scenari sono stati completati (per mostrare schermata di completion). */
export function allCompleted(completedIds: string[]): boolean {
  return TUTORIAL_SCENARIOS.every((s) => completedIds.includes(s.id));
}

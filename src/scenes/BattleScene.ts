import Phaser from 'phaser';
import { HexBoard } from '@ui/HexBoard';
import { UnitSprite } from '@ui/UnitSprite';
import { HUD } from '@ui/HUD';
import { CombatLog } from '@ui/CombatLog';
import { ActionMenu, ActionMenuItem } from '@ui/ActionMenu';
import { DiceChoiceUI } from '@ui/DiceChoiceUI';
import { SliderChoiceUI } from '@ui/SliderChoiceUI';
import { playCombatRoll } from '@ui/DiceRollAnimation';
import { uiScale } from '@ui/uiScale';
import { HandoffOverlay } from '@ui/HandoffOverlay';
import { GameOverOverlay } from '@ui/GameOverOverlay';
import { GAME_CONFIG } from '@/config';
import { offsetToAxial } from '@core/hex/coords';
import { Unit, UnitId } from '@entities/Unit';
import { unitFromPreset, getPreset } from '@data/presets';
import { loadAllBuilds, unitFromBuild } from '@data/builds';
import { BattleSetup } from '@persistence/storage';
import { createInitialState, GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { GameEvent } from '@core/events';
import { getMaxSlancioRoll } from '@core/turn';
import {
  countFlatBonuses,
  countForcedExtraDice,
  countMaxDiceExtra,
  getImpedimentTotal,
  makeAttackContext,
  makeDodgeContext,
  makeParryContext,
  makeSlancioContext,
} from '@core/stats';
import { baseDistance, getBaseHexes } from '@core/hex/base';
import { reachableHexes } from '@core/hex/pathfinding';
import { hexLine } from '@core/hex/line';
import { Axial } from '@core/hex/coords';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { canFireRanged } from '@core/ranged';
import {
  aiDecideAction,
  aiDecideAttackerDice,
  aiDecideBidMovement,
  aiDecideCarica,
  aiDecideDefense,
  aiDecideSlancio,
} from '@ai/basicAi';
import { aiDecideStudentMlp as aiDecideHard } from '@ai/studentMlpAi';
import { aiDecideExpert, preloadStudentMulti } from '@ai/studentMultiAi';
// "Hard" = MLP distillato sync dal Deep CFR multi-matchup (commit aa9d4e1, 6/5/2026).
// Il vecchio DT distillato dal PPO v14 (src/ai/dtAI*.ts) è stato rimosso col cleanup
// pre-apertura repo (non più usato dopo la sostituzione con MLP).
import { FactionId } from '@entities/Unit';
import { getScenario, TutorialScenario, TutorialStep } from '@data/tutorial';
import { TutorialOverlay } from '@ui/TutorialOverlay';
import { saveCompletion } from '@scenes/TutorialMenuScene';
import { audio } from '@utils/audio';
import { paintVellum } from '@ui/Vellum';
import { FONTS, PALETTE, factionTincture } from '@ui/theme';
import { CombatNarrationOverlay } from '@ui/CombatNarrationOverlay';
import { narrate } from '@ui/combatNarrator';

/**
 * Scena principale di battaglia.
 *
 * M6 — UI combat MVP:
 *   - 1v1 hot-seat con 2 PG precostruiti (entrambe spada + armatura leggera)
 *   - Flusso completo: round → turno → attacco/difesa con info nascosta tramite handoff
 *   - HUD live, action menu contestuale, log scrollabile
 *   - Movimento (M7) e ranged (M8) saranno aggiunti dopo
 */
export class BattleScene extends Phaser.Scene {
  private state!: GameState;
  private board!: HexBoard;
  private unitSprites: Map<UnitId, UnitSprite> = new Map();
  private hud!: HUD;
  private log!: CombatLog;
  private menu!: ActionMenu;
  private diceUI!: DiceChoiceUI;
  private sliderUI!: SliderChoiceUI;
  private handoff!: HandoffOverlay;
  private gameOverOverlay!: GameOverOverlay;
  private narration!: CombatNarrationOverlay;

  /** Modalità di controllo per fazione (default: A umano vs B AI) */
  private controlMode: Record<FactionId, 'human' | 'ai'> = { A: 'human', B: 'ai' };
  /** Livello AI per fazione.
   * - 'easy' = basicAi heuristic
   * - 'hard' = DT distillato v14 (sync)
   * - 'expert' = Deep CFR multi-matchup distilled (ONNX, async). Sub-fasi usano DT come 'hard'.
   */
  private aiLevel: Record<FactionId, 'easy' | 'hard' | 'expert'> = { A: 'easy', B: 'easy' };

  // Camera state (replicato da M2)
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
    G: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };
  // Pan camera state RIMOSSO: la camera è fissa per evitare input mismatch UI.

  private incomingSetup?: BattleSetup;

  // === Tutorial mode ===
  private tutorialScenario?: TutorialScenario;
  private tutorialStepIdx = 0;
  private tutorialOverlay?: TutorialOverlay;
  private tutorialCompleted = false;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(data: BattleSetup | { tutorialMode?: string }): void {
    // Tutorial mode: ricevuto come { tutorialMode: scenarioId }
    if (data && (data as { tutorialMode?: string }).tutorialMode) {
      const scenarioId = (data as { tutorialMode: string }).tutorialMode;
      const scenario = getScenario(scenarioId);
      if (scenario) {
        this.tutorialScenario = scenario;
        this.tutorialStepIdx = 0;
        this.tutorialCompleted = false;
        this.controlMode = { A: scenario.modeA, B: scenario.modeB };
        // Costruisci BattleSetup compatibile per il setupGameState standard
        this.incomingSetup = {
          presetA: scenario.presetA,
          presetB: scenario.presetB,
          modeA: scenario.modeA,
          modeB: scenario.modeB,
        };
        return;
      }
    }
    // Modalità battaglia normale
    if (data && (data as Partial<BattleSetup>).presetA) {
      this.incomingSetup = data as BattleSetup;
      this.controlMode = { A: this.incomingSetup.modeA, B: this.incomingSetup.modeB };
      this.aiLevel = {
        A: this.incomingSetup.aiLevelA ?? 'easy',
        B: this.incomingSetup.aiLevelB ?? 'easy',
      };
      // Pre-carica il modello ONNX se almeno una fazione è Expert (warm-up async)
      if (this.aiLevel.A === 'expert' || this.aiLevel.B === 'expert') {
        void preloadStudentMulti();
      }
    }
  }

  create(): void {
    // Vellum + paper grain (Codex Tacticus): sotto tutto via depth -100.
    paintVellum(this, this.scale.width, this.scale.height);
    this.setupGameState();
    this.setupBoard();
    this.setupUnits();
    this.setupCamera();
    this.setupKeys();
    this.setupUI();

    // Tutorial overlay (se in tutorial mode)
    if (this.tutorialScenario) {
      this.tutorialOverlay = new TutorialOverlay(this);
      // Mostro il primo step subito (manualAdvance=true), poi al click avanzo
      this.showCurrentTutorialStep();
    }

    // Avvia la battaglia
    this.dispatch({ type: 'START_ROUND' });
    this.startCurrentTurnFlow();
  }

  /** Mostra lo step corrente del tutorial */
  private showCurrentTutorialStep(): void {
    if (!this.tutorialScenario || !this.tutorialOverlay) return;
    const step = this.tutorialScenario.steps[this.tutorialStepIdx];
    if (!step) {
      // Tutti gli step esauriti — verifica obiettivo finale
      this.checkTutorialObjective();
      return;
    }

    // Coordinate freccia in base al target
    let arrowTarget: { x: number; y: number } | undefined;
    if (step.arrow === 'action-menu') {
      arrowTarget = { x: this.scale.width - 250, y: 180 };
    } else if (step.arrow === 'dice-ui') {
      arrowTarget = { x: this.scale.width / 2, y: this.scale.height / 2 };
    } else if (typeof step.arrow === 'object' && step.arrow !== null) {
      arrowTarget = step.arrow;
    }

    // Mostra il bottone Avanti solo se NON c'è un trigger automatico
    // (se c'è un trigger, il giocatore avanza facendo l'azione del gioco — il bottone
    // sarebbe ridondante e inviterebbe a saltare l'azione).
    const showButton = !step.trigger;
    this.tutorialOverlay.show({
      text: step.text,
      arrowTarget,
      showButton,
      onAdvance: () => this.advanceTutorialStep(),
    });
  }

  /** Avanza al prossimo step del tutorial */
  private advanceTutorialStep(): void {
    if (!this.tutorialScenario) return;
    this.tutorialStepIdx++;
    this.showCurrentTutorialStep();
  }

  /** Valuta l'obiettivo finale del tutorial dopo ogni dispatch */
  private checkTutorialObjective(): void {
    if (!this.tutorialScenario || this.tutorialCompleted) return;
    const result = this.tutorialScenario.objective(this.state);
    if (result === 'success') {
      this.tutorialCompleted = true;
      saveCompletion(this.tutorialScenario.id);
      // Mostra messaggio di vittoria
      if (this.tutorialOverlay) {
        this.tutorialOverlay.show({
          text: '🎉 Scenario completato! Puoi tornare al menu tutorial per il prossimo.',
          onAdvance: () => this.scene.start('TutorialMenuScene'),
        });
      }
    } else if (result === 'fail') {
      if (this.tutorialOverlay) {
        this.tutorialOverlay.show({
          text: 'Non ci siamo. Riprova lo scenario dal menu.',
          onAdvance: () => this.scene.start('TutorialMenuScene'),
        });
      }
    }
    // pending: niente, continua
  }

  private setupGameState(): void {
    const cols = GAME_CONFIG.map.cols;
    const rows = GAME_CONFIG.map.rows;
    const midRow = Math.floor(rows / 2);
    const setup = this.incomingSetup ?? {
      presetA: 'spadaccino',
      presetB: 'arciere',
      modeA: 'human' as const,
      modeB: 'ai' as const,
    };

    const presetA = getPreset(setup.presetA) ?? getPreset('spadaccino')!;
    const presetB = getPreset(setup.presetB) ?? getPreset('arciere')!;

    // Custom build override (via setup): se presente, costruisce l'unità dalla build personalizzata.
    const allBuilds = loadAllBuilds();
    const customA = setup.customBuildIdA ? allBuilds.find((b) => b.id === setup.customBuildIdA) : undefined;
    const customB = setup.customBuildIdB ? allBuilds.find((b) => b.id === setup.customBuildIdB) : undefined;

    const posA = offsetToAxial({ col: 2, row: midRow });
    const posB = offsetToAxial({ col: cols - 3, row: midRow });
    const a: Unit = customA ? unitFromBuild(customA, 'A', posA) : unitFromPreset(presetA, 'A', posA);
    const b: Unit = customB ? unitFromBuild(customB, 'B', posB) : unitFromPreset(presetB, 'B', posB);

    this.state = createInitialState({
      units: [a, b],
      board: { cols, rows },
      rngSeed: Math.floor(Math.random() * 1_000_000),
    });

    // Tutorial mode: applica il patch dello scenario
    if (this.tutorialScenario) {
      this.tutorialScenario.applySetup(this.state);
    }
  }

  private setupBoard(): void {
    const cols = GAME_CONFIG.map.cols;
    const rows = GAME_CONFIG.map.rows;
    const midRow = Math.floor(rows / 2);
    this.board = new HexBoard(this, {
      cols,
      rows,
      hexSize: GAME_CONFIG.map.hexSize,
      padding: GAME_CONFIG.map.padding,
      deployA: offsetToAxial({ col: 2, row: midRow }),
      deployB: offsetToAxial({ col: cols - 3, row: midRow }),
    });
    this.board.render();
  }

  private setupUnits(): void {
    const sqrt3Half = Math.sqrt(3) / 2;
    const origin = {
      x: GAME_CONFIG.map.padding + sqrt3Half * GAME_CONFIG.map.hexSize,
      y: GAME_CONFIG.map.padding + GAME_CONFIG.map.hexSize,
    };
    for (const u of Object.values(this.state.units)) {
      const sprite = new UnitSprite(this, u, GAME_CONFIG.map.hexSize, origin);
      this.unitSprites.set(u.id, sprite);
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    // CAMERA TOTALMENTE FISSA. Il pan camera (drag right/middle/touch) causava
    // input mismatch sui menu UI (Phaser hit-test dipende dalla camera principale
    // anche con setScrollFactor=0). Soluzione: niente movimento camera.
    cam.setZoom(1.0);
    cam.setScroll(0, 0);
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.input.mouse?.disableContextMenu();
    // NB: setupTouchGestures rimosso. Niente pan touch, niente pinch zoom.
  }

  /** True se l'ultimo touch è stato un drag-pan (legacy, ora sempre false: pan rimosso). */
  isTouchPanActive(): boolean {
    return false;
  }

  private setupKeys(): void {
    if (!this.input.keyboard) return;
    const KEY = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      W: this.input.keyboard.addKey(KEY.W),
      A: this.input.keyboard.addKey(KEY.A),
      S: this.input.keyboard.addKey(KEY.S),
      D: this.input.keyboard.addKey(KEY.D),
      UP: this.input.keyboard.addKey(KEY.UP),
      DOWN: this.input.keyboard.addKey(KEY.DOWN),
      LEFT: this.input.keyboard.addKey(KEY.LEFT),
      RIGHT: this.input.keyboard.addKey(KEY.RIGHT),
      G: this.input.keyboard.addKey(KEY.G),
      SPACE: this.input.keyboard.addKey(KEY.SPACE),
    };
    this.keys.G.on('down', () => this.board.toggleLabels());
    this.keys.SPACE.on('down', () => {
      // Space = end turn (QoL) — usa lo stesso percorso del bottone
      if (this.state.phase === 'choosing-action') {
        this.passTurn();
      }
    });
  }

  private setupUI(): void {
    this.hud = new HUD(this, 20, 20);
    // Log: occupa la fascia bassa-sinistra; dimensioni e posizione adattive
    const logW = Math.min(420, this.scale.width * 0.45);
    const logH = Math.min(220, this.scale.height * 0.28);
    this.log = new CombatLog(this, 20, this.scale.height - logH - 20, logW, logH, 12);
    // Menu: ancorato in alto a destra. UI scale x1.4 su mobile → button width
    // s(280)=392, quindi ancoraggio dinamico per restare dentro canvas.
    const menuW = uiScale() * 280;
    this.menu = new ActionMenu(this, this.scale.width - menuW - 20, 140);
    this.diceUI = new DiceChoiceUI(this);
    this.sliderUI = new SliderChoiceUI(this);
    this.handoff = new HandoffOverlay(this);
    this.gameOverOverlay = new GameOverOverlay(this);
    this.narration = new CombatNarrationOverlay(this);
    this.refreshUI();

    // Listener per resize del viewport: riposiziona overlay e UI
    this.scale.on('resize', this.onResize, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
  }

  /** Resize handler: riposiziona UI e ricrea overlay con le nuove dimensioni */
  private onResize(): void {
    // Distrugge gli overlay (le loro dimensioni dipendono dalle camera dimensions)
    this.handoff.destroy?.();
    this.diceUI.destroy?.();
    this.sliderUI.destroy?.();
    this.gameOverOverlay.destroy?.();
    this.handoff = new HandoffOverlay(this);
    this.diceUI = new DiceChoiceUI(this);
    this.sliderUI = new SliderChoiceUI(this);
    this.gameOverOverlay = new GameOverOverlay(this);
    this.narration?.destroy?.();
    this.narration = new CombatNarrationOverlay(this);

    // Riposiziona log (rimane in basso-sinistra) e menu (in alto-destra)
    const logW = Math.min(420, this.scale.width * 0.45);
    const logH = Math.min(220, this.scale.height * 0.28);
    this.log.relayout?.(20, this.scale.height - logH - 20, logW, logH);
    const menuW = uiScale() * 280;
    this.menu.setPosition(this.scale.width - menuW - 20, 140);

    // Camera: niente setBounds (vedi setupCamera per motivazione anti-offset)
    void this.cameras.main;
    this.refreshUI();
  }

  override update(_time: number, _deltaMs: number): void {
    void _deltaMs;
    // Pan camera con WASD/frecce RIMOSSO: la camera è fissa per evitare input mismatch
    // sui menu UI (Phaser hit-test dipende dalla camera principale).
  }

  /** Aggiorna UI a partire dallo state corrente */
  private refreshUI(): void {
    this.hud.update(this.state);
    this.log.update(this.state.log);
    // Highlight unit attiva (turno corrente)
    const activeId = this.state.turnOrder[this.state.currentTurnIdx];
    for (const [id, sprite] of this.unitSprites) {
      const u = this.state.units[id];
      if (u) sprite.update(u);
      sprite.setActive(this, id === activeId && u?.alive === true);
    }
  }

  /** Dispatch evento al reducer e aggiorna UI */
  private dispatch(event: GameEvent): void {
    const prev = this.state;
    this.state = reduce(this.state, event);
    // Audio: feedback per eventi UI specifici
    this.maybePlayAudio(event, prev, this.state);
    // Animazioni post-resolve: se phase passa da 'resolving' a 'choosing-action', cerca log nuovo per evidenze
    if (prev.phase === 'resolving' && this.state.phase === 'choosing-action' && this.state.pendingAction === undefined) {
      this.maybeShowDamageAnimations(prev, this.state);
    }
    // Popup variazione slancio per ogni unità (skip START_TURN dove lo slancio si azzera per design)
    this.maybeShowSlancioChange(prev, this.state, event.type);
    // Animazione movimento: confronta posizioni prima/dopo
    this.maybeTweenMovement(prev, this.state);
    // Narrazione: una linea asciutta-poetica per eventi rilevanti
    // (RESOLVE_COMBAT, RELOAD, MOVE, START_ROUND). Pure function in @ui/combatNarrator.
    this.maybeShowNarration(prev, this.state, event);
    this.refreshUI();
    // Tutorial: dopo ogni dispatch, verifica trigger step + obiettivo
    if (this.tutorialScenario && !this.tutorialCompleted) {
      this.checkTutorialTrigger();
      this.checkTutorialObjective();
    }
  }

  /**
   * Genera una linea di narrazione (overlay in basso sulla scena) per gli eventi
   * che meritano commento (combat, reload, movement, init swap, carica). Per
   * eventi sub-step (CHOOSE_DEFENSE, BID_MOVEMENT, ...) il narratore ritorna null.
   *
   * Hold della linea: 4.5s per i combat (più letterari), 2.5s per movement/reload.
   *
   * Soppressione: durante le fasi con popup UI attivo (DiceChoiceUI, SliderChoiceUI,
   * HandoffOverlay) sopprimiamo l'overlay per evitare sovrapposizione visiva.
   * La linea viene accodata e mostrata appena la fase torna sgombra.
   */
  private maybeShowNarration(prev: GameState, curr: GameState, event: GameEvent): void {
    if (!this.narration) return;
    // Sincronizza soppressione con fase corrente
    this.narration.setSuppressed(this.isUiPopupPhase(curr));
    try {
      const line = narrate({ prev, curr, event });
      if (!line) return;
      const hold = event.type === 'RESOLVE_COMBAT' ? 4500 : 2500;
      this.narration.show(line, hold);
    } catch (e) {
      // Defensive: un crash del narratore non deve mai rompere il gameplay
      // eslint-disable-next-line no-console
      console.warn('[narrator] errore:', e);
    }
  }

  /**
   * True quando lo stato corrente ha un popup UI centrale attivo che occluderebbe
   * l'overlay narrazione. Si basa sulla phase + sul controlMode (hot-seat = handoff
   * tra umani può popparsi al cambio turno).
   */
  private isUiPopupPhase(s: GameState): boolean {
    switch (s.phase) {
      case 'turn-start': // DiceChoiceUI slancio (umano) o slider impeto-slancio
      case 'declaring-attack': // DiceChoiceUI attacker dice
      case 'awaiting-defense': // DiceChoiceUI defense
      case 'awaiting-carica': // SliderChoiceUI carica
      case 'awaiting-attacker-bid':
      case 'awaiting-defender-bid':
        return true;
      default:
        return false;
    }
  }

  /** Audio per eventi UI: tiri dadi, inizio turno, click. */
  private maybePlayAudio(event: GameEvent, _prev: GameState, _curr: GameState): void {
    void _prev;
    void _curr;
    switch (event.type) {
      case 'START_TURN':
        audio.turn();
        break;
      case 'CHOOSE_ATTACKER_DICE':
      case 'CHOOSE_DEFENSE':
      case 'BID_MOVEMENT':
      case 'CHOOSE_CARICA':
        audio.dice();
        break;
      case 'TOGGLE_DEFENSIVE':
      case 'MOVE':
      case 'DECLARE_ATTACK':
      case 'RELOAD':
        audio.click();
        break;
      default:
        // niente
        break;
    }
  }

  /** Se una unità ha cambiato posizione tra prev e curr, lancia il tween. */
  private maybeTweenMovement(prev: GameState, curr: GameState): void {
    for (const id of Object.keys(curr.units)) {
      const before = prev.units[id]?.position;
      const after = curr.units[id]?.position;
      if (!before || !after) continue;
      if (before.q === after.q && before.r === after.r) continue;
      const sprite = this.unitSprites.get(id);
      if (!sprite) continue;
      // Fire-and-forget: il tween aggiorna `displayedPosition` durante l'animazione,
      // ma `state.units[id].position` è già la finale.
      sprite.tweenTo(this, after);
    }
  }

  /**
   * Avanza automaticamente lo step se il suo `trigger` è soddisfatto.
   * Gli step con solo `manualAdvance` (senza trigger) avanzano solo via bottone.
   */
  private checkTutorialTrigger(): void {
    if (!this.tutorialScenario) return;
    const step: TutorialStep | undefined = this.tutorialScenario.steps[this.tutorialStepIdx];
    if (!step) return;
    if (step.trigger && step.trigger(this.state)) {
      this.advanceTutorialStep();
    }
  }

  /** Heuristic: confronta HP unità prima/dopo per mostrare flash + numero danno */
  private maybeShowDamageAnimations(prev: GameState, curr: GameState): void {
    let anyHit = false;
    let anyMiss = false;
    let anyHitHard = false;
    let anyDeath = false;
    for (const id of Object.keys(curr.units)) {
      const beforeU = prev.units[id];
      const afterU = curr.units[id];
      if (!beforeU || !afterU) continue;
      const lost = beforeU.hp - afterU.hp;
      const sprite = this.unitSprites.get(id);
      if (lost > 0) {
        anyHit = true;
        if (lost >= 6) anyHitHard = true;
        if (sprite) {
          sprite.flashHit(this);
          sprite.showDamage(this, lost);
          // Screen-shake leggero proporzionale al danno (cap 12px)
          const intensity = Math.min(0.012, 0.003 + lost * 0.0015);
          this.cameras.main.shake(180, intensity);
        }
      }
      // Death animation: era vivo, ora morto
      if (beforeU.alive && !afterU.alive && sprite) {
        sprite.playDeathAnimation(this);
        anyDeath = true;
      }
    }
    // Se c'era un pendingAction risolto e nessuno ha perso HP: schivata/parata riuscita
    if (!anyHit && prev.pendingAction && !curr.pendingAction) {
      const targetId = prev.pendingAction.targetId;
      const sprite = this.unitSprites.get(targetId);
      const def = prev.pendingAction.defense?.type;
      if (sprite) {
        const txt =
          def === 'parry' ? 'PARATO' : def === 'dodge' ? 'SCHIVATO' : 'MISS';
        const color = def === 'parry' ? '#88ccff' : def === 'dodge' ? '#88ff88' : '#ffd966';
        sprite.showText(this, txt, color);
      }
      anyMiss = true;
    }
    // Audio
    if (anyDeath) audio.death();
    else if (anyHitHard) audio.hitHard();
    else if (anyHit) audio.hit();
    else if (anyMiss) audio.miss();
  }

  /**
   * Mostra delta slancio sopra ogni unità che ha cambiato slancio tra prev/curr.
   * Skippa l'evento START_TURN dove lo slancio si azzera (transfer in impeto) per
   * design — non è meaningful da mostrare come "perdita".
   */
  private maybeShowSlancioChange(prev: GameState, curr: GameState, eventType: string): void {
    if (eventType === 'START_TURN') return;
    for (const id of Object.keys(curr.units)) {
      const before = prev.units[id]?.slancio ?? 0;
      const after = curr.units[id]?.slancio ?? 0;
      if (before === after) continue;
      const sprite = this.unitSprites.get(id);
      if (!sprite) continue;
      sprite.showSlancioChange(this, after - before);
    }
  }

  /**
   * Linea/proiettile attacker → target. Per CaC: linea diretta che lampeggia.
   * Per ranged: proiettile (cerchietto luminoso) che viaggia.
   * Va chiamato PRIMA del dispatch RESOLVE_COMBAT (altrimenti se l'unità muore
   * il sprite non c'è più). Dura ~280ms in parallelo al flash danno: i due
   * insieme leggono come "attacca → colpisce".
   */
  private vfxAttackLine(attackerId: UnitId, targetId: UnitId, isRanged: boolean): void {
    const a = this.unitSprites.get(attackerId);
    const b = this.unitSprites.get(targetId);
    if (!a || !b) return;
    const p1 = a.getCenter();
    const p2 = b.getCenter();
    if (isRanged) {
      // Proiettile: pallino oro + alone
      const proj = this.add.graphics();
      proj.fillStyle(PALETTE.gold.num, 1);
      proj.fillCircle(0, 0, 5);
      proj.lineStyle(2, PALETTE.gold.num, 0.5);
      proj.strokeCircle(0, 0, 9);
      proj.x = p1.x;
      proj.y = p1.y;
      this.tweens.add({
        targets: proj,
        x: p2.x,
        y: p2.y,
        duration: 280,
        ease: 'Linear',
        onComplete: () => proj.destroy(),
      });
    } else {
      // Linea CaC: striscia oro che lampeggia 400ms
      const line = this.add.graphics();
      line.lineStyle(5, PALETTE.gold.num, 0.95);
      line.lineBetween(p1.x, p1.y, p2.x, p2.y);
      this.tweens.add({
        targets: line,
        alpha: 0,
        duration: 400,
        onComplete: () => line.destroy(),
      });
    }
  }

  /**
   * Helper: chiama vfxAttackLine leggendo attaccante/target/ranged dal pendingAction
   * corrente, poi dispatcha RESOLVE_COMBAT. Usato come sostituto dei 4 dispatch
   * RESOLVE_COMBAT per garantire che l'effetto visivo sia agganciato sempre.
   */
  private dispatchResolveCombat(): void {
    const pa = this.state.pendingAction;
    if (pa) {
      this.vfxAttackLine(pa.attackerId, pa.targetId, pa.isRanged ?? false);
    }
    const ev: GameEvent = { type: 'RESOLVE_COMBAT' };
    this.dispatch(ev);
    // Suono dadi che cadono (subito dopo il resolve)
    audio.diceFall();
    // V2: animazione dadi reale (legge dal lastResolution popolato dal reducer)
    this.playRollAnimation();
  }

  /**
   * Legge `state.lastResolution` (popolato dal reducer dopo RESOLVE_COMBAT)
   * e mostra l'animazione completa: titolo, dadi atk + def, breakdown e esito.
   */
  private playRollAnimation(): void {
    const lr = this.state.lastResolution;
    if (!lr) return;
    let title: string;
    if (lr.isRanged) {
      title = 'ATTACCO RANGED';
    } else if (lr.defenseType === 'parry') {
      title = 'ATTACCO vs PARATA';
    } else if (lr.defenseType === 'dodge') {
      title = 'ATTACCO vs SCHIVATA';
    } else {
      title = 'ATTACCO (no difesa)';
    }
    const subtitle = `${lr.attackerName} → ${lr.defenderName}`;
    void playCombatRoll(this, {
      title,
      subtitle,
      attacker: {
        name: lr.attackerName,
        dice: lr.attackerDice,
        variable: lr.attackerVariable,
        fixed: lr.attackerFixed,
        total: lr.attackerTotal,
      },
      defender: {
        name: lr.defenderName,
        dice: lr.defenderDice,
        fixed: lr.defenderFixed,
        total: lr.defenderTotal,
      },
      outcome: {
        residual: lr.residual,
        hit: lr.hit,
        rawDamage: lr.rawDamage,
        effectiveDamage: lr.effectiveDamage,
        defenseType: lr.defenseType,
      },
      centerX: this.scale.width / 2,
      topY: this.scale.height * 0.18,
    });
  }

  /**
   * Banner "Turno: <nome>" che pop-in al centro alto dello schermo a inizio turno.
   * Colore basato sulla fazione (blu A, rosso B). Auto-distrugge dopo ~1.5s.
   */
  private vfxTurnBanner(unit: Unit): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const tincture = factionTincture(unit.faction);
    const t = this.add.text(w / 2, h * 0.18, `Round  —  ${unit.name}`, {
      fontFamily: FONTS.display,
      fontSize: '34px',
      color: tincture.css,
      stroke: PALETTE.vellum.css,
      strokeThickness: 5,
      fontStyle: 'italic',
    });
    t.setOrigin(0.5, 0.5);
    t.setScrollFactor(0);
    t.setAlpha(0);
    t.setScale(0.5);
    this.tweens.add({
      targets: t,
      alpha: 1,
      scale: 1.0,
      duration: 220,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          duration: 700,
          delay: 1100, // hold più lungo per leggere chi gioca
          onComplete: () => t.destroy(),
        });
      },
    });
  }

  /** Entry-point del turno: applica START_TURN (con scelta slancio) e mostra menu azioni */
  private startCurrentTurnFlow(): void {
    if (this.state.phase === 'game-over') {
      this.showGameOver();
      return;
    }
    if (this.state.phase !== 'turn-start') return;

    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;

    // VFX: banner che annuncia chi sta giocando (rapido, per non rompere il pacing)
    this.vfxTurnBanner(unit);

    // Se l'unità è AI: salta handoff e gioca automaticamente
    if (this.controlMode[unit.faction] === 'ai') {
      const isHard = this.aiLevel[unit.faction] === 'hard';
      let slancioN: number;
      let impetoToSlancio: number | undefined;
      if (isHard) {
        const e = aiDecideHard(this.state, unit.id);
        if (e.type === 'START_TURN') {
          slancioN = e.slancioDice;
          impetoToSlancio = e.impetoToSlancio;
        } else {
          slancioN = aiDecideSlancio(this.state, unit.id);
        }
      } else {
        slancioN = aiDecideSlancio(this.state, unit.id);
      }
      this.dispatch({ type: 'START_TURN', slancioDice: slancioN, impetoToSlancio });
      this.scheduleAiTurn();
      return;
    }

    // Umano: vai direttamente alla scelta dadi slancio (no schermata "Sono pronto")
    this.askSlancio();
  }

  /** Esegue il turno di un'unità AI: pianifica le azioni con un piccolo delay per leggibilità */
  private scheduleAiTurn(): void {
    if (this.state.phase !== 'choosing-action') return;
    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;
    if (this.controlMode[unit.faction] !== 'ai') return;

    // Piccolo delay per dare tempo al giocatore di vedere lo stato
    // Delay aumentato per leggibilità: l'AI è troppo veloce, il giocatore non vede cosa fa.
    this.time.delayedCall(1100, () => {
      // executeAiAction è async (per supportare livello 'expert' con ONNX). Phaser
      // delayedCall accetta callback sync ma TS permette di "fire-and-forget" una promise.
      void this.executeAiAction();
    });
  }

  private async executeAiAction(): Promise<void> {
    if (this.state.phase !== 'choosing-action') return;
    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;
    if (this.controlMode[unit.faction] !== 'ai') return;

    // Livelli AI: 'expert' (Deep CFR distilled, async) → 'hard' (DT) → 'easy' (heuristic).
    // Per 'expert': solo l'azione principale del turno usa il modello distillato; le
    // sub-fasi (CHOOSE_ATTACKER_DICE, CHOOSE_DEFENSE) ricadono su DT come 'hard'.
    const level = this.aiLevel[unit.faction];
    const isHard = level === 'hard' || level === 'expert';
    const isExpert = level === 'expert';
    const event = isExpert
      ? await aiDecideExpert(this.state, unit.id)
      : (isHard ? aiDecideHard(this.state, unit.id) : aiDecideAction(this.state, unit.id));
    // Diagnostica: aggiungi al log la decisione AI cosi è visibile durante playtest.
    // Util per capire perché AI sceglie MOVE invece di ATTACK in qualche edge case.
    const choice =
      event.type === 'DECLARE_ATTACK' ? `attack ${event.isRanged ? 'ranged' : 'mischia'}` :
      event.type === 'MOVE' ? 'muovi' :
      event.type === 'RELOAD' ? 'ricarica' :
      event.type === 'END_TURN' ? 'passa turno' :
      event.type;
    // Diagnostica estesa: per MOVE/END_TURN aggiungi distanza/reach/canAct così
    // si capisce PERCHÉ l'AI non attacca quando è "vicina" al nemico.
    let diag = '';
    if ((event.type === 'MOVE' || event.type === 'END_TURN') && unit.weapon) {
      const enemies = Object.values(this.state.units).filter(
        (u) => u.faction !== unit.faction && u.alive,
      );
      if (enemies.length > 0) {
        const w = getWeapon(unit.weapon);
        const reach = w?.range?.reach ?? 1;
        const closest = enemies.reduce((a, b) =>
          baseDistance(unit.position, a.position) < baseDistance(unit.position, b.position) ? a : b,
        );
        const dist = baseDistance(unit.position, closest.position);
        const canAct = !unit.actionTakenThisTurn && unit.dadiAzione >= 1;
        diag = ` [dist=${dist} reach=${reach} canAct=${canAct} dadi=${unit.dadiAzione} act=${unit.actionTakenThisTurn} sl=${unit.slancio}]`;
      }
    }
    this.state = {
      ...this.state,
      log: [...this.state.log, {
        round: this.state.round,
        turnUnitId: unit.id,
        message: `${unit.name}: scelta AI = ${choice}${diag}`,
      }],
    };
    // Defensive: traccia state pre-dispatch. Per MOVE rilevo loop quando il
    // movimento è completamente rifiutato (phase resta choosing-action e position invariata).
    // NB: se phase passa a awaiting-attacker-bid, NON è rifiuto — è asta in corso → processMovementPhase
    const prevPos = unit.position;
    this.dispatch(event);
    if (event.type === 'MOVE') {
      const after = this.state.units[unit.id];
      const moved = after && (after.position.q !== prevPos.q || after.position.r !== prevPos.r);
      const stillChoosingAction = this.state.phase === 'choosing-action';
      if (!moved && stillChoosingAction) {
        // MOVE rifiutato (overlap basetta / path bloccato) → AI fallback: passa turno
        this.dispatch({ type: 'END_TURN' });
        this.startCurrentTurnFlow();
        return;
      }
    }

    if (event.type === 'DECLARE_ATTACK') {
      // Defensive: se il reducer ha rifiutato l'attacco (es. AI ha proposto un attacco
      // mischia con arco — DT degenerato), phase resta 'choosing-action' e
      // pendingAction è undefined. Niente pendingAction → END_TURN per evitare loop
      // (executeAiAction continuerebbe a dispatchare CHOOSE_ATTACKER_DICE su uno
      // state inesistente, che il reducer rejecterebbe in serie).
      if (this.state.phase === 'choosing-action' && !this.state.pendingAction) {
        this.state = {
          ...this.state,
          log: [...this.state.log, {
            round: this.state.round,
            turnUnitId: unit.id,
            message: `${unit.name}: attacco rifiutato dal reducer → END_TURN (defensive)`,
          }],
        };
        this.dispatch({ type: 'END_TURN' });
        this.startCurrentTurnFlow();
        return;
      }
      // Fase 1: gestisci awaiting-carica per AI.
      if ((this.state.phase as string) === 'awaiting-carica') {
        let amount: number;
        if (isHard) {
          const e = aiDecideHard(this.state, unit.id);
          amount = e.type === 'CHOOSE_CARICA' ? e.amount : aiDecideCarica(this.state, unit.id);
        } else {
          amount = aiDecideCarica(this.state, unit.id);
        }
        this.dispatch({ type: 'CHOOSE_CARICA', amount });
      }
      // CHOOSE_ATTACKER_DICE: usa hard se attivo, altrimenti basic
      let diceN: number;
      if (isHard) {
        const e = aiDecideHard(this.state, unit.id);
        diceN = e.type === 'CHOOSE_ATTACKER_DICE' ? e.diceN : aiDecideAttackerDice(this.state, unit.id);
      } else {
        diceN = aiDecideAttackerDice(this.state, unit.id);
      }
      this.dispatch({ type: 'CHOOSE_ATTACKER_DICE', diceN });

      if (event.isRanged) {
        this.dispatchResolveCombat();
        this.afterCombat();
        this.scheduleAiTurn();
        return;
      }

      const targetId = event.targetId;
      const target = this.state.units[targetId];
      if (this.controlMode[target.faction] === 'ai') {
        const targetHard = this.aiLevel[target.faction] === 'hard';
        let defType: 'parry' | 'dodge' | 'none';
        let parryWith: 'weapon' | 'offhand' | undefined;
        let defDice: number;
        if (targetHard) {
          const e = aiDecideHard(this.state, targetId);
          if (e.type === 'CHOOSE_DEFENSE') {
            defType = e.defenseType;
            parryWith = e.parryWith;
            defDice = e.diceN;
          } else {
            const def = aiDecideDefense(this.state, targetId);
            defType = def.defenseType;
            parryWith = def.parryWith;
            defDice = def.diceN;
          }
        } else {
          const def = aiDecideDefense(this.state, targetId);
          defType = def.defenseType;
          parryWith = def.parryWith;
          defDice = def.diceN;
        }
        this.dispatch({
          type: 'CHOOSE_DEFENSE',
          defenseType: defType,
          parryWith,
          diceN: defDice,
        });
        this.dispatchResolveCombat();
        this.afterCombat();
        this.scheduleAiTurn();
      } else {
        this.askDefense(targetId, /*resumeAiAfter=*/true);
      }
      return;
    }

    if (event.type === 'MOVE') {
      // Movimento già applicato dal dispatch; AI può ancora attaccare nello stesso turno.
      // Fase 1: il MOVE può aver aperto un'asta — processMovementPhase la risolve in cascata.
      this.processMovementPhase();
      return;
    }

    if (event.type === 'RELOAD') {
      // Ricarica già applicata; può continuare il turno (ma con meno dadi)
      this.scheduleAiTurn();
      return;
    }

    if (event.type === 'END_TURN') {
      this.startCurrentTurnFlow();
      return;
    }
  }

  private askSlancio(): void {
    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;
    const ctx = makeSlancioContext();
    const maxN = 2 + countMaxDiceExtra(unit.skills, ctx);
    const choices = Array.from({ length: maxN + 1 }, (_, i) => i);

    // Costruisci breakdown
    const flatBonus = countFlatBonuses(unit.skills, ctx);
    const forced = countForcedExtraDice(unit.skills, ctx);
    const imp = getImpedimentTotal(unit);
    const info: string[] = [
      `Base: 0-${maxN} d6 + 2 fissi`,
    ];
    if (forced > 0) info.push(`+${forced} dado/i forzati (skill)`);
    if (flatBonus > 0) info.push(`+${flatBonus} al tiro (skill)`);
    if (imp > 0) info.push(`− ${imp} impedimento`);
    info.push(`Round successivo: questo slancio si somma a impeto`);

    this.diceUI.show({
      title: `${unit.name} — Tiro slancio (1/2)`,
      subtitle: `Scegli quanti dadi tirare (0..${maxN})`,
      infoLines: info,
      choices,
      onChoose: (n) => {
        // Step 2: opzionale transfer impeto→slancio (D-044). Skip se impeto a 0.
        if (unit.impeto > 0) {
          this.askImpetoTransfer(unit.id, n);
        } else {
          this.dispatch({ type: 'START_TURN', slancioDice: n });
          this.showActionMenu();
        }
      },
    });
  }

  /**
   * Step 2 turn-start (D-044): trasferisce N punti da impeto a slancio (1:1, gratis).
   *
   * Cap stretto = `min(impeto, headroomMin)` dove
   *   `headroomMin = getMaxSlancioRoll(unit) - slancioMaxThisTurn`
   *   `slancioMaxThisTurn = clampedDiceN*6 + flatBonus - impedimento` (tiro MAX possibile coi dadi scelti).
   *
   * Questo è il cap GARANTITO: anche col tiro più fortunato il transfer rientra completamente.
   * Esempi (spadaccino base maxRoll=14):
   *  - 0 dadi: cap = 14 (transfer pieno)
   *  - 1 dado: cap = 14 − 8 = 6
   *  - 2 dadi: cap = 14 − 14 = 0 (niente transfer possibile)
   *
   * Il reducer fa comunque clamp finale sull'headroom REALE post-tiro — qui mostriamo
   * solo il cap conservativo per non promettere transfer che potrebbero essere troncati.
   */
  private askImpetoTransfer(unitId: UnitId, slancioDiceN: number): void {
    const unit = this.state.units[unitId];
    if (!unit) return;

    const ctx = makeSlancioContext();
    const flat = countFlatBonuses(unit.skills, ctx);
    const imp = getImpedimentTotal(unit);
    const maxDice = 2 + countMaxDiceExtra(unit.skills, ctx);
    // Effective dice tirabili: clamp anche al pool dadi azione corrente (come fa applyTurnStart)
    const effectiveDice = Math.max(0, Math.min(slancioDiceN, maxDice, unit.dadiAzione));
    const slancioMaxThisTurn = Math.max(0, effectiveDice * 6 + (effectiveDice > 0 ? flat - imp : 0));
    const maxRoll = getMaxSlancioRoll(unit);
    const headroomMin = Math.max(0, maxRoll - slancioMaxThisTurn);
    const cap = Math.max(0, Math.min(unit.impeto, headroomMin));

    const info: string[] = [
      `Impeto attuale: ${unit.impeto}`,
      `Slancio max dal tiro (${effectiveDice}d6+${Math.max(0, flat - imp)}): ${slancioMaxThisTurn}`,
      `Headroom slancio: ${maxRoll} − ${slancioMaxThisTurn} = ${headroomMin}`,
      `Cap garantito trasferibile: ${cap}`,
      `(transfer 1:1 gratis, una volta a turno)`,
    ];

    if (cap === 0) {
      // Niente transfer possibile: skip dialog e prosegui direttamente.
      this.dispatch({ type: 'START_TURN', slancioDice: slancioDiceN, impetoToSlancio: 0 });
      this.showActionMenu();
      return;
    }

    this.sliderUI.show({
      title: `${unit.name} — Impeto → Slancio (2/2)`,
      subtitle: `Trascina lo slider o usa −/+ (default = max disponibile)`,
      infoLines: info,
      max: cap,
      initial: cap, // default massimo: l'utente può sempre ridurre con −
      onConfirm: (m) => {
        this.dispatch({ type: 'START_TURN', slancioDice: slancioDiceN, impetoToSlancio: m });
        this.showActionMenu();
      },
    });
  }

  /** Costruisce il menu azioni in base al contesto */
  private showActionMenu(): void {
    if (this.state.phase !== 'choosing-action') return;
    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;

    const items: ActionMenuItem[] = [];

    // Per M6: solo attacchi mischia su nemici adiacenti (base distance 1)
    const enemies = Object.values(this.state.units).filter(
      (u) => u.faction !== unit.faction && u.alive,
    );
    // Helper: aggiunge una voce al menu, eventualmente disabled con motivo nel label.
    const addItem = (
      baseLabel: string,
      onClick: () => void,
      disabledReason: string | null = null,
    ): void => {
      if (disabledReason) {
        items.push({ label: `${baseLabel} — ${disabledReason}`, onClick: () => {}, disabled: true });
      } else {
        items.push({ label: baseLabel, onClick });
      }
    };

    if (unit.weapon) {
      const w = getWeapon(unit.weapon);
      if (w) {
        // V2: armi ranged (archi, balestra) NON hanno reach esplicito → niente
        // attacco mischia. Le melee tutte hanno reach=1 (D-049).
        const meleeCapable = w.range?.reach != null;
        // Threat in mischia: nemico melee con slancio > 0 minaccia → ranged vietato.
        const inMeleeThreat = enemies.some((e) => {
          const d = baseDistance(unit.position, e.position);
          return d <= 1 && e.slancio > 0;
        });
        for (const enemy of enemies) {
          const dist = baseDistance(unit.position, enemy.position);
          const meleeRange = w.range?.reach ?? 0; // 0 se no melee
          // Mischia: solo per armi melee-capable
          if (meleeCapable) {
            for (let mi = 0; mi < w.attackModes.length; mi++) {
              const mode = w.attackModes[mi];
              const label = `Attacca ${enemy.name} (${w.name} · ${mode.label})`;
              let reason: string | null = null;
              if (unit.actionTakenThisTurn) reason = 'azione già usata';
              else if (unit.dadiAzione < 1) reason = 'no dadi';
              else if (dist > meleeRange) reason = `fuori portata (${dist} > ${meleeRange})`;
              addItem(
                label,
                () => this.startAttackFlow(unit.id, enemy.id, w.id, mi, mode.stat === 'either' ? undefined : mode.stat, false),
                reason,
              );
            }
          }
          // Ranged: mostra solo se arma ha capacità ranged. Bloccato se in melee threat.
          const isRangedCapable = w.range && (w.range.distance != null || w.range.throw != null);
          if (isRangedCapable) {
            const canRanged = canFireRanged(unit, enemy, w.id, this.state.units);
            for (let mi = 0; mi < w.attackModes.length; mi++) {
              const mode = w.attackModes[mi];
              const losInfo = canRanged.los;
              const labelExtra = losInfo ? ` · vis ${losInfo.visibility}/7 · dist ${losInfo.distance}` : '';
              const label = `Spara a ${enemy.name} (${w.name}${labelExtra})`;
              let reason: string | null = null;
              if (unit.actionTakenThisTurn) reason = 'azione già usata';
              else if (unit.dadiAzione < 1) reason = 'no dadi';
              else if (inMeleeThreat) reason = 'minacciato in mischia (no ranged)';
              else if (!canRanged.ok) reason = canRanged.reason ?? 'non sparabile';
              addItem(
                label,
                () => this.startAttackFlow(unit.id, enemy.id, w.id, mi, mode.stat === 'either' ? undefined : mode.stat, true),
                reason,
              );
            }
          }
        }
      }
    }

    // D-051: attacco con OFFHAND (arma o scudo) per ogni nemico in melee.
    // - Arma in offhand: usa composeAttackRoll standard (es. arciere col pugnale)
    // - Scudo in offhand: usa composeShieldAttackRoll (no dadi, solo parry.fixed)
    //   NON consentito se in stance difensiva.
    if (unit.offhand && !unit.actionTakenThisTurn) {
      const offW = getWeapon(unit.offhand);
      const offS = getShield(unit.offhand);
      for (const enemy of enemies) {
        const dist = baseDistance(unit.position, enemy.position);
        if (offW) {
          // Arma in offhand: range = reach se ce l'ha, else 0 (no melee)
          const meleeRangeOff = offW.range?.reach ?? 0;
          if (offW.range?.reach != null) {
            for (let mi = 0; mi < offW.attackModes.length; mi++) {
              const mode = offW.attackModes[mi];
              const label = `Attacca ${enemy.name} (offhand: ${offW.name} · ${mode.label})`;
              let reason: string | null = null;
              if (unit.dadiAzione < 1) reason = 'no dadi';
              else if (dist > meleeRangeOff) reason = `fuori portata (${dist} > ${meleeRangeOff})`;
              addItem(
                label,
                () => this.startAttackFlow(unit.id, enemy.id, offW.id, mi, mode.stat === 'either' ? undefined : mode.stat, false),
                reason,
              );
            }
          }
        } else if (offS) {
          // Scudo in offhand: bludgeon attack, no dadi arma, solo parry.fixed
          const label = `Bludgeon ${enemy.name} (offhand: ${offS.name}, +${offS.parry.fixed} fissi)`;
          let reason: string | null = null;
          if (unit.dadiAzione < 1) reason = 'no dadi';
          else if (dist > 1) reason = `fuori portata (${dist} > 1)`;
          else if (unit.defensiveStance) reason = 'in stance difensiva';
          addItem(
            label,
            () => this.startAttackFlow(unit.id, enemy.id, offS.id, 0, undefined, false),
            reason,
          );
        }
      }
    }

    // Ricarica arma (es. balestra)
    if (unit.weapon) {
      const w = getWeapon(unit.weapon);
      if (w && w.range?.reload != null) {
        const label = `Ricarica ${w.name} (diff ${w.range.reload}, Forza)`;
        let reason: string | null = null;
        if (unit.weaponLoaded) reason = 'arma già carica';
        else if (unit.actionTakenThisTurn) reason = 'azione già usata';
        else if (unit.dadiAzione < 1) reason = 'no dadi';
        addItem(label, () => this.startReloadFlow(unit.id), reason);
      }
    }

    // Movimento: range = slancio + freeHex
    const freeHex = unit.hexMovedThisTurn === 0 ? 1 : 0;
    const moveRange = unit.slancio + freeHex;
    {
      const label = `Muovi (range ${moveRange}, slancio ${unit.slancio}${freeHex ? ' +1 gratis' : ''})`;
      const reason = moveRange === 0 ? 'no slancio' : null;
      addItem(label, () => this.startMoveMode(unit.id), reason);
    }

    // Posizione difensiva (solo se ha scudo offhand)
    if (unit.offhand) {
      const offShield = getShield(unit.offhand);
      if (offShield) {
        const label = unit.defensiveStance
          ? `🛡 Esci posizione difensiva (${offShield.name})`
          : `🛡 Posizione difensiva (${offShield.name}: imp ×2, RD ×2)`;
        const reason = unit.defensiveToggledThisTurn ? 'già toggled questo turno' : null;
        addItem(label, () => {
          this.dispatch({ type: 'TOGGLE_DEFENSIVE', unitId: unit.id });
          this.startCurrentTurnFlow();
        }, reason);
      }
    }

    items.push({
      label: 'Passa turno (Spazio)',
      onClick: () => this.passTurn(),
    });

    this.menu.setItems(items);
  }

  /** Esegue il passa turno in modo robusto: pulisce overlay/move-mode, dispatch END_TURN, avvia next */
  private passTurn(): void {
    // Cleanup difensivo: nessun overlay residuo, niente move mode
    this.handoff.hide();
    this.diceUI.hide();
    this.board.clearHighlightedMove(); this.board.clearHighlightedThreat();
    this.board.setExternalClickHandler(null);
    // Svuota menu per evitare doppi click
    this.menu.setItems([]);

    this.dispatch({ type: 'END_TURN' });
    // eslint-disable-next-line no-console
    console.info('[BattleScene] Post END_TURN: phase=', this.state.phase, 'turnIdx=', this.state.currentTurnIdx);
    this.startCurrentTurnFlow();
  }

  /** Box scelta dadi per ricarica arma (tiro abilità Forza vs difficoltà arma.reload) */
  private startReloadFlow(unitId: UnitId): void {
    const unit = this.state.units[unitId];
    if (!unit || !unit.weapon) return;
    const weapon = getWeapon(unit.weapon);
    if (!weapon || weapon.range?.reload == null) return;

    const ctx = {
      azione: 'ricaricare' as const,
      stat: 'forza' as const,
      classeOggetto: weapon.category,
      oggettoSpecifico: weapon.id,
    };
    const maxN = Math.min(unit.dadiAzione, 2 + countMaxDiceExtra(unit.skills, ctx));
    const minN = Math.min(1, maxN);
    const choices: number[] = [];
    for (let i = minN; i <= maxN; i++) choices.push(i);

    const flat = countFlatBonuses(unit.skills, ctx);
    const forced = countForcedExtraDice(unit.skills, ctx);
    const imp = getImpedimentTotal(unit);
    const info: string[] = [
      `Arma: ${weapon.name} (scarica)`,
      `Stat: Forza · Difficoltà: ${weapon.range.reload}`,
      `Tiro: 1-${maxN} d6 + 2 fissi`,
    ];
    if (forced > 0) info.push(`+${forced} dado/i forzati (skill)`);
    if (flat > 0) info.push(`+${flat} al tiro (skill)`);
    if (imp > 0) info.push(`− ${imp} impedimento`);
    info.push(`Successo se totale ≥ ${weapon.range.reload}`);
    info.push(`Fallimento: nessuna penalità, ritenta al prossimo turno`);

    this.diceUI.show({
      title: `${unit.name} — Ricarica ${weapon.name}`,
      subtitle: `Scegli i dadi (${minN}..${maxN})`,
      infoLines: info,
      choices,
      onChoose: (n) => {
        this.dispatch({ type: 'RELOAD', unitId: unit.id, diceN: n });
        this.showActionMenu();
      },
    });
  }

  /** Modalità movimento: highlight raggiungibili, click per selezionare destinazione */
  private startMoveMode(unitId: UnitId): void {
    const unit = this.state.units[unitId];
    if (!unit) return;

    // Calcola blocked: hex coperti da basette di altre unità vive.
    const blocked = new Set<string>();
    for (const other of Object.values(this.state.units)) {
      if (other.id === unit.id || !other.alive) continue;
      for (const h of getBaseHexes(other.position)) blocked.add(`${h.q},${h.r}`);
    }
    const passable = (h: Axial) => !blocked.has(`${h.q},${h.r}`);

    // Range = slancio + (1 se non ho ancora mosso questo turno, altrimenti 0)
    const freeHex = unit.hexMovedThisTurn === 0 ? 1 : 0;
    const reachable = reachableHexes(unit.position, unit.slancio + freeHex, { passable });

    // Filtra: highlight solo hex DAVVERO raggiungibili = basetta destinazione non
    // overlap + path intero (hexLine) senza step in overlap. Cosi il giocatore
    // NON vede hex gialli "trappola" che il reducer poi rifiuta.
    const baseOverlap = (h: Axial): boolean => {
      for (const bh of getBaseHexes(h)) {
        if (blocked.has(`${bh.q},${bh.r}`)) return true;
      }
      return false;
    };
    const pathClear = (to: Axial): boolean => {
      const line = hexLine(unit.position, to);
      for (let i = 1; i < line.length; i++) {
        if (baseOverlap(line[i])) return false;
      }
      return true;
    };
    const reachHexes: Axial[] = [];
    for (const r of reachable.values()) {
      if (r.hex.q === unit.position.q && r.hex.r === unit.position.r) continue;
      if (baseOverlap(r.hex)) continue;
      if (!pathClear(r.hex)) continue;
      reachHexes.push(r.hex);
    }
    // Re-build set di hex validi (per check al click)
    const validKeys = new Set(reachHexes.map((h) => `${h.q},${h.r}`));
    this.board.setHighlightedMove(reachHexes);

    // Zone di minaccia: hex entro reach (>= 1) di nemici eligibili con slancio>0
    // e arma melee. Regola V2 universale: tutte le armi melee triggerano l'asta.
    // L'utente vede in rosso/arancio dove rischia di entrare in asta.
    const threatHexes: Axial[] = [];
    for (const other of Object.values(this.state.units)) {
      if (other.id === unit.id || !other.alive) continue;
      if (other.faction === unit.faction) continue;
      if (other.slancio <= 0) continue;
      if (!other.weapon) continue;
      const w = getWeapon(other.weapon);
      if (!w || !w.range || w.range.reach == null || w.range.reach < 4) continue;
      // Tutti gli hex entro reach del centro nemico
      const reach = w.range.reach;
      const otherPos = other.position;
      const inThreatRange = reachHexes.filter(
        (h) => Math.max(
          Math.abs(h.q - otherPos.q),
          Math.abs(h.r - otherPos.r),
          Math.abs((h.q + h.r) - (otherPos.q + otherPos.r)),
        ) <= reach,
      );
      threatHexes.push(...inThreatRange);
    }
    this.board.setHighlightedThreat(threatHexes);
    this.menu.setItems([
      {
        label: 'Annulla movimento',
        onClick: () => {
          this.board.clearHighlightedMove(); this.board.clearHighlightedThreat();
          this.board.setExternalClickHandler(null);
          this.showActionMenu();
        },
      },
    ]);

    this.board.setExternalClickHandler((hex) => {
      if (hex === null) return;
      const k = `${hex.q},${hex.r}`;
      // Solo hex evidenziati (già filtrati per overlap basetta + path)
      if (!validKeys.has(k)) return;

      this.dispatch({ type: 'MOVE', unitId: unit.id, targetHex: hex });
      this.board.clearHighlightedMove(); this.board.clearHighlightedThreat();
      this.board.setExternalClickHandler(null);
      // Fase 1: il dispatch può aver portato in awaiting-attacker-bid (zona di controllo).
      this.processMovementPhase();
    });
  }

  /** Sequenza completa di un attacco: dichiara → (carica?) → attaccante dadi → difensore dadi → resolve */
  private startAttackFlow(
    attackerId: UnitId,
    targetId: UnitId,
    weaponId: string,
    modeIdx: number,
    chosenStat: 'forza' | 'agilità' | 'volontà' | undefined,
    isRanged: boolean,
  ): void {
    this.menu.setItems([]); // pulisce per non confondere
    this.dispatch({
      type: 'DECLARE_ATTACK',
      attackerId,
      targetId,
      weaponId,
      attackModeIdx: modeIdx,
      chosenStat,
      isRanged,
    });

    // Fase 1: se il reducer è entrato in awaiting-carica, mostra prima la scelta carica.
    if (this.state.phase === 'awaiting-carica') {
      this.askCarica(attackerId, () =>
        this.askAttackerDice(attackerId, targetId, weaponId, modeIdx, chosenStat, isRanged),
      );
      return;
    }

    this.askAttackerDice(attackerId, targetId, weaponId, modeIdx, chosenStat, isRanged);
  }

  /** Step di scelta dadi attaccante. Estratto da startAttackFlow per essere richiamabile dopo askCarica. */
  private askAttackerDice(
    attackerId: UnitId,
    targetId: UnitId,
    weaponId: string,
    modeIdx: number,
    chosenStat: 'forza' | 'agilità' | 'volontà' | undefined,
    isRanged: boolean,
  ): void {
    const attacker = this.state.units[attackerId];
    const target = this.state.units[targetId];
    const weapon = getWeapon(weaponId)!;
    const mode = weapon.attackModes[modeIdx];
    const ctx = makeAttackContext(weaponId, weapon.category, chosenStat);
    const standardMax = 2 + countMaxDiceExtra(attacker.skills, ctx);
    const maxN = Math.min(attacker.dadiAzione, standardMax);
    const minN = Math.min(1, maxN);
    const choices: number[] = [];
    for (let i = minN; i <= maxN; i++) choices.push(i);

    // Breakdown bonus al tiro
    const flat = countFlatBonuses(attacker.skills, ctx);
    const forced = countForcedExtraDice(attacker.skills, ctx);
    const imp = getImpedimentTotal(attacker);
    const carica = this.state.pendingAction?.caricaAmount ?? 0;
    const info: string[] = [
      `Arma: ${weapon.name} — ${mode.label}`,
      `Tiro PG: 1-${maxN} d6 + 2 fissi  (pool dadi: ${attacker.dadiAzione}, cap regola: ${standardMax})`,
      `Bonus arma: ${mode.diceVariable > 0 ? `+${mode.diceVariable}d6 ` : ''}+${mode.fixedBonus} fissi`,
    ];
    if (forced > 0) info.push(`+${forced} dado/i forzati (skill)`);
    if (flat > 0) info.push(`+${flat} al tiro (skill)`);
    if (imp > 0) info.push(`− ${imp} impedimento`);
    if (carica > 0) info.push(`+${carica} bonus carica`);
    if (isRanged) {
      info.push(`(Ranged: bonus visibilità + malus distanza/slancio target applicati al tiro)`);
    }

    this.diceUI.show({
      title: `${attacker.name} attacca ${target.name}`,
      subtitle: `${isRanged ? 'Tiro a distanza' : 'Mischia'} — scegli i dadi PG (${minN}..${maxN})`,
      infoLines: info,
      choices,
      onChoose: (n) => {
        this.dispatch({ type: 'CHOOSE_ATTACKER_DICE', diceN: n });
        if (isRanged) {
          this.dispatchResolveCombat();
          this.afterCombat();
          return;
        }
        // Mischia: difensore decide. Se è AI, scegli auto e risolvi.
        const target2 = this.state.units[targetId];
        if (target2 && this.controlMode[target2.faction] === 'ai') {
          const isHard = this.aiLevel[target2.faction] === 'hard';
          let defType: 'parry' | 'dodge' | 'none';
          let parryWith: 'weapon' | 'offhand' | undefined;
          let defDice: number;
          if (isHard) {
            const e = aiDecideHard(this.state, targetId);
            if (e.type === 'CHOOSE_DEFENSE') {
              defType = e.defenseType;
              parryWith = e.parryWith;
              defDice = e.diceN;
            } else {
              const def = aiDecideDefense(this.state, targetId);
              defType = def.defenseType;
              parryWith = def.parryWith;
              defDice = def.diceN;
            }
          } else {
            const def = aiDecideDefense(this.state, targetId);
            defType = def.defenseType;
            parryWith = def.parryWith;
            defDice = def.diceN;
          }
          this.dispatch({
            type: 'CHOOSE_DEFENSE',
            defenseType: defType,
            parryWith,
            diceN: defDice,
          });
          this.dispatchResolveCombat();
          this.afterCombat();
          return;
        }
        // Difensore umano: scelta manuale immediata
        this.askDefense(targetId);
      },
    });
  }

  /**
   * Fase 1 — Carica: l'attaccante decide il bonus carica (0..min(delta_dist, slancio)).
   * Se attaccante AI: scelta automatica + dispatch + onContinue.
   * Se umano: DiceChoiceUI.
   */
  private askCarica(attackerId: UnitId, onContinue: () => void): void {
    const u = this.state.units[attackerId];
    const pa = this.state.pendingAction;
    if (!u || !pa) {
      // Stato corrotto: prosegui comunque
      this.dispatch({ type: 'CHOOSE_CARICA', amount: 0 });
      onContinue();
      return;
    }
    const target = this.state.units[pa.targetId];
    if (!target || !u.positionAtTurnStart) {
      this.dispatch({ type: 'CHOOSE_CARICA', amount: 0 });
      onContinue();
      return;
    }
    const dStart = baseDistance(u.positionAtTurnStart, target.position);
    const dNow = baseDistance(u.position, target.position);
    const delta = Math.max(0, dStart - dNow);
    const maxC = Math.max(0, Math.min(delta, u.slancio));

    if (this.controlMode[u.faction] === 'ai') {
      const amount = aiDecideCarica(this.state, attackerId);
      this.dispatch({ type: 'CHOOSE_CARICA', amount });
      onContinue();
      return;
    }

    // Edge case: maxC=0 (slancio=0 o delta=0). Skip UI, dispatch 0 e prosegui.
    if (maxC <= 0) {
      this.dispatch({ type: 'CHOOSE_CARICA', amount: 0 });
      onContinue();
      return;
    }

    const choices: number[] = [];
    for (let i = 0; i <= maxC; i++) choices.push(i);
    const info: string[] = [
      `Hex avvicinati: ${delta} (max bonus carica)`,
      `Slancio attuale: ${u.slancio}`,
      `Ogni punto carica = +1 alla fissa atk e −1 slancio`,
    ];

    this.diceUI.show({
      title: `${u.name} — Carica`,
      subtitle: `Scegli bonus carica (0..${maxC})`,
      infoLines: info,
      choices,
      onChoose: (n) => {
        this.dispatch({ type: 'CHOOSE_CARICA', amount: n });
        onContinue();
      },
    });
  }

  /**
   * Fase 1 — Asta movimento: orchestratore chiamato dopo MOVE o BID_MOVEMENT.
   * - awaiting-attacker-bid → askAttackerBid (umano o AI)
   * - awaiting-defender-bid → askDefenderBid (con handoff se atk era umano)
   * - choosing-action → showActionMenu o scheduleAiTurn (se è il turno di un'AI)
   * - altri stati → no-op (gestito altrove)
   */
  private processMovementPhase(): void {
    if (this.state.phase === 'awaiting-attacker-bid') {
      this.askAttackerBid();
      return;
    }
    if (this.state.phase === 'awaiting-defender-bid') {
      this.askDefenderBid();
      return;
    }
    if (this.state.phase === 'choosing-action') {
      const unitId = this.state.turnOrder[this.state.currentTurnIdx];
      const unit = this.state.units[unitId];
      if (unit && this.controlMode[unit.faction] === 'ai') {
        this.scheduleAiTurn();
        return;
      }
      this.showActionMenu();
      return;
    }
    // game-over: nothing to do
    if (this.state.phase === 'game-over') {
      this.showGameOver();
    }
  }

  /** Asta — l'attaccante punta privatamente. Dopo dispatch, passa a defender bid. */
  private askAttackerBid(): void {
    audio.biddingStart(); // suono apertura asta
    const mip = this.state.moveInProgress;
    if (!mip) return;
    const atk = this.state.units[mip.unitId];
    if (!atk) return;

    if (this.controlMode[atk.faction] === 'ai') {
      const amount = aiDecideBidMovement(this.state, atk.id);
      this.dispatch({ type: 'BID_MOVEMENT', amount });
      this.processMovementPhase();
      return;
    }

    // Edge case: slancio=0 → unica scelta possibile = 0. Auto-dispatch.
    if (atk.slancio <= 0) {
      this.dispatch({ type: 'BID_MOVEMENT', amount: 0 });
      this.processMovementPhase();
      return;
    }

    const def = mip.defenderId ? this.state.units[mip.defenderId] : null;
    const maxB = atk.slancio;
    const choices: number[] = [];
    for (let i = 0; i <= maxB; i++) choices.push(i);

    this.diceUI.show({
      title: `${atk.name} — Asta movimento (attaccante)`,
      subtitle: `Tenta di passare la zona di controllo${def ? ` di ${def.name}` : ''}. Puntata 0..${maxB}`,
      infoLines: [
        `Slancio attuale: ${atk.slancio}`,
        `Vince chi punta più alto (parità → attaccante).`,
        `Entrambi pagano la propria puntata in slancio.`,
        `La tua scelta resta privata fino alla rivelazione.`,
      ],
      choices,
      onChoose: (n) => {
        this.dispatch({ type: 'BID_MOVEMENT', amount: n });
        this.processMovementPhase();
      },
    });
  }

  /** Asta — il difensore punta. Se atk era umano, mostra handoff per privacy. */
  private askDefenderBid(): void {
    const mip = this.state.moveInProgress;
    if (!mip || !mip.defenderId) return;
    const def = this.state.units[mip.defenderId];
    const atk = this.state.units[mip.unitId];
    if (!def || !atk) return;

    if (this.controlMode[def.faction] === 'ai') {
      const amount = aiDecideBidMovement(this.state, def.id);
      this.dispatch({ type: 'BID_MOVEMENT', amount });
      this.processMovementPhase();
      return;
    }

    // Edge case: difensore senza slancio → puntata forzata a 0.
    if (def.slancio <= 0) {
      this.dispatch({ type: 'BID_MOVEMENT', amount: 0 });
      this.processMovementPhase();
      return;
    }

    const showBidUI = () => {
      const maxB = def.slancio;
      const choices: number[] = [];
      for (let i = 0; i <= maxB; i++) choices.push(i);
      this.diceUI.show({
        title: `${def.name} — Asta movimento (difensore)`,
        subtitle: `${atk.name} prova ad attraversare. Puntata 0..${maxB}`,
        infoLines: [
          `Slancio attuale: ${def.slancio}`,
          `Vince chi punta più alto (parità → attaccante).`,
          `Entrambi pagano la propria puntata in slancio.`,
        ],
        choices,
        onChoose: (n) => {
          this.dispatch({ type: 'BID_MOVEMENT', amount: n });
          this.processMovementPhase();
        },
      });
    };

    const atkWasHuman = this.controlMode[atk.faction] === 'human';
    if (atkWasHuman) {
      this.handoff.show(
        `Passa il controllo a ${def.name}`,
        `${atk.name} ha scelto la propria puntata in segreto. Tocca a te decidere se difendere la zona di controllo.`,
        showBidUI,
      );
    } else {
      showBidUI();
    }
  }

  private askDefense(targetId: UnitId, resumeAiAfter = false): void {
    const target = this.state.units[targetId];
    if (!target) return;
    const pa = this.state.pendingAction;
    const attacker = pa ? this.state.units[pa.attackerId] : null;
    const attackerWeapon = pa ? getWeapon(pa.weaponId) : null;

    // Tipi di difesa disponibili
    const defenseTypes: Array<{ label: string; type: 'parry' | 'dodge' | 'none'; parryWith?: 'weapon' | 'offhand' }> = [];
    defenseTypes.push({ label: 'Schivata', type: 'dodge' });

    if (target.weapon) {
      const w = getWeapon(target.weapon);
      if (w && w.parry !== null) {
        defenseTypes.push({ label: `Parata (${w.name})`, type: 'parry', parryWith: 'weapon' });
      }
    }
    if (target.offhand) {
      const w = getWeapon(target.offhand);
      const sh = getShield(target.offhand);
      if (w && w.parry !== null) {
        defenseTypes.push({ label: `Parata (${w.name})`, type: 'parry', parryWith: 'offhand' });
      } else if (sh) {
        defenseTypes.push({ label: `Parata (${sh.name})`, type: 'parry', parryWith: 'offhand' });
      }
    }
    defenseTypes.push({ label: 'Niente difesa', type: 'none' });

    const items: ActionMenuItem[] = defenseTypes.map((d) => ({
      label: d.label,
      onClick: () => {
        if (d.type === 'none') {
          this.dispatch({ type: 'CHOOSE_DEFENSE', defenseType: 'none', diceN: 0 });
          this.dispatchResolveCombat();
          this.afterCombat();
          if (resumeAiAfter) this.scheduleAiTurn();
          return;
        }
        // Box scelta dadi con info sul tiro difensivo
        const ctx = d.type === 'dodge'
          ? makeDodgeContext()
          : makeParryContext(
              d.parryWith === 'weapon' ? target.weapon! : target.offhand!,
              (d.parryWith === 'weapon'
                ? getWeapon(target.weapon!)?.category
                : (getWeapon(target.offhand!)?.category ?? getShield(target.offhand!)?.category))!,
            );
        const maxN = Math.min(target.dadiAzione, 2 + countMaxDiceExtra(target.skills, ctx));
        const minN = Math.min(1, maxN);
        const choices: number[] = [];
        for (let i = minN; i <= maxN; i++) choices.push(i);

        // Bonus tiro difensivo
        const flat = countFlatBonuses(target.skills, ctx);
        const forced = countForcedExtraDice(target.skills, ctx);
        const imp = getImpedimentTotal(target);
        const info: string[] = [];
        if (attacker && attackerWeapon) {
          // Privacy: NON mostrare quanti dadi ha scelto l'attaccante (regola "scelte simultanee private")
          info.push(`Attacco: ${attacker.name} con ${attackerWeapon.name}`);
          info.push('');
        }
        info.push(`${d.type === 'dodge' ? 'Schivata' : 'Parata'}: 1-${maxN} d6 + 2 fissi`);
        if (d.type === 'parry') {
          // Aggiungi bonus arma/scudo
          const itemId = d.parryWith === 'weapon' ? target.weapon! : target.offhand!;
          const wp = getWeapon(itemId);
          const sh = getShield(itemId);
          const ps = wp?.parry ?? sh?.parry;
          if (ps) {
            info.push(`Bonus ${wp?.name ?? sh?.name}: ${ps.dice > 0 ? `+${ps.dice}d6 ` : ''}+${ps.fixed} fissi`);
          }
        }
        if (forced > 0) info.push(`+${forced} dado/i forzati (skill)`);
        if (flat > 0) info.push(`+${flat} al tiro (skill)`);
        if (imp > 0) info.push(`− ${imp} impedimento`);
        info.push('');
        info.push(d.type === 'dodge'
          ? 'Schivata: morde solo i DADI dell\'attaccante'
          : 'Parata: morde l\'intero tiro dell\'attaccante');

        this.diceUI.show({
          title: `${target.name} — ${d.label}`,
          subtitle: `Scegli i dadi (${minN}..${maxN})`,
          infoLines: info,
          choices,
          onChoose: (n) => {
            this.dispatch({ type: 'CHOOSE_DEFENSE', defenseType: d.type, parryWith: d.parryWith, diceN: n });
            this.dispatchResolveCombat();
            this.afterCombat();
            if (resumeAiAfter) this.scheduleAiTurn();
          },
        });
      },
    }));
    this.menu.setItems(items);
  }

  private afterCombat(): void {
    // Cleanup overlay residui
    this.handoff.hide();
    this.diceUI.hide();
    if (this.state.phase === 'game-over') {
      this.showGameOver();
      return;
    }
    // Torna al menu azioni del giocatore corrente
    this.showActionMenu();
  }

  /** Mostra l'overlay di fine partita (non-opaco) e svuota il menu azioni; il log resta visibile. */
  private showGameOver(): void {
    if (!this.state.winner) return;
    // Pulisce menu/handoff/dice per non lasciare residui
    this.menu.setItems([]);
    this.handoff.hide();
    this.diceUI.hide();
    this.board.clearHighlightedMove(); this.board.clearHighlightedThreat();
    this.board.setExternalClickHandler(null);

    // Audio: vittoria/sconfitta in base al vincitore.
    // Per "humanvs AI" semplifichiamo: se il vincitore è 'A' (default human) → vittoria.
    if (this.state.winner === 'A') audio.victory();
    else if (this.state.winner === 'B') audio.defeat();

    this.gameOverOverlay.show(this.state.winner, () => {
      this.scene.start('MainMenuScene');
    });
  }
}

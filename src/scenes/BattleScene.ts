import Phaser from 'phaser';
import { HexBoard } from '@ui/HexBoard';
import { UnitSprite } from '@ui/UnitSprite';
import { HUD } from '@ui/HUD';
import { CombatLog } from '@ui/CombatLog';
import { ActionMenu, ActionMenuItem } from '@ui/ActionMenu';
import { DiceChoiceUI } from '@ui/DiceChoiceUI';
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
import { FactionId } from '@entities/Unit';
import { getScenario, TutorialScenario, TutorialStep } from '@data/tutorial';
import { TutorialOverlay } from '@ui/TutorialOverlay';
import { saveCompletion } from '@scenes/TutorialMenuScene';
import { audio } from '@utils/audio';

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
  private handoff!: HandoffOverlay;
  private gameOverOverlay!: GameOverOverlay;

  /** Modalità di controllo per fazione (default: A umano vs B AI) */
  private controlMode: Record<FactionId, 'human' | 'ai'> = { A: 'human', B: 'ai' };

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
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panCamStartX = 0;
  private panCamStartY = 0;
  /** Touch: distanza tra 2 dita all'inizio del pinch */
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  /** Drag-pan a un dito (touch): scattato dopo che il dito si è mosso > soglia */
  private touchPanActive = false;
  private touchPanStartX = 0;
  private touchPanStartY = 0;
  private touchPanCamStartX = 0;
  private touchPanCamStartY = 0;
  /** Soglia in px per considerare un drag (deadzone). Sotto = click, sopra = pan. */
  private static readonly TOUCH_DRAG_THRESHOLD = 12;

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
    }
  }

  create(): void {
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
    const bounds = this.board.getWorldBounds();
    cam.setBounds(0, 0, bounds.width, bounds.height);
    cam.setZoom(1.0);
    cam.centerOn(bounds.width / 2, bounds.height / 2);

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _g: unknown, _dx: number, dy: number) => {
      const newZoom = Phaser.Math.Clamp(
        cam.zoom - Math.sign(dy) * GAME_CONFIG.camera.zoomStep,
        GAME_CONFIG.camera.zoomMin,
        GAME_CONFIG.camera.zoomMax,
      );
      cam.setZoom(newZoom);
    });

    // Pan camera con tasto destro/medio (mouse desktop)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 1 || pointer.button === 2) {
        this.isPanning = true;
        this.panStartX = pointer.x;
        this.panStartY = pointer.y;
        this.panCamStartX = cam.scrollX;
        this.panCamStartY = cam.scrollY;
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isPanning) return;
      const dx = (pointer.x - this.panStartX) / cam.zoom;
      const dy = (pointer.y - this.panStartY) / cam.zoom;
      cam.scrollX = this.panCamStartX - dx;
      cam.scrollY = this.panCamStartY - dy;
    });
    this.input.on('pointerup', () => {
      this.isPanning = false;
    });
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.input.mouse?.disableContextMenu();

    // Touch: pinch-zoom + drag-pan a un dito
    this.setupTouchGestures(cam);
  }

  /** Gesture touch: pan-1-dito (con deadzone) + pinch-zoom-2-dita */
  private setupTouchGestures(cam: Phaser.Cameras.Scene2D.Camera): void {
    const canvas = this.game.canvas;

    canvas.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (e.touches.length === 2) {
          // Pinch start
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          this.pinchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          this.pinchStartZoom = cam.zoom;
          this.touchPanActive = false;
        } else if (e.touches.length === 1) {
          // Setup potential pan
          const t0 = e.touches[0];
          this.touchPanStartX = t0.clientX;
          this.touchPanStartY = t0.clientY;
          this.touchPanCamStartX = cam.scrollX;
          this.touchPanCamStartY = cam.scrollY;
          this.touchPanActive = false; // attivato solo dopo movimento > threshold
        }
      },
      { passive: false },
    );

    canvas.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (e.touches.length === 2 && this.pinchStartDist > 0) {
          e.preventDefault();
          const t0 = e.touches[0];
          const t1 = e.touches[1];
          const newDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
          const ratio = newDist / this.pinchStartDist;
          const newZoom = Phaser.Math.Clamp(
            this.pinchStartZoom * ratio,
            GAME_CONFIG.camera.zoomMin,
            GAME_CONFIG.camera.zoomMax,
          );
          cam.setZoom(newZoom);
        } else if (e.touches.length === 1) {
          const t0 = e.touches[0];
          const dx = t0.clientX - this.touchPanStartX;
          const dy = t0.clientY - this.touchPanStartY;
          const dist = Math.hypot(dx, dy);

          // Attiva pan solo dopo soglia (deadzone — sotto è considerato click/tap)
          if (!this.touchPanActive && dist > BattleScene.TOUCH_DRAG_THRESHOLD) {
            this.touchPanActive = true;
          }
          if (this.touchPanActive) {
            e.preventDefault();
            cam.scrollX = this.touchPanCamStartX - dx / cam.zoom;
            cam.scrollY = this.touchPanCamStartY - dy / cam.zoom;
          }
        }
      },
      { passive: false },
    );

    canvas.addEventListener(
      'touchend',
      () => {
        this.pinchStartDist = 0;
        // Non resettare touchPanActive subito — Phaser pointerup viene processato dopo;
        // se touchPanActive è true, vogliamo bloccare il "click" finale.
        // Strategia: lasciamo che il flag persista per ~50ms, poi reset.
        if (this.touchPanActive) {
          // Notifica HexBoard di ignorare l'imminente pointerup come click
          // Lo facciamo via flag globale leggibile da HexBoard / handler.
          // (Implementato in pointerdown/up handler della scene: vedi sotto.)
          setTimeout(() => {
            this.touchPanActive = false;
          }, 50);
        }
      },
      { passive: true },
    );
  }

  /** True se l'ultimo touch è stato un drag-pan (non un click). HexBoard lo legge per ignorare il click. */
  isTouchPanActive(): boolean {
    return this.touchPanActive;
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
    // Menu: ancorato in alto a destra
    this.menu = new ActionMenu(this, this.scale.width - 300, 140);
    this.diceUI = new DiceChoiceUI(this);
    this.handoff = new HandoffOverlay(this);
    this.gameOverOverlay = new GameOverOverlay(this);
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
    this.gameOverOverlay.destroy?.();
    this.handoff = new HandoffOverlay(this);
    this.diceUI = new DiceChoiceUI(this);
    this.gameOverOverlay = new GameOverOverlay(this);

    // Riposiziona log (rimane in basso-sinistra) e menu (in alto-destra)
    const logW = Math.min(420, this.scale.width * 0.45);
    const logH = Math.min(220, this.scale.height * 0.28);
    this.log.relayout?.(20, this.scale.height - logH - 20, logW, logH);
    this.menu.setPosition(this.scale.width - 300, 140);

    // Camera: i bounds della mappa restano gli stessi (la mappa è fissa);
    // ricentra solo se l'attuale scroll è fuori dai nuovi limiti del viewport.
    const cam = this.cameras.main;
    const bounds = this.board.getWorldBounds();
    cam.setBounds(0, 0, bounds.width, bounds.height);

    this.refreshUI();
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.keys) return;
    const cam = this.cameras.main;
    const dt = deltaMs / 1000;
    const speed = GAME_CONFIG.camera.panSpeed / cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) dx -= speed * dt;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx += speed * dt;
    if (this.keys.W.isDown || this.keys.UP.isDown) dy -= speed * dt;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) dy += speed * dt;
    if (dx !== 0 || dy !== 0) {
      cam.scrollX += dx;
      cam.scrollY += dy;
    }
  }

  /** Aggiorna UI a partire dallo state corrente */
  private refreshUI(): void {
    this.hud.update(this.state);
    this.log.update(this.state.log);
    for (const [id, sprite] of this.unitSprites) {
      const u = this.state.units[id];
      if (u) sprite.update(u);
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
    // Animazione movimento: confronta posizioni prima/dopo
    this.maybeTweenMovement(prev, this.state);
    this.refreshUI();
    // Tutorial: dopo ogni dispatch, verifica trigger step + obiettivo
    if (this.tutorialScenario && !this.tutorialCompleted) {
      this.checkTutorialTrigger();
      this.checkTutorialObjective();
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
    for (const id of Object.keys(curr.units)) {
      const before = prev.units[id]?.hp ?? 0;
      const after = curr.units[id]?.hp ?? 0;
      const lost = before - after;
      if (lost > 0) {
        anyHit = true;
        const sprite = this.unitSprites.get(id);
        if (sprite) {
          sprite.flashHit(this);
          sprite.showDamage(this, lost);
        }
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
        sprite.showText(this, txt);
      }
      anyMiss = true;
    }
    // Audio
    if (anyHit) audio.hit();
    else if (anyMiss) audio.miss();
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

    // Se l'unità è AI: salta handoff e gioca automaticamente
    if (this.controlMode[unit.faction] === 'ai') {
      const slancioN = aiDecideSlancio(this.state, unit.id);
      this.dispatch({ type: 'START_TURN', slancioDice: slancioN });
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
    this.time.delayedCall(600, () => this.executeAiAction());
  }

  private executeAiAction(): void {
    if (this.state.phase !== 'choosing-action') return;
    const unitId = this.state.turnOrder[this.state.currentTurnIdx];
    const unit = this.state.units[unitId];
    if (!unit) return;
    if (this.controlMode[unit.faction] !== 'ai') return;

    const event = aiDecideAction(this.state, unit.id);
    this.dispatch(event);

    if (event.type === 'DECLARE_ATTACK') {
      // Fase 1: gestisci awaiting-carica per AI.
      // Cast a string per la narrowing di TS dopo dispatch (modifica side-effect non tracciata).
      if ((this.state.phase as string) === 'awaiting-carica') {
        const amount = aiDecideCarica(this.state, unit.id);
        this.dispatch({ type: 'CHOOSE_CARICA', amount });
      }
      const diceN = aiDecideAttackerDice(this.state, unit.id);
      this.dispatch({ type: 'CHOOSE_ATTACKER_DICE', diceN });

      if (event.isRanged) {
        // Risolvi direttamente
        this.dispatch({ type: 'RESOLVE_COMBAT' });
        this.afterCombat();
        this.scheduleAiTurn();
        return;
      }

      // Mischia: difensore decide
      const targetId = event.targetId;
      const target = this.state.units[targetId];
      if (this.controlMode[target.faction] === 'ai') {
        const def = aiDecideDefense(this.state, targetId);
        this.dispatch({
          type: 'CHOOSE_DEFENSE',
          defenseType: def.defenseType,
          parryWith: def.parryWith,
          diceN: def.diceN,
        });
        this.dispatch({ type: 'RESOLVE_COMBAT' });
        this.afterCombat();
        this.scheduleAiTurn();
      } else {
        // Difensore umano: scelta manuale immediata (no handoff)
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
      title: `${unit.name} — Tiro slancio`,
      subtitle: `Scegli quanti dadi tirare (0..${maxN})`,
      infoLines: info,
      choices,
      onChoose: (n) => {
        this.dispatch({ type: 'START_TURN', slancioDice: n });
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
    if (unit.weapon) {
      const w = getWeapon(unit.weapon);
      if (w) {
        for (const enemy of enemies) {
          // Mischia (anche reach se l'arma ha portata)
          const dist = baseDistance(unit.position, enemy.position);
          const meleeRange = w.range?.reach ?? 1;
          if (dist <= meleeRange) {
            for (let mi = 0; mi < w.attackModes.length; mi++) {
              const mode = w.attackModes[mi];
              items.push({
                label: `Attacca ${enemy.name} (${w.name} · ${mode.label})`,
                onClick: () => this.startAttackFlow(unit.id, enemy.id, w.id, mi, mode.stat === 'either' ? undefined : mode.stat, false),
              });
            }
          }

          // Ranged
          const canRanged = canFireRanged(unit, enemy, w.id, this.state.units);
          if (canRanged.ok) {
            const losInfo = canRanged.los!;
            for (let mi = 0; mi < w.attackModes.length; mi++) {
              const mode = w.attackModes[mi];
              items.push({
                label: `Spara a ${enemy.name} (${w.name} · vis ${losInfo.visibility}/7 · dist ${losInfo.distance})`,
                onClick: () => this.startAttackFlow(unit.id, enemy.id, w.id, mi, mode.stat === 'either' ? undefined : mode.stat, true),
              });
            }
          }
        }
      }
    }

    // Ricarica arma (es. balestra): se scarica, offri azione di ricarica
    if (unit.weapon) {
      const w = getWeapon(unit.weapon);
      if (w && w.range?.reload != null && !unit.weaponLoaded && unit.dadiAzione > 0) {
        items.push({
          label: `Ricarica ${w.name} (diff ${w.range.reload}, Forza)`,
          onClick: () => this.startReloadFlow(unit.id),
        });
      }
    }

    // Movimento: range = slancio + (1 se non ho ancora mosso, altrimenti 0)
    const freeHex = unit.hexMovedThisTurn === 0 ? 1 : 0;
    const moveRange = unit.slancio + freeHex;
    if (moveRange > 0) {
      items.push({
        label: `Muovi (range ${moveRange}, slancio ${unit.slancio}${freeHex ? ' +1 gratis' : ''})`,
        onClick: () => this.startMoveMode(unit.id),
      });
    }

    // Fase 1: posizione difensiva con scudo (gratuita, max 1 toggle/turno, solo scudi veri)
    if (unit.offhand && !unit.defensiveToggledThisTurn) {
      const offShield = getShield(unit.offhand);
      if (offShield) {
        const label = unit.defensiveStance
          ? `🛡 Esci posizione difensiva (${offShield.name})`
          : `🛡 Posizione difensiva (${offShield.name}: imp ×2, RD ×2)`;
        items.push({
          label,
          onClick: () => {
            this.dispatch({ type: 'TOGGLE_DEFENSIVE', unitId: unit.id });
            this.startCurrentTurnFlow();
          },
        });
      }
    }

    items.push({
      label: 'Passa turno (Spazio)',
      onClick: () => {
        // eslint-disable-next-line no-console
        console.info('[BattleScene] Passa turno cliccato. Phase:', this.state.phase, 'unit:', unit.id);
        this.passTurn();
      },
    });

    this.menu.setItems(items);
  }

  /** Esegue il passa turno in modo robusto: pulisce overlay/move-mode, dispatch END_TURN, avvia next */
  private passTurn(): void {
    // Cleanup difensivo: nessun overlay residuo, niente move mode
    this.handoff.hide();
    this.diceUI.hide();
    this.board.clearHighlightedMove();
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

    // Calcola passable: esclude basette di unità altre vive
    const blocked = new Set<string>();
    for (const other of Object.values(this.state.units)) {
      if (other.id === unit.id || !other.alive) continue;
      for (const h of getBaseHexes(other.position)) blocked.add(`${h.q},${h.r}`);
    }
    const passable = (h: Axial) => !blocked.has(`${h.q},${h.r}`);

    // Range = slancio + (1 se non ho ancora mosso questo turno, altrimenti 0)
    const freeHex = unit.hexMovedThisTurn === 0 ? 1 : 0;
    const reachable = reachableHexes(unit.position, unit.slancio + freeHex, { passable });
    const reachHexes: Axial[] = Array.from(reachable.values()).map((r) => r.hex);
    this.board.setHighlightedMove(reachHexes);
    this.menu.setItems([
      {
        label: 'Annulla movimento',
        onClick: () => {
          this.board.clearHighlightedMove();
          this.board.setExternalClickHandler(null);
          this.showActionMenu();
        },
      },
    ]);

    this.board.setExternalClickHandler((hex) => {
      if (hex === null) return;
      const k = `${hex.q},${hex.r}`;
      if (!reachable.has(k)) return; // click su esagono fuori range, ignorato
      // Verifica che la basetta destinazione non si sovrapponga
      const targetBase = new Set(getBaseHexes(hex).map((h) => `${h.q},${h.r}`));
      let overlap = false;
      for (const other of Object.values(this.state.units)) {
        if (other.id === unit.id || !other.alive) continue;
        for (const h of getBaseHexes(other.position)) {
          if (targetBase.has(`${h.q},${h.r}`)) {
            overlap = true;
            break;
          }
        }
        if (overlap) break;
      }
      if (overlap) return;

      this.dispatch({ type: 'MOVE', unitId: unit.id, targetHex: hex });
      this.board.clearHighlightedMove();
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
    const maxN = Math.min(attacker.dadiAzione, 2 + countMaxDiceExtra(attacker.skills, ctx));
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
      `Tiro PG: 1-${maxN} d6 + 2 fissi`,
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
          this.dispatch({ type: 'RESOLVE_COMBAT' });
          this.afterCombat();
          return;
        }
        // Mischia: vai diretto alla scelta difensiva (no handoff intermedio)
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
          this.dispatch({ type: 'RESOLVE_COMBAT' });
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
            this.dispatch({ type: 'RESOLVE_COMBAT' });
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
    this.board.clearHighlightedMove();
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

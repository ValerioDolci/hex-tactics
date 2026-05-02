import Phaser from 'phaser';
import { PRESETS, PresetSpec } from '@data/presets';
import { saveSetup, loadSetup, BattleSetup } from '@persistence/storage';
import { loadAllBuilds } from '@data/builds';

/**
 * Schermata di selezione setup battaglia.
 * Layout responsivo: si adatta al viewport (Phaser.Scale.RESIZE).
 *
 * Permette di:
 *  - Scegliere preset PG per fazione A e B
 *  - Scegliere modalità (umano vs AI) per ogni fazione
 *  - Avviare la battaglia
 */
export class MainMenuScene extends Phaser.Scene {
  private setup: BattleSetup;
  /** Container che contiene tutti gli elementi scrollabili del menu */
  private scrollContainer!: Phaser.GameObjects.Container;
  /** Y totale del contenuto (per scroll quando supera viewport) */
  private contentBottomY = 0;
  /** Scroll offset corrente (≤ 0 = scrolled down) */
  private scrollY = 0;
  /** True se l'init di sessione è già avvenuto (caricamento da localStorage) */
  private static sessionLoaded = false;
  /** Touch drag-scroll state */
  private touchScrollStartY = 0;
  private touchScrollOriginY = 0;
  private touchScrollActive = false;

  constructor() {
    super({ key: 'MainMenuScene' });
    this.setup = {
      presetA: 'spadaccino',
      presetB: 'arciere',
      modeA: 'human',
      modeB: 'ai',
    };
  }

  /** Riceve eventuali dati al ritorno da CharacterBuilderScene. */
  init(data?: { selectCustomBuildFor?: 'A' | 'B'; buildId?: string }): void {
    if (data?.selectCustomBuildFor && data?.buildId) {
      // Carica setup precedente da localStorage prima di applicare la selezione custom
      const last = loadSetup();
      if (last) this.setup = last;
      if (data.selectCustomBuildFor === 'A') {
        this.setup.customBuildIdA = data.buildId;
      } else {
        this.setup.customBuildIdB = data.buildId;
      }
      saveSetup(this.setup);
      MainMenuScene.sessionLoaded = true;
    }
  }

  create(): void {
    // Carica setup da localStorage SOLO la prima volta
    if (!MainMenuScene.sessionLoaded) {
      const last = loadSetup();
      if (last) this.setup = last;
      MainMenuScene.sessionLoaded = true;
    }

    this.scrollY = 0;
    this.layout();
    this.setupScroll();

    // Ascolta resize del viewport per re-renderizzare
    this.scale.on('resize', this.onResize, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
  }

  /** Permette di scrollare verticalmente la scena se il contenuto eccede il viewport. */
  private setupScroll(): void {
    // Drag-scroll a un dito (touch) quando contenuto > viewport
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.contentBottomY <= this.scale.height) return; // niente scroll necessario
      if (pointer.button !== 0) return;
      this.touchScrollStartY = pointer.y;
      this.touchScrollOriginY = this.scrollY;
      this.touchScrollActive = true;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.touchScrollActive) return;
      const dy = pointer.y - this.touchScrollStartY;
      // Solo scroll vero (dy significativo). Se il dito si muove poco, non scrolla
      if (Math.abs(dy) < 8 && this.scrollY === this.touchScrollOriginY) return;
      this.scrollY = this.clampScroll(this.touchScrollOriginY + dy);
      this.applyScroll();
    });
    this.input.on('pointerup', () => {
      this.touchScrollActive = false;
    });
    // Rotella mouse per scroll (desktop)
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _g: unknown, _dx: number, dy: number) => {
      if (this.contentBottomY <= this.scale.height) return;
      this.scrollY = this.clampScroll(this.scrollY - dy);
      this.applyScroll();
    });
  }

  private clampScroll(y: number): number {
    const overflow = this.contentBottomY - this.scale.height;
    if (overflow <= 0) return 0;
    // y va da -overflow (full scrolled) a 0 (top). Con un piccolo extra in fondo per
    // poter "rilassare" il dito senza tornare immediatamente in cima.
    return Math.max(-overflow, Math.min(0, y));
  }

  /** Applica lo scrollY al container scrollabile (efficiente: una singola translate) */
  private applyScroll(): void {
    if (this.scrollContainer) this.scrollContainer.y = this.scrollY;
  }

  private onResize(): void {
    // Re-renderizza con le nuove dimensioni (layout() pulisce internamente)
    this.scrollY = 0;
    this.layout();
  }

  private clearAll(): void {
    if (this.scrollContainer) {
      this.scrollContainer.removeAll(true);
      this.scrollContainer.destroy();
    }
    this.scrollContainer = this.add.container(0, this.scrollY);
  }

  /** Aggiunge un GameObject al container scrollabile */
  private addToContent(obj: Phaser.GameObjects.GameObject): void {
    this.scrollContainer.add(obj);
  }

  /** Layout responsivo: usa scale.width/height (viewport effettivo) */
  private layout(): void {
    // Garantisce un container pulito (anche al primo create)
    this.clearAll();
    const w = this.scale.width;
    const h = this.scale.height;

    // Titolo
    const titleSize = w < 700 ? 28 : 40;
    const title = this.add
      .text(w / 2, h * 0.06, 'hex-tactics', {
        fontFamily: 'monospace',
        fontSize: `${titleSize}px`,
        color: '#fff',
      })
      .setOrigin(0.5, 0);
    this.addToContent(title);

    const subtitle = this.add
      .text(w / 2, h * 0.06 + titleSize + 6, 'Tactical RPG a turni — MVP', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#aaa',
      })
      .setOrigin(0.5, 0);
    this.addToContent(subtitle);

    // Posizionamento delle 2 colonne fazione (layout adattivo: side-by-side se larghezza
    // sufficiente, altrimenti sotto se schermo piccolo).
    const stackVertical = w < 800;
    const colY = h * 0.18;

    let bottomY: number;
    if (stackVertical) {
      // Schermo stretto: A sopra, B sotto
      const cx = w / 2;
      this.renderFactionHeader(cx, colY, 'A');
      const aBottom = this.renderFactionCol(cx, colY + 36, 'A');
      const gap = 24;
      this.renderFactionHeader(cx, aBottom + gap, 'B');
      bottomY = this.renderFactionCol(cx, aBottom + gap + 36, 'B');
    } else {
      // Layout standard: 2 colonne affiancate
      const offsetX = Math.min(w * 0.25, 320);
      const cx = w / 2;
      this.renderFactionHeader(cx - offsetX, colY, 'A');
      this.renderFactionHeader(cx + offsetX, colY, 'B');
      const aBottom = this.renderFactionCol(cx - offsetX, colY + 36, 'A');
      const bBottom = this.renderFactionCol(cx + offsetX, colY + 36, 'B');
      bottomY = Math.max(aBottom, bBottom);
    }

    // Bottone "Inizia battaglia": dopo il contenuto. Con scroll abilitato non c'è più
    // bisogno di forzare il bottone nel viewport.
    const btnY = bottomY + 30;
    this.renderStartButton(w, btnY);

    // Aggiorna contentBottomY (per scroll clamp). Buffer 240 px sotto il bottone
    // per assicurare visibilità completa anche su iPhone con notch/home indicator.
    // Include anche i due bottoni secondari (Tutorial / Manuale) sotto.
    const btnH = 64;
    const subBtnH = 48;
    this.contentBottomY = btnY + btnH + 16 + subBtnH + 240;
  }

  private renderFactionHeader(x: number, y: number, faction: 'A' | 'B'): void {
    const txt = this.add
      .text(x, y, faction === 'A' ? 'Fazione A (blu)' : 'Fazione B (rosso)', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: faction === 'A' ? '#4ab0ff' : '#ff5050',
      })
      .setOrigin(0.5, 0);
    this.addToContent(txt);
  }

  /** Renderizza i selettori di una fazione, restituisce la y al termine */
  /** Ritorna l'id della build custom selezionata per la fazione (undefined se preset). */
  private getCustomBuildId(faction: 'A' | 'B'): string | undefined {
    return faction === 'A' ? this.setup.customBuildIdA : this.setup.customBuildIdB;
  }

  private renderFactionCol(x: number, y: number, faction: 'A' | 'B'): number {
    const getPresetId = (): string => (faction === 'A' ? this.setup.presetA : this.setup.presetB);
    const setPresetId = (id: string): void => {
      if (faction === 'A') this.setup.presetA = id;
      else this.setup.presetB = id;
    };
    const getMode = (): 'human' | 'ai' => (faction === 'A' ? this.setup.modeA : this.setup.modeB);
    const setMode = (m: 'human' | 'ai'): void => {
      if (faction === 'A') this.setup.modeA = m;
      else this.setup.modeB = m;
    };

    // Stack mode = compatto (riduce bottoni e spacing per non scrollare quando non serve)
    const compact = this.scale.width < 800;
    const btnSpacing = compact ? 44 : 50;
    const labelGap = compact ? 24 : 28;

    let yy = y;
    const presetLabel = this.add
      .text(x, yy, 'Preset:', { fontFamily: 'monospace', fontSize: '14px', color: '#aaa' })
      .setOrigin(0.5, 0);
    this.addToContent(presetLabel);
    yy += labelGap;

    for (const preset of PRESETS) {
      const isSelected = getPresetId() === preset.id && !this.getCustomBuildId(faction);
      this.makeChoiceButton(x, yy, preset.name, isSelected, () => {
        setPresetId(preset.id);
        // Selezionare un preset disabilita la build custom per questa fazione
        if (faction === 'A') this.setup.customBuildIdA = undefined;
        else this.setup.customBuildIdB = undefined;
        saveSetup(this.setup);
        this.refresh();
      });
      yy += btnSpacing;
    }

    // Bottone "Build custom..." sempre presente
    const customBuildId = this.getCustomBuildId(faction);
    const customBuilds = loadAllBuilds();
    const customBuild = customBuilds.find((b) => b.id === customBuildId);
    const customLabel = customBuild
      ? `★ ${customBuild.name || 'Custom'}`
      : '＋ Crea personaggio…';
    this.makeChoiceButton(x, yy, customLabel, !!customBuild, () => {
      // Apre CharacterBuilder con la build esistente o una nuova
      this.scale.off('resize', this.onResize, this);
      this.scene.start('CharacterBuilderScene', {
        faction,
        build: customBuild,
      });
    });
    yy += btnSpacing;

    // Descrizione preset (oppure descrizione build custom)
    const selPreset = PRESETS.find((p) => p.id === getPresetId()) as PresetSpec | undefined;
    let descContent: string;
    if (customBuild) {
      const skillCnt = customBuild.skills.length;
      const totExp = customBuild.skills.reduce((sum, s) => sum + s.cost, 0);
      const equip = [
        customBuild.weaponId,
        customBuild.offhandId,
        customBuild.armorId,
      ].filter(Boolean).join(', ');
      descContent = `Custom: ${equip}. ${skillCnt} skill, ${totExp}/2000 exp.`;
    } else {
      descContent = selPreset?.description ?? '';
    }
    yy += 6;
    const descTxt = this.add
      .text(x, yy, descContent, {
        fontFamily: 'monospace',
        fontSize: compact ? 10 : 11,
        color: '#999',
        align: 'center',
        wordWrap: { width: compact ? 320 : 280 },
      } as Phaser.Types.GameObjects.Text.TextStyle)
      .setOrigin(0.5, 0);
    this.addToContent(descTxt);
    yy += descTxt.height + (compact ? 10 : 16);

    // Modalità
    const modeLabel = this.add
      .text(x, yy, 'Modalità:', { fontFamily: 'monospace', fontSize: '14px', color: '#aaa' })
      .setOrigin(0.5, 0);
    this.addToContent(modeLabel);
    yy += labelGap;
    for (const mode of ['human', 'ai'] as const) {
      const isSelected = getMode() === mode;
      this.makeChoiceButton(x, yy, mode === 'human' ? 'Umano' : 'AI', isSelected, () => {
        setMode(mode);
        saveSetup(this.setup);
        this.refresh();
      });
      yy += btnSpacing;
    }

    return yy;
  }

  private makeChoiceButton(
    x: number,
    y: number,
    label: string,
    selected: boolean,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const compact = this.scale.width < 800;
    const w = compact ? 260 : 240;
    const h = compact ? 36 : 42; // h ridotta in stack mode
    const c = this.add.container(x - w / 2, y);
    const bg = this.add.rectangle(0, 0, w, h, selected ? 0x336688 : 0x222a33, 1);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(2, selected ? 0x77aacc : 0x444444);
    const t = this.add.text(w / 2, h / 2, label, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#fff',
    });
    t.setOrigin(0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true });
    // pointerup per affidabilità touch
    bg.on('pointerup', () => onClick());
    bg.on('pointerover', () => {
      if (!selected) bg.setFillStyle(0x2c3540);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(selected ? 0x336688 : 0x222a33);
    });
    this.addToContent(c);
    return c;
  }

  private renderStartButton(w: number, y: number): void {
    const btnW = 280;
    const btnH = 64;
    const c = this.add.container(w / 2 - btnW / 2, y);
    const bg = this.add.rectangle(0, 0, btnW, btnH, 0x336633, 1);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(3, 0x66aa66);
    const t = this.add.text(btnW / 2, btnH / 2, 'Inizia battaglia', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#fff',
    });
    t.setOrigin(0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x448844));
    bg.on('pointerout', () => bg.setFillStyle(0x336633));
    bg.on('pointerup', () => this.startBattle());
    this.addToContent(c);

    // Bottoni secondari Tutorial + Manuale (sotto al bottone principale)
    const subBtnW = 130;
    const subBtnH = 48;
    const subY = y + btnH + 16;
    const gap = 20;

    // Tutorial
    const tutC = this.add.container(w / 2 - subBtnW - gap / 2, subY);
    const tutBg = this.add.rectangle(0, 0, subBtnW, subBtnH, 0x444477, 1);
    tutBg.setOrigin(0, 0);
    tutBg.setStrokeStyle(2, 0x7777aa);
    const tutT = this.add.text(subBtnW / 2, subBtnH / 2, '🎓 Tutorial', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#fff',
    });
    tutT.setOrigin(0.5, 0.5);
    tutC.add([tutBg, tutT]);
    tutBg.setInteractive({ useHandCursor: true });
    tutBg.on('pointerover', () => tutBg.setFillStyle(0x5555aa));
    tutBg.on('pointerout', () => tutBg.setFillStyle(0x444477));
    tutBg.on('pointerup', () => {
      this.scale.off('resize', this.onResize, this);
      this.scene.start('TutorialMenuScene');
    });
    this.addToContent(tutC);

    // Manuale
    const manC = this.add.container(w / 2 + gap / 2, subY);
    const manBg = this.add.rectangle(0, 0, subBtnW, subBtnH, 0x666633, 1);
    manBg.setOrigin(0, 0);
    manBg.setStrokeStyle(2, 0xaaaa55);
    const manT = this.add.text(subBtnW / 2, subBtnH / 2, '📘 Manuale', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#fff',
    });
    manT.setOrigin(0.5, 0.5);
    manC.add([manBg, manT]);
    manBg.setInteractive({ useHandCursor: true });
    manBg.on('pointerover', () => manBg.setFillStyle(0x888844));
    manBg.on('pointerout', () => manBg.setFillStyle(0x666633));
    manBg.on('pointerup', () => {
      this.scale.off('resize', this.onResize, this);
      this.scene.start('ManualScene');
    });
    this.addToContent(manC);
  }

  private refresh(): void {
    // Mantiene scrollY corrente — l'utente non perde la posizione cliccando
    this.layout();
  }

  private startBattle(): void {
    saveSetup(this.setup);
    this.scale.off('resize', this.onResize, this);
    this.scene.start('BattleScene', this.setup);
  }
}

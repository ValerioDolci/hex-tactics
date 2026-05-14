import Phaser from 'phaser';
import { PRESETS, PresetSpec } from '@data/presets';
import { saveSetup, loadSetup, BattleSetup } from '@persistence/storage';
import { loadAllBuilds } from '@data/builds';
import { paintVellum } from '@/ui/Vellum';
import { FONTS, PALETTE, makeCodexButton } from '@/ui/theme';
import { uiScale } from '@/ui/uiScale';

/**
 * Schermata di selezione setup battaglia — Codex Tacticus.
 *
 * Layout responsivo: si adatta al viewport (Phaser.Scale.RESIZE).
 *
 * Permette di:
 *  - Scegliere preset PG per fazione A e B
 *  - Scegliere modalità (umano vs AI) per ogni fazione
 *  - Avviare la battaglia
 *
 * Estetica: titolo display serif a colofone, vellum + grain, bottoni Codex,
 * fazione A/B in tinture araldiche (azzurro/rosso), stagger reveal a page-load.
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
  /** True se il primo reveal stagger è già stato eseguito (su layout iniziale). */
  private static introPlayed = false;
  /** Touch drag-scroll state */
  private touchScrollStartY = 0;
  private touchScrollOriginY = 0;
  private touchScrollActive = false;
  /** Riferimenti agli oggetti vellum per cleanup su resize. */
  private vellumDestroy?: () => void;

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
      this.vellumDestroy?.();
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
    return Math.max(-overflow, Math.min(0, y));
  }

  /** Applica lo scrollY al container scrollabile (efficiente: una singola translate) */
  private applyScroll(): void {
    if (this.scrollContainer) this.scrollContainer.y = this.scrollY;
  }

  private onResize(): void {
    this.scrollY = 0;
    this.layout();
  }

  private clearAll(): void {
    if (this.scrollContainer) {
      this.scrollContainer.removeAll(true);
      this.scrollContainer.destroy();
    }
    this.vellumDestroy?.();
    // Pulisci eventuali oggetti orfani (es. titolo non-scrollabile lasciato fuori)
    this.children.removeAll();
    this.scrollContainer = this.add.container(0, this.scrollY);
  }

  /** Aggiunge un GameObject al container scrollabile */
  private addToContent(obj: Phaser.GameObjects.GameObject): void {
    this.scrollContainer.add(obj);
  }

  /** Layout responsivo: usa scale.width/height (viewport effettivo) */
  private layout(): void {
    this.clearAll();

    // Vellum + paper grain
    const vellum = paintVellum(this, this.scale.width, this.scale.height);
    this.vellumDestroy = vellum.destroy;

    const w = this.scale.width;
    const h = this.scale.height;

    // ── Frontespizio: titolo display serif + sottotitolo + filetto oro
    const titleSize = w < 700 ? 44 : 64;
    const title = this.add
      .text(w / 2, h * 0.05, 'Codex Tacticus', {
        fontFamily: FONTS.display,
        fontSize: `${Math.round(titleSize * uiScale())}px`,
        color: PALETTE.ink.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0);
    this.addToContent(title);

    // Filetto oro (ornament line)
    const ornY = h * 0.05 + titleSize + 14;
    const ornament = this.add.graphics();
    ornament.lineStyle(1.4, PALETTE.gold.num, 0.85);
    const ornW = Math.min(360, w * 0.5);
    ornament.lineBetween(w / 2 - ornW / 2, ornY, w / 2 + ornW / 2, ornY);
    // Rombi terminali
    ornament.fillStyle(PALETTE.gold.num, 0.95);
    [w / 2 - ornW / 2, w / 2, w / 2 + ornW / 2].forEach((cx) => {
      ornament.fillTriangle(cx - 4, ornY, cx + 4, ornY, cx, ornY - 4);
      ornament.fillTriangle(cx - 4, ornY, cx + 4, ornY, cx, ornY + 4);
    });
    this.addToContent(ornament);

    const subtitle = this.add
      .text(w / 2, ornY + 12, 'Trattato di scherma esagonale  ·  duello tattico 1v1', {
        fontFamily: FONTS.body,
        fontSize: `${Math.round(15 * uiScale())}px`,
        color: PALETTE.inkSoft.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0);
    this.addToContent(subtitle);

    // Posizionamento delle 2 colonne fazione (layout adattivo).
    const stackVertical = w < 800;
    const colY = h * 0.18;

    let bottomY: number;
    if (stackVertical) {
      const cx = w / 2;
      this.renderFactionHeader(cx, colY, 'A');
      const aBottom = this.renderFactionCol(cx, colY + 38, 'A');
      const gap = 28;
      this.renderFactionHeader(cx, aBottom + gap, 'B');
      bottomY = this.renderFactionCol(cx, aBottom + gap + 38, 'B');
    } else {
      const offsetX = Math.min(w * 0.25, 320);
      const cx = w / 2;
      this.renderFactionHeader(cx - offsetX, colY, 'A');
      this.renderFactionHeader(cx + offsetX, colY, 'B');
      const aBottom = this.renderFactionCol(cx - offsetX, colY + 38, 'A');
      const bBottom = this.renderFactionCol(cx + offsetX, colY + 38, 'B');
      bottomY = Math.max(aBottom, bBottom);
    }

    // Bottone "Inizia battaglia"
    const btnY = bottomY + 38;
    this.renderStartButton(w, btnY);

    // contentBottomY (per scroll clamp)
    const btnH = 64;
    const subBtnH = 48;
    this.contentBottomY = btnY + btnH + 16 + subBtnH + 240;

    // Stagger reveal alla prima apertura della scena (Regola 11: motion intenzionale)
    if (!MainMenuScene.introPlayed) {
      this.playIntroStagger();
      MainMenuScene.introPlayed = true;
    }
  }

  /** Stagger reveal: titolo → ornament → sottotitolo → fazioni → bottoni. */
  private playIntroStagger(): void {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const children = this.scrollContainer.list as Phaser.GameObjects.GameObject[];
    children.forEach((obj, idx) => {
      const o = obj as Phaser.GameObjects.GameObject & {
        setAlpha?: (a: number) => unknown;
        setY?: (y: number) => unknown;
        y?: number;
      };
      if (typeof o.setAlpha !== 'function') return;
      const targetY = (o as { y?: number }).y ?? 0;
      o.setAlpha(0);
      // shift verso il basso 8px iniziali
      if ('y' in o && typeof o.y === 'number') {
        (o as { y: number }).y = targetY - 8;
      }
      this.tweens.add({
        targets: o,
        alpha: 1,
        y: targetY,
        duration: 380,
        delay: 60 + idx * 18,
        ease: 'Sine.easeOut',
      });
    });
  }

  private renderFactionHeader(x: number, y: number, faction: 'A' | 'B'): void {
    const tincture = faction === 'A' ? PALETTE.azure : PALETTE.gules;
    const blason = faction === 'A' ? '⛨ Azzurra' : '⛨ Rossa';
    const txt = this.add
      .text(x, y, blason, {
        fontFamily: FONTS.display,
        fontSize: `${Math.round(26 * uiScale())}px`,
        color: tincture.css,
        fontStyle: 'italic bold',
      })
      .setOrigin(0.5, 0);
    this.addToContent(txt);
  }

  /** Renderizza i selettori di una fazione, restituisce la y al termine */
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

    const compact = this.scale.width < 800;
    const btnSpacing = compact ? 48 : 52;
    const labelGap = compact ? 26 : 30;
    const heraldicVariant = faction === 'A' ? 'heraldic-A' : 'heraldic-B';

    const btnW = compact ? 280 : 260;
    const btnH = compact ? 40 : 44;

    let yy = y;
    const presetLabel = this.add
      .text(x, yy, '— maestria —', {
        fontFamily: FONTS.body,
        fontSize: `${Math.round(14 * uiScale())}px`,
        color: PALETTE.inkSoft.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0);
    this.addToContent(presetLabel);
    yy += labelGap;

    for (const preset of PRESETS) {
      const isSelected = getPresetId() === preset.id && !this.getCustomBuildId(faction);
      const btn = makeCodexButton({
        scene: this,
        x: x - btnW / 2,
        y: yy,
        width: btnW,
        height: btnH,
        label: preset.name,
        selected: isSelected,
        variant: heraldicVariant,
        fontSize: 17,
        onClick: () => {
          setPresetId(preset.id);
          if (faction === 'A') this.setup.customBuildIdA = undefined;
          else this.setup.customBuildIdB = undefined;
          saveSetup(this.setup);
          this.refresh();
        },
      });
      this.addToContent(btn);
      yy += btnSpacing;
    }

    // Build custom
    const customBuildId = this.getCustomBuildId(faction);
    const customBuilds = loadAllBuilds();
    const customBuild = customBuilds.find((b) => b.id === customBuildId);
    const customLabel = customBuild
      ? `✦ ${customBuild.name || 'Custom'}`
      : '✦  Forgia un carattere…';
    const customBtn = makeCodexButton({
      scene: this,
      x: x - btnW / 2,
      y: yy,
      width: btnW,
      height: btnH,
      label: customLabel,
      selected: !!customBuild,
      variant: 'gold',
      fontKind: 'display',
      fontSize: 17,
      onClick: () => {
        this.scale.off('resize', this.onResize, this);
        this.scene.start('CharacterBuilderScene', { faction, build: customBuild });
      },
    });
    this.addToContent(customBtn);
    yy += btnSpacing;

    // Descrizione
    const selPreset = PRESETS.find((p) => p.id === getPresetId()) as PresetSpec | undefined;
    let descContent: string;
    if (customBuild) {
      const skillCnt = customBuild.skills.length;
      const totExp = customBuild.skills.reduce((sum, s) => sum + s.cost, 0);
      const equip = [customBuild.weaponId, customBuild.offhandId, customBuild.armorId]
        .filter(Boolean)
        .join(', ');
      descContent = `Custom: ${equip}. ${skillCnt} skill, ${totExp}/2000 exp.`;
    } else {
      descContent = selPreset?.description ?? '';
    }
    yy += 10;
    const descTxt = this.add
      .text(x, yy, descContent, {
        fontFamily: FONTS.body,
        fontSize: `${Math.round((compact ? 13 : 14) * uiScale())}px`,
        color: PALETTE.ink.css,
        align: 'center',
        wordWrap: { width: compact ? 340 : 300 },
        fontStyle: 'italic',
        lineSpacing: 3,
      } as Phaser.Types.GameObjects.Text.TextStyle)
      .setOrigin(0.5, 0);
    this.addToContent(descTxt);
    yy += descTxt.height + (compact ? 14 : 20);

    // Modalità
    const modeLabel = this.add
      .text(x, yy, '— mano —', {
        fontFamily: FONTS.body,
        fontSize: `${Math.round(14 * uiScale())}px`,
        color: PALETTE.inkSoft.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0);
    this.addToContent(modeLabel);
    yy += labelGap;

    for (const mode of ['human', 'ai'] as const) {
      const isSelected = getMode() === mode;
      const modeBtn = makeCodexButton({
        scene: this,
        x: x - btnW / 2,
        y: yy,
        width: btnW,
        height: btnH,
        label: mode === 'human' ? 'Mano umana' : 'Automa (CFR)',
        selected: isSelected,
        variant: heraldicVariant,
        fontSize: 17,
        onClick: () => {
          setMode(mode);
          saveSetup(this.setup);
          this.refresh();
        },
      });
      this.addToContent(modeBtn);
      yy += btnSpacing;
    }

    // Difficoltà AI
    if (getMode() === 'ai') {
      yy += 6;
      const aiLabel = this.add
        .text(x, yy, '— grado dell\'automa —', {
          fontFamily: FONTS.body,
          fontSize: `${Math.round(14 * uiScale())}px`,
          color: PALETTE.inkSoft.css,
          fontStyle: 'italic',
        })
        .setOrigin(0.5, 0);
      this.addToContent(aiLabel);
      yy += labelGap;
      const getLevel = (): 'easy' | 'hard' | 'expert' =>
        (faction === 'A' ? this.setup.aiLevelA : this.setup.aiLevelB) ?? 'easy';
      const setLevel = (lv: 'easy' | 'hard' | 'expert') => {
        if (faction === 'A') this.setup.aiLevelA = lv;
        else this.setup.aiLevelB = lv;
      };
      const levels: ReadonlyArray<'easy' | 'hard' | 'expert'> = __SINGLEFILE__
        ? ['easy', 'hard']
        : ['easy', 'hard', 'expert'];
      if (__SINGLEFILE__ && getLevel() === 'expert') {
        setLevel('hard');
        saveSetup(this.setup);
      }
      const levelLabel: Record<'easy' | 'hard' | 'expert', string> = {
        easy: 'Iniziato',
        hard: '✦ Maestro (CFR)',
        expert: '✦✦ Gran Maestro (CFR full)',
      };
      for (const lv of levels) {
        const isSelected = getLevel() === lv;
        const levelBtn = makeCodexButton({
          scene: this,
          x: x - btnW / 2,
          y: yy,
          width: btnW,
          height: btnH,
          label: levelLabel[lv],
          selected: isSelected,
          variant: lv === 'easy' ? heraldicVariant : 'gold',
          fontSize: 16,
          onClick: () => {
            setLevel(lv);
            saveSetup(this.setup);
            this.refresh();
          },
        });
        this.addToContent(levelBtn);
        yy += btnSpacing;
      }
    }

    return yy;
  }

  private renderStartButton(w: number, y: number): void {
    const btnW = 300;
    const btnH = 64;

    // Bottone "Apri il duello" — primary CTA
    const startBtn = makeCodexButton({
      scene: this,
      x: w / 2 - btnW / 2,
      y,
      width: btnW,
      height: btnH,
      label: 'Apri il duello',
      variant: 'primary',
      fontKind: 'display',
      fontSize: 22,
      onClick: () => this.startBattle(),
    });
    this.addToContent(startBtn);

    // Bottoni secondari Tutorial + Manuale (sotto al CTA)
    const subBtnW = 150;
    const subBtnH = 46;
    const subY = y + btnH + 18;
    const gap = 18;

    const tutBtn = makeCodexButton({
      scene: this,
      x: w / 2 - subBtnW - gap / 2,
      y: subY,
      width: subBtnW,
      height: subBtnH,
      label: 'Tutorial',
      variant: 'outline',
      fontKind: 'display',
      fontSize: 17,
      onClick: () => {
        this.scale.off('resize', this.onResize, this);
        this.scene.start('TutorialMenuScene');
      },
    });
    this.addToContent(tutBtn);

    const manBtn = makeCodexButton({
      scene: this,
      x: w / 2 + gap / 2,
      y: subY,
      width: subBtnW,
      height: subBtnH,
      label: 'Codice & regole',
      variant: 'outline',
      fontKind: 'display',
      fontSize: 17,
      onClick: () => {
        this.scale.off('resize', this.onResize, this);
        this.scene.start('ManualScene');
      },
    });
    this.addToContent(manBtn);
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

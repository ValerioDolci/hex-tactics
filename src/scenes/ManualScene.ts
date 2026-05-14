import Phaser from 'phaser';
import { MANUAL, ManualBlock } from '@data/manual';
import { paintVellum } from '@/ui/Vellum';
import { FONTS, PALETTE, makeCodexButton, makeCodexPanel } from '@/ui/theme';

/**
 * Scena Manuale: viewer del contenuto del manuale.
 * Layout: sidebar sinistra con indice capitoli + contenuto a destra scrollabile.
 *
 * Interazione:
 *  - Click su un capitolo nella sidebar → renderizza nel pannello destro.
 *  - Mouse wheel / drag verticale sul pannello destro → scroll.
 *  - Bottone "Indietro" → torna a MainMenu.
 */
export class ManualScene extends Phaser.Scene {
  private currentChapterId: string = MANUAL[0].id;
  private contentContainer!: Phaser.GameObjects.Container;
  private contentMask!: Phaser.GameObjects.Graphics;
  private sidebarItems: Phaser.GameObjects.Container[] = [];
  private contentScrollY = 0;
  private contentHeight = 0;
  private contentViewportH = 0;
  private contentViewportTop = 0;
  private contentViewportLeft = 0;
  private contentViewportW = 0;

  constructor() {
    super({ key: 'ManualScene' });
  }

  create(): void {
    // Restart on resize (es. orientation change su mobile): brute-force ma robusto
    // per scene statiche senza state vivo. BattleScene gestisce resize fine-grained.
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize, this);
    });
    const w = this.scale.width;
    const h = this.scale.height;

    // Sfondo vellum + paper grain
    paintVellum(this, w, h);

    // Header
    const headerH = 60;
    this.add
      .text(w / 2, headerH / 2, 'Codice & regole', {
        fontFamily: FONTS.display,
        fontSize: '24px',
        color: PALETTE.ink.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0.5);

    // Filetto oro sotto header
    const ornament = this.add.graphics();
    ornament.lineStyle(1.2, PALETTE.gold.num, 0.9);
    ornament.lineBetween(w / 2 - 200, headerH - 8, w / 2 + 200, headerH - 8);

    // Bottone indietro
    this.makeBackButton(20, 12);

    // Layout colonne
    const sidebarW = Math.min(280, w * 0.28);
    const padding = 16;
    const sidebarTop = headerH + padding;
    const sidebarH = h - sidebarTop - padding;
    const contentLeft = sidebarW + padding * 2;
    const contentTop = headerH + padding;
    const contentW = w - contentLeft - padding;
    const contentH = h - contentTop - padding;

    // Sidebar (panel codex)
    makeCodexPanel({ scene: this, x: padding, y: sidebarTop, width: sidebarW, height: sidebarH, tone: 'vellum', alpha: 0.92 });
    this.renderSidebar(padding, sidebarTop, sidebarW, sidebarH);

    // Content panel (codex)
    makeCodexPanel({ scene: this, x: contentLeft, y: contentTop, width: contentW, height: contentH, tone: 'vellum', alpha: 0.92 });

    // Container per contenuto + maschera per scroll
    this.contentContainer = this.add.container(contentLeft + 20, contentTop + 20);
    this.contentMask = this.add.graphics();
    this.contentMask.fillStyle(0xffffff);
    this.contentMask.fillRect(contentLeft, contentTop, contentW, contentH);
    this.contentContainer.setMask(this.contentMask.createGeometryMask());
    this.contentMask.setVisible(false);

    this.contentViewportTop = contentTop;
    this.contentViewportLeft = contentLeft;
    this.contentViewportH = contentH;
    this.contentViewportW = contentW;

    this.renderChapter(this.currentChapterId);

    // Wheel scroll
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _g: unknown, _dx: number, dy: number) => {
      if (!this.isPointerInContent(_p)) return;
      this.scrollContent(dy * 0.6);
    });

    // Drag scroll (touch e mouse)
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isPointerInContent(p)) return;
      dragging = true;
      lastY = p.y;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      const dy = lastY - p.y;
      this.scrollContent(dy);
      lastY = p.y;
    });
    this.input.on('pointerup', () => {
      dragging = false;
    });
  }

  private isPointerInContent(p: Phaser.Input.Pointer): boolean {
    return (
      p.x >= this.contentViewportLeft &&
      p.x <= this.contentViewportLeft + this.contentViewportW &&
      p.y >= this.contentViewportTop &&
      p.y <= this.contentViewportTop + this.contentViewportH
    );
  }

  private scrollContent(dy: number): void {
    const maxScroll = Math.max(0, this.contentHeight - this.contentViewportH + 40);
    this.contentScrollY = Phaser.Math.Clamp(this.contentScrollY + dy, 0, maxScroll);
    this.contentContainer.y = this.contentViewportTop + 20 - this.contentScrollY;
  }

  private renderSidebar(x: number, y: number, w: number, _h: number): void {
    void _h;
    let yy = y + 12;
    for (const ch of MANUAL) {
      const isCurrent = ch.id === this.currentChapterId;
      const item = makeCodexButton({
        scene: this,
        x: x + 8,
        y: yy,
        width: w - 16,
        height: 42,
        label: ch.title,
        selected: isCurrent,
        variant: 'gold',
        fontKind: 'body',
        fontSize: 15,
        onClick: () => this.selectChapter(ch.id),
      });
      this.sidebarItems.push(item);
      yy += 48;
    }
  }

  private selectChapter(id: string): void {
    if (this.currentChapterId === id) return;
    this.currentChapterId = id;
    // Re-render sidebar (highlight) e content
    this.sidebarItems.forEach((it) => it.destroy());
    this.sidebarItems = [];
    const w = this.scale.width;
    const padding = 16;
    const sidebarW = Math.min(280, w * 0.28);
    const sidebarTop = 60 + padding;
    const sidebarH = this.scale.height - sidebarTop - padding;
    this.renderSidebar(padding, sidebarTop, sidebarW, sidebarH);
    this.renderChapter(id);
  }

  private renderChapter(id: string): void {
    // Pulisce
    this.contentContainer.removeAll(true);
    this.contentScrollY = 0;
    this.contentContainer.y = this.contentViewportTop + 20;

    const ch = MANUAL.find((c) => c.id === id);
    if (!ch) return;

    const innerW = this.contentViewportW - 40;
    let cy = 0;

    // Title (display serif italic, ink)
    const titleText = this.add
      .text(0, cy, ch.title, {
        fontFamily: FONTS.display,
        fontSize: '24px',
        color: PALETTE.ink.css,
        fontStyle: 'italic',
        wordWrap: { width: innerW },
      })
      .setOrigin(0, 0);
    this.contentContainer.add(titleText);
    cy += titleText.height + 8;
    // Filetto oro sotto il titolo capitolo
    const sep = this.add.graphics();
    sep.lineStyle(1, PALETTE.gold.num, 0.8);
    sep.lineBetween(0, cy, Math.min(220, innerW), cy);
    this.contentContainer.add(sep);
    cy += 14;

    for (const block of ch.blocks) {
      cy = this.renderBlock(block, cy, innerW);
      cy += 12; // spacing tra blocchi
    }

    this.contentHeight = cy;
  }

  private renderBlock(block: ManualBlock, cy: number, innerW: number): number {
    if (block.type === 'p') {
      const t = this.add
        .text(0, cy, block.text, {
          fontFamily: FONTS.body,
          fontSize: '16px',
          color: PALETTE.ink.css,
          wordWrap: { width: innerW },
          lineSpacing: 5,
        })
        .setOrigin(0, 0);
      this.contentContainer.add(t);
      return cy + t.height;
    }
    if (block.type === 'subheading') {
      const t = this.add
        .text(0, cy, block.text, {
          fontFamily: FONTS.display,
          fontSize: '20px',
          color: PALETTE.goldDeep.css,
          fontStyle: 'italic bold',
          wordWrap: { width: innerW },
        })
        .setOrigin(0, 0);
      this.contentContainer.add(t);
      return cy + t.height + 6;
    }
    if (block.type === 'list') {
      let y2 = cy;
      for (const item of block.items) {
        const t = this.add
          .text(16, y2, '·  ' + item, {
            fontFamily: FONTS.body,
            fontSize: '16px',
            color: PALETTE.ink.css,
            wordWrap: { width: innerW - 16 },
            lineSpacing: 5,
          })
          .setOrigin(0, 0);
        this.contentContainer.add(t);
        y2 += t.height + 7;
      }
      return y2;
    }
    if (block.type === 'example') {
      // Box "esempio" stile codex: vellum dark + bordo gold
      const boxX = 0;
      const boxPad = 14;
      const lines = (block.title ? [block.title, ''] : []).concat(block.lines);
      const fullText = lines.join('\n');
      const tmp = this.add
        .text(boxX + boxPad, cy + boxPad, fullText, {
          fontFamily: FONTS.mono,
          fontSize: '14px',
          color: PALETTE.ink.css,
          wordWrap: { width: innerW - boxPad * 2 },
          lineSpacing: 5,
        })
        .setOrigin(0, 0);
      const boxH = tmp.height + boxPad * 2;
      const bg = this.add.rectangle(boxX, cy, innerW, boxH, PALETTE.vellumDeep.num, 0.6).setOrigin(0, 0);
      bg.setStrokeStyle(1, PALETTE.gold.num);
      this.contentContainer.add(bg);
      this.contentContainer.add(tmp);
      tmp.setDepth(1);
      return cy + boxH;
    }
    if (block.type === 'table') {
      const cellPad = 6;
      const colCount = block.headers.length;
      const colW = (innerW - cellPad * (colCount + 1)) / colCount;
      // Header (vellum dark + bordo ink)
      const headerRowH = 26;
      const headerBg = this.add.rectangle(0, cy, innerW, headerRowH, PALETTE.vellumDeep.num, 1).setOrigin(0, 0);
      headerBg.setStrokeStyle(1, PALETTE.ink.num);
      this.contentContainer.add(headerBg);
      let cx = cellPad;
      for (const h of block.headers) {
        const t = this.add
          .text(cx, cy + headerRowH / 2, h, {
            fontFamily: FONTS.display,
            fontSize: '14px',
            color: PALETTE.ink.css,
            fontStyle: 'italic bold',
            wordWrap: { width: colW },
          })
          .setOrigin(0, 0.5);
        this.contentContainer.add(t);
        cx += colW + cellPad;
      }
      let yy = cy + headerRowH;

      const dataRowH = 26;
      for (let i = 0; i < block.rows.length; i++) {
        const row = block.rows[i];
        const rowBg = this.add
          .rectangle(0, yy, innerW, dataRowH, i % 2 === 0 ? PALETTE.vellumDark.num : PALETTE.vellum.num, 0.6)
          .setOrigin(0, 0);
        this.contentContainer.add(rowBg);
        cx = cellPad;
        for (const cell of row) {
          const t = this.add
            .text(cx, yy + dataRowH / 2, cell, {
              fontFamily: FONTS.mono,
              fontSize: '13px',
              color: PALETTE.ink.css,
              wordWrap: { width: colW },
            })
            .setOrigin(0, 0.5);
          this.contentContainer.add(t);
          cx += colW + cellPad;
        }
        yy += dataRowH;
      }
      return yy + 4;
    }
    return cy;
  }

  private makeBackButton(x: number, y: number): void {
    makeCodexButton({
      scene: this,
      x,
      y,
      width: 110,
      height: 36,
      label: '←  Frontespizio',
      variant: 'outline',
      fontKind: 'display',
      fontSize: 13,
      onClick: () => this.scene.start('MainMenuScene'),
    });
  }
}

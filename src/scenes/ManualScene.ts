import Phaser from 'phaser';
import { MANUAL, ManualBlock } from '@data/manual';

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

    // Sfondo
    this.add.rectangle(0, 0, w, h, 0x121821, 1).setOrigin(0, 0);

    // Header
    const headerH = 60;
    const header = this.add.rectangle(0, 0, w, headerH, 0x1c2530, 1).setOrigin(0, 0);
    header.setStrokeStyle(2, 0x445566);
    void header;
    this.add
      .text(w / 2, headerH / 2, 'Manuale di hex-tactics', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);

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

    // Sidebar
    this.add.rectangle(padding, sidebarTop, sidebarW, sidebarH, 0x1a222c, 1).setOrigin(0, 0);
    this.renderSidebar(padding, sidebarTop, sidebarW, sidebarH);

    // Content panel
    this.add.rectangle(contentLeft, contentTop, contentW, contentH, 0x1a222c, 1).setOrigin(0, 0);

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
      const item = this.add.container(x + 8, yy);
      const isCurrent = ch.id === this.currentChapterId;
      const bg = this.add.rectangle(0, 0, w - 16, 38, isCurrent ? 0x335577 : 0x222a35, 1).setOrigin(0, 0);
      bg.setStrokeStyle(1, isCurrent ? 0x6699bb : 0x445566);
      const t = this.add
        .text(10, 19, ch.title, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ddd',
          wordWrap: { width: w - 36 },
        })
        .setOrigin(0, 0.5);
      item.add([bg, t]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(0x3a4a5e));
      bg.on('pointerout', () => bg.setFillStyle(ch.id === this.currentChapterId ? 0x335577 : 0x222a35));
      bg.on('pointerup', () => this.selectChapter(ch.id));
      this.sidebarItems.push(item);
      yy += 44;
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

    // Title
    const titleText = this.add
      .text(0, cy, ch.title, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#fff',
        fontStyle: 'bold',
        wordWrap: { width: innerW },
      })
      .setOrigin(0, 0);
    this.contentContainer.add(titleText);
    cy += titleText.height + 18;

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
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#cdd',
          wordWrap: { width: innerW },
          lineSpacing: 4,
        })
        .setOrigin(0, 0);
      this.contentContainer.add(t);
      return cy + t.height;
    }
    if (block.type === 'subheading') {
      const t = this.add
        .text(0, cy, block.text, {
          fontFamily: 'monospace',
          fontSize: '17px',
          color: '#9cf',
          fontStyle: 'bold',
          wordWrap: { width: innerW },
        })
        .setOrigin(0, 0);
      this.contentContainer.add(t);
      return cy + t.height + 4;
    }
    if (block.type === 'list') {
      let y2 = cy;
      for (const item of block.items) {
        const t = this.add
          .text(16, y2, '• ' + item, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#cdd',
            wordWrap: { width: innerW - 16 },
            lineSpacing: 4,
          })
          .setOrigin(0, 0);
        this.contentContainer.add(t);
        y2 += t.height + 6;
      }
      return y2;
    }
    if (block.type === 'example') {
      // Box bordato con titolo
      const boxX = 0;
      const boxPad = 10;
      const lines = (block.title ? [block.title, ''] : []).concat(block.lines);
      const fullText = lines.join('\n');
      const tmp = this.add
        .text(boxX + boxPad, cy + boxPad, fullText, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffd',
          wordWrap: { width: innerW - boxPad * 2 },
          lineSpacing: 4,
        })
        .setOrigin(0, 0);
      const boxH = tmp.height + boxPad * 2;
      const bg = this.add.rectangle(boxX, cy, innerW, boxH, 0x2a2a18, 0.85).setOrigin(0, 0);
      bg.setStrokeStyle(2, 0x999933);
      this.contentContainer.add(bg);
      this.contentContainer.add(tmp);
      tmp.setDepth(1);
      return cy + boxH;
    }
    if (block.type === 'table') {
      // Tabella semplice: header riga in bold + righe alternate
      const cellPad = 6;
      const colCount = block.headers.length;
      const colW = (innerW - cellPad * (colCount + 1)) / colCount;
      const rowH = 22;

      // Header
      const headerBg = this.add.rectangle(0, cy, innerW, rowH, 0x2c3a48, 1).setOrigin(0, 0);
      this.contentContainer.add(headerBg);
      let cx = cellPad;
      for (const h of block.headers) {
        const t = this.add
          .text(cx, cy + rowH / 2, h, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#fff',
            fontStyle: 'bold',
            wordWrap: { width: colW },
          })
          .setOrigin(0, 0.5);
        this.contentContainer.add(t);
        cx += colW + cellPad;
      }
      let yy = cy + rowH;

      for (let i = 0; i < block.rows.length; i++) {
        const row = block.rows[i];
        const rowBg = this.add
          .rectangle(0, yy, innerW, rowH, i % 2 === 0 ? 0x1a232f : 0x202a36, 1)
          .setOrigin(0, 0);
        this.contentContainer.add(rowBg);
        cx = cellPad;
        for (const cell of row) {
          const t = this.add
            .text(cx, yy + rowH / 2, cell, {
              fontFamily: 'monospace',
              fontSize: '12px',
              color: '#cdd',
              wordWrap: { width: colW },
            })
            .setOrigin(0, 0.5);
          this.contentContainer.add(t);
          cx += colW + cellPad;
        }
        yy += rowH;
      }
      return yy + 4;
    }
    return cy;
  }

  private makeBackButton(x: number, y: number): void {
    const w = 100;
    const h = 36;
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x335577, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, 0x6699bb);
    const t = this.add
      .text(w / 2, h / 2, '← Indietro', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#fff',
      })
      .setOrigin(0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x447aaa));
    bg.on('pointerout', () => bg.setFillStyle(0x335577));
    bg.on('pointerup', () => this.scene.start('MainMenuScene'));
  }
}

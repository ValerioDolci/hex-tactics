import Phaser from 'phaser';
import { FONTS, PALETTE } from './theme';

/**
 * Tooltip helper: mostra una piccola box di testo che segue il cursore
 * o appare vicino a un elemento UI. Riusato per spiegare armi/skill/scelte.
 *
 * Pattern d'uso:
 *   const tip = new Tooltip(scene);
 *   bg.on('pointerover', (p) => tip.show(p.x, p.y, 'Spada lunga\nATK 1d6+6\nIMP 6'));
 *   bg.on('pointerout', () => tip.hide());
 *   bg.on('pointermove', (p) => tip.move(p.x, p.y));
 */
export class Tooltip {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private scene: Phaser.Scene;
  private padding = 8;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(2000);
    this.container.setVisible(false);

    // Tooltip Codex: vellum cream con bordo gold (informazione preziosa, ink leggibile)
    this.bg = scene.add.rectangle(0, 0, 100, 40, PALETTE.vellum.num, 0.97).setOrigin(0, 0);
    this.bg.setStrokeStyle(1, PALETTE.gold.num);
    this.text = scene.add
      .text(this.padding, this.padding, '', {
        fontFamily: FONTS.body,
        fontSize: '14px',
        color: PALETTE.ink.css,
        wordWrap: { width: 320 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    this.container.add([this.bg, this.text]);
  }

  /** Mostra il tooltip con un dato testo e posizione (in coord. canvas). */
  show(x: number, y: number, text: string): void {
    this.text.setText(text);
    // Resize bg al testo
    const w = this.text.width + this.padding * 2;
    const h = this.text.height + this.padding * 2;
    this.bg.setSize(w, h);
    this.move(x, y);
    this.container.setVisible(true);
  }

  /** Aggiorna posizione (segue il cursore). Clampa al viewport. */
  move(x: number, y: number): void {
    const cw = this.scene.cameras.main.width;
    const ch = this.scene.cameras.main.height;
    const w = this.bg.width;
    const h = this.bg.height;
    // Default: in alto a destra del cursore
    let tx = x + 14;
    let ty = y + 14;
    if (tx + w > cw) tx = x - w - 14;
    if (ty + h > ch) ty = y - h - 14;
    this.container.setPosition(tx, ty);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  destroy(): void {
    this.container.destroy();
  }
}

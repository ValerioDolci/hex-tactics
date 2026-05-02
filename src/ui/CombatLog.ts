import Phaser from 'phaser';
import { LogEntry } from '@core/state';

/**
 * Pannello con log eventi di combattimento.
 * Mostra le entries più recenti dal fondo verso l'alto, con clip via mask:
 * niente overflow oltre il bg, niente scrollbar.
 */
export class CombatLog {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private maxLines: number;
  private mask?: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  private boxX: number;
  private boxY: number;
  private boxW: number;
  private boxH: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, maxLines = 14) {
    this.scene = scene;
    this.maxLines = maxLines;
    this.boxX = x;
    this.boxY = y;
    this.boxW = w;
    this.boxH = h;

    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0);

    this.bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.6);
    this.bg.setOrigin(0, 0);
    this.bg.setStrokeStyle(2, 0x666666);

    this.text = scene.add.text(10, 8, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#ddd',
      wordWrap: { width: w - 20 },
      lineSpacing: 2,
    });
    this.container.add([this.bg, this.text]);

    this.applyMask();
  }

  /** Crea/aggiorna la geometric mask che clippa al box. */
  private applyMask(): void {
    if (this.mask) this.mask.destroy();
    const m = this.scene.add.graphics();
    m.fillStyle(0xffffff);
    m.fillRect(this.boxX, this.boxY, this.boxW, this.boxH);
    m.setVisible(false);
    this.mask = m;
    this.container.setMask(m.createGeometryMask());
  }

  update(entries: LogEntry[]): void {
    // Prendi le ultime maxLines entry e calcola le righe; se eccedono altezza box, taglia dall'alto.
    const recent = entries.slice(-this.maxLines);
    const lines = recent.map((e) => `[R${e.round}] ${e.message}`);
    this.text.setText(lines.join('\n'));

    // Se il text eccede l'altezza del box, allinea il fondo al bordo basso del box
    // (mostra le righe più recenti, taglia dall'alto via mask).
    const availH = this.boxH - 16;
    if (this.text.height > availH) {
      // y negativo per "spingere su" il text e mostrare il fondo
      this.text.y = 8 - (this.text.height - availH);
    } else {
      this.text.y = 8;
    }
  }

  /** Riposiziona e ridimensiona il pannello (per resize del viewport). */
  relayout(x: number, y: number, w: number, h: number): void {
    this.boxX = x;
    this.boxY = y;
    this.boxW = w;
    this.boxH = h;
    this.container.setPosition(x, y);
    this.bg.setSize(w, h);
    this.text.setStyle({ wordWrap: { width: w - 20 } });
    this.applyMask();
  }
}

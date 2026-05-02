import Phaser from 'phaser';
import { LogEntry } from '@core/state';

/**
 * Pannello scrollabile con log eventi di combattimento.
 * Per MVP: mostra le ultime N entries, no scroll interattivo (tutte le ultime visibili).
 * In M13 si può aggiungere scroll wheel.
 */
export class CombatLog {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private maxLines: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, maxLines = 14) {
    this.maxLines = maxLines;
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
  }

  update(entries: LogEntry[]): void {
    const recent = entries.slice(-this.maxLines);
    const lines = recent.map((e) => `[R${e.round}] ${e.message}`);
    this.text.setText(lines.join('\n'));
  }

  /** Riposiziona e ridimensiona il pannello (per resize del viewport). */
  relayout(x: number, y: number, w: number, h: number): void {
    this.container.setPosition(x, y);
    this.bg.setSize(w, h);
    this.text.setStyle({ wordWrap: { width: w - 20 } });
  }
}

import Phaser from 'phaser';
import { LogEntry } from '@core/state';

/**
 * Pannello con log eventi di combattimento.
 * Mostra le entries più recenti dal fondo verso l'alto, droppando dinamicamente
 * dall'inizio quando il testo eccede l'altezza disponibile.
 *
 * NB: niente mask geometric — interferiva con coord/input. Soluzione fully-text:
 * calcoliamo il text.height dopo setText e troncamo finché ci sta.
 */
export class CombatLog {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private maxLines: number;
  private boxH: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, maxLines = 30) {
    this.maxLines = maxLines;
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
  }

  update(entries: LogEntry[]): void {
    // Prendi le ultime maxLines entries (pool ampio) e droppa dall'inizio
    // finché il text height fitta nel box.
    let recent = entries.slice(-this.maxLines);
    const availH = this.boxH - 16; // padding sopra+sotto

    // Set + check: se eccede, droppa entries dall'inizio.
    while (recent.length > 0) {
      const lines = recent.map((e) => `[R${e.round}] ${e.message}`);
      this.text.setText(lines.join('\n'));
      if (this.text.height <= availH || recent.length === 1) break;
      // Eccede: droppa la più vecchia (prima del slice)
      recent = recent.slice(1);
    }
    this.text.y = 8;
  }

  /** Riposiziona e ridimensiona il pannello (per resize del viewport). */
  relayout(x: number, y: number, w: number, h: number): void {
    this.boxH = h;
    this.container.setPosition(x, y);
    this.bg.setSize(w, h);
    this.text.setStyle({ wordWrap: { width: w - 20 } });
  }
}

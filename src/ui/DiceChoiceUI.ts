import Phaser from 'phaser';
import { s, sFont } from './uiScale';

export interface DiceChoiceOptions {
  /** Titolo principale del box (es. "Alpha — Tiro slancio") */
  title: string;
  /** Sottotitolo / descrizione del tiro (es. "0-2 d6 + 2 (modalità)") */
  subtitle?: string;
  /** Linee di info bonus al tiro (es. ["+ 1d6 spada", "− 3 imp"]) */
  infoLines?: string[];
  /** Scelte numeriche disponibili (es. [0,1,2]) */
  choices: number[];
  /** Callback chiamata col valore scelto */
  onChoose: (n: number) => void;
}

/**
 * Box di scelta dei dadi: dialog modale ma non full-screen "Sono pronto" intermedio.
 * Mostra immediatamente:
 *   - titolo (chi sta tirando, cosa)
 *   - sottotitolo (formula compatta del tiro)
 *   - info bonus dettagliate (una riga per modificatore)
 *   - bottoni numerici grandi e cliccabili (0..N)
 */
export class DiceChoiceUI {
  private overlay: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private box: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private info: Phaser.GameObjects.Text;
  private buttons: Phaser.GameObjects.Container[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;
    this.overlay = scene.add.container(0, 0);
    this.overlay.setScrollFactor(0);

    // Backdrop semi-trasparente (non opaco: si vede mappa/log sotto)
    this.bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.5);
    this.bg.setOrigin(0, 0);

    // Box centrale (resta dentro il viewport anche su schermi piccoli)
    const boxW = Math.min(560, w - 40);
    const boxH = Math.min(420, h - 80);
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;
    this.box = scene.add.rectangle(bx, by, boxW, boxH, 0x1a2530, 0.96);
    this.box.setOrigin(0, 0);
    this.box.setStrokeStyle(2, 0x6699bb);

    this.title = scene.add.text(w / 2, by + 20, '', {
      fontFamily: 'monospace',
      fontSize: sFont(20),
      color: '#fff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: boxW - 40 },
    });
    this.title.setOrigin(0.5, 0);

    this.subtitle = scene.add.text(w / 2, by + 56, '', {
      fontFamily: 'monospace',
      fontSize: sFont(14),
      color: '#9bcfff',
      align: 'center',
      wordWrap: { width: boxW - 40 },
    });
    this.subtitle.setOrigin(0.5, 0);

    this.info = scene.add.text(bx + 24, by + 96, '', {
      fontFamily: 'monospace',
      fontSize: sFont(13),
      color: '#cdd9e3',
      align: 'left',
      wordWrap: { width: boxW - 48 },
      lineSpacing: 4,
    });
    this.info.setOrigin(0, 0);

    this.overlay.add([this.bg, this.box, this.title, this.subtitle, this.info]);
    this.overlay.setVisible(false);
    this.bg.disableInteractive();
  }

  /**
   * Mostra il box. La firma legacy (3 args) è preservata per retrocompatibilità.
   */
  show(promptOrOpts: string | DiceChoiceOptions, choices?: number[], onChoose?: (n: number) => void): void {
    const opts: DiceChoiceOptions =
      typeof promptOrOpts === 'string'
        ? { title: promptOrOpts, choices: choices!, onChoose: onChoose! }
        : promptOrOpts;

    this.title.setText(opts.title);
    this.subtitle.setText(opts.subtitle ?? '');
    this.info.setText((opts.infoLines ?? []).join('\n'));

    this.bg.setInteractive(); // backdrop blocca click sotto

    // Pulisci bottoni precedenti
    for (const b of this.buttons) b.destroy();
    this.buttons = [];

    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    const boxW = Math.min(560, w - 40);
    const boxH = Math.min(420, h - 80);
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;

    // Bottoni in basso al box (scalati su mobile)
    const btnH = s(78);
    const btnGap = s(14);
    const totalW = boxW - s(48);
    const maxBtnW = s(110);
    const btnW = Math.min(maxBtnW, (totalW - btnGap * (opts.choices.length - 1)) / opts.choices.length);
    const startX = bx + (boxW - (opts.choices.length * btnW + (opts.choices.length - 1) * btnGap)) / 2;
    const btnY = by + boxH - btnH - s(24);

    let x = startX;
    for (const n of opts.choices) {
      const c = this.scene.add.container(x, btnY);
      const r = this.scene.add.rectangle(0, 0, btnW, btnH, 0x335577, 1);
      r.setOrigin(0, 0);
      r.setStrokeStyle(3, 0x6699bb);
      const t = this.scene.add.text(btnW / 2, btnH / 2, `${n}`, {
        fontFamily: 'monospace',
        fontSize: sFont(34),
        color: '#fff',
        fontStyle: 'bold',
      });
      t.setOrigin(0.5, 0.5);
      c.add([r, t]);
      r.setInteractive({ useHandCursor: true });
      r.on('pointerover', () => r.setFillStyle(0x4477aa));
      r.on('pointerout', () => r.setFillStyle(0x335577));
      r.on('pointerup', () => {
        this.hide();
        opts.onChoose(n);
      });
      this.buttons.push(c);
      this.overlay.add(c);
      x += btnW + btnGap;
    }

    this.overlay.setVisible(true);
  }

  hide(): void {
    this.overlay.setVisible(false);
    this.bg.disableInteractive();
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
  }

  destroy(): void {
    this.overlay.destroy();
  }
}

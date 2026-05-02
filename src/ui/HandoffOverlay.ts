import Phaser from 'phaser';

/**
 * Overlay "Passa al giocatore X" per hot-seat.
 * Nasconde la scelta privata fatta dal giocatore precedente prima di mostrare quella del nuovo.
 */
export class HandoffOverlay {
  private overlay: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private button: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;

    this.overlay = scene.add.container(0, 0);
    this.overlay.setScrollFactor(0);

    this.bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.95);
    this.bg.setOrigin(0, 0);
    this.bg.setInteractive(); // blocca click

    this.title = scene.add.text(w / 2, h / 2 - 60, '', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#fff',
      align: 'center',
    });
    this.title.setOrigin(0.5, 0.5);

    this.subtitle = scene.add.text(w / 2, h / 2 - 20, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaa',
      align: 'center',
      wordWrap: { width: w * 0.7 },
    });
    this.subtitle.setOrigin(0.5, 0.5);

    // Bottone "Sono pronto" — touch-friendly
    const btnW = 280;
    const btnH = 70;
    this.button = scene.add.container(w / 2 - btnW / 2, h / 2 + 20);
    const r = scene.add.rectangle(0, 0, btnW, btnH, 0x336633, 1);
    r.setOrigin(0, 0);
    r.setStrokeStyle(3, 0x66aa66);
    const t = scene.add.text(btnW / 2, btnH / 2, 'Sono pronto', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#fff',
    });
    t.setOrigin(0.5, 0.5);
    this.button.add([r, t]);

    this.overlay.add([this.bg, this.title, this.subtitle, this.button]);
    this.overlay.setVisible(false);
    // Disable interactive all'init: viene riabilitato in show()
    this.bg.disableInteractive();
  }

  show(title: string, subtitle: string, onProceed: () => void): void {
    this.title.setText(title);
    this.subtitle.setText(subtitle);

    // Riabilita interactive (il bg cattura click impedendo passaggio sotto)
    this.bg.setInteractive();
    const btnRect = this.button.getAt(0) as Phaser.GameObjects.Rectangle;
    btnRect.removeAllListeners();
    btnRect.setInteractive({ useHandCursor: true });
    btnRect.on('pointerover', () => btnRect.setFillStyle(0x448844));
    btnRect.on('pointerout', () => btnRect.setFillStyle(0x336633));
    // pointerup invece di pointerdown per affidabilità touch
    btnRect.on('pointerup', () => {
      this.hide();
      onProceed();
    });
    this.overlay.setVisible(true);
  }

  hide(): void {
    this.overlay.setVisible(false);
    // CRITICO: disabilitare interactive — un overlay invisibile MA interactive
    // continua a catturare i click su touch. Bug fix iPad.
    this.bg.disableInteractive();
    const btnRect = this.button.getAt(0) as Phaser.GameObjects.Rectangle;
    btnRect.disableInteractive();
  }

  /** Distrugge tutti gli oggetti grafici (per resize/teardown). */
  destroy(): void {
    this.overlay.destroy();
  }
}

import Phaser from 'phaser';

/**
 * Overlay di fine partita non-opaco: mostra il vincitore con leggibilità chiara,
 * mantenendo VISIBILI sotto la mappa e il combat log. Bottone "Torna al menu".
 */
export class GameOverOverlay {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private button: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;

    this.container = scene.add.container(0, 0);
    this.container.setScrollFactor(0);

    // Banner centrale (non full-screen): lascia visibili HUD/log/mappa
    const bannerW = 600;
    const bannerH = 200;
    const bx = w / 2 - bannerW / 2;
    const by = h / 2 - bannerH / 2;

    this.bg = scene.add.rectangle(bx, by, bannerW, bannerH, 0x111820, 0.92);
    this.bg.setOrigin(0, 0);
    this.bg.setStrokeStyle(3, 0x88aacc);
    this.bg.setInteractive(); // cattura click, non li propaga sotto

    this.title = scene.add.text(w / 2, by + 40, '', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#fff',
      align: 'center',
    });
    this.title.setOrigin(0.5, 0);

    this.subtitle = scene.add.text(w / 2, by + 90, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#aaa',
      align: 'center',
      wordWrap: { width: bannerW - 40 },
    });
    this.subtitle.setOrigin(0.5, 0);

    // Bottone "Torna al menu"
    this.button = scene.add.container(w / 2 - 130, by + 140);
    const btnW = 260;
    const btnH = 44;
    const r = scene.add.rectangle(0, 0, btnW, btnH, 0x336633, 1);
    r.setOrigin(0, 0);
    r.setStrokeStyle(2, 0x66aa66);
    const t = scene.add.text(btnW / 2, btnH / 2, 'Torna al menu', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#fff',
    });
    t.setOrigin(0.5, 0.5);
    this.button.add([r, t]);

    this.container.add([this.bg, this.title, this.subtitle, this.button]);
    this.container.setVisible(false);
    this.bg.disableInteractive();
  }

  show(winner: 'A' | 'B' | 'draw', onReturnToMenu: () => void): void {
    if (winner === 'draw') {
      this.title.setText('Pareggio');
    } else {
      this.title.setText(`Vince Fazione ${winner}`);
    }
    this.subtitle.setText(
      'Il log della battaglia è visibile in basso a sinistra.\nClicca "Torna al menu" per scegliere un altro setup.',
    );

    this.bg.setInteractive();
    const btnRect = this.button.getAt(0) as Phaser.GameObjects.Rectangle;
    btnRect.removeAllListeners();
    btnRect.setInteractive({ useHandCursor: true });
    btnRect.on('pointerover', () => btnRect.setFillStyle(0x448844));
    btnRect.on('pointerout', () => btnRect.setFillStyle(0x336633));
    btnRect.on('pointerup', () => {
      this.hide();
      onReturnToMenu();
    });

    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
    this.bg.disableInteractive();
    const btnRect = this.button.getAt(0) as Phaser.GameObjects.Rectangle;
    btnRect.disableInteractive();
  }

  /** Distrugge tutti gli oggetti grafici. */
  destroy(): void {
    this.container.destroy();
  }
}

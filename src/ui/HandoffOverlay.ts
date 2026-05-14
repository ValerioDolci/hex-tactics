import Phaser from 'phaser';
import { FONTS, PALETTE, makeCodexButton, makeCodexPanel } from './theme';

/**
 * Overlay "Cambio di mano" per hot-seat (Codex Tacticus).
 * Nasconde la scelta privata del giocatore precedente: schermata vellum
 * inchiostrata centrale, "Sono pronto" come bottone Codex primary.
 */
export class HandoffOverlay {
  private overlay: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private button: Phaser.GameObjects.Container;
  private buttonHandler: (() => void) | null = null;
  private cardContainer!: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;

    this.overlay = scene.add.container(0, 0);
    this.overlay.setScrollFactor(0);

    // Veil ink scuro semitrasparente (nasconde la scena)
    this.bg = scene.add.rectangle(0, 0, w, h, PALETTE.ink.num, 0.92);
    this.bg.setOrigin(0, 0);
    this.bg.setInteractive(); // blocca click

    // Card vellum centrale (panel codex)
    const cardW = Math.min(540, w * 0.7);
    const cardH = 260;
    const card = makeCodexPanel({
      scene,
      x: w / 2 - cardW / 2,
      y: h / 2 - cardH / 2,
      width: cardW,
      height: cardH,
      tone: 'vellum',
      alpha: 1,
    });
    this.cardContainer = card.container;

    this.title = scene.add.text(cardW / 2, 30, '', {
      fontFamily: FONTS.display,
      fontSize: '26px',
      color: PALETTE.ink.css,
      align: 'center',
      fontStyle: 'italic',
    });
    this.title.setOrigin(0.5, 0);

    this.subtitle = scene.add.text(cardW / 2, 80, '', {
      fontFamily: FONTS.body,
      fontSize: '16px',
      color: PALETTE.ink.css,
      align: 'center',
      wordWrap: { width: cardW - 40 },
      fontStyle: 'italic',
    });
    this.subtitle.setOrigin(0.5, 0);

    // Filetto oro
    const sep = scene.add.graphics();
    sep.lineStyle(1, PALETTE.gold.num, 0.85);
    sep.lineBetween(cardW / 2 - 60, 145, cardW / 2 + 60, 145);

    // Bottone "Sono pronto"
    const btnW = 280;
    const btnH = 64;
    this.button = makeCodexButton({
      scene,
      x: cardW / 2 - btnW / 2,
      y: 170,
      width: btnW,
      height: btnH,
      label: 'Sono pronto',
      variant: 'primary',
      fontKind: 'display',
      fontSize: 20,
      onClick: () => {
        this.hide();
        this.buttonHandler?.();
      },
    });

    this.cardContainer.add([this.title, this.subtitle, sep, this.button]);
    this.overlay.add([this.bg, this.cardContainer]);
    this.overlay.setVisible(false);
    this.bg.disableInteractive();
  }

  show(title: string, subtitle: string, onProceed: () => void): void {
    this.title.setText(title);
    this.subtitle.setText(subtitle);
    this.buttonHandler = onProceed;
    this.bg.setInteractive();
    this.overlay.setVisible(true);
  }

  hide(): void {
    this.overlay.setVisible(false);
    this.bg.disableInteractive();
  }

  destroy(): void {
    this.overlay.destroy();
  }
}

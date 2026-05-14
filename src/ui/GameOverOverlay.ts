import Phaser from 'phaser';
import { FONTS, PALETTE, factionTincture, makeCodexButton, makeCodexPanel } from './theme';

/**
 * Banner di fine duello (Codex Tacticus) — non full-screen: lascia visibili
 * sotto la mappa e la cronaca. Banner vellum centrale con drop-cap e bottone.
 */
export class GameOverOverlay {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private button!: Phaser.GameObjects.Container;
  private buttonHandler: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;

    this.container = scene.add.container(0, 0);
    this.container.setScrollFactor(0);

    const bannerW = 620;
    const bannerH = 220;
    const bx = w / 2 - bannerW / 2;
    const by = h / 2 - bannerH / 2;

    const panel = makeCodexPanel({
      scene,
      x: bx,
      y: by,
      width: bannerW,
      height: bannerH,
      tone: 'vellum',
      alpha: 0.96,
    });
    const card = panel.container;
    this.bg = panel.bg;
    this.bg.setInteractive(); // cattura click

    this.title = scene.add.text(bannerW / 2, 30, '', {
      fontFamily: FONTS.display,
      fontSize: '32px',
      color: PALETTE.ink.css,
      align: 'center',
      fontStyle: 'italic',
    });
    this.title.setOrigin(0.5, 0);

    // Filetto oro decorativo
    const sep = scene.add.graphics();
    sep.lineStyle(1.2, PALETTE.gold.num, 0.85);
    sep.lineBetween(bannerW / 2 - 90, 86, bannerW / 2 + 90, 86);
    sep.fillStyle(PALETTE.gold.num, 1);
    sep.fillTriangle(bannerW / 2 - 4, 86, bannerW / 2 + 4, 86, bannerW / 2, 80);
    sep.fillTriangle(bannerW / 2 - 4, 86, bannerW / 2 + 4, 86, bannerW / 2, 92);

    this.subtitle = scene.add.text(bannerW / 2, 100, '', {
      fontFamily: FONTS.body,
      fontSize: '15px',
      color: PALETTE.ink.css,
      align: 'center',
      wordWrap: { width: bannerW - 60 },
      fontStyle: 'italic',
    });
    this.subtitle.setOrigin(0.5, 0);

    const btnW = 260;
    const btnH = 48;
    this.button = makeCodexButton({
      scene,
      x: bannerW / 2 - btnW / 2,
      y: 158,
      width: btnW,
      height: btnH,
      label: 'Ritorno al frontespizio',
      variant: 'primary',
      fontKind: 'display',
      fontSize: 16,
      onClick: () => {
        this.hide();
        this.buttonHandler?.();
      },
    });

    card.add([this.title, sep, this.subtitle, this.button]);
    this.container.add(card);
    this.container.setVisible(false);
    this.bg.disableInteractive();
  }

  show(winner: 'A' | 'B' | 'draw', onReturnToMenu: () => void): void {
    if (winner === 'draw') {
      this.title.setText('Pareggio');
      this.title.setColor(PALETTE.ink.css);
    } else {
      const t = factionTincture(winner);
      this.title.setText(`Vince la fazione ${t.blason}`);
      this.title.setColor(t.css);
    }
    this.subtitle.setText(
      'La cronaca del duello resta in basso a sinistra.\nIl frontespizio attende un nuovo setup.',
    );
    this.buttonHandler = onReturnToMenu;
    this.bg.setInteractive();
    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
    this.bg.disableInteractive();
  }

  destroy(): void {
    this.container.destroy();
  }
}

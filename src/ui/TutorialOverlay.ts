import Phaser from 'phaser';
import { FONTS, PALETTE, makeCodexButton, makeCodexPanel } from './theme';

/**
 * Overlay didattico mostrato durante i tutorial.
 * Box semi-trasparente con testo + freccia opzionale che punta a un elemento UI
 * + bottone "Avanti" per advance manuale.
 *
 * Posizione: in basso al centro (per non coprire il board e l'azione menu).
 */
export class TutorialOverlay {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private text!: Phaser.GameObjects.Text;
  private button!: Phaser.GameObjects.Container;
  private arrow?: Phaser.GameObjects.Triangle;
  private onAdvance?: () => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(1000);
    this.container.setVisible(false);
    this.build();
  }

  private build(): void {
    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    const boxW = Math.min(680, w - 40);
    const boxH = 110;
    const bx = w / 2 - boxW / 2;
    const by = h - boxH - 20;

    const panel = makeCodexPanel({
      scene: this.scene,
      x: bx,
      y: by,
      width: boxW,
      height: boxH,
      tone: 'vellum',
      alpha: 0.97,
    });

    this.text = this.scene.add
      .text(16, 14, '', {
        fontFamily: FONTS.body,
        fontSize: '16px',
        color: PALETTE.ink.css,
        wordWrap: { width: boxW - 140 },
        lineSpacing: 5,
        fontStyle: 'italic',
      })
      .setOrigin(0, 0);
    panel.container.add(this.text);

    // Bottone Avanti — gold variant codex
    const btnW = 100;
    const btnH = 36;
    const btnX = boxW - btnW - 16;
    const btnY = boxH - btnH - 14;
    this.button = makeCodexButton({
      scene: this.scene,
      x: btnX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'Avanti  →',
      variant: 'gold',
      fontKind: 'display',
      fontSize: 14,
      onClick: () => {
        if (this.onAdvance) this.onAdvance();
      },
    });
    panel.container.add(this.button);
    this.container.add(panel.container);
  }

  /**
   * Mostra l'overlay con un testo e (opzionale) una freccia che punta a un target.
   * `onAdvance` è chiamato quando l'utente clicca "Avanti".
   */
  show(opts: {
    text: string;
    arrowTarget?: { x: number; y: number };
    showButton?: boolean;
    onAdvance?: () => void;
  }): void {
    this.text.setText(opts.text);
    this.onAdvance = opts.onAdvance;

    // Bottone visibilità
    const showBtn = opts.showButton !== false;
    this.button.setVisible(showBtn);

    // Freccia
    if (this.arrow) {
      this.arrow.destroy();
      this.arrow = undefined;
    }
    if (opts.arrowTarget) {
      this.drawArrow(opts.arrowTarget.x, opts.arrowTarget.y);
    }

    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
    if (this.arrow) {
      this.arrow.destroy();
      this.arrow = undefined;
    }
  }

  private drawArrow(targetX: number, targetY: number): void {
    // Triangolo che indica il target. Posizionato vicino al target,
    // puntando dal box-overlay verso l'elemento.
    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    const boxTop = h - 130;

    // Direzione approssimativa: se target è sopra il box → freccia punta in alto vicino al target
    // Se target è in alto-destra → freccia in alto-destra
    // Per semplicità: disegno un triangolo giallo vicino al target che punta verso il target.
    const arrowSize = 18;
    let arrX = targetX;
    let arrY = targetY + arrowSize + 10; // sotto al target

    // Se sotto al box overlay, sposta sopra
    if (arrY > boxTop - arrowSize) {
      arrY = targetY - arrowSize - 10;
    }
    // Triangolo che punta verso il target (verso l'alto se sopra, verso il basso se sotto)
    const pointsUp = arrY > targetY;
    if (pointsUp) {
      this.arrow = this.scene.add.triangle(
        arrX,
        arrY,
        0,
        arrowSize,
        arrowSize,
        arrowSize,
        arrowSize / 2,
        0,
        PALETTE.gold.num,
      );
    } else {
      this.arrow = this.scene.add.triangle(
        arrX,
        arrY,
        0,
        0,
        arrowSize,
        0,
        arrowSize / 2,
        arrowSize,
        PALETTE.gold.num,
      );
    }
    this.arrow.setStrokeStyle(2, PALETTE.goldDeep.num);
    this.arrow.setScrollFactor(0);
    this.arrow.setDepth(1001);

    // Animazione: pulsa per attirare attenzione
    this.scene.tweens.add({
      targets: this.arrow,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    void w;
  }

  /**
   * Aggiorna solo il testo senza altri side effect.
   */
  setText(text: string): void {
    this.text.setText(text);
  }

  destroy(): void {
    this.container.destroy();
    if (this.arrow) this.arrow.destroy();
  }
}

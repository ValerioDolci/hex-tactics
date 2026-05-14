/**
 * CombatNarrationOverlay — overlay sopra la scena per la narrazione del combattimento.
 *
 * Posizione: barra orizzontale ancorata sotto il banner round (~25% dall'alto),
 * larga ~70% dello schermo, centrata.
 *
 * Estetica: cartiglio di pergamena scura semi-trasparente (PALETTE.vellumDeep
 * alpha ~0.85), bordo sottile inchiostro, testo serif Display.
 *
 * Comportamento:
 *  - `show(text, tone)`: fade-in nuova linea. Se un'altra è già visibile la
 *    sostituisce (fade-out vecchia + fade-in nuova). Niente accumulo: una sola
 *    riga alla volta per non disturbare la lettura della board.
 *  - Auto-dismiss dopo `holdMs` (default 3500ms; min 2000ms anche su frasi corte).
 *  - `hide()` forza dismiss immediato.
 *
 * Toni → colore:
 *   neutral    → ink                  (testo normale)
 *   hit        → gules                (rosso araldico, colpo letale)
 *   miss       → inkFaded              (sbiadito, niente impatto)
 *   defense    → azure                (blu araldico, difesa attiva)
 *   initiative → gold                 (oro, momento chiave di tempo)
 *   death      → inkBrown bold        (marrone scuro, peso)
 */
import Phaser from 'phaser';
import { PALETTE, FONTS } from './theme';
import { uiScale } from './uiScale';

import type { NarrationLine } from './combatNarrator';

type Tone = NonNullable<NarrationLine>['tone'];

const TONE_COLORS: Record<Tone, { css: string; bold: boolean }> = {
  neutral: { css: PALETTE.ink.css, bold: false },
  hit: { css: PALETTE.gules.css, bold: false },
  miss: { css: PALETTE.inkFaded.css, bold: false },
  defense: { css: PALETTE.azure.css, bold: false },
  initiative: { css: PALETTE.gold.css, bold: true },
  death: { css: PALETTE.ink.css, bold: true },
  tempo: { css: PALETTE.inkFaded.css, bold: false }, // pause tattiche (reload): tono sbiadito
};

export class CombatNarrationOverlay {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private bg!: Phaser.GameObjects.Rectangle;
  private border!: Phaser.GameObjects.Rectangle;
  private text!: Phaser.GameObjects.Text;
  private dismissEvent: Phaser.Time.TimerEvent | null = null;
  private currentTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  private build(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const scl = uiScale();

    const barW = Math.min(w * 0.7, 800 * scl);
    const barH = 60 * scl;
    const x = w / 2;
    const y = h * 0.22 + 50 * scl; // sotto il banner round

    this.container = this.scene.add.container(x, y);
    this.container.setScrollFactor(0);
    this.container.setDepth(1000);
    this.container.setAlpha(0);

    this.bg = this.scene.add.rectangle(0, 0, barW, barH, PALETTE.vellumDeep.num, 0.92);
    this.border = this.scene.add.rectangle(0, 0, barW, barH);
    this.border.setStrokeStyle(1, PALETTE.ink.num, 0.6);
    this.border.setFillStyle();
    this.text = this.scene.add.text(0, 0, '', {
      fontFamily: FONTS.display,
      fontSize: `${Math.round(20 * scl)}px`,
      color: PALETTE.ink.css,
      align: 'center',
      wordWrap: { width: barW - 32 * scl, useAdvancedWrap: true },
      fontStyle: 'italic',
    });
    this.text.setOrigin(0.5, 0.5);

    this.container.add([this.bg, this.border, this.text]);
  }

  /**
   * Mostra una nuova linea con animazione fade-in. Se una linea è già visibile,
   * la sostituisce (fade-out → swap testo → fade-in).
   */
  show(line: NarrationLine, holdMs = 3500): void {
    if (!line || !this.container) return;
    const tone = line.tone;
    const color = TONE_COLORS[tone] ?? TONE_COLORS.neutral;

    const apply = (): void => {
      if (!this.container) return;
      this.text.setText(line.text);
      this.text.setColor(color.css);
      this.text.setStyle({ fontStyle: color.bold ? 'bold italic' : 'italic' });
      // Resize background a contenere il testo (con padding)
      const padX = 24 * uiScale();
      const padY = 14 * uiScale();
      const tb = this.text.getBounds();
      const targetW = Math.max(this.bg.width, tb.width + padX * 2);
      const targetH = tb.height + padY * 2;
      this.bg.setSize(targetW, targetH);
      this.border.setSize(targetW, targetH);
      // Re-stroke (Phaser perde lo stroke su setSize)
      this.border.setStrokeStyle(1, PALETTE.ink.num, 0.6);

      // Fade-in
      this.killTweens();
      this.scene.tweens.add({
        targets: this.container,
        alpha: 1,
        duration: 220,
        ease: 'Sine.easeOut',
      });
      // Auto-dismiss
      if (this.dismissEvent) this.dismissEvent.remove();
      this.dismissEvent = this.scene.time.delayedCall(Math.max(2000, holdMs), () => this.hide());
    };

    if (this.container.alpha > 0.05) {
      // Fade-out poi swap
      this.killTweens();
      this.currentTween = this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: 140,
        ease: 'Sine.easeIn',
        onComplete: apply,
      });
    } else {
      apply();
    }
  }

  /** Dismissione forzata immediata (fade-out). */
  hide(): void {
    if (!this.container) return;
    this.killTweens();
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 220,
      ease: 'Sine.easeIn',
    });
    if (this.dismissEvent) {
      this.dismissEvent.remove();
      this.dismissEvent = null;
    }
  }

  destroy(): void {
    this.killTweens();
    if (this.dismissEvent) this.dismissEvent.remove();
    this.container?.destroy(true);
    this.container = null;
  }

  private killTweens(): void {
    if (this.currentTween) {
      this.currentTween.stop();
      this.currentTween = null;
    }
    if (this.container) this.scene.tweens.killTweensOf(this.container);
  }
}

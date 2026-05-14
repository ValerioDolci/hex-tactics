/**
 * CombatNarrationOverlay — overlay sopra la scena per la narrazione del combattimento.
 *
 * Posizione: barra orizzontale in BASSO, sopra il CombatLog (area sgombra).
 * Centrato orizzontalmente, larga ~60% schermo, sopra (y) il log/menu.
 * Motivo del basso: il centro-alto è occupato da SliderChoiceUI/DiceChoiceUI
 * (popup scelta dadi/slancio) — overlay narrazione lì creava sovrapposizione.
 *
 * Estetica: cartiglio pergamena scura, ben opaco (alpha 0.96), bordo inchiostro
 * 2px, testo serif Display 22*scl px (più grande di prima per leggibilità).
 *
 * Comportamento:
 *  - `show(text, tone)`: fade-in. Sostituisce con fade-out → swap → fade-in.
 *  - Auto-dismiss dopo `holdMs` (default 3500ms; min 2000ms).
 *  - `hide()` forza dismiss immediato.
 *  - `setSuppressed(bool)`: durante popup UI (slider/dice/handoff) silenzia il
 *    refresh; le linee accodate vengono comunque mostrate ma con priorità bassa.
 *
 * Toni → colore (su bg vellumDeep #c9b896):
 *   neutral    → ink                  (inchiostro caldo)
 *   hit        → gules                (rosso araldico)
 *   miss       → inkFaded              (sbiadito)
 *   defense    → azure deep           (blu araldico più scuro per leggibilità)
 *   initiative → goldDeep             (oro scuro, più contrastato del gold chiaro)
 *   death      → ink bold             (marcato)
 *   tempo      → inkFaded             (sbiadito per pause)
 */
import Phaser from 'phaser';
import { PALETTE, FONTS } from './theme';
import { uiScale } from './uiScale';

import type { NarrationLine } from './combatNarrator';

type Tone = NonNullable<NarrationLine>['tone'];

const TONE_COLORS: Record<Tone, { css: string; bold: boolean }> = {
  neutral: { css: PALETTE.ink.css, bold: false },
  hit: { css: PALETTE.gules.css, bold: true },
  miss: { css: PALETTE.inkFaded.css, bold: false },
  defense: { css: PALETTE.azureDeep?.css ?? PALETTE.azure.css, bold: false },
  initiative: { css: PALETTE.goldDeep?.css ?? PALETTE.gold.css, bold: true },
  death: { css: PALETTE.ink.css, bold: true },
  tempo: { css: PALETTE.inkFaded.css, bold: false },
};

export class CombatNarrationOverlay {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private bg!: Phaser.GameObjects.Rectangle;
  private border!: Phaser.GameObjects.Rectangle;
  private text!: Phaser.GameObjects.Text;
  private dismissEvent: Phaser.Time.TimerEvent | null = null;
  private currentTween: Phaser.Tweens.Tween | null = null;
  private suppressed = false;
  /** Linea pending da mostrare appena `suppressed` torna a false. */
  private queued: { line: NarrationLine; holdMs: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  private build(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const scl = uiScale();

    const barW = Math.min(w * 0.62, 760 * scl);
    const barH = 64 * scl;
    const x = w / 2;
    // In basso: sopra al CombatLog (che è ancorato a y=height - logH - 20 con logH<=220).
    // Lasciamo ~250px di buffer dal fondo per stare sopra al log + non toccare unità.
    const y = h - Math.max(280 * scl, 250);

    this.container = this.scene.add.container(x, y);
    this.container.setScrollFactor(0);
    this.container.setDepth(1000);
    this.container.setAlpha(0);

    this.bg = this.scene.add.rectangle(0, 0, barW, barH, PALETTE.vellumDeep.num, 0.96);
    this.border = this.scene.add.rectangle(0, 0, barW, barH);
    this.border.setStrokeStyle(2, PALETTE.ink.num, 0.85);
    this.border.setFillStyle();
    this.text = this.scene.add.text(0, 0, '', {
      fontFamily: FONTS.display,
      fontSize: `${Math.round(22 * scl)}px`,
      color: PALETTE.ink.css,
      align: 'center',
      wordWrap: { width: barW - 36 * scl, useAdvancedWrap: true },
      fontStyle: 'italic',
    });
    this.text.setOrigin(0.5, 0.5);

    this.container.add([this.bg, this.border, this.text]);
  }

  /**
   * Imposta lo stato "soppressione": quando true, qualunque `show()` viene
   * accodato per essere mostrato a soppressione finita. La linea attualmente
   * visibile viene comunque chiusa per non sovrapporsi ai popup UI.
   */
  setSuppressed(value: boolean): void {
    if (this.suppressed === value) return;
    this.suppressed = value;
    if (value) {
      // Soppressione attivata: nascondi l'overlay corrente, eventuale linea accodata
      // sarà mostrata al ritorno a false.
      if (this.container && this.container.alpha > 0.05) this.hide();
    } else {
      // Sopprimere finita: se c'è una linea accodata, mostrala adesso.
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.show(q.line, q.holdMs);
      }
    }
  }

  /**
   * Mostra una nuova linea. Se soppressa, accoda l'ULTIMA (sovrascrive la precedente
   * accodata — vogliamo l'evento più recente, non un buffer).
   */
  show(line: NarrationLine, holdMs = 3500): void {
    if (!line || !this.container) return;
    if (this.suppressed) {
      this.queued = { line, holdMs };
      return;
    }
    const tone = line.tone;
    const color = TONE_COLORS[tone] ?? TONE_COLORS.neutral;

    const apply = (): void => {
      if (!this.container) return;
      this.text.setText(line.text);
      this.text.setColor(color.css);
      this.text.setStyle({ fontStyle: color.bold ? 'bold italic' : 'italic' });
      const padX = 28 * uiScale();
      const padY = 16 * uiScale();
      const tb = this.text.getBounds();
      const targetW = Math.max(this.bg.width, tb.width + padX * 2);
      const targetH = Math.max(this.bg.height, tb.height + padY * 2);
      this.bg.setSize(targetW, targetH);
      this.border.setSize(targetW, targetH);
      // Re-stroke (Phaser perde lo stroke su setSize)
      this.border.setStrokeStyle(2, PALETTE.ink.num, 0.85);

      this.killTweens();
      this.scene.tweens.add({
        targets: this.container,
        alpha: 1,
        duration: 220,
        ease: 'Sine.easeOut',
      });
      if (this.dismissEvent) this.dismissEvent.remove();
      this.dismissEvent = this.scene.time.delayedCall(Math.max(2000, holdMs), () => this.hide());
    };

    if (this.container.alpha > 0.05) {
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

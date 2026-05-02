import Phaser from 'phaser';

export interface SliderChoiceOptions {
  /** Titolo principale del box */
  title: string;
  /** Sottotitolo / descrizione */
  subtitle?: string;
  /** Linee di info (una per riga) */
  infoLines?: string[];
  /** Cap massimo dello slider (min è sempre 0) */
  max: number;
  /** Valore iniziale (default 0). Clampato in [0, max]. */
  initial?: number;
  /** Callback chiamata col valore confermato */
  onConfirm: (n: number) => void;
}

/**
 * Slider numerico modale: alternativa a DiceChoiceUI per quando il range è
 * potenzialmente ampio (es. transfer impeto→slancio fino a 14).
 *
 * UI:
 *   - track orizzontale + fill colorato
 *   - knob draggabile (anche click+drag su track per snap)
 *   - label valore corrente grande al centro
 *   - bottoni −/+ per fine-tuning
 *   - bottone CONFERMA per chiudere e callback
 *
 * Pattern coerente con DiceChoiceUI: overlay container con bg semi-trasparente
 * + box centrale, scrollFactor 0 (UI immune da scroll camera).
 */
export class SliderChoiceUI {
  private scene: Phaser.Scene;
  private overlay: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private box: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private info: Phaser.GameObjects.Text;
  private valueText!: Phaser.GameObjects.Text;
  private track!: Phaser.GameObjects.Rectangle;
  private fill!: Phaser.GameObjects.Rectangle;
  private knob!: Phaser.GameObjects.Arc;
  private minusBtn!: Phaser.GameObjects.Container;
  private plusBtn!: Phaser.GameObjects.Container;
  private confirmBtn!: Phaser.GameObjects.Container;

  private value = 0;
  private max = 0;
  private trackX0 = 0;
  private trackX1 = 0;
  private trackY = 0;
  private dragHandlerAttached = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const w = scene.cameras.main.width;
    const h = scene.cameras.main.height;
    this.overlay = scene.add.container(0, 0);
    this.overlay.setScrollFactor(0);

    this.bg = scene.add.rectangle(0, 0, w, h, 0x000000, 0.5);
    this.bg.setOrigin(0, 0);

    const boxW = Math.min(560, w - 40);
    const boxH = Math.min(420, h - 80);
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;
    this.box = scene.add.rectangle(bx, by, boxW, boxH, 0x1a2530, 0.96);
    this.box.setOrigin(0, 0);
    this.box.setStrokeStyle(2, 0x6699bb);

    this.title = scene.add.text(w / 2, by + 20, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#fff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: { width: boxW - 40 },
    });
    this.title.setOrigin(0.5, 0);

    this.subtitle = scene.add.text(w / 2, by + 56, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#9bcfff',
      align: 'center',
      wordWrap: { width: boxW - 40 },
    });
    this.subtitle.setOrigin(0.5, 0);

    this.info = scene.add.text(bx + 24, by + 96, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
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

  show(opts: SliderChoiceOptions): void {
    this.title.setText(opts.title);
    this.subtitle.setText(opts.subtitle ?? '');
    this.info.setText((opts.infoLines ?? []).join('\n'));

    this.bg.setInteractive(); // backdrop blocca click sotto

    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    const boxW = Math.min(560, w - 40);
    const boxH = Math.min(420, h - 80);
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;

    this.max = Math.max(0, Math.floor(opts.max));
    this.value = Math.max(0, Math.min(this.max, Math.floor(opts.initial ?? 0)));

    // Pulisci elementi precedenti se ricreati (per show multipli)
    this.destroySliderElements();

    // Layout (boxH=420, top→bottom):
    //   title (by+20) | subtitle (by+56) | info (by+96..by+~190 wordwrap)
    //   valueText centrato y=by+220 (font 50px, height ~50, top by+195 — margine 5px da info)
    //   slider y=by+290 con bottoni −/+ ai lati (non sopra)
    //   CONFERMA y=by+boxH-36 = by+384
    const valueY = by + 220;
    const sliderY = by + 290;
    const sliderH = 14;
    const sideBtnSize = 44;
    const sideMargin = 24;
    // Track va da subito dopo bottone − a subito prima bottone +
    this.trackX0 = bx + sideMargin + sideBtnSize + 18;
    this.trackX1 = bx + boxW - sideMargin - sideBtnSize - 18;
    this.trackY = sliderY;
    const trackW = this.trackX1 - this.trackX0;

    // Label valore corrente, in mezzo sopra slider, separato da info da margine
    this.valueText = this.scene.add.text(w / 2, valueY, '0', {
      fontFamily: 'monospace',
      fontSize: '50px',
      color: '#ffd966',
      fontStyle: 'bold',
      stroke: '#000',
      strokeThickness: 4,
    });
    this.valueText.setOrigin(0.5, 0.5);

    // Track (sfondo)
    this.track = this.scene.add.rectangle(
      this.trackX0,
      sliderY,
      trackW,
      sliderH,
      0x223344,
      1,
    );
    this.track.setOrigin(0, 0.5);
    this.track.setStrokeStyle(2, 0x6699bb);

    // Fill (parte attiva, verde slancio)
    this.fill = this.scene.add.rectangle(
      this.trackX0,
      sliderY,
      0,
      sliderH,
      0x44aa88,
      1,
    );
    this.fill.setOrigin(0, 0.5);

    // Knob (cerchietto draggabile, più grande per hit-test agevole)
    this.knob = this.scene.add.circle(this.trackX0, sliderY, 18, 0xffd966, 1);
    this.knob.setStrokeStyle(3, 0x886622);
    this.knob.setInteractive({ draggable: true, useHandCursor: true });

    // Track click anche fuori dal knob: snap immediato
    this.track.setInteractive({ useHandCursor: true });
    this.track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.setValueFromX(pointer.x);
    });

    // Drag knob: aggiorna valore con snap intero
    if (!this.dragHandlerAttached) {
      this.scene.input.on('drag', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject, dragX: number) => {
        if (obj !== this.knob) return;
        const clamped = Math.max(this.trackX0, Math.min(this.trackX1, dragX));
        this.setValueFromX(clamped);
      });
      this.dragHandlerAttached = true;
    }

    // Bottoni −/+ ai lati dello slider (non sopra: evita sovrapposizione con valueText/info)
    const minusX = bx + sideMargin + sideBtnSize / 2;
    const plusX = bx + boxW - sideMargin - sideBtnSize / 2;
    this.minusBtn = this.makeIconButton(minusX, sliderY, '−', sideBtnSize, () => {
      this.setValue(this.value - 1);
    });
    this.plusBtn = this.makeIconButton(plusX, sliderY, '+', sideBtnSize, () => {
      this.setValue(this.value + 1);
    });

    // Bottone CONFERMA in basso al box
    this.confirmBtn = this.makeConfirmButton(w / 2, by + boxH - 36, () => {
      const v = this.value;
      this.hide();
      opts.onConfirm(v);
    });

    this.overlay.add([
      this.track,
      this.fill,
      this.knob,
      this.valueText,
      this.minusBtn,
      this.plusBtn,
      this.confirmBtn,
    ]);

    this.refresh();
    this.overlay.setVisible(true);
  }

  private setValueFromX(screenX: number): void {
    const trackW = this.trackX1 - this.trackX0;
    if (trackW <= 0 || this.max === 0) {
      this.setValue(0);
      return;
    }
    const t = (screenX - this.trackX0) / trackW;
    const v = Math.round(t * this.max);
    this.setValue(v);
  }

  private setValue(v: number): void {
    this.value = Math.max(0, Math.min(this.max, Math.floor(v)));
    this.refresh();
  }

  /** Aggiorna posizione knob, dimensione fill, e label numerica. */
  private refresh(): void {
    const trackW = this.trackX1 - this.trackX0;
    const t = this.max > 0 ? this.value / this.max : 0;
    const x = this.trackX0 + t * trackW;
    this.knob.setPosition(x, this.trackY);
    this.fill.width = Math.max(0, x - this.trackX0);
    this.valueText.setText(`${this.value}`);
  }

  private makeIconButton(
    cx: number,
    cy: number,
    label: string,
    size: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.scene.add.container(cx, cy);
    const r = this.scene.add.rectangle(0, 0, size, size, 0x335577, 1);
    r.setStrokeStyle(2, 0x6699bb);
    const t = this.scene.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: `${Math.round(size * 0.6)}px`,
      color: '#fff',
      fontStyle: 'bold',
    });
    t.setOrigin(0.5, 0.5);
    c.add([r, t]);
    r.setInteractive({ useHandCursor: true });
    r.on('pointerover', () => r.setFillStyle(0x4477aa));
    r.on('pointerout', () => r.setFillStyle(0x335577));
    r.on('pointerup', onClick);
    return c;
  }

  private makeConfirmButton(
    cx: number,
    cy: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.scene.add.container(cx, cy);
    const r = this.scene.add.rectangle(0, 0, 220, 56, 0x336633, 1);
    r.setStrokeStyle(3, 0x77bb77);
    const t = this.scene.add.text(0, 0, 'CONFERMA', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    t.setOrigin(0.5, 0.5);
    c.add([r, t]);
    r.setInteractive({ useHandCursor: true });
    r.on('pointerover', () => r.setFillStyle(0x448844));
    r.on('pointerout', () => r.setFillStyle(0x336633));
    r.on('pointerup', onClick);
    return c;
  }

  private destroySliderElements(): void {
    // Distrugge solo gli elementi creati in show() (non title/subtitle/info che restano)
    for (const obj of [
      this.track,
      this.fill,
      this.knob,
      this.valueText,
      this.minusBtn,
      this.plusBtn,
      this.confirmBtn,
    ]) {
      if (obj) obj.destroy();
    }
  }

  hide(): void {
    this.overlay.setVisible(false);
    this.bg.disableInteractive();
    this.destroySliderElements();
  }

  destroy(): void {
    this.overlay.destroy();
  }
}

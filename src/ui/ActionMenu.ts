import Phaser from 'phaser';

export type ActionMenuItem = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * Menu di azioni per il giocatore corrente. Lista di bottoni cliccabili.
 * Fissato alla camera. Riposizionabile.
 */
export class ActionMenu {
  private container: Phaser.GameObjects.Container;
  private scene: Phaser.Scene;
  private buttons: Phaser.GameObjects.Container[] = [];

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0);
  }

  setItems(items: ActionMenuItem[]): void {
    // Distrugge i precedenti
    for (const b of this.buttons) b.destroy();
    this.buttons = [];

    let yOffset = 0;
    for (const item of items) {
      const btn = this.makeButton(0, yOffset, item);
      this.buttons.push(btn);
      this.container.add(btn);
      yOffset += 60; // touch-friendly spacing
    }
  }

  private makeButton(x: number, y: number, item: ActionMenuItem): Phaser.GameObjects.Container {
    const c = this.scene.add.container(x, y);
    const w = 280;
    const h = 52; // touch-friendly + leggibilità
    const bg = this.scene.add.rectangle(0, 0, w, h, item.disabled ? 0x222222 : 0x335577, 0.92);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(2, item.disabled ? 0x444444 : 0x6699bb);
    const txt = this.scene.add.text(14, h / 2, item.label, {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: item.disabled ? '#888' : '#fff',
      wordWrap: { width: w - 28 },
    });
    txt.setOrigin(0, 0.5);
    c.add([bg, txt]);
    if (!item.disabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(0x4477aa, 0.9));
      bg.on('pointerout', () => bg.setFillStyle(0x335577, 0.9));
      // pointerup: più affidabile cross-platform per click
      bg.on('pointerup', () => item.onClick());
    }
    return c;
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  destroy(): void {
    this.container.destroy();
  }
}

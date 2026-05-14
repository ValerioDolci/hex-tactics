import Phaser from 'phaser';
import { s } from './uiScale';
import { makeCodexButton } from './theme';

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
    const rowH = s(60);
    for (const item of items) {
      const btn = this.makeButton(0, yOffset, item);
      this.buttons.push(btn);
      this.container.add(btn);
      yOffset += rowH; // touch-friendly spacing (scalato su mobile)
    }
  }

  private makeButton(x: number, y: number, item: ActionMenuItem): Phaser.GameObjects.Container {
    return makeCodexButton({
      scene: this.scene,
      x,
      y,
      width: s(300),
      height: s(56),
      label: item.label,
      disabled: item.disabled,
      variant: 'outline',
      fontKind: 'body',
      fontSize: 17,
      onClick: item.disabled ? undefined : item.onClick,
    });
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

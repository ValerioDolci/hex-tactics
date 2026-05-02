import Phaser from 'phaser';

/**
 * Scena di boot. Per ora non carica asset (M1 = rendering vettoriale puro).
 * In M2 caricherà il pack tile/sprite scelto.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // M1: niente da caricare. Placeholder.
  }

  create(): void {
    this.scene.start('MainMenuScene');
  }
}

import Phaser from 'phaser';
import { Unit } from '@entities/Unit';
import { GameState } from '@core/state';

/**
 * HUD principale: mostra info dell'unità di turno corrente, round attuale, fazione di turno.
 * Fissato alla camera (scrollFactor 0).
 */
export class HUD {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private stats: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0);

    this.bg = scene.add.rectangle(0, 0, 380, 130, 0x000000, 0.7);
    this.bg.setOrigin(0, 0);
    this.bg.setStrokeStyle(2, 0x666666);

    this.title = scene.add.text(12, 10, 'HUD', {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#fff',
      fontStyle: 'bold',
    });

    this.stats = scene.add.text(12, 38, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ddd',
      lineSpacing: 4,
    });

    this.container.add([this.bg, this.title, this.stats]);
  }

  update(state: GameState): void {
    if (state.turnOrder.length === 0) {
      this.title.setText('In attesa…');
      this.stats.setText('');
      return;
    }
    const unitId = state.turnOrder[state.currentTurnIdx];
    const unit: Unit | undefined = state.units[unitId];
    if (!unit) return;

    this.title.setText(`Round ${state.round}  ·  Turno: ${unit.name} (fazione ${unit.faction})`);
    const lines = [
      `HP ${unit.hp}/${unit.hpMax}    Impeto ${unit.impeto}    Slancio ${unit.slancio}`,
      `Dadi azione ${unit.dadiAzione}/${unit.dadiAzioneMax}`,
      `Arma: ${unit.weapon ?? '—'}    Offhand: ${unit.offhand ?? '—'}    Armatura: ${unit.armor ?? '—'}`,
      `Fase: ${state.phase}`,
    ];
    this.stats.setText(lines.join('\n'));
  }
}

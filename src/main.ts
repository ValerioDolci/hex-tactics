import Phaser from 'phaser';
import { GAME_CONFIG } from './config';
import { BootScene } from '@scenes/BootScene';
import { MainMenuScene } from '@scenes/MainMenuScene';
import { BattleScene } from '@scenes/BattleScene';
import { ManualScene } from '@scenes/ManualScene';
import { TutorialMenuScene } from '@scenes/TutorialMenuScene';
import { CharacterBuilderScene } from '@scenes/CharacterBuilderScene';

/**
 * Setup Phaser con scale RESIZE: il canvas si adatta al viewport reale del browser
 * (iPad incluso). Le scene ascoltano l'evento resize per riposizionare l'UI.
 *
 * Le dimensioni iniziali in GAME_CONFIG.width/height sono usate come "design size"
 * iniziale e come fallback se il viewport è troppo piccolo.
 */
const initialWidth = Math.max(window.innerWidth || 0, 800);
const initialHeight = Math.max(window.innerHeight || 0, 600);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: initialWidth,
  height: initialHeight,
  backgroundColor: GAME_CONFIG.backgroundColor,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: initialWidth,
    height: initialHeight,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false, // no integer-pixel snap (riduce blur su display HiDPI)
  },
  scene: [
    BootScene,
    MainMenuScene,
    BattleScene,
    ManualScene,
    TutorialMenuScene,
    CharacterBuilderScene,
  ],
};

const game = new Phaser.Game(config);

// Esposizione globale per E2E testing (Playwright). In prod non causa problemi —
// `window.__hexGame` è un appiglio per script di test, non viene usato dal runtime.
(window as unknown as { __hexGame?: Phaser.Game }).__hexGame = game;

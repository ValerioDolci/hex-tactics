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
  // Phaser.CANVAS forza Canvas2D (skip WebGL, che ha bug DPR su alcuni browser/Windows scaling).
  type: Phaser.CANVAS,
  parent: 'game-container',
  width: initialWidth,
  height: initialHeight,
  backgroundColor: GAME_CONFIG.backgroundColor,
  scale: {
    // Scale.NONE = niente auto-scaling Phaser. Il canvas avrà esattamente width × height
    // e niente trasformazioni implicite. Le coord pointer Phaser saranno in CSS pixel
    // identiche al clientX/clientY del browser, eliminando l'offset DPR su Windows.
    mode: Phaser.Scale.NONE,
    width: initialWidth,
    height: initialHeight,
    zoom: 1,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
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

// Manual resize handler per Scale.NONE: aggiorna size canvas + emette resize event Phaser
// così le scene possono riposizionare la UI.
function manualResize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!game.canvas) return;
  // Scale.NONE: canvas internal size = CSS size = viewport. 1 CSS pixel = 1 Phaser pixel.
  game.scale.resize(w, h);
  // Forza CSS canvas a riempire viewport (sicurezza)
  game.canvas.style.width = w + 'px';
  game.canvas.style.height = h + 'px';
}
window.addEventListener('load', () => {
  manualResize();
  setTimeout(manualResize, 250);
});
window.addEventListener('resize', manualResize);
window.addEventListener('orientationchange', () => setTimeout(manualResize, 200));

// Debug overlay puntatore: attivabile con ?debug=1 nell'URL.
// Mostra un puntino rosso alla posizione che PHASER pensa sia il cursore.
// Se il puntino non segue il cursore reale → c'è offset coord, e si vede dove.
if (window.location.search.includes('debug=1')) {
  const dot = document.createElement('div');
  dot.style.cssText = [
    'position: fixed',
    'width: 14px',
    'height: 14px',
    'border-radius: 50%',
    'background: red',
    'border: 2px solid white',
    'pointer-events: none',
    'z-index: 999999',
    'transform: translate(-50%, -50%)',
    'transition: none',
  ].join(';');
  document.body.append(dot);

  const info = document.createElement('div');
  info.style.cssText = [
    'position: fixed',
    'top: 8px',
    'left: 8px',
    'background: rgba(0,0,0,0.85)',
    'color: white',
    'padding: 6px 10px',
    'font: 12px monospace',
    'pointer-events: none',
    'z-index: 999999',
    'border: 1px solid #888',
  ].join(';');
  document.body.append(info);

  // Hooka su pointermove di Phaser quando una scene è attiva
  const updateInfo = (): void => {
    const scene = game.scene.scenes.find((s) => s.scene.isActive());
    if (!scene) return;
    const p = scene.input.activePointer;
    if (!p) return;
    // Phaser p.x/p.y sono già le coord nel canvas
    dot.style.left = p.x + 'px';
    dot.style.top = p.y + 'px';
    const canvas = game.canvas;
    const r = canvas.getBoundingClientRect();
    const cam = scene.cameras.main;
    info.innerHTML =
      `viewport: ${window.innerWidth}×${window.innerHeight} dpr ${window.devicePixelRatio}<br>` +
      `canvas rect: ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}<br>` +
      `canvas internal: ${canvas.width}×${canvas.height}<br>` +
      `Phaser pointer: ${Math.round(p.x)}, ${Math.round(p.y)}<br>` +
      `world: ${Math.round(p.worldX)}, ${Math.round(p.worldY)}<br>` +
      `scene: ${scene.scene.key} | cam scroll: ${Math.round(cam.scrollX)}, ${Math.round(cam.scrollY)} zoom ${cam.zoom.toFixed(2)}<br>` +
      `cam viewport: ${Math.round(cam.width)}×${Math.round(cam.height)}`;
  };
  game.events.on('postrender', updateInfo);
}

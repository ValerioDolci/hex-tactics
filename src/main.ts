import Phaser from 'phaser';
import { GAME_CONFIG } from './config';
import { BootScene } from '@scenes/BootScene';
import { MainMenuScene } from '@scenes/MainMenuScene';
import { BattleScene } from '@scenes/BattleScene';
import { ManualScene } from '@scenes/ManualScene';
import { TutorialMenuScene } from '@scenes/TutorialMenuScene';
import { CharacterBuilderScene } from '@scenes/CharacterBuilderScene';

/**
 * Setup Phaser con scale FIT: canvas logica fissa a GAME_CONFIG.width/height,
 * scalata uniformemente per stare nella finestra del browser mantenendo aspect ratio.
 *
 * Razionale: la mappa è dimensionata per il "design size" 1280×800. Con Scale.RESIZE
 * il canvas seguiva la window: se la window < mappa, la mappa veniva troncata e il
 * giocatore poteva perdere unità mosse fuori vista. Scale.FIT garantisce che l'intera
 * mappa sia sempre visibile (con eventuale letterboxing).
 *
 * Il bug pointer in BattleScene era CAMERA-side (cam.centerOn con viewport > bounds) →
 * fixato rimuovendo pan/zoom. Phaser gestisce trasparentemente la conversione coord
 * canvas→logical anche con Scale.FIT, quindi il pointer continua a funzionare.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  backgroundColor: GAME_CONFIG.backgroundColor,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_CONFIG.width,
    height: GAME_CONFIG.height,
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

// Refresh dopo `load` (utile su mobile dove l'address bar fa layout shift).
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      game.scale.refresh();
    } catch {
      /* ignora */
    }
  }, 250);
});

/**
 * Orientation change su mobile: forziamo Phaser a re-fittare il canvas
 * con un piccolo delay (l'address bar/notch ridisegnano dopo).
 * Senza questo handler, su iOS il canvas può restare bloccato sulle
 * dimensioni vecchie dopo il rotate.
 */
const handleOrientationChange = () => {
  // Doppio refresh: primo immediato, secondo dopo 300ms per address-bar settle
  try { game.scale.refresh(); } catch { /* ignora */ }
  setTimeout(() => {
    try { game.scale.refresh(); } catch { /* ignora */ }
  }, 300);
  // Su mobile, mostra/nascondi overlay portrait
  updatePortraitOverlay();
};
window.addEventListener('orientationchange', handleOrientationChange);
window.addEventListener('resize', handleOrientationChange);
// Modern API screen.orientation (più affidabile su iOS recenti)
if (window.screen && (window.screen as Screen).orientation) {
  try {
    (window.screen as Screen).orientation.addEventListener('change', handleOrientationChange);
  } catch { /* ignora */ }
}

/**
 * Overlay HTML "ruota in landscape": appare se l'utente è su mobile portrait.
 * Il design del gioco (1280×800 = 16:10) è ottimizzato per landscape; in portrait
 * lo Scale.FIT genera bande nere enormi rendendo l'UI quasi inutilizzabile.
 */
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini/i.test(navigator.userAgent)
    || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}
function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}
const portraitOverlay = document.createElement('div');
portraitOverlay.id = 'portrait-overlay';
portraitOverlay.style.cssText = [
  'position: fixed', 'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
  'background: rgba(10, 14, 20, 0.98)',
  'color: #fff', 'font-family: -apple-system, system-ui, sans-serif',
  'display: none', 'align-items: center', 'justify-content: center',
  'flex-direction: column', 'gap: 24px', 'text-align: center', 'padding: 32px',
  'z-index: 9999',
].join(';');
portraitOverlay.innerHTML = `
  <div style="font-size: 64px; animation: rotate 1.5s ease-in-out infinite;">📱</div>
  <div style="font-size: 22px; font-weight: bold;">Ruota il telefono</div>
  <div style="font-size: 16px; color: #aab; max-width: 320px; line-height: 1.4;">
    Il gioco è ottimizzato per uso orizzontale (landscape). Ruota il dispositivo per giocare comodamente.
  </div>
  <style>
    @keyframes rotate {
      0%, 100% { transform: rotate(0deg); }
      50% { transform: rotate(-90deg); }
    }
  </style>
`;
document.body.appendChild(portraitOverlay);

function updatePortraitOverlay(): void {
  if (isMobile() && isPortrait()) {
    portraitOverlay.style.display = 'flex';
  } else {
    portraitOverlay.style.display = 'none';
  }
}
// Check al caricamento
window.addEventListener('load', updatePortraitOverlay);
updatePortraitOverlay();

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

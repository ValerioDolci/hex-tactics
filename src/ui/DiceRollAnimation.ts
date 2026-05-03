import Phaser from 'phaser';

/**
 * Animazione lancio dadi: mostra N dadi D6 stilizzati che ruotano e atterrano
 * sui valori finali. Usata dopo RESOLVE_COMBAT per dare evidenza visiva di
 * quanti dadi sono stati tirati e quali valori sono usciti.
 *
 * Stack: Phaser graphics (pip stile D6), tween scale+rotation.
 * Layout: dadi disposti in fila orizzontale sopra l'origine indicata.
 *
 * Esempio uso:
 *   playDiceRoll(scene, {
 *     dice: [3, 5, 2],
 *     centerX: 640, centerY: 200,
 *     label: 'Bravo attacca',
 *     color: 0xffee66,
 *     onComplete: () => { ... },
 *   });
 */

export interface DiceRollOptions {
  /** Valori finali dei dadi (1-6). La lunghezza determina quanti dadi disegnare. */
  dice: number[];
  /** Centro orizzontale del gruppo dadi (px). */
  centerX: number;
  /** Centro verticale del gruppo (px). */
  centerY: number;
  /** Label sopra i dadi (es. "Alpha attacca"). */
  label?: string;
  /** Colore base dadi (default giallo). */
  color?: number;
  /** Durata totale dell'animazione (default 700ms roll + 600ms hold + 400ms fade). */
  durationRollMs?: number;
  durationHoldMs?: number;
  durationFadeMs?: number;
  /** Callback chiamata a fine animazione. */
  onComplete?: () => void;
}

const DICE_SIZE = 38;
const DICE_GAP = 8;

/**
 * Disegna i pip (puntini) di un D6 sulla faccia "value" (1-6).
 * Pattern standard occidentale.
 */
function drawDicePips(g: Phaser.GameObjects.Graphics, value: number, size: number): void {
  const c = size / 2;
  const r = size * 0.08; // raggio pip
  const off = size * 0.27; // offset dal centro
  g.fillStyle(0x111111, 1);
  // Pip pattern per D6 (1-6) — coordinate relative a (cx, cy)
  const patterns: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-off, -off], [off, off]],
    3: [[-off, -off], [0, 0], [off, off]],
    4: [[-off, -off], [off, -off], [-off, off], [off, off]],
    5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
    6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
  };
  const pips = patterns[Math.max(1, Math.min(6, value))] || [];
  for (const [dx, dy] of pips) {
    g.fillCircle(c + dx, c + dy, r);
  }
}

/**
 * Disegna un singolo dado (rettangolo arrotondato + bordo + pip).
 * Restituisce un container che può essere tweenato.
 */
function makeDie(scene: Phaser.Scene, value: number, color: number): Phaser.GameObjects.Container {
  const cont = scene.add.container(0, 0);
  const g = scene.add.graphics();
  // Sfondo dado
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  g.lineStyle(2, 0x333333, 1);
  g.strokeRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  drawDicePips(g, value, DICE_SIZE);
  // Origine al centro per ruotare
  cont.add(g);
  g.x = -DICE_SIZE / 2;
  g.y = -DICE_SIZE / 2;
  return cont;
}

/**
 * Helper interno: aggiorna il valore visibile di un dado già esistente
 * (cambia faccia durante il roll). Distrugge graphics interno e ricrea.
 */
function updateDieValue(cont: Phaser.GameObjects.Container, value: number, color: number): void {
  // Distrugge il graphics esistente e ne ricrea uno con il nuovo valore
  for (const child of [...cont.list]) {
    child.destroy();
  }
  const g = cont.scene.add.graphics();
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  g.lineStyle(2, 0x333333, 1);
  g.strokeRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  drawDicePips(g, value, DICE_SIZE);
  g.x = -DICE_SIZE / 2;
  g.y = -DICE_SIZE / 2;
  cont.add(g);
}

/**
 * Funzione principale: anima N dadi che rollano e atterrano sui valori finali.
 * Auto-cleanup. Restituisce una Promise che si risolve a fine animazione.
 */
export function playDiceRoll(
  scene: Phaser.Scene,
  opts: DiceRollOptions,
): Promise<void> {
  return new Promise((resolve) => {
    const n = opts.dice.length;
    if (n === 0) {
      opts.onComplete?.();
      resolve();
      return;
    }
    const color = opts.color ?? 0xffee66;
    const durRoll = opts.durationRollMs ?? 700;
    const durHold = opts.durationHoldMs ?? 600;
    const durFade = opts.durationFadeMs ?? 400;

    // Layout orizzontale: posiziona N dadi attorno a (centerX, centerY)
    const totalW = n * DICE_SIZE + (n - 1) * DICE_GAP;
    const startX = opts.centerX - totalW / 2 + DICE_SIZE / 2;
    const cy = opts.centerY;

    // Container "gruppo" per gestire alpha/destroy collettivo
    const group = scene.add.container(0, 0);
    group.setScrollFactor(0); // UI immune da scroll camera

    // Label sopra (opzionale)
    let labelText: Phaser.GameObjects.Text | null = null;
    if (opts.label) {
      labelText = scene.add.text(opts.centerX, cy - DICE_SIZE * 1.2, opts.label, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      });
      labelText.setOrigin(0.5, 1);
      labelText.setScrollFactor(0);
      group.add(labelText);
    }

    // Crea N dadi con valore random iniziale (1..6)
    const dies: Phaser.GameObjects.Container[] = [];
    for (let i = 0; i < n; i++) {
      const die = makeDie(scene, 1 + Math.floor(Math.random() * 6), color);
      die.x = startX + i * (DICE_SIZE + DICE_GAP);
      die.y = cy;
      die.setScrollFactor(0);
      // Scale-in dramatic
      die.setScale(0.2);
      group.add(die);
      dies.push(die);
    }

    // Fase 1: pop-in scale 0.2 → 1.0 (200ms)
    scene.tweens.add({
      targets: dies,
      scale: 1.0,
      duration: 200,
      ease: 'Back.easeOut',
    });

    // Fase 2: roll (rotation + face change ogni 80ms) per durRoll
    const faceChangeInterval = 80;
    const faceChanges = Math.floor(durRoll / faceChangeInterval);
    for (let k = 1; k <= faceChanges; k++) {
      scene.time.delayedCall(k * faceChangeInterval, () => {
        for (const die of dies) {
          if (!die.scene) return;
          updateDieValue(die, 1 + Math.floor(Math.random() * 6), color);
        }
      });
    }
    // Rotation tween (gira 720°)
    scene.tweens.add({
      targets: dies,
      angle: 720,
      duration: durRoll,
      ease: 'Cubic.easeOut',
    });

    // Fase 3: atterraggio sui valori reali (subito dopo durRoll)
    scene.time.delayedCall(durRoll + 50, () => {
      for (let i = 0; i < dies.length; i++) {
        const die = dies[i];
        if (!die.scene) continue;
        updateDieValue(die, opts.dice[i], color);
        die.setAngle(0); // raddrizza
        // Piccolo bounce sul valore finale
        scene.tweens.add({
          targets: die,
          scale: { from: 1.0, to: 1.2 },
          duration: 100,
          yoyo: true,
        });
      }
    });

    // Fase 4: hold + fade out
    scene.time.delayedCall(durRoll + durHold + 100, () => {
      scene.tweens.add({
        targets: group,
        alpha: 0,
        duration: durFade,
        onComplete: () => {
          group.destroy();
          opts.onComplete?.();
          resolve();
        },
      });
    });
  });
}

/**
 * Vellum — sfondo pergamena per le scene Codex Tacticus.
 *
 * Disegna:
 *  1. Fondo crema (PALETTE.vellum)
 *  2. Paper-grain procedurale: dots/marks sparsi a bassa opacità che simulano
 *     la trama irregolare della pergamena. Densità ~1 mark / 80 px².
 *  3. (Opzionale) Vignette ai margini per concentrare l'attenzione al centro.
 *
 * Uso tipico (in `Scene.create()`):
 *
 *     import { paintVellum } from '@/ui/Vellum';
 *     paintVellum(this, this.scale.width, this.scale.height);
 *
 * Il paint è O(N) con N = dots; per W=1280 H=800 → ~13k mark, ~30 ms una tantum.
 * Niente animazione: è uno strato statico. setScrollFactor(0) di default.
 *
 * Determinismo: usa un PRNG seedato con `seed` (default 1337) così il pattern è
 * stabile tra scene/render → no flicker quando si naviga tra scene.
 */
import Phaser from 'phaser';
import { PALETTE } from './theme';

/** PRNG mulberry32 — piccolo, deterministico, sufficiente per noise visivo. */
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PaintVellumOpts {
  /** Numero di dots/marks. Default scala con area: ~area/80. */
  density?: number;
  /** Seed per il pattern. Default 1337 (stabile). */
  seed?: number;
  /** Disegna anche vignette ai margini (default true). */
  vignette?: boolean;
  /** Profondità della scena. Default -100 (sotto tutto). */
  depth?: number;
}

/**
 * Dipinge il vellum sull'intera scena. Restituisce gli oggetti creati per
 * eventuale destroy/relayout.
 */
export function paintVellum(
  scene: Phaser.Scene,
  width: number,
  height: number,
  opts: PaintVellumOpts = {},
): {
  bg: Phaser.GameObjects.Rectangle;
  grain: Phaser.GameObjects.Graphics;
  vignette?: Phaser.GameObjects.Graphics;
  destroy: () => void;
} {
  const density = opts.density ?? Math.max(800, Math.round((width * height) / 80));
  const seed = opts.seed ?? 1337;
  const depth = opts.depth ?? -100;
  const wantVignette = opts.vignette !== false;

  // 1. Fondo crema
  const bg = scene.add.rectangle(0, 0, width, height, PALETTE.vellum.num, 1);
  bg.setOrigin(0, 0);
  bg.setScrollFactor(0);
  bg.setDepth(depth);

  // 2. Paper grain (dots di inchiostro debole + qualche mark più scuro)
  const rand = mulberry32(seed);
  const grain = scene.add.graphics();
  grain.setScrollFactor(0);
  grain.setDepth(depth + 1);

  for (let i = 0; i < density; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const r = rand();
    // 90% dots quasi invisibili, 8% mark medi, 2% mark scuri (pori della pergamena)
    if (r < 0.9) {
      grain.fillStyle(PALETTE.inkParchment.num, 0.04 + rand() * 0.04);
      grain.fillRect(x, y, 1, 1);
    } else if (r < 0.98) {
      grain.fillStyle(PALETTE.inkSoft.num, 0.06 + rand() * 0.05);
      const sz = 1 + Math.floor(rand() * 2);
      grain.fillRect(x, y, sz, sz);
    } else {
      grain.fillStyle(PALETTE.inkParchment.num, 0.10 + rand() * 0.08);
      grain.fillRect(x, y, 1.5, 1.5);
    }
  }

  // 3. Subtle horizontal "fibre" strokes (pochissime, leggerissime)
  for (let i = 0; i < Math.round(density / 200); i++) {
    const y = rand() * height;
    const x = rand() * width * 0.7;
    const len = 30 + rand() * 80;
    grain.lineStyle(0.5, PALETTE.inkSoft.num, 0.05 + rand() * 0.04);
    grain.lineBetween(x, y, x + len, y + (rand() - 0.5) * 2);
  }

  // 4. Vignette: gradiente scuro sottile ai 4 bordi (depth)
  let vignette: Phaser.GameObjects.Graphics | undefined;
  if (wantVignette) {
    vignette = scene.add.graphics();
    vignette.setScrollFactor(0);
    vignette.setDepth(depth + 2);
    const vDepth = Math.min(120, Math.round(Math.min(width, height) * 0.12));
    // Disegno in 12 layer concentrici dai bordi verso il centro
    const layers = 12;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1); // 0..1
      const inset = vDepth * t;
      const alpha = 0.10 * (1 - t) ** 1.4;
      vignette.lineStyle(2, PALETTE.inkParchment.num, alpha);
      vignette.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    }
  }

  const destroy = (): void => {
    bg.destroy();
    grain.destroy();
    vignette?.destroy();
  };

  return { bg, grain, vignette, destroy };
}

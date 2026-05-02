import Phaser from 'phaser';
import {
  Axial,
  Pixel,
  axialEquals,
  axialToPixel,
  hexVertices,
  offsetToAxial,
  pixelToAxial,
} from '@core/hex/coords';
import { getBaseHexes } from '@core/hex/base';
import { GAME_CONFIG } from '@/config';

export interface HexBoardOptions {
  cols: number;
  rows: number;
  hexSize: number;
  padding: number;
  /** Centro della deploy zone della fazione A (basetta 7-hex) */
  deployA: Axial;
  /** Centro della deploy zone della fazione B */
  deployB: Axial;
}

/**
 * Componente UI che disegna una griglia esagonale e gestisce hover/click.
 *
 * Camera-aware: usa worldX/worldY del puntatore per pick-up,
 * così pan/zoom della camera principale funzionano trasparentemente.
 *
 * Funzionalità M2:
 * - Rendering 24×18 esagoni (config-driven)
 * - Deploy zone visualizzate (basette 7-hex)
 * - Hover + click + click-deselect
 * - Etichette coordinate hex toggle (tasto G)
 */
export class HexBoard {
  private scene: Phaser.Scene;
  private opts: HexBoardOptions;
  private graphics: Phaser.GameObjects.Graphics;
  private origin: Pixel;
  private cells: Axial[] = [];
  private cellKeys: Set<string> = new Set();
  /** Esagoni delle deploy zone (per highlight) */
  private deployHexesA: Set<string> = new Set();
  private deployHexesB: Set<string> = new Set();
  /** Esagono sotto al puntatore */
  private hoveredHex: Axial | null = null;
  /** Esagono selezionato (click) */
  private selectedHex: Axial | null = null;
  /** Toggle etichette coordinate */
  private showLabels = false;
  /** Container per le etichette text */
  private labels: Phaser.GameObjects.Text[] = [];
  /** Esagoni evidenziati come raggiungibili (movimento) */
  private highlightedMove: Set<string> = new Set();
  private highlightedThreat: Set<string> = new Set();
  /** Callback esterna per click su hex (es. selezione target movimento) */
  private externalClickHandler: ((hex: Axial | null) => void) | null = null;

  constructor(scene: Phaser.Scene, opts: HexBoardOptions) {
    this.scene = scene;
    this.opts = opts;

    const sqrt3Half = Math.sqrt(3) / 2;
    this.origin = {
      x: opts.padding + sqrt3Half * opts.hexSize,
      y: opts.padding + opts.hexSize,
    };

    for (let row = 0; row < opts.rows; row++) {
      for (let col = 0; col < opts.cols; col++) {
        const ax = offsetToAxial({ col, row });
        this.cells.push(ax);
        this.cellKeys.add(this.key(ax));
      }
    }

    for (const h of getBaseHexes(opts.deployA)) this.deployHexesA.add(this.key(h));
    for (const h of getBaseHexes(opts.deployB)) this.deployHexesB.add(this.key(h));

    this.graphics = scene.add.graphics();
    this.attachInput();
  }

  /** Larghezza/altezza in pixel della mappa, utili per limiti camera. */
  getWorldBounds(): { width: number; height: number } {
    const sqrt3 = Math.sqrt(3);
    const width =
      this.opts.padding * 2 + sqrt3 * this.opts.hexSize * (this.opts.cols + 0.5);
    const height =
      this.opts.padding * 2 + this.opts.hexSize * (1.5 * (this.opts.rows - 1) + 2);
    return { width, height };
  }

  render(): void {
    this.graphics.clear();
    for (const hex of this.cells) {
      const center = axialToPixel(hex, this.opts.hexSize, this.origin);
      const verts = hexVertices(center, this.opts.hexSize);

      const fillColor = this.colorFor(hex);
      this.graphics.fillStyle(fillColor, this.fillAlphaFor(hex));
      this.graphics.lineStyle(2, GAME_CONFIG.colors.hexStroke, 1);

      this.graphics.beginPath();
      this.graphics.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) this.graphics.lineTo(verts[i].x, verts[i].y);
      this.graphics.closePath();
      this.graphics.fillPath();
      this.graphics.strokePath();
    }
    this.renderLabels();
  }

  /** Toggle visibilità etichette coordinate */
  toggleLabels(): void {
    this.showLabels = !this.showLabels;
    this.renderLabels();
  }

  /** Imposta gli esagoni evidenziati come raggiungibili (modalità movimento) */
  setHighlightedMove(hexes: Axial[]): void {
    this.highlightedMove = new Set(hexes.map((h) => this.key(h)));
    this.render();
  }

  /** Pulisce l'highlight movimento */
  clearHighlightedMove(): void {
    this.highlightedMove.clear();
    this.render();
  }

  /** Hex sotto minaccia (es. zone di controllo lance reach >= 4). */
  setHighlightedThreat(hexes: Axial[]): void {
    this.highlightedThreat = new Set(hexes.map((h) => this.key(h)));
    this.render();
  }
  clearHighlightedThreat(): void {
    this.highlightedThreat.clear();
    this.render();
  }

  /** Imposta il callback per click su hex (sostituisce il behaviour di default) */
  setExternalClickHandler(handler: ((hex: Axial | null) => void) | null): void {
    this.externalClickHandler = handler;
  }

  private renderLabels(): void {
    // Distrugge le etichette esistenti
    for (const t of this.labels) t.destroy();
    this.labels = [];
    if (!this.showLabels) return;

    for (const hex of this.cells) {
      const center = axialToPixel(hex, this.opts.hexSize, this.origin);
      const t = this.scene.add.text(center.x, center.y, `${hex.q},${hex.r}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#668899',
      });
      t.setOrigin(0.5, 0.5);
      this.labels.push(t);
    }
  }

  private colorFor(hex: Axial): number {
    if (this.selectedHex && axialEquals(this.selectedHex, hex)) return GAME_CONFIG.colors.hexSelected;
    if (this.hoveredHex && axialEquals(this.hoveredHex, hex)) return GAME_CONFIG.colors.hexHover;
    const k = this.key(hex);
    // Priorità: hex sotto minaccia (rosso scuro) > range movimento (verde) > deploy zone
    if (this.highlightedThreat.has(k) && this.highlightedMove.has(k)) return 0xcc6633; // arancio: hex muovibile MA in minaccia
    if (this.highlightedThreat.has(k)) return 0xaa3322; // rosso scuro: zona controllo nemica
    if (this.highlightedMove.has(k)) return 0x44aa88;
    if (this.deployHexesA.has(k)) return GAME_CONFIG.colors.deployZoneA;
    if (this.deployHexesB.has(k)) return GAME_CONFIG.colors.deployZoneB;
    return GAME_CONFIG.colors.hexFill;
  }

  private fillAlphaFor(hex: Axial): number {
    const k = this.key(hex);
    // Deploy zone leggermente trasparenti per non distrarre troppo
    if (this.deployHexesA.has(k) || this.deployHexesB.has(k)) return 0.55;
    return 1;
  }

  private attachInput(): void {
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Hover: skip se c'è un altro interactive (es. bottone UI) sotto al puntatore
      if (this.isPointerOverUI(pointer)) {
        if (this.hoveredHex !== null) {
          this.hoveredHex = null;
          this.render();
        }
        return;
      }
      const hex = this.pickHex(pointer.worldX, pointer.worldY);
      const changed =
        (hex === null) !== (this.hoveredHex === null) ||
        (hex !== null && this.hoveredHex !== null && !axialEquals(hex, this.hoveredHex));
      if (changed) {
        this.hoveredHex = hex;
        this.render();
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;

      // CRITICO: se sotto il puntatore c'è un altro interactive (bottone UI),
      // non processare il click — appartiene a quel bottone, non alla mappa.
      if (this.isPointerOverUI(pointer)) return;

      // Ignora il click se la scena segnala che il pointer event è parte di un drag-pan touch
      const sceneAny = this.scene as Phaser.Scene & { isTouchPanActive?: () => boolean };
      if (sceneAny.isTouchPanActive && sceneAny.isTouchPanActive()) {
        return;
      }

      // Ignora click se il puntatore si è mosso troppo (drag rilevato)
      if (pointer.getDistance() > 10) return;

      const hex = this.pickHex(pointer.worldX, pointer.worldY);

      // Se è registrato un handler esterno (es. modalità movimento), delega
      if (this.externalClickHandler) {
        this.externalClickHandler(hex);
        return;
      }

      // Behaviour default: selezione/deselezione
      if (hex === null) {
        if (this.selectedHex !== null) {
          this.selectedHex = null;
          this.render();
        }
        return;
      }
      if (this.selectedHex && axialEquals(hex, this.selectedHex)) {
        this.selectedHex = null;
      } else {
        this.selectedHex = hex;
        // eslint-disable-next-line no-console
        console.info(`[HexBoard] selected hex axial=(${hex.q},${hex.r})`);
      }
      this.render();
    });
  }

  /**
   * True se il puntatore è sopra un altro elemento interactive di Phaser
   * (es. un bottone UI). In tal caso il click NON appartiene alla mappa.
   */
  private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    const hits = this.scene.input.hitTestPointer(pointer);
    return hits.length > 0;
  }

  private pickHex(x: number, y: number): Axial | null {
    const candidate = pixelToAxial({ x, y }, this.opts.hexSize, this.origin);
    if (this.cellKeys.has(this.key(candidate))) return candidate;
    return null;
  }

  private key(h: Axial): string {
    return `${h.q},${h.r}`;
  }
}

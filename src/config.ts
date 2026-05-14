/**
 * Costanti di configurazione del gioco.
 * Tutti i numeri di tuning vivono qui o in src/data/.
 */

export const GAME_CONFIG = {
  /** Dimensioni canvas */
  width: 1280,
  height: 800,

  /** Sfondo Phaser game (vellum/pergamena — Codex Tacticus). */
  backgroundColor: 0xefe5d0,

  /** Geometria mappa: dimensionata per stare in viewport 1280×720 ÷ 1528×800
   *  senza pan/zoom camera (camera fissa per stabilità input click).
   */
  map: {
    cols: 24,
    rows: 14, // ridotto da 18 (eccedeva verticalmente i ~720-800px)
    hexSize: 24, // ridotto da 32 per stare orizzontalmente
    padding: 60, // ridotto da 80 per dare un po' più spazio
  },

  /** Camera (M2: pan/zoom) */
  camera: {
    /** Velocità pan con WASD/frecce (px/sec) */
    panSpeed: 600,
    /** Zoom min/max */
    zoomMin: 0.5,
    zoomMax: 2.0,
    /** Step zoom per scroll della rotella */
    zoomStep: 0.1,
  },

  /** Colori (Codex Tacticus — vedi src/ui/theme.ts per la palette completa). */
  colors: {
    /** Pergamena del campo (vellum dark, leggermente più calda del fondo). */
    hexFill: 0xe2d5b8,
    /** Inchiostro caldo per il bordo dell'esagono. */
    hexStroke: 0x3a2e22,
    /** Hover: shift verso vellum deep + leggera luce gold. */
    hexHover: 0xd4c39a,
    /** Selezione attiva: wash oro foglia. */
    hexSelected: 0xb8862a,
    /** Deploy zone fazione A (azure wash). */
    deployZoneA: 0x4a78a0,
    /** Deploy zone fazione B (gules wash). */
    deployZoneB: 0xa75a5d,
    /** Etichette coordinate (debug, ink faded). */
    labelText: 0x7a6a55,
  },
} as const;

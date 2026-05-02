/**
 * Costanti di configurazione del gioco.
 * Tutti i numeri di tuning vivono qui o in src/data/.
 */

export const GAME_CONFIG = {
  /** Dimensioni canvas */
  width: 1280,
  height: 800,

  /** Sfondo */
  backgroundColor: 0x1a1a1a,

  /** Geometria mappa (M2: ingrandita) */
  map: {
    /** Numero colonne della griglia */
    cols: 24,
    /** Numero righe della griglia */
    rows: 18,
    /** Raggio dal centro al vertice di un esagono in pixel */
    hexSize: 32,
    /** Padding visivo dal bordo canvas */
    padding: 80,
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

  /** Colori */
  colors: {
    hexFill: 0x2a3a4a,
    hexStroke: 0x4a5a6a,
    hexHover: 0x4a6a8a,
    hexSelected: 0x8aaa4a,
    /** Deploy zone fazione 1 (sinistra/blu) */
    deployZoneA: 0x2a4a8a,
    /** Deploy zone fazione 2 (destra/rosso) */
    deployZoneB: 0x8a3a3a,
    /** Etichette coordinate (debug) */
    labelText: 0x668899,
  },
} as const;

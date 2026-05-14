/**
 * Codex Tacticus — design system.
 *
 * Estetica: "vellum & iron". Trattato di scherma manoscritto del XV secolo
 * incrociato con codex wargame. Pergamena (osso/vellum) come dominante,
 * inchiostro caldo per il testo, tinture araldiche per le fazioni
 * (azure/gules), oro foglia come UNICO accent per stati critici (selezione,
 * decisione tattica, evidenza).
 *
 * Convenzioni:
 *  - `.num` = numero esadecimale (per Phaser graphics, rectangle.fillStyle/strokeStyle)
 *  - `.css` = stringa "#RRGGBB" (per Phaser Text fontStyle)
 *  - I valori .num e .css devono restare in sync.
 *
 * Tipografia: SOLO system font stack (vincolo Valerio: niente Google Fonts —
 * privacy + zero extra request). Display + body + mono sono caratteristici
 * (no Inter/Roboto/Arial cliché). Mono usato SOLO per numeri di stat.
 */
import Phaser from 'phaser';
import { uiScale } from './uiScale';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PALETTE = {
  // ── Dominante: vellum/pergamena
  vellum: { num: 0xefe5d0, css: '#efe5d0' },
  vellumDark: { num: 0xe2d5b8, css: '#e2d5b8' }, // sfondo bottoni, deployment wash background
  vellumDeep: { num: 0xc9b896, css: '#c9b896' }, // section dividers, faded ink, hover

  // ── Inchiostro (mai puro — sempre caldo)
  ink: { num: 0x1d1611, css: '#1d1611' }, // testo principale, stroke pesanti
  inkSoft: { num: 0x4a3d30, css: '#4a3d30' }, // testo secondario, soft strokes
  inkFaded: { num: 0x7a6a55, css: '#7a6a55' }, // labels secondari, captions
  inkParchment: { num: 0x3a2e22, css: '#3a2e22' }, // hex stroke caldo

  // ── Heraldic — Fazione A (azure)
  azure: { num: 0x1c4a72, css: '#1c4a72' },
  azureDeep: { num: 0x14365a, css: '#14365a' },
  azureWash: { num: 0x4a78a0, css: '#4a78a0' }, // desaturato per wash zona deploy

  // ── Heraldic — Fazione B (gules)
  gules: { num: 0x8a1f22, css: '#8a1f22' },
  gulesDeep: { num: 0x6a1518, css: '#6a1518' },
  gulesWash: { num: 0xa75a5d, css: '#a75a5d' }, // desaturato per wash zona deploy

  // ── Accent: oro foglia (UNICO — porta peso)
  gold: { num: 0xb8862a, css: '#b8862a' },
  goldDeep: { num: 0x8e6520, css: '#8e6520' },
  goldLeaf: { num: 0xd4a843, css: '#d4a843' }, // luce sul gold

  // ── Verderame (zone passive, info neutrali)
  verde: { num: 0x3f6a5a, css: '#3f6a5a' },
  verdeWash: { num: 0x7a9e8e, css: '#7a9e8e' },

  // ── Stati combat (alias semantici)
  threat: { num: 0x8a1f22, css: '#8a1f22' }, // = gules
  reach: { num: 0x3f6a5a, css: '#3f6a5a' }, // = verde
  reachThreat: { num: 0xb8862a, css: '#b8862a' }, // = gold (decisione critica)

  // ── Black puro: solo per shadow ed effetti rari
  shadow: { num: 0x000000, css: '#000000' },
} as const;

// ---------------------------------------------------------------------------
// Tipografia
// ---------------------------------------------------------------------------

/**
 * Stack font system-only (no Google Fonts).
 * Display: caratteriale (Cochin/Big Caslon su Mac, Baskerville/Palatino fallback).
 * Body: serif morbido leggibile.
 * Mono: SOLO per numeri di stat (HP, impeto, slancio, dadi).
 */
export const FONTS = {
  display: "'Cochin', 'Big Caslon', 'Hoefler Text', 'Baskerville', 'Palatino', Georgia, serif",
  body: "'Iowan Old Style', 'Charter', 'Palatino', Georgia, serif",
  mono: "'Menlo', 'Consolas', 'Courier New', monospace",
} as const;

/** Background config per scene (usato da Vellum + Phaser game backgroundColor). */
export const BG = {
  num: PALETTE.vellum.num,
  css: PALETTE.vellum.css,
} as const;

// ---------------------------------------------------------------------------
// Helpers fazioni
// ---------------------------------------------------------------------------

export interface Tincture {
  num: number;
  css: string;
  deep: number;
  wash: number;
  /** Etichetta araldica italiana (per chronicle / UI). */
  blason: string;
}

export function factionTincture(f: 'A' | 'B'): Tincture {
  if (f === 'A')
    return {
      num: PALETTE.azure.num,
      css: PALETTE.azure.css,
      deep: PALETTE.azureDeep.num,
      wash: PALETTE.azureWash.num,
      blason: 'azzurra',
    };
  return {
    num: PALETTE.gules.num,
    css: PALETTE.gules.css,
    deep: PALETTE.gulesDeep.num,
    wash: PALETTE.gulesWash.num,
    blason: 'rossa',
  };
}

// ---------------------------------------------------------------------------
// Codex button helper
// ---------------------------------------------------------------------------

export type ButtonVariant = 'outline' | 'primary' | 'heraldic-A' | 'heraldic-B' | 'gold';

export interface CodexButtonOpts {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  /** Font display (serif caratteriale) o body (serif morbido). Default: body. */
  fontKind?: 'display' | 'body';
  fontSize?: number; // punti logici (verrà scalato per mobile)
  onClick?: () => void;
}

/**
 * Bottone Codex Tacticus.
 *
 * Cifra grafica: doppio bordo inchiostro (1px outer + 1px inner con gap) su
 * fondo vellum-dark. Selezione = wash oro al 22% + bordo oro foglia. Hover =
 * shift tono vellum + bordo ink più pesante. Variant heraldic = bordo
 * tincture araldica (per scelte legate alla fazione).
 *
 * NB: NON usa rounded corners. La cifra è "ink ruled rectangle" — se servisse
 * morbidezza si va su radius 2 max, mai più.
 */
export function makeCodexButton(opts: CodexButtonOpts): Phaser.GameObjects.Container {
  const {
    scene,
    x,
    y,
    width: w,
    height: h,
    label,
    selected = false,
    disabled = false,
    variant = 'outline',
    fontKind = 'body',
    fontSize = 15,
    onClick,
  } = opts;

  const c = scene.add.container(x, y);

  // Determina colori per variant
  const palette = resolveButtonPalette(variant, selected, disabled);

  // Background fill (subtle paper tone)
  const bg = scene.add.rectangle(0, 0, w, h, palette.fill, palette.fillAlpha);
  bg.setOrigin(0, 0);

  // Doppio bordo: outer + inner con gap (effetto "ruled by hand")
  // Phaser Rectangle non supporta multi-stroke nativo → uso un secondo Rectangle interno.
  const outer = scene.add.graphics();
  outer.lineStyle(1.2, palette.borderOuter, 1);
  outer.strokeRect(0.5, 0.5, w - 1, h - 1);

  const inner = scene.add.graphics();
  inner.lineStyle(1, palette.borderInner, palette.borderInnerAlpha);
  inner.strokeRect(3.5, 3.5, w - 7, h - 7);

  // Label
  const t = scene.add.text(w / 2, h / 2, label, {
    fontFamily: fontKind === 'display' ? FONTS.display : FONTS.body,
    fontSize: `${Math.round(fontSize * uiScale())}px`,
    color: palette.textCss,
  });
  t.setOrigin(0.5, 0.5);

  c.add([bg, outer, inner, t]);

  // Hit area
  if (!disabled && onClick) {
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      bg.setFillStyle(palette.fillHover, palette.fillAlpha);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(palette.fill, palette.fillAlpha);
    });
    bg.on('pointerup', () => onClick());
  }

  return c;
}

interface ResolvedPalette {
  fill: number;
  fillHover: number;
  fillAlpha: number;
  borderOuter: number;
  borderInner: number;
  borderInnerAlpha: number;
  textCss: string;
}

function resolveButtonPalette(
  variant: ButtonVariant,
  selected: boolean,
  disabled: boolean,
): ResolvedPalette {
  if (disabled) {
    return {
      fill: PALETTE.vellumDeep.num,
      fillHover: PALETTE.vellumDeep.num,
      fillAlpha: 0.6,
      borderOuter: PALETTE.inkFaded.num,
      borderInner: PALETTE.inkFaded.num,
      borderInnerAlpha: 0.5,
      textCss: PALETTE.inkFaded.css,
    };
  }

  if (selected) {
    // Selezionato: fondo oro pieno + bordo gold deep + label ink scuro.
    // Contrasto netto vs unselected (vellum-on-vellum): un bottone selezionato
    // diventa un "sigillo dorato" inequivocabile.
    return {
      fill: PALETTE.gold.num,
      fillHover: PALETTE.goldLeaf.num,
      fillAlpha: 0.85,
      borderOuter: PALETTE.goldDeep.num,
      borderInner: PALETTE.ink.num,
      borderInnerAlpha: 0.95,
      textCss: PALETTE.ink.css,
    };
  }

  switch (variant) {
    case 'primary':
      // CTA principale: fondo vellumDark + bordo ink pesante + label display
      return {
        fill: PALETTE.vellumDark.num,
        fillHover: PALETTE.vellumDeep.num,
        fillAlpha: 1,
        borderOuter: PALETTE.ink.num,
        borderInner: PALETTE.ink.num,
        borderInnerAlpha: 0.6,
        textCss: PALETTE.ink.css,
      };
    case 'heraldic-A':
      return {
        fill: PALETTE.vellumDark.num,
        fillHover: PALETTE.azureWash.num,
        fillAlpha: 0.95,
        borderOuter: PALETTE.azureDeep.num,
        borderInner: PALETTE.azure.num,
        borderInnerAlpha: 0.7,
        textCss: PALETTE.azureDeep.css,
      };
    case 'heraldic-B':
      return {
        fill: PALETTE.vellumDark.num,
        fillHover: PALETTE.gulesWash.num,
        fillAlpha: 0.95,
        borderOuter: PALETTE.gulesDeep.num,
        borderInner: PALETTE.gules.num,
        borderInnerAlpha: 0.7,
        textCss: PALETTE.gulesDeep.css,
      };
    case 'gold':
      return {
        fill: PALETTE.gold.num,
        fillHover: PALETTE.goldLeaf.num,
        fillAlpha: 0.18,
        borderOuter: PALETTE.goldDeep.num,
        borderInner: PALETTE.gold.num,
        borderInnerAlpha: 0.7,
        textCss: PALETTE.goldDeep.css,
      };
    case 'outline':
    default:
      return {
        fill: PALETTE.vellumDark.num,
        fillHover: PALETTE.vellumDeep.num,
        fillAlpha: 0.85,
        borderOuter: PALETTE.ink.num,
        borderInner: PALETTE.inkSoft.num,
        borderInnerAlpha: 0.55,
        textCss: PALETTE.ink.css,
      };
  }
}

// ---------------------------------------------------------------------------
// Codex panel helper (HUD, log, modal)
// ---------------------------------------------------------------------------

export interface CodexPanelOpts {
  scene: Phaser.Scene;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Tonalità: vellum chiaro (default) o ink dark (overlay/modal). */
  tone?: 'vellum' | 'ink';
  /** Trasparenza fondo (default 0.96). */
  alpha?: number;
}

/**
 * Pannello stile Codex: vellum cream con doppio bordo inchiostro.
 * Restituisce un container con [bg, outer-stroke, inner-stroke] già aggiunti.
 * Aggiungere il contenuto via container.add(...) come al solito.
 */
export function makeCodexPanel(opts: CodexPanelOpts): {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  resize: (w: number, h: number) => void;
} {
  const { scene, x, y, width: w, height: h, tone = 'vellum', alpha = 0.96 } = opts;

  const c = scene.add.container(x, y);
  const fillNum = tone === 'vellum' ? PALETTE.vellumDark.num : PALETTE.ink.num;
  const borderOuterNum = tone === 'vellum' ? PALETTE.ink.num : PALETTE.gold.num;
  const borderInnerNum = tone === 'vellum' ? PALETTE.inkSoft.num : PALETTE.goldDeep.num;

  const bg = scene.add.rectangle(0, 0, w, h, fillNum, alpha);
  bg.setOrigin(0, 0);

  const outer = scene.add.graphics();
  outer.lineStyle(1.2, borderOuterNum, 1);
  outer.strokeRect(0.5, 0.5, w - 1, h - 1);

  const inner = scene.add.graphics();
  inner.lineStyle(1, borderInnerNum, 0.55);
  inner.strokeRect(3.5, 3.5, w - 7, h - 7);

  c.add([bg, outer, inner]);

  const resize = (newW: number, newH: number): void => {
    bg.setSize(newW, newH);
    outer.clear();
    outer.lineStyle(1.2, borderOuterNum, 1);
    outer.strokeRect(0.5, 0.5, newW - 1, newH - 1);
    inner.clear();
    inner.lineStyle(1, borderInnerNum, 0.55);
    inner.strokeRect(3.5, 3.5, newW - 7, newH - 7);
  };

  return { container: c, bg, resize };
}

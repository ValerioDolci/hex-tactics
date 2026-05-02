/**
 * Geometria esagonale — coordinate axial e conversioni.
 *
 * Convenzione: pointy-top hex (vertici in alto e in basso).
 * Riferimento: https://www.redblobgames.com/grids/hexagons/
 *
 * In M1 abbiamo solo lo stretto necessario per renderizzare e fare hit-detection.
 * In M2 si aggiungono distance, line raster, A* (e relativi test).
 */

/** Coordinate axial (pointy-top). q = colonna obliqua, r = riga */
export interface Axial {
  q: number;
  r: number;
}

/** Coordinate offset rettangolari (odd-r), comode per layout di mappa */
export interface Offset {
  col: number;
  row: number;
}

/** Coordinate pixel (centro dell'esagono) */
export interface Pixel {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

/**
 * Converte coordinate offset (odd-r) in axial.
 * In odd-r, le righe dispari sono shiftate di mezza cella verso destra.
 */
export function offsetToAxial({ col, row }: Offset): Axial {
  const q = col - (row - (row & 1)) / 2;
  return { q, r: row };
}

/**
 * Converte axial in offset (odd-r).
 */
export function axialToOffset({ q, r }: Axial): Offset {
  const col = q + (r - (r & 1)) / 2;
  return { col, row: r };
}

/**
 * Converte coordinate axial in pixel (pointy-top).
 * @param size raggio dal centro al vertice
 * @param origin offset pixel dell'origine (q=0, r=0)
 */
export function axialToPixel({ q, r }: Axial, size: number, origin: Pixel = { x: 0, y: 0 }): Pixel {
  const x = size * SQRT3 * (q + r / 2);
  const y = size * 1.5 * r;
  return { x: x + origin.x, y: y + origin.y };
}

/**
 * Converte coordinate pixel in axial (pointy-top), arrotondando all'esagono più vicino.
 */
export function pixelToAxial(p: Pixel, size: number, origin: Pixel = { x: 0, y: 0 }): Axial {
  const x = p.x - origin.x;
  const y = p.y - origin.y;
  const qFrac = ((SQRT3 / 3) * x - y / 3) / size;
  const rFrac = ((2 / 3) * y) / size;
  return axialRound({ q: qFrac, r: rFrac });
}

/**
 * Arrotonda coordinate axial frazionarie all'esagono più vicino,
 * usando la rappresentazione cube interna.
 */
export function axialRound({ q, r }: { q: number; r: number }): Axial {
  // cube coords
  const x = q;
  const z = r;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

/**
 * Restituisce i 6 vertici di un esagono pointy-top centrato sul pixel dato.
 * Utile per disegno con Graphics.fillPoints / strokePoints.
 */
export function hexVertices(center: Pixel, size: number): Pixel[] {
  const vertices: Pixel[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30; // pointy-top: ruota di -30°
    const angleRad = (Math.PI / 180) * angleDeg;
    vertices.push({
      x: center.x + size * Math.cos(angleRad),
      y: center.y + size * Math.sin(angleRad),
    });
  }
  return vertices;
}

/** Uguaglianza axial (utility) */
export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

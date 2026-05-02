/**
 * A* su griglia esagonale.
 *
 * Funziona con costi pluggabili (per ora unitari, ma estendibile per terreni speciali).
 * Restituisce il path completo (incluso start e goal) o null se non raggiungibile.
 */

import { Axial, axialEquals } from './coords';
import { hexDistance, neighbors } from './distance';

export interface PathfindingOptions {
  /** Predicato per esagoni transitabili. Default: tutti transitabili. */
  passable?: (hex: Axial) => boolean;
  /** Costo per attraversare un esagono. Default: 1. */
  cost?: (hex: Axial) => number;
  /** Limite massimo di costo cumulativo (per esplorazioni vincolate). */
  maxCost?: number;
}

interface Node {
  hex: Axial;
  g: number; // costo dal start
  f: number; // g + heuristic
  parent: Node | null;
}

/**
 * A* su griglia hex. Heuristic = distanza esagonale.
 */
export function findPath(start: Axial, goal: Axial, opts: PathfindingOptions = {}): Axial[] | null {
  const passable = opts.passable ?? (() => true);
  const costFn = opts.cost ?? (() => 1);
  const maxCost = opts.maxCost ?? Infinity;

  if (!passable(goal)) return null;
  if (axialEquals(start, goal)) return [start];

  const open: Node[] = [{ hex: start, g: 0, f: hexDistance(start, goal), parent: null }];
  const closed = new Set<string>();

  while (open.length > 0) {
    // Estrae il nodo con f minimo (linear scan; per griglie piccole è ok)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    if (axialEquals(current.hex, goal)) {
      return reconstruct(current);
    }

    closed.add(key(current.hex));

    for (const n of neighbors(current.hex)) {
      if (closed.has(key(n))) continue;
      if (!passable(n) && !axialEquals(n, goal)) continue;

      const tentativeG = current.g + costFn(n);
      if (tentativeG > maxCost) continue;

      const existing = open.find((o) => axialEquals(o.hex, n));
      if (existing && tentativeG >= existing.g) continue;

      const node: Node = {
        hex: n,
        g: tentativeG,
        f: tentativeG + hexDistance(n, goal),
        parent: current,
      };
      if (existing) {
        existing.g = node.g;
        existing.f = node.f;
        existing.parent = node.parent;
      } else {
        open.push(node);
      }
    }
  }

  return null;
}

/**
 * Restituisce tutti gli esagoni raggiungibili da `start` entro un costo cumulativo `maxCost`.
 * Usa BFS con costi (Dijkstra-like). Utile per highlight movimento.
 */
export function reachableHexes(
  start: Axial,
  maxCost: number,
  opts: { passable?: (hex: Axial) => boolean; cost?: (hex: Axial) => number } = {},
): Map<string, { hex: Axial; cost: number }> {
  const passable = opts.passable ?? (() => true);
  const costFn = opts.cost ?? (() => 1);

  const result = new Map<string, { hex: Axial; cost: number }>();
  result.set(key(start), { hex: start, cost: 0 });

  const queue: { hex: Axial; cost: number }[] = [{ hex: start, cost: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const n of neighbors(current.hex)) {
      if (!passable(n)) continue;
      const newCost = current.cost + costFn(n);
      if (newCost > maxCost) continue;
      const k = key(n);
      const prev = result.get(k);
      if (prev && prev.cost <= newCost) continue;
      result.set(k, { hex: n, cost: newCost });
      queue.push({ hex: n, cost: newCost });
    }
  }

  return result;
}

function key(h: Axial): string {
  return `${h.q},${h.r}`;
}

function reconstruct(node: Node): Axial[] {
  const path: Axial[] = [];
  let cur: Node | null = node;
  while (cur) {
    path.push(cur.hex);
    cur = cur.parent;
  }
  return path.reverse();
}

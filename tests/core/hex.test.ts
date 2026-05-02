import { describe, it, expect } from 'vitest';
import {
  Axial,
  axialToPixel,
  pixelToAxial,
  axialToOffset,
  offsetToAxial,
  hexVertices,
  axialEquals,
  axialRound,
} from '@core/hex/coords';
import {
  hexDistance,
  neighbors,
  hexesInRange,
  areAdjacent,
  NEIGHBOR_DIRS,
} from '@core/hex/distance';
import { hexLine, hasLineOfSight } from '@core/hex/line';
import { findPath, reachableHexes } from '@core/hex/pathfinding';
import { getBaseHexes, basesOverlap, baseDistance } from '@core/hex/base';

describe('coords', () => {
  it('axialToOffset and back roundtrip (odd-r)', () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 12; col++) {
        const offset = { col, row };
        const axial = offsetToAxial(offset);
        const back = axialToOffset(axial);
        expect(back).toEqual(offset);
      }
    }
  });

  it('axialToPixel for origin returns origin offset', () => {
    const p = axialToPixel({ q: 0, r: 0 }, 30, { x: 100, y: 100 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100);
  });

  it('pixelToAxial inverse of axialToPixel', () => {
    const size = 30;
    const origin = { x: 200, y: 200 };
    const cells: Axial[] = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 3, r: 4 },
      { q: -2, r: 5 },
      { q: 7, r: -3 },
    ];
    for (const c of cells) {
      const p = axialToPixel(c, size, origin);
      const back = pixelToAxial(p, size, origin);
      expect(axialEquals(back, c)).toBe(true);
    }
  });

  it('hexVertices returns 6 points', () => {
    const v = hexVertices({ x: 0, y: 0 }, 30);
    expect(v).toHaveLength(6);
    // Distance from center should be ~size for all
    for (const p of v) {
      const d = Math.sqrt(p.x ** 2 + p.y ** 2);
      expect(d).toBeCloseTo(30);
    }
  });

  it('axialRound snaps fractional to nearest hex', () => {
    expect(axialRound({ q: 0.1, r: 0.1 })).toEqual({ q: 0, r: 0 });
    expect(axialRound({ q: 0.6, r: 0.1 })).toEqual({ q: 1, r: 0 });
  });
});

describe('distance', () => {
  it('hexDistance same hex is 0', () => {
    expect(hexDistance({ q: 3, r: 4 }, { q: 3, r: 4 })).toBe(0);
  });

  it('hexDistance to neighbors is 1', () => {
    const center: Axial = { q: 0, r: 0 };
    for (const d of NEIGHBOR_DIRS) {
      expect(hexDistance(center, { q: d.dq, r: d.dr })).toBe(1);
    }
  });

  it('hexDistance is symmetric', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 5, r: -2 })).toBe(
      hexDistance({ q: 5, r: -2 }, { q: 0, r: 0 }),
    );
  });

  it('neighbors returns exactly 6', () => {
    expect(neighbors({ q: 0, r: 0 })).toHaveLength(6);
  });

  it('hexesInRange 0 returns just the center', () => {
    const r = hexesInRange({ q: 2, r: 3 }, 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ q: 2, r: 3 });
  });

  it('hexesInRange 1 returns 7 hexes (center + 6)', () => {
    const r = hexesInRange({ q: 0, r: 0 }, 1);
    expect(r).toHaveLength(7);
  });

  it('hexesInRange 2 returns 19 hexes', () => {
    // Numero di hex in raggio R: 1 + 3R(R+1) = 1+6+12 = 19 per R=2
    const r = hexesInRange({ q: 0, r: 0 }, 2);
    expect(r).toHaveLength(19);
  });

  it('areAdjacent matches hexDistance==1', () => {
    expect(areAdjacent({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
    expect(areAdjacent({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(false);
    expect(areAdjacent({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(false);
  });
});

describe('line', () => {
  it('hexLine same hex returns single element', () => {
    expect(hexLine({ q: 2, r: 3 }, { q: 2, r: 3 })).toEqual([{ q: 2, r: 3 }]);
  });

  it('hexLine adjacent returns 2 elements', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 1, r: 0 });
    expect(line).toHaveLength(2);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line[1]).toEqual({ q: 1, r: 0 });
  });

  it('hexLine length matches distance + 1', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 4, r: 2 };
    const line = hexLine(a, b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
  });

  it('hasLineOfSight: clear line', () => {
    const blocking = () => false;
    expect(hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, blocking)).toBe(true);
  });

  it('hasLineOfSight: blocked by intermediate', () => {
    const blocked: Axial = { q: 2, r: 0 };
    const blocking = (h: Axial) => axialEquals(h, blocked);
    expect(hasLineOfSight({ q: 0, r: 0 }, { q: 4, r: 0 }, blocking)).toBe(false);
  });

  it('hasLineOfSight: endpoints are not checked for blocking', () => {
    const blocking = (h: Axial) => axialEquals(h, { q: 0, r: 0 });
    expect(hasLineOfSight({ q: 0, r: 0 }, { q: 3, r: 0 }, blocking)).toBe(true);
  });
});

describe('pathfinding', () => {
  it('findPath: trivial same-cell', () => {
    const p = findPath({ q: 0, r: 0 }, { q: 0, r: 0 });
    expect(p).toEqual([{ q: 0, r: 0 }]);
  });

  it('findPath: adjacent', () => {
    const p = findPath({ q: 0, r: 0 }, { q: 1, r: 0 });
    expect(p).toHaveLength(2);
  });

  it('findPath: straight line', () => {
    const p = findPath({ q: 0, r: 0 }, { q: 5, r: 0 });
    expect(p).not.toBeNull();
    expect(p!.length).toBe(6);
  });

  it('findPath: blocked path goes around', () => {
    const blocked = new Set(['1,0', '1,1', '1,-1']);
    const p = findPath(
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      { passable: (h) => !blocked.has(`${h.q},${h.r}`) },
    );
    expect(p).not.toBeNull();
    expect(p![0]).toEqual({ q: 0, r: 0 });
    expect(p![p!.length - 1]).toEqual({ q: 2, r: 0 });
  });

  it('findPath: unreachable returns null', () => {
    const p = findPath(
      { q: 0, r: 0 },
      { q: 5, r: 0 },
      { passable: () => false }, // niente è passabile
    );
    expect(p).toBeNull();
  });

  it('reachableHexes: maxCost 0 returns just start', () => {
    const r = reachableHexes({ q: 0, r: 0 }, 0);
    expect(r.size).toBe(1);
  });

  it('reachableHexes: maxCost 1 returns 7 (center + 6)', () => {
    const r = reachableHexes({ q: 0, r: 0 }, 1);
    expect(r.size).toBe(7);
  });

  it('reachableHexes: maxCost 2 returns 19', () => {
    const r = reachableHexes({ q: 0, r: 0 }, 2);
    expect(r.size).toBe(19);
  });
});

describe('base', () => {
  it('getBaseHexes returns 7 hexes (center + 6)', () => {
    const b = getBaseHexes({ q: 0, r: 0 });
    expect(b).toHaveLength(7);
  });

  it('basesOverlap: same center overlaps', () => {
    expect(basesOverlap({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(true);
  });

  it('basesOverlap: distant centers do not overlap', () => {
    expect(basesOverlap({ q: 0, r: 0 }, { q: 5, r: 0 })).toBe(false);
  });

  it('basesOverlap: adjacent centers (dist 1) overlap', () => {
    expect(basesOverlap({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(true);
  });

  it('basesOverlap: centers at dist 2 do NOT overlap (boundary)', () => {
    expect(basesOverlap({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(true); // condividono ancora un esagono
    expect(basesOverlap({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(false);
  });

  it('baseDistance: centers at dist 3 → base distance 1', () => {
    expect(baseDistance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(1);
  });

  it('baseDistance: centers at dist 5 → base distance 3', () => {
    expect(baseDistance({ q: 0, r: 0 }, { q: 5, r: 0 })).toBe(3);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { deriveSettlementRing, placeCoverageTowers, type EnclosureCtx } from '@/world/enclosure';
import { BARRIER_DEFAULTS, type BarrierRun, type PlacedBarrier, type RingSegment } from '@/world/barrier';
import { computeDitchCells, buildDitchDeformations } from '@/world/ditch-deformation';
import { computeKillingFieldCells } from '@/world/killing-field';
import type { GameMap, Tile } from '@/core/types';

const ctx: EnclosureCtx = { era: 'medieval' };

beforeAll(() => loadDefaultPacks());

// ── helpers ──────────────────────────────────────────────────────────────────

/** A closed masonry town-wall ring as a run, with centroid, matching what worldgen commits. */
function wallRun(path: [number, number][], centroid: [number, number], gates: BarrierRun['gates'] = [], segments?: RingSegment[]): BarrierRun {
  return { kind: 'wall', path, ...BARRIER_DEFAULTS.wall, crenellated: true, material: 'stone', thickness: 1, centroid, gates, ...(segments ? { segments } : {}) };
}

/** Rectangle ring path (closed). */
function rect(minX: number, minY: number, maxX: number, maxY: number): [number, number][] {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

function pathLen(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Path-distance of the closest point on `path` to (x,y). */
function tOf(path: [number, number][], x: number, y: number): number {
  let acc = 0, bestT = 0, bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let u = ((x - ax) * dx + (y - ay) * dy) / L2; u = Math.max(0, Math.min(1, u));
    const px = ax + dx * u, py = ay + dy * u;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) { bestD = d; bestT = acc + u * Math.hypot(dx, dy); }
    acc += Math.hypot(dx, dy);
  }
  return bestT;
}

function gridMap(w: number, h: number, fill: (x: number, y: number) => Partial<Tile> = () => ({})): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized', ...fill(x, y) } as Tile);
    tiles.push(row);
  }
  return { tiles, width: w, height: h, seed: 1, worldSeed: null } as unknown as GameMap;
}

// ── coverage towers ────────────────────────────────────────────────────────────

describe('placeCoverageTowers — gates first', () => {
  it('gives each real gate a flanking PAIR just outside the leaf span', () => {
    const run = wallRun(rect(0, 0, 20, 16), [10, 8], [{ t: 10, width: 3, kind: 'gate' }]);
    const towers = placeCoverageTowers(run);
    const gateTowers = towers.filter((t) => t.role === 'gate');
    expect(gateTowers.length).toBe(2);                          // one each side of the gate
    // Both flankers sit near the gate point (t≈10 → world (10,0)) on the north edge, offset along the wall.
    for (const g of gateTowers) expect(g.y).toBeCloseTo(0, 0);
    const xs = gateTowers.map((g) => g.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(10);                            // left flanker
    expect(xs[1]).toBeGreaterThan(10);                         // right flanker
  });

  it('a plain GAP opening (water/building) gets no flanking pair', () => {
    const run = wallRun(rect(0, 0, 20, 16), [10, 8], [{ t: 10, width: 6, kind: 'gap' }]);
    expect(placeCoverageTowers(run).filter((t) => t.role === 'gate')).toHaveLength(0);
  });

  it('a palisade rung gets gate flankers only — no salient/fill drums', () => {
    const pal: BarrierRun = { kind: 'palisade', path: rect(0, 0, 40, 30), ...BARRIER_DEFAULTS.palisade, centroid: [20, 15], gates: [{ t: 20, width: 3, kind: 'gate' }] };
    const towers = placeCoverageTowers(pal);
    expect(towers.every((t) => t.role === 'gate')).toBe(true);
    expect(towers.filter((t) => t.role === 'salient')).toHaveLength(0);
    expect(towers.filter((t) => t.role === 'fill')).toHaveLength(0);
  });
});

describe('placeCoverageTowers — salients + fill spacing', () => {
  it('places a drum at each convex corner (salient)', () => {
    const run = wallRun(rect(0, 0, 20, 16), [10, 8], []);
    const salients = placeCoverageTowers(run).filter((t) => t.role === 'salient');
    expect(salients.length).toBe(4);                          // the four rectangle corners
  });

  it('no OPEN wall run exceeds MAX_TOWER_SPACING (24 tiles)', () => {
    // A big ring whose sides (each ~40–60 tiles) exceed the spacing → fill towers must appear.
    const path = rect(0, 0, 60, 44);
    const run = wallRun(path, [30, 22], [{ t: 30, width: 3, kind: 'gate' }]);
    const towers = placeCoverageTowers(run);
    expect(towers.some((t) => t.role === 'fill')).toBe(true);
    const total = pathLen(path);
    const ts = towers.map((t) => tOf(path, t.x, t.y)).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < ts.length; i++) {
      const gap = (i + 1 < ts.length ? ts[i + 1] : ts[0] + total) - ts[i];
      maxGap = Math.max(maxGap, gap);
    }
    expect(maxGap).toBeLessThanOrEqual(24 + 1e-6);
  });

  it('relaxes on steep legs and skips fill entirely on water legs', () => {
    const path = rect(0, 0, 60, 44);
    // Dense per-leg metadata: leg 0 (top, path[0]→path[1]) is WATER; leg 1 (right) is STEEP; rest open.
    const segments: RingSegment[] = [{ defends: 'water' }, { defends: 'steep' }, { defends: 'open' }, { defends: 'open' }];
    const run = wallRun(path, [30, 22], [], segments);
    const towers = placeCoverageTowers(run);
    // No fill tower on the water leg (top edge, y≈0, 0<x<60).
    const onWater = towers.filter((t) => t.role === 'fill' && t.y < 1 && t.x > 1 && t.x < 59);
    expect(onWater).toHaveLength(0);
    // The open bottom edge (y≈44) is still filled within spacing.
    const bottomFills = towers.filter((t) => t.role === 'fill' && t.y > 43);
    expect(bottomFills.length).toBeGreaterThan(0);
  });

  it('is deterministic — identical output across calls', () => {
    const run = wallRun(rect(0, 0, 60, 44), [30, 22], [{ t: 30, width: 3, kind: 'gate' }]);
    expect(placeCoverageTowers(run)).toEqual(placeCoverageTowers(run));
  });

  it('is set on a real derived town-wall ring', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 45, maxY: 40 }, mapW: 80, mapH: 80,
      buildingCount: 40, poiId: 'town', isWater: () => false, isRoad: () => false,
      connections: [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }], ctx,
    })!;
    expect(ring.run.towers).toBeTruthy();
    expect(ring.run.towers!.some((t) => t.role === 'gate')).toBe(true);
  });
});

// ── ditch ────────────────────────────────────────────────────────────────────

describe('ditch band', () => {
  const path = rect(20, 20, 44, 40);
  const centroid: [number, number] = [32, 30];

  it('never carves under water, roads, buildings, or farmland', () => {
    const map = gridMap(64, 64, (x, y) => {
      // Put a road, a building, water, farmland right in the outward band of the east wall (x≈45–47).
      if (x === 46 && y === 30) return { type: 'dirt_road' };
      if (x === 46 && y === 32) return { type: 'grass', walkable: false };   // building footprint
      if (x === 46 && y === 34) return { type: 'shallow_water', walkable: false };
      if (x === 46 && y === 36) return { type: 'farm_field' };
      return {};
    });
    const run = wallRun(path, centroid, [{ t: 12, width: 3, kind: 'gate' }]);
    const cells = computeDitchCells(map, run);
    const has = (x: number, y: number): boolean => cells.has(y * map.width + x);
    expect(cells.size).toBeGreaterThan(0);
    expect(has(46, 30)).toBe(false);  // road
    expect(has(46, 32)).toBe(false);  // building
    expect(has(46, 34)).toBe(false);  // water
    expect(has(46, 36)).toBe(false);  // farmland
    // Every ditch cell is a grass, walkable, non-road, non-farm tile.
    for (const idx of cells) {
      const t = map.tiles[(idx / map.width) | 0][idx % map.width];
      expect(t.walkable).toBe(true);
      expect(['dirt_road', 'stone_road', 'bridge', 'farm_field']).not.toContain(t.type);
    }
  });

  it('breaks at a causeway across each real gate (no ditch on the gate approach)', () => {
    const map = gridMap(64, 64);
    const run = wallRun(path, centroid, [{ t: 12, width: 3, kind: 'gate' }]);   // t=12 → north edge x≈32
    const cells = computeDitchCells(map, run);
    // Gate world point is on the top edge near (32,20). No ditch cell within the causeway radius.
    let minDist = Infinity;
    for (const idx of cells) {
      const x = idx % map.width, y = (idx / map.width) | 0;
      minDist = Math.min(minDist, Math.hypot(x - 32, y - 20));
    }
    expect(minDist).toBeGreaterThan(3);     // gate half-width + band cleared
  });

  it('carves no ditch on a water-defended leg', () => {
    const map = gridMap(64, 64);
    // Top edge (leg 0) is water-defended (dense per-leg metadata).
    const run = wallRun(path, centroid, [], [{ defends: 'water' }, { defends: 'open' }, { defends: 'open' }, { defends: 'open' }]);
    const cells = computeDitchCells(map, run);
    // No ditch cell just north of the top edge (y ≈ 17–19, 20<x<44).
    for (const idx of cells) {
      const x = idx % map.width, y = (idx / map.width) | 0;
      const northOfTopEdge = y < 20 && x > 21 && x < 43;
      expect(northOfTopEdge).toBe(false);
    }
  });

  it('buildDitchDeformations emits a carve for a town wall, nothing for a palisade', () => {
    const map = gridMap(64, 64);
    const wall: PlacedBarrier = { id: 'ring', run: wallRun(path, centroid, [{ t: 12, width: 3, kind: 'gate' }]) };
    const pal: PlacedBarrier = { id: 'pal', run: { kind: 'palisade', path, ...BARRIER_DEFAULTS.palisade, centroid, gates: [] } };
    map.barrierRuns = [wall, pal];
    const defs = buildDitchDeformations(map);
    expect(defs.length).toBe(1);
    expect(defs[0].op).toBe('carve');
    expect(defs[0].source).toBe('wall:ditch');
    expect(defs[0].amount).toBeGreaterThan(0);
  });

  it('is deterministic — identical cell set across calls', () => {
    const map = gridMap(64, 64);
    const run = wallRun(path, centroid, [{ t: 12, width: 3, kind: 'gate' }]);
    expect([...computeDitchCells(map, run)].sort()).toEqual([...computeDitchCells(map, run)].sort());
  });
});

// ── killing field ──────────────────────────────────────────────────────────────

describe('killing field', () => {
  const path = rect(20, 20, 44, 40);
  const centroid: [number, number] = [32, 30];

  it('covers the outward band on open legs but exempts farmland', () => {
    const map = gridMap(64, 64, (x, y) => (x === 46 && y === 30 ? { type: 'farm_field' } : {}));
    const run = wallRun(path, centroid, []);
    const cells = computeKillingFieldCells(map, run);
    expect(cells.size).toBeGreaterThan(0);
    expect(cells.has(30 * map.width + 46)).toBe(false);   // farmland exempt
  });

  it('skips water-defended legs (the water is the field)', () => {
    const map = gridMap(64, 64);
    const run = wallRun(path, centroid, [], [{ defends: 'water' }, { defends: 'open' }, { defends: 'open' }, { defends: 'open' }]);
    const cells = computeKillingFieldCells(map, run);
    for (const idx of cells) {
      const x = idx % map.width, y = (idx / map.width) | 0;
      expect(y < 20 && x > 21 && x < 43).toBe(false);     // nothing cleared north of the water leg
    }
  });
});

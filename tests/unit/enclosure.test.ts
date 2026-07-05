import { describe, it, expect, beforeAll } from 'vitest';
import {
  selectSettlementEnclosure, selectCroftEnclosure, barrierRunFromType,
  deriveCroftEnclosures, deriveSettlementRing, type EnclosureCtx,
} from '@/world/enclosure';
import { loadDefaultPacks } from '@/catalogue';
import { gatePoint } from '@/world/barrier';
import type { Lot } from '@/world/settlement-plan';

const ctx: EnclosureCtx = { era: 'medieval' };
// Deterministic rng stub: cycles a fixed sequence.
function seqRng(vals: number[]) {
  let i = 0;
  return { next: () => vals[i++ % vals.length] };
}

beforeAll(() => loadDefaultPacks());

describe('barrier catalogue is registered + Wikipedia-grounded', () => {
  it('builds a hedge run with metric height and material from the fact', () => {
    const run = barrierRunFromType('hedge', [[0, 0], [3, 0]], []);
    expect(run).toBeTruthy();
    expect(run!.kind).toBe('hedge');
    expect(run!.material).toBe('hedge');
    expect(run!.height).toBeGreaterThan(0); // mToTiles(1.5)
  });

  it('town-wall is crenellated stone', () => {
    const run = barrierRunFromType('town-wall', [[0, 0], [4, 0]], []);
    expect(run!.material).toBe('stone');
    expect(run!.crenellated).toBe(true);
  });
});

describe('settlement enclosure rung selection scales with size', () => {
  it('hamlet (few buildings) gets no settlement ring', () => {
    expect(selectSettlementEnclosure(3, ctx)).toBeNull();
  });
  it('village gets a palisade', () => {
    expect(selectSettlementEnclosure(8, ctx)).toBe('timber-palisade');
  });
  it('town gets the town wall (the highest rung it reaches)', () => {
    expect(selectSettlementEnclosure(20, ctx)).toBe('town-wall');
  });
});

describe('croft enclosure selection', () => {
  it('default region biases to a hedge but only returns applicable types', () => {
    // rng.next < 0.6 → hedge
    expect(selectCroftEnclosure(seqRng([0.1]), ctx)).toBe('hedge');
    // drystone is region-gated (upland/north) → excluded in the default region
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) picks.add(selectCroftEnclosure(seqRng([0.9, i / 20]), ctx)!);
    expect(picks.has('drystone-wall')).toBe(false);
  });
});

describe('deriveCroftEnclosures rings built lots with a street gate', () => {
  const lot: Lot = {
    id: 'lot:1', edge: 0, side: [0, 1], // road to the north
    frontage: [{ x: 2, y: 1 }],
    depth: 3,
    tiles: [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ],
    buildingId: 'bld_1',
  };

  it('produces one gated ring per built lot', () => {
    const runs = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx);
    expect(runs).toHaveLength(1);
    const { run } = runs[0];
    expect(run.path.length).toBe(5);        // closed rectangle
    expect(run.gates).toHaveLength(1);
    // road north → gate on the top edge, t = dx/2 = (4-2)/2 = 1
    expect(run.gates[0].t).toBeCloseTo(1, 5);
  });

  it('skips unbuilt lots', () => {
    const empty = { ...lot, buildingId: undefined };
    expect(deriveCroftEnclosures([empty], 'poi1', seqRng([0.1]), ctx)).toHaveLength(0);
  });

  // ── road-threaded crofts (C-3: road-x-barrier) ──────────────────────────────────────
  it('opens a real GATE where a lane threads the croft ring (no fording the hedge)', () => {
    // A road runs along the ring's WEST edge (x=2, the left side of the lot rectangle).
    const isRoad = (x: number, _y: number): boolean => x === 2;
    const withRoad = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx, undefined, undefined, isRoad);
    const withoutRoad = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx);
    // The road adds at least one gate span the un-roaded ring lacks…
    expect(withRoad[0].run.gates.length).toBeGreaterThan(withoutRoad[0].run.gates.length);
    // …and it is typed a real 'gate' (a gatehouse opening), not a plain gap.
    const extra = withRoad[0].run.gates.filter((g) => g.kind === 'gate');
    expect(extra.length).toBeGreaterThan(0);
  });

  it('is a no-op when no road crosses the ring (byte-identical to the no-isRoad path)', () => {
    const noCross = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx, undefined, undefined, () => false);
    const legacy = deriveCroftEnclosures([lot], 'poi1', seqRng([0.1]), ctx);
    expect(noCross[0].run.gates).toEqual(legacy[0].run.gates);
  });
});

describe('deriveSettlementRing encloses the built bbox with gates at crossings', () => {
  it('rings a town and opens a gate where a road crosses', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 15, maxY: 15 },
      mapW: 64, mapH: 64,
      buildingCount: 20,
      poiId: 'town1',
      isWater: () => false,
      isRoad: (x, y) => x === 10 && y <= 3, // a road exits north near x=10
      ctx,
    });
    expect(ring).toBeTruthy();
    expect(ring!.run.kind).toBe('wall');     // town wall at 20 buildings
    // ring sits margin=2 outside the bbox
    expect(ring!.run.path[0]).toEqual([3, 3]);
    expect(ring!.run.gates.length).toBeGreaterThanOrEqual(1);
  });

  it('guarantees ONE main gate even when no road crosses the ring (never a sealed town)', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 15, maxY: 15 },
      mapW: 64, mapH: 64, buildingCount: 20, poiId: 'town2',
      isWater: () => false,
      isRoad: (x, y) => x === 10 && y === 25,   // a road well SOUTH of the ring, never crossing it
      ctx,
    });
    const realGates = ring!.run.gates.filter((g) => g.kind !== 'gap');
    expect(realGates.length).toBe(1);           // exactly one main gate, toward the road
  });

  it('opens a whole water-fronted side and keeps its gate off the water', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 15, maxY: 15 },
      mapW: 64, mapH: 64, buildingCount: 20, poiId: 'town3',
      isWater: (x) => x >= 18,                    // sea to the EAST, just outside the east wall (x=17)
      isRoad: () => false,
      ctx,
    });
    const gaps = ring!.run.gates.filter((g) => g.kind === 'gap');
    expect(gaps.length).toBeGreaterThanOrEqual(1);   // the east side opened to the water
    const gates = ring!.run.gates.filter((g) => g.kind !== 'gap');
    expect(gates.length).toBe(1);                     // still exactly one landward gate
  });

  // ── gates-first: committed direction gates (Watabou portal nodes) ──────────────────
  it('commits a gate toward each inbound connection direction, before any road exists', () => {
    // No road crosses the ring at all — gates come purely from the connection directions.
    const ring = deriveSettlementRing({
      bbox: { minX: 20, minY: 20, maxX: 34, maxY: 34 },
      mapW: 80, mapH: 80, buildingCount: 20, poiId: 'portal',
      isWater: () => false,
      isRoad: () => false,                       // NO road crossing — gates are direction-committed
      connections: [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }],   // east + north neighbours
      ctx,
    })!;
    const gates = ring.run.gates.filter((g) => g.kind !== 'gap');
    // Two distinct inbound directions → two committed gates (no road needed to derive them).
    expect(gates.length).toBe(2);
    const c = ring.run.centroid!;
    // One gate opens on the EAST bearing, one on the NORTH bearing.
    const bearings = gates.map((g) => {
      const [gx, gy] = gatePoint(ring.run, g);
      return { ex: gx - c[0], ey: gy - c[1] };
    });
    expect(bearings.some((b) => b.ex > 3 && Math.abs(b.ey) < 4)).toBe(true);   // east gate
    expect(bearings.some((b) => b.ey < -3 && Math.abs(b.ex) < 4)).toBe(true);  // north gate
  });

  it('never opens a committed gate onto water (a POI across the river shares a landward gate)', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 20, minY: 20, maxX: 34, maxY: 34 },
      mapW: 80, mapH: 80, buildingCount: 20, poiId: 'riverport',
      isWater: (x) => x >= 37,                    // river to the EAST just outside the wall
      isRoad: () => false,
      connections: [{ dx: 1, dy: 0 }],            // the only neighbour is EAST, across the water
      ctx,
    })!;
    const gates = ring.run.gates.filter((g) => g.kind !== 'gap');
    // Still exactly one landward gate (guarantee), and it is NOT on the wet east side.
    expect(gates.length).toBe(1);
    const [gx] = gatePoint(ring.run, gates[0]);
    expect(gx).toBeLessThan(36);
  });

  it('deduplicates a direction gate that coincides with an interior-street crossing', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 20, minY: 20, maxX: 34, maxY: 34 },
      mapW: 80, mapH: 80, buildingCount: 20, poiId: 'aligned',
      isWater: () => false,
      isRoad: (x, y) => y <= 19 && x >= 26 && x <= 28,   // a street pokes north through the ring
      connections: [{ dx: 0, dy: -1 }],                   // and the neighbour is also NORTH
      ctx,
    })!;
    const gates = ring.run.gates.filter((g) => g.kind !== 'gap');
    // The northbound street crossing and the north connection resolve to ONE gate, not two abutting.
    expect(gates.length).toBe(1);
  });

  it('returns null for a hamlet', () => {
    const ring = deriveSettlementRing({
      bbox: { minX: 5, minY: 5, maxX: 9, maxY: 9 },
      mapW: 64, mapH: 64,
      buildingCount: 3,
      poiId: 'hamlet1',
      isWater: () => false, isRoad: () => false, ctx,
    });
    expect(ring).toBeNull();
  });
});

// ── WP-W1: canonical 8-bearing ring contract ─────────────────────────────────────────
// Assert a ring path is a closed, simple, convex polygon whose every edge runs in one of the 8
// canonical directions on the piece grid (cardinal edges even tiles; diagonal edges Δ = (±2k, ±2k)),
// with integer vertices.
function assertCanonical(path: [number, number][]): void {
  expect(path.length).toBeGreaterThanOrEqual(5);          // ≥4 edges + closing repeat
  expect(path[0]).toEqual(path[path.length - 1]);          // closed
  let sign = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    expect(Number.isInteger(ax) && Number.isInteger(ay)).toBe(true);
    const dx = bx - ax, dy = by - ay;
    const cardinal = (dx === 0) !== (dy === 0);
    const diagonal = dx !== 0 && Math.abs(dx) === Math.abs(dy);
    expect(cardinal || diagonal).toBe(true);               // canonical bearing
    if (cardinal) expect(Math.abs(dx + dy) % 2).toBe(0);   // even tiles (whole cardinal pieces)
    else expect(Math.abs(dx) % 2).toBe(0);                 // Δ = (±2k, ±2k) (whole diagonal pieces)
    // Convexity (⇒ simple): consecutive edges never reverse turn direction.
    if (i < path.length - 1) {
      const [cx, cy] = path[i + 1];
      const cross = dx * (cy - by) - dy * (cx - bx);
      if (Math.abs(cross) > 1e-9) { const s = Math.sign(cross); if (sign === 0) sign = s; else expect(s).toBe(sign); }
    }
  }
}

describe('terrain-traced settlement ring (canonical 8-bearing walls)', () => {
  // A blobby building cluster centred at (19,18), radius ~7.4 tiles.
  const bset = new Set<string>();
  for (let y = 12; y <= 24; y++) for (let x = 12; x <= 26; x++) {
    if ((x - 19) ** 2 + (y - 18) ** 2 <= 55) bset.add(`${x},${y}`);
  }
  const isBuilding = (x: number, y: number) => bset.has(`${x},${y}`);
  const bbox = { minX: 12, minY: 12, maxX: 26, maxY: 24 };

  // Even-odd point-in-polygon on a closed ring path.
  function inside(poly: [number, number][], x: number, y: number): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  it('traces a canonical (non-rectangular) polygon that still encloses every building', () => {
    const ring = deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'traced',
      isWater: () => false, isRoad: () => false, isBuilding, ctx: { era: 'medieval', wealth: 'wealthy' },
    })!;
    expect(ring).toBeTruthy();
    const path = ring.run.path as [number, number][];
    // A canonical ring has more than a rectangle's 5 points but stays bounded (≤8 edges + close).
    expect(path.length).toBeGreaterThan(5);
    expect(path.length - 1).toBeLessThanOrEqual(14);
    // Every edge is on a canonical bearing + the piece grid; the ring is closed, simple, convex.
    assertCanonical(path);
    // It is genuinely 8-directional: at least one segment runs on a true (45°) diagonal.
    const hasDiagonal = path.slice(1).some((p, i) => {
      const dx = p[0] - path[i][0], dy = p[1] - path[i][1];
      return dx !== 0 && Math.abs(dx) === Math.abs(dy);
    });
    expect(hasDiagonal).toBe(true);
    // Enclosure guarantee: no building cell lands outside the ring.
    let breaches = 0;
    for (const k of bset) { const [x, y] = k.split(',').map(Number); if (!inside(path, x, y)) breaches++; }
    expect(breaches).toBe(0);
  });

  it('is deterministic — same inputs give a byte-identical canonical ring', () => {
    const mk = () => deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'det',
      isWater: () => false, isRoad: () => false, isBuilding, ctx: { era: 'medieval', wealth: 'wealthy' },
    })!;
    expect(mk().run.path).toEqual(mk().run.path);
  });

  it('encloses buildings + stays canonical across several cluster seeds', () => {
    for (const [cx0, cy0, r2] of [[24, 22, 40], [30, 30, 70], [18, 26, 30], [40, 20, 55]] as const) {
      const cells = new Set<string>();
      for (let y = cy0 - 10; y <= cy0 + 10; y++) for (let x = cx0 - 10; x <= cx0 + 10; x++) {
        if ((x - cx0) ** 2 + (y - cy0) ** 2 <= r2) cells.add(`${x},${y}`);
      }
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const k of cells) { const [x, y] = k.split(',').map(Number); mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y); }
      const ring = deriveSettlementRing({
        bbox: { minX: mnx, minY: mny, maxX: mxx, maxY: mxy },
        mapW: 80, mapH: 80, buildingCount: 30, poiId: `seed_${cx0}_${cy0}`,
        isWater: () => false, isRoad: () => false,
        isBuilding: (x, y) => cells.has(`${x},${y}`), ctx: { era: 'medieval', wealth: 'wealthy' },
      })!;
      const path = ring.run.path as [number, number][];
      assertCanonical(path);
      let breaches = 0;
      for (const k of cells) { const [x, y] = k.split(',').map(Number); if (!inside(path, x, y)) breaches++; }
      expect(breaches).toBe(0);
    }
  });

  it('snaps every real gate onto whole piece slots (1 or 2 pieces on its edge)', () => {
    const ring = deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'gateslot',
      isWater: () => false, isRoad: () => false, isBuilding,
      connections: [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: 1 }],
      ctx: { era: 'medieval', wealth: 'wealthy' },
    })!;
    const path = ring.run.path as [number, number][];
    // Cumulative edge starts + per-edge piece length.
    const edges: { start: number; len: number; piece: number }[] = [];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i][0] - path[i - 1][0], dy = path[i][1] - path[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const piece = (dx !== 0 && dy !== 0) ? 2 * Math.SQRT2 : 2;
      edges.push({ start: acc, len, piece });
      acc += len;
    }
    for (const g of ring.run.gates.filter((x) => x.kind !== 'gap')) {
      const e = edges.find((ed) => g.t >= ed.start - 1e-6 && g.t <= ed.start + ed.len + 1e-6)!;
      expect(e).toBeTruthy();
      const local = g.t - e.start;                 // gate centre offset along its edge
      const halfSlots = g.width / e.piece;         // width in pieces (1 or 2)
      expect(Math.abs(Math.round(halfSlots) - halfSlots)).toBeLessThan(1e-6);   // whole pieces
      expect([1, 2]).toContain(Math.round(halfSlots));
      // The span [local - w/2, local + w/2] starts on a piece boundary.
      const slotStart = (local - g.width / 2) / e.piece;
      expect(Math.abs(Math.round(slotStart) - slotStart)).toBeLessThan(1e-6);
    }
  });

  it('hugs a nearby waterline — the wall sits landward of the river', () => {
    const ring = deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'river',
      isWater: (x) => x >= 29,                     // river/coast to the east
      isRoad: (x, y) => y === 18 && x < 12,        // road approaching from the west
      isBuilding, ctx: { era: 'medieval', wealth: 'wealthy' },
    })!;
    const path = ring.run.path as [number, number][];
    // No ring vertex crosses into the water; the east edge tucks just landward of x=29.
    const maxX = Math.max(...path.map((p) => p[0]));
    expect(maxX).toBeLessThan(29);
    expect(maxX).toBeGreaterThan(26);              // but it DID reach out to hug the bank
  });

  it('falls back to a rectangle when no building footprint is supplied', () => {
    const ring = deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'norect',
      isWater: () => false, isRoad: () => false, ctx: { era: 'medieval', wealth: 'wealthy' },
    })!;
    expect(ring.run.path.length).toBe(5);          // the classic axis-aligned box
  });
});

// ── WP-R: terrain-seeking ring + nature-defends segments ─────────────────────────────
describe('terrain-seeking ring (WP-R): high-line preference + nature-defends metadata', () => {
  // A blobby building cluster centred at (19,18), radius ~7.4 tiles (30+ cells → town-wall rung).
  const bset = new Set<string>();
  for (let y = 12; y <= 24; y++) for (let x = 12; x <= 26; x++) {
    if ((x - 19) ** 2 + (y - 18) ** 2 <= 55) bset.add(`${x},${y}`);
  }
  const isBuilding = (x: number, y: number) => bset.has(`${x},${y}`);
  const bbox = { minX: 12, minY: 12, maxX: 26, maxY: 24 };
  const townCtx: EnclosureCtx = { era: 'medieval', wealth: 'wealthy' };

  // Even-odd point-in-polygon on a closed ring path.
  function inside(poly: [number, number][], x: number, y: number): boolean {
    let c = false;
    for (let i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  // A north–south ridge crest at x=31 (metres above sea, water negative). East of the town this is
  // the local high line; the terrain-seeking ring should climb toward it within its bounded slack.
  const ridgeEast = (x: number, _y: number): number => Math.max(0, 6 - Math.abs(x - 31));

  const mk = (heightAt: ((x: number, y: number) => number) | undefined, poiId: string, buildingCount = 30) =>
    deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount, poiId,
      isWater: () => false, isRoad: () => false, isBuilding, heightAt, ctx: townCtx,
    })!;

  it('a masonry town wall reaches OUT toward the high line (vs the distance-only ring)', () => {
    const withT = mk(ridgeEast, 'seek');
    const noT = mk(undefined, 'noseek');
    expect(withT.run.kind).toBe('wall');
    const maxXwith = Math.max(...withT.run.path.map((p) => p[0]));
    const maxXno = Math.max(...noT.run.path.map((p) => p[0]));
    expect(maxXwith).toBeGreaterThan(maxXno);        // the east curtain climbed toward the ridge
  });

  it('never violates building enclosure while seeking terrain', () => {
    const path = mk(ridgeEast, 'enclose').run.path as [number, number][];
    let breaches = 0;
    for (const k of bset) { const [x, y] = k.split(',').map(Number); if (!inside(path, x, y)) breaches++; }
    expect(breaches).toBe(0);
  });

  it('emits one nature-defends segment per ring side, present and stable across re-gen', () => {
    const r1 = mk(ridgeEast, 'stable');
    const r2 = mk(ridgeEast, 'stable');             // identical inputs ⇒ byte-identical output
    expect(r1.run.segments).toBeDefined();
    expect(r1.run.segments!.length).toBe(r1.run.path.length - 1);   // one per polygon edge
    for (const s of r1.run.segments!) expect(['open', 'water', 'steep']).toContain(s.defends);
    expect(r1.run.path).toEqual(r2.run.path);        // deterministic geometry
    expect(r1.run.segments).toEqual(r2.run.segments); // deterministic metadata
  });

  it('classifies a side above a sharp outward drop as `steep` (cliff-defended)', () => {
    // High ground on/inside the town (y ≤ 28), a sharp drop to sea level beyond it: the SOUTH
    // curtain crowns the cliff edge, so at least one side reads `steep`.
    const cliffSouth = (_x: number, y: number): number => (y <= 28 ? 8 : 0);
    const segs = mk(cliffSouth, 'cliff').run.segments!;
    expect(segs.some((s) => s.defends === 'steep')).toBe(true);
  });

  it('classifies a water-fronted side as `water` (unchanged gap behaviour)', () => {
    const ring = deriveSettlementRing({
      bbox, mapW: 60, mapH: 60, buildingCount: 30, poiId: 'wet',
      isWater: (x) => x >= 29,                        // river/coast to the east
      isRoad: () => false, isBuilding, ctx: townCtx,
    })!;
    expect(ring.run.segments!.some((s) => s.defends === 'water')).toBe(true);
  });

  it('leaves a timber PALISADE distance-based (terrain never moves its ring) but still classifies it', () => {
    const withT = mk(ridgeEast, 'palisade-seek', 10);   // 10 buildings → village palisade rung
    const noT = mk(undefined, 'palisade-noseek', 10);
    expect(withT.run.kind).toBe('palisade');
    expect(withT.run.path).toEqual(noT.run.path);       // terrain preference is gated off for palisades
    expect(withT.run.segments).toBeDefined();           // nature-defends metadata is still emitted
    expect(withT.run.segments!.length).toBe(withT.run.path.length - 1);
  });
});

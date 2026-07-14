// Biome-fidelity worldgen (WCV 97): the desert / swamp / savanna brushes exist and
// actually FIRE on their biomes' real tile types, and the vegetation placer's TREELINE
// band thins a species out as it climbs toward its altitude ceiling.
import { describe, it, expect } from 'vitest';
import { desertBrush } from '@/world/brushes/desert';
import { swampBrush } from '@/world/brushes/swamp';
import { savannaBrush } from '@/world/brushes/savanna';
import { pineForestBrush } from '@/world/brushes/pine-forest';
import { forestBrush } from '@/world/brushes/forest';
import { hillsBrush } from '@/world/brushes/hills';
import { brushForBiome } from '@/world/brushes/index';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][], seed = 0): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const fill = (w: number, h: number, type: string, seed = 0) =>
  ctx(Array.from({ length: h }, () => Array(w).fill(type)), seed);

/** Seed 1234 at 160² has a real alpine tail: ~179 cells above 22 m, ~1526 above 15 m —
 *  enough high ground for both the conifer (22 m) and broadleaf (15 m) ceilings to bite. */
const RELIEF_SEED = 1234;
const N = 160;
function heightM(x: number, y: number): number {
  const hf = getHeightfield(RELIEF_SEED, N, N, null, null, null);
  return (hf[y * N + x] - ELEVATION_SEA_LEVEL) * worldStyleOf(null).mountainRelief;
}

describe('biome → brush remap (WCV 97)', () => {
  it('desert and swamp get their own ecology brushes (were scrubland / dense_forest)', () => {
    expect(brushForBiome('desert')).toBe('desert');
    expect(brushForBiome('swamp')).toBe('swamp');
  });
  it('the warm grass seas route to savanna, not temperate scrub', () => {
    expect(brushForBiome('savanna')).toBe('savanna');
    expect(brushForBiome('tropical_grassland')).toBe('savanna');
  });
});

describe('desert brush', () => {
  it('places arid flora on SAND — the desert tile majority that used to get nothing', () => {
    const out = desertBrush({ x: 0, y: 0, w: 40, h: 40 }, 5, fill(40, 40, 'sand'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((e) => Math.floor(e.x) >= 0)).toBe(true);
  });

  it('only emits arid species — no temperate hedgerow thorns', () => {
    const allowed = new Set(['esparto-grass', 'tamarisk', 'white-wormwood', 'common-juniper', 'cotton-thistle']);
    for (const e of desertBrush({ x: 0, y: 0, w: 40, h: 40 }, 5, fill(40, 40, 'sand'))) {
      expect(allowed.has(e.kind)).toBe(true);
    }
    // The temperate scrub pool must not leak in.
    const kinds = new Set(desertBrush({ x: 0, y: 0, w: 40, h: 40 }, 5, fill(40, 40, 'sand')).map((e) => e.kind));
    expect(kinds.has('common-hawthorn')).toBe(false);
    expect(kinds.has('blackthorn')).toBe(false);
  });

  it('is SPARSE — a desert reads mostly bare (well under the grassland brush)', () => {
    const cells = 40 * 40;
    const out = desertBrush({ x: 0, y: 0, w: 40, h: 40 }, 5, fill(40, 40, 'sand'));
    expect(out.length / cells).toBeLessThan(0.25);
  });

  it('is deterministic', () => {
    const c = fill(16, 16, 'sand');
    const r = { x: 0, y: 0, w: 16, h: 16 };
    expect(desertBrush(r, 42, c)).toEqual(desertBrush(r, 42, c));
  });
});

describe('swamp brush', () => {
  it('FIRES on swamp tiles (the dense_forest brush it replaced never did)', () => {
    const out = swampBrush({ x: 0, y: 0, w: 32, h: 32 }, 7, fill(32, 32, 'swamp'));
    expect(out.length).toBeGreaterThan(0);
  });

  it('packs the reedbed fringe densely where the fen meets standing water', () => {
    // Left half swamp, right half shallow water → column 15 is the waterline.
    const rows = Array.from({ length: 32 }, () =>
      Array.from({ length: 32 }, (_, x) => (x < 16 ? 'swamp' : 'shallow_water')));
    const out = swampBrush({ x: 0, y: 0, w: 32, h: 32 }, 7, ctx(rows));
    const reeds = new Set(['common-reed', 'bulrush', 'carex-sedge']);
    const atEdge = out.filter((e) => reeds.has(e.kind) && Math.floor(e.x) === 15).length;
    const inland = out.filter((e) => reeds.has(e.kind) && Math.floor(e.x) < 8).length / 8;
    expect(atEdge).toBeGreaterThan(0);
    // The waterline column carries more reed per column than the average inland column.
    expect(atEdge).toBeGreaterThan(inland);
  });

  it('grows a wet-woodland canopy (alder/willow), not a dry-forest one', () => {
    const kinds = new Set(swampBrush({ x: 0, y: 0, w: 40, h: 40 }, 3, fill(40, 40, 'swamp')).map((e) => e.kind));
    expect(kinds.has('common-alder') || kinds.has('white-willow') || kinds.has('weeping-willow')).toBe(true);
    expect(kinds.has('english-oak')).toBe(false);
    expect(kinds.has('european-beech')).toBe(false);
  });

  it('is deterministic', () => {
    const c = fill(16, 16, 'swamp');
    const r = { x: 0, y: 0, w: 16, h: 16 };
    expect(swampBrush(r, 42, c)).toEqual(swampBrush(r, 42, c));
  });
});

describe('savanna brush', () => {
  it('dresses the warm grass sea with dry tussock, not temperate wildflowers', () => {
    const out = savannaBrush({ x: 0, y: 0, w: 40, h: 40 }, 9, fill(40, 40, 'grass'));
    expect(out.length).toBeGreaterThan(0);
    const kinds = new Set(out.map((e) => e.kind));
    expect(kinds.has('tussock-grass')).toBe(true);
    expect(kinds.has('oxeye-daisy')).toBe(false);   // the temperate meadow pool stays out
  });

  it('thorn scrub is VERY sparse against the grass', () => {
    const out = savannaBrush({ x: 0, y: 0, w: 60, h: 60 }, 9, fill(60, 60, 'grass'));
    const thorn = out.filter((e) => e.kind === 'common-hawthorn' || e.kind === 'blackthorn').length;
    const grass = out.filter((e) => e.kind === 'tussock-grass' || e.kind === 'esparto-grass').length;
    expect(grass).toBeGreaterThan(thorn * 3);
  });
});

describe('treeline — per-species altitude band thins canopy toward its ceiling', () => {
  it('scots-pine never appears above its 22 m ceiling', () => {
    const out = pineForestBrush({ x: 0, y: 0, w: N, h: N }, 11, fill(N, N, 'pine_forest', RELIEF_SEED));
    const pines = out.filter((e) => e.kind === 'scots-pine');
    expect(pines.length).toBeGreaterThan(0);          // the test is not vacuous
    for (const p of pines) {
      expect(heightM(Math.floor(p.x), Math.floor(p.y))).toBeLessThan(22);
    }
  });

  it('scots-pine THINS across its band rather than stopping at a hard contour', () => {
    const out = pineForestBrush({ x: 0, y: 0, w: N, h: N }, 11, fill(N, N, 'pine_forest', RELIEF_SEED));
    const pines = out.filter((e) => e.kind === 'scots-pine');
    // Cells available in the low band (below the band start, 22−8=14 m) vs the upper
    // half of the thinning band (18–22 m). Per-cell pine rate must fall, not vanish.
    let lowCells = 0, highCells = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const m = heightM(x, y);
      if (m < 14) lowCells++;
      else if (m >= 18 && m < 22) highCells++;
    }
    const lowPines = pines.filter((p) => heightM(Math.floor(p.x), Math.floor(p.y)) < 14).length;
    const highPines = pines.filter((p) => {
      const m = heightM(Math.floor(p.x), Math.floor(p.y));
      return m >= 18 && m < 22;
    }).length;
    expect(highCells).toBeGreaterThan(0);
    const lowRate = lowPines / lowCells;
    const highRate = highPines / Math.max(1, highCells);
    expect(highRate).toBeLessThan(lowRate);      // thinned
  });

  it('broadleaf stays LOWLAND — english-oak caps well below the conifer treeline', () => {
    const out = forestBrush({ x: 0, y: 0, w: N, h: N }, 13, fill(N, N, 'forest', RELIEF_SEED));
    const oaks = out.filter((e) => e.kind === 'english-oak');
    expect(oaks.length).toBeGreaterThan(0);
    for (const o of oaks) {
      expect(heightM(Math.floor(o.x), Math.floor(o.y))).toBeLessThan(15);
    }
    // The hardy pioneer birch (ceiling 19 m) reaches above the oak's ceiling.
    const birchMax = Math.max(...out.filter((e) => e.kind === 'silver-birch')
      .map((e) => heightM(Math.floor(e.x), Math.floor(e.y))), -1);
    expect(birchMax).toBeGreaterThan(15);
  });

  it('above the treeline the alpine brush still populates — shrubs, tussock and rock', () => {
    // The hills brush carries NO altitude band: its pool grows at any altitude, which is
    // what keeps the ground above the treeline populated instead of bare.
    const out = hillsBrush({ x: 0, y: 0, w: 40, h: 40 }, 3, fill(40, 40, 'mountain', RELIEF_SEED));
    const kinds = new Set(out.map((e) => e.kind));
    expect(kinds.has('tussock-grass')).toBe(true);
    expect([...kinds].some((k) => k === 'boulder' || k === 'rock_pile' || k === 'pebbles')).toBe(true);
    expect([...kinds].some((k) => k === 'heather' || k === 'common-juniper' || k === 'gorse')).toBe(true);
  });
});

describe('alpine scatter — the lattice is dead', () => {
  const out = hillsBrush({ x: 0, y: 0, w: 48, h: 48 }, 3, fill(48, 48, 'mountain'));

  it('scatters at real intra-tile offsets, not all at the tile centre (x+0.5)', () => {
    const rocks = out.filter((e) => e.kind === 'boulder' || e.kind === 'rock_pile' || e.kind === 'pebbles');
    expect(rocks.length).toBeGreaterThan(20);
    const atCentre = rocks.filter((e) => Math.abs((e.x - Math.floor(e.x)) - 0.5) < 1e-6).length;
    expect(atCentre / rocks.length).toBeLessThan(0.1);   // was 100% on the old noise() path
    // Fractional parts spread across the cell rather than piling on one value.
    const buckets = new Set(rocks.map((e) => Math.floor((e.x - Math.floor(e.x)) * 5)));
    expect(buckets.size).toBeGreaterThanOrEqual(4);
  });

  it('is far denser than the old ≤27%-of-cells single-entity scatter', () => {
    const cells = 48 * 48;
    // Old path: at most ONE entity per cell, gated to fire on ~27% of them (and in
    // practice far fewer — the correlated noise() gate). New path clears 1 per cell on
    // average, i.e. >4× the old ceiling and >5× its real rate. (The whole-world alpine
    // total measures 7–8× on the probe seeds; see WCV 97.)
    expect(out.length / cells).toBeGreaterThan(1.1);
  });

  it('is deterministic', () => {
    const c = fill(16, 16, 'mountain');
    const r = { x: 0, y: 0, w: 16, h: 16 };
    expect(hillsBrush(r, 42, c)).toEqual(hillsBrush(r, 42, c));
  });
});

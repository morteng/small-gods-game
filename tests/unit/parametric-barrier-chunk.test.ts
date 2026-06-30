import { describe, it, expect } from 'vitest';
import { chunkBarrierRun, runElements } from '@/render/parametric-barrier-source';
import { BARRIER_DEFAULTS, type BarrierRun } from '@/world/barrier';

const wall = (path: [number, number][], gates = [] as { t: number; width: number }[]): BarrierRun =>
  ({ kind: 'wall', path, ...BARRIER_DEFAULTS.wall, gates });

const RING: [number, number][] = [[0, 0], [14, 0], [14, 10], [0, 10], [0, 0]];
const crenStoneRing = (gates = [] as { t: number; width: number }[]): BarrierRun =>
  ({ kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone', crenellated: true, gates });

describe('chunkBarrierRun', () => {
  it('splits a straight run into ≤4-tile chunks that cover the whole length', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [12, 0]]));
    expect(chunks.length).toBe(3);                       // 12 / 4
    // First chunk starts at the run origin; chunks march along +x by CHUNK_TILES.
    expect(chunks[0].refX).toBe(0);
    expect(chunks[1].refX).toBeCloseTo(4);
    expect(chunks[2].refX).toBeCloseTo(8);
    // Each localised chunk runs from its own origin along +x for its length.
    expect(chunks[0].localRun.path[0]).toEqual([0, 0]);
    expect(chunks[0].localRun.path[1][0]).toBeCloseTo(4);
  });

  it('identical straight chunks share ONE cache key (so a long wall reuses one sprite)', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [16, 0]]));
    const full = chunks.filter((c) => Math.hypot(c.localRun.path[1][0], c.localRun.path[1][1]) > 3.9);
    expect(full.length).toBeGreaterThanOrEqual(3);
    expect(new Set(full.map((c) => c.key)).size).toBe(1);   // all full 4-tile chunks → same key
  });

  it('breaks chunks at polyline vertices (a corner is never inside one chunk)', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [4, 0], [4, 4]]));
    // Two perpendicular legs → no chunk spans both; each chunk is axis-aligned.
    for (const c of chunks) {
      const [dx, dy] = c.localRun.path[1];
      expect(Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6).toBe(true);
    }
  });

  it('rebases a gate onto the chunk it falls in (chunk-local distance)', () => {
    const chunks = chunkBarrierRun(wall([[0, 0], [12, 0]], [{ t: 6, width: 2 }]));
    const gated = chunks.filter((c) => c.localRun.gates.length > 0);
    expect(gated.length).toBeGreaterThan(0);
    // The gate at run-distance 6 lands in the chunk starting at 4 → local t ≈ 2.
    const g = gated[0].localRun.gates[0];
    expect(g.t).toBeGreaterThanOrEqual(0);
    expect(g.t).toBeLessThanOrEqual(4);
    expect(g.width).toBeCloseTo(2);
  });

  it('a degenerate run (one point) yields no chunks', () => {
    expect(chunkBarrierRun(wall([[3, 3]]))).toHaveLength(0);
  });

  it('a crenellated stone ring adds a flanking tower at every corner', () => {
    const chunks = chunkBarrierRun(crenStoneRing()).length;
    const elements = runElements(crenStoneRing()).length;
    // 4 rectangular corners → 4 extra tower elements over the curtain chunks.
    expect(elements).toBe(chunks + 4);
  });

  it('a gate adds a gatehouse (two flanking towers) + a timber gate leaf', () => {
    const ungated = runElements(crenStoneRing()).length;
    const gatedEls = runElements(crenStoneRing([{ t: 7, width: 3 }]));
    expect(gatedEls.length).toBe(ungated + 3);                                // 2 towers + 1 leaf
    expect(gatedEls.filter((e) => e.key.startsWith('gate:'))).toHaveLength(1);
  });

  it('a palisade gate gets a timber gate leaf but NO masonry towers', () => {
    const palisade = (gates = [] as { t: number; width: number }[]): BarrierRun =>
      ({ kind: 'palisade', path: [[0, 0], [10, 0]], ...BARRIER_DEFAULTS.palisade, gates });
    const els = runElements(palisade([{ t: 5, width: 3 }]));
    expect(els.filter((e) => e.key.startsWith('gate:'))).toHaveLength(1);     // closing gate
    expect(els.filter((e) => e.key.startsWith('tower:'))).toHaveLength(0);    // timber: no drums
  });

  it('a fence / hedge gate gets NO gate leaf (only defensive runs close)', () => {
    const fence: BarrierRun = { kind: 'fence', path: [[0, 0], [8, 0]], ...BARRIER_DEFAULTS.fence, gates: [{ t: 4, width: 2 }] };
    expect(runElements(fence).filter((e) => e.key.startsWith('gate:'))).toHaveLength(0);
  });

  it('corner towers are ROUND drums; gate towers are SQUARE (distinct cached geometry)', () => {
    const keys = runElements(crenStoneRing([{ t: 7, width: 3 }])).map((e) => e.key);
    expect(keys.some((k) => k.startsWith('tower:round:'))).toBe(true);   // 4 corner drums
    expect(keys.some((k) => k.startsWith('tower:gate:'))).toBe(true);    // 2 gatehouse towers
    // The two kinds compose separately (one cache entry each), not as one shared tower.
    expect(new Set(keys.filter((k) => k.startsWith('tower:'))).size).toBe(2);
  });

  it('non-masonry / uncrenellated runs get NO towers (curtain chunks only)', () => {
    const hedge: BarrierRun = { kind: 'hedge', path: RING, ...BARRIER_DEFAULTS.hedge, gates: [] };
    expect(runElements(hedge).length).toBe(chunkBarrierRun(hedge).length);
    const plainStone: BarrierRun = { kind: 'wall', path: RING, height: 1.3, thickness: 1, material: 'stone', crenellated: false, gates: [] };
    expect(runElements(plainStone).length).toBe(chunkBarrierRun(plainStone).length);
  });
});

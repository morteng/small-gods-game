import { describe, it, expect } from 'vitest';
import {
  buildRockPadDeformations, collectRockPads, padWorthyRock,
  rockPadDepthM, rockPadRadiusTiles, ROCK_PAD_MIN_SIZE_M, ROCK_PAD_STRIDE,
} from '@/world/rock-deformation';
import { DeformationStore, heightAt, baseHeightAt } from '@/world/terrain-deformation';
import type { GameMap, Entity, Tile } from '@/core/types';

/** A minimal real-ish map: `heightMetresAt` reads the seed heightfield off (seed, dims). */
function testMap(over: Partial<GameMap> = {}): GameMap {
  const width = 24, height = 24;
  const tiles: Tile[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ type: 'hills', walkable: true } as Tile)));
  return {
    tiles, width, height, villages: [], seed: 4242, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    ...over,
  } as GameMap;
}

const rock = (kind: string, x: number, y: number, scale: number): Entity => ({
  id: `hills-${kind}-${Math.floor(x)}-${Math.floor(y)}`,
  kind, x, y, properties: { scale }, tags: [],
});

describe('rock settle pads — the pad-worthy gate', () => {
  it('a big alpine rock earns a pad; a pebble and a cobble do not', () => {
    // boulder 1.2 m nominal → scale 1.0 is 1.2 m ≥ the 1 m gate.
    expect(padWorthyRock(rock('boulder', 5.5, 5.5, 1.0))).toBe(true);
    // …but a runt boulder at the bottom of the scale range is below it.
    expect(padWorthyRock(rock('boulder', 5.5, 5.5, 0.7))).toBe(false);
    // standing_stone 3 m — always.
    expect(padWorthyRock(rock('standing_stone', 5.5, 5.5, 0.7))).toBe(true);
    // rock_pile 0.7 m and pebbles 0.2 m never reach 1 m, even at max scale.
    expect(padWorthyRock(rock('rock_pile', 5.5, 5.5, 1.2))).toBe(false);
    expect(padWorthyRock(rock('pebbles', 5.5, 5.5, 1.2))).toBe(false);
    // a tree is not a rock, whatever its size
    expect(padWorthyRock(rock('english-oak', 5.5, 5.5, 1.2))).toBe(false);
  });

  it('a bigger rock dishes DEEPER and WIDER (size-scaled settling)', () => {
    expect(rockPadDepthM(3.0)).toBeGreaterThan(rockPadDepthM(1.2));
    expect(rockPadRadiusTiles(3.0)).toBeGreaterThan(rockPadRadiusTiles(1.2));
    // and the gate's own size is the floor of the pad population
    expect(rockPadDepthM(ROCK_PAD_MIN_SIZE_M)).toBeGreaterThan(0);
  });
});

describe('rock settle pads — determinism (pads are a PURE function of the map)', () => {
  const pads = collectRockPads([
    rock('boulder', 5.5, 6.25, 1.0),
    rock('pebbles', 7.5, 7.5, 1.2),          // dropped: too small
    rock('standing_stone', 11.5, 12.5, 1.0),
  ]);

  it('the declaration is flat (x, y, sizeM) triples for the pad-worthy rocks only', () => {
    expect(pads).toHaveLength(2 * ROCK_PAD_STRIDE);
    expect(pads.slice(0, 3)).toEqual([5.5, 6.25, 1.2]);   // boulder: 1.2 m × scale 1
    expect(pads.slice(3, 6)).toEqual([11.5, 12.5, 3.0]);  // menhir
  });

  it('re-deriving twice from the same map gives IDENTICAL deformations', () => {
    const map = testMap({ rockPads: pads });
    const a = buildRockPadDeformations(map);
    const b = buildRockPadDeformations(map);
    expect(a).toHaveLength(2);
    const shape = (d: typeof a) => d.map((x) => ({
      id: x.id, op: x.op, priority: x.priority, target: x.target, bounds: x.bounds,
    }));
    expect(shape(a)).toEqual(shape(b));
  });

  it('survives a save/load round-trip: pads re-derive identically from the cloned map', () => {
    const map = testMap({ rockPads: pads });
    const before = buildRockPadDeformations(map);
    // SaveFile.map rides `structuredClone(map)` — the same trip roadGraph/barrierRuns take.
    const loaded = testMap({ rockPads: structuredClone(map.rockPads) });
    const after = buildRockPadDeformations(loaded);
    expect(after.map((d) => [d.id, d.target, d.priority]))
      .toEqual(before.map((d) => [d.id, d.target, d.priority]));
  });

  it('a map that declares NO pads (test stub, studio ground, pre-98 save) gets none', () => {
    expect(buildRockPadDeformations(testMap())).toEqual([]);
    expect(buildRockPadDeformations(testMap({ rockPads: pads, flatHeight: true }))).toEqual([]);
  });
});

describe('rock settle pads — the ground actually dishes', () => {
  it('the composed ground under a big rock sits BELOW the untouched ground beside it', () => {
    const map = testMap({ rockPads: collectRockPads([rock('standing_stone', 12.5, 12.5, 1.0)]) });
    const defs = buildRockPadDeformations(map);
    expect(defs).toHaveLength(1);
    const store = new DeformationStore();
    store.add(...defs);
    const under = heightAt(map, store, 12.5, 12.5);
    const away = heightAt(map, store, 20.5, 20.5);   // well outside the pad + feather
    // The pad levels the ground to (base − depth): pushed INTO the ground, not onto it.
    expect(under).toBeLessThan(baseHeightAt(map, 12.5, 12.5));
    expect(under).toBeCloseTo(defs[0].target!, 5);
    expect(baseHeightAt(map, 12.5, 12.5) - under).toBeCloseTo(rockPadDepthM(3.0), 5);
    // and the deformation is BOUNDED: far away the terrain is untouched.
    expect(away).toBeCloseTo(baseHeightAt(map, 20.5, 20.5), 5);
  });
});

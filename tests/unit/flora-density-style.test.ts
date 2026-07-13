// The floraDensity world-style dial (WCV 95): `World.applyBrush` resolves the
// map's world style into `BrushContext.style`, and `placeVegetation` scales its
// authored base density (and open-ground undergrowth share, capped ≤1) by
// `style.floraDensity`. A missing style = ×1 = the historic behaviour.
import { describe, it, expect } from 'vitest';
import { placeVegetation, type VegetationParams } from '@/world/brushes/vegetation-placer';
import { registerBrush } from '@/world/brushes';
import '@/world/brushes/grassland'; // registers the 'grassland' brush
import { World } from '@/world/world';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import { STYLE_DEFAULTS, resolveWorldStyle } from '@/core/world-style';
import type { BrushContext, GameMap, Tile, WorldSeed } from '@/core/types';

function grassMap(w: number, h: number, floraDensity?: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const worldSeed = floraDensity === undefined
    ? null
    : ({ style: { overrides: { floraDensity } } } as unknown as WorldSeed);
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function ctxWith(map: GameMap, floraDensity?: number): BrushContext {
  return {
    ...EMPTY_CONTEXT,
    tiles: map,
    style: floraDensity === undefined ? undefined : { ...STYLE_DEFAULTS, floraDensity },
  };
}

const PARAMS: VegetationParams = {
  brush: 'test_flora',
  tileType: 'grass',
  kinds: [['tussock-grass', 1]],
  density: 0.2,
  scaleRange: [0.8, 1.2],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
};

const REGION = { x: 0, y: 0, w: 40, h: 40 };
const SEED = 42;

describe('placeVegetation × floraDensity', () => {
  it('floraDensity 2 roughly doubles placement on a fixed seed/region', () => {
    const map = grassMap(40, 40);
    const base = placeVegetation(REGION, SEED, ctxWith(map), PARAMS).length;
    const doubled = placeVegetation(REGION, SEED, ctxWith(map, 2), PARAMS).length;
    expect(base).toBeGreaterThan(100); // sanity: the field is actually populated
    const ratio = doubled / base;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.3);
  });

  it('an absent style and floraDensity 1 both reproduce the historic output exactly', () => {
    const map = grassMap(24, 24);
    const r = { x: 0, y: 0, w: 24, h: 24 };
    const none = placeVegetation(r, SEED, ctxWith(map), PARAMS);
    const one = placeVegetation(r, SEED, ctxWith(map, 1), PARAMS);
    expect(one).toEqual(none);
  });

  it('is deterministic under a style — same inputs, equal output', () => {
    const map = grassMap(24, 24);
    const r = { x: 0, y: 0, w: 24, h: 24 };
    expect(placeVegetation(r, SEED, ctxWith(map, 1.5), PARAMS))
      .toEqual(placeVegetation(r, SEED, ctxWith(map, 1.5), PARAMS));
  });

  it('caps the scaled openUndergrowth share at 1 (a probability, not a multiplier)', () => {
    // No canopy (density 0) → every cell uses the open-ground share. With
    // openUndergrowth 0.5, any floraDensity ≥ 2 saturates the cap, so 2 and 4
    // must place identically.
    const map = grassMap(24, 24);
    const r = { x: 0, y: 0, w: 24, h: 24 };
    const params: VegetationParams = {
      ...PARAMS, density: 0, undergrowth: [['bracken', 1, 0.3]], openUndergrowth: 0.5,
    };
    const atTwo = placeVegetation(r, SEED, ctxWith(map, 2), params);
    const atFour = placeVegetation(r, SEED, ctxWith(map, 4), params);
    expect(atTwo.length).toBeGreaterThan(0);
    expect(atFour).toEqual(atTwo);
  });
});

describe('World.applyBrush → BrushContext.style plumbing', () => {
  it('passes the resolved worldSeed style to the brush', () => {
    let seen: BrushContext['style'];
    registerBrush('__style_probe', (_r, _s, ctx) => { seen = ctx.style; return []; });
    const world = new World(grassMap(4, 4, 1.2));
    world.applyBrush('__style_probe', { x: 0, y: 0, w: 4, h: 4 }, 1);
    expect(seen).toBeDefined();
    expect(seen!.floraDensity).toBe(1.2);
    // The rest of the record resolves through the normal preset/override chain.
    expect(seen).toEqual(resolveWorldStyle({ overrides: { floraDensity: 1.2 } }));
  });

  it('a map with no worldSeed resolves to neutral defaults (floraDensity 1)', () => {
    let seen: BrushContext['style'];
    registerBrush('__style_probe_default', (_r, _s, ctx) => { seen = ctx.style; return []; });
    const world = new World(grassMap(4, 4));
    world.applyBrush('__style_probe_default', { x: 0, y: 0, w: 4, h: 4 }, 1);
    expect(seen?.floraDensity).toBe(1);
  });

  it('end-to-end: the grassland brush places more under floraDensity 2 than 1', () => {
    const dense = new World(grassMap(40, 40, 2));
    const sparse = new World(grassMap(40, 40, 1));
    const region = { x: 0, y: 0, w: 40, h: 40 };
    const denseIds = dense.applyBrush('grassland', region, SEED);
    const sparseIds = sparse.applyBrush('grassland', region, SEED);
    expect(sparseIds.length).toBeGreaterThan(0);
    expect(denseIds.length).toBeGreaterThan(sparseIds.length * 1.5);
  });
});

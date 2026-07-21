// T4 (flora-into-ground): a per-cell flora coloration wash accumulated during
// vegetation placement (`vegetation-placer.ts`/`vegetation-fill.ts`) and blended
// into the ground colour field (`terrain-field.ts packColorField`), so a meadow's
// flower/foliage hue survives once grass billboards / analytic ground detail
// recede at zoom-out or a lower-res `px` tier (both of which fade via screen-space
// `fwidth`, which the colour field never samples).
//
// Covers: deterministic accumulation, biome-dominant blend math (small vs
// saturated weight), memo-key invalidation on tint presence, a tint-absent world
// staying byte-identical to pre-T4, and a rock-only/floraless placement being a
// true no-op (never allocates the field).
import { describe, it, expect } from 'vitest';
import {
  accumulateFloraTint, speciesTintRgb, placeVegetation, type VegetationParams,
} from '@/world/brushes/vegetation-placer';
import { fillBareGround } from '@/world/vegetation-fill';
import { World } from '@/world/world';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import { packColorField, packColorFieldMemo, hexToAbgr } from '@/render/gpu/terrain-field';
import { TILE_COLORS } from '@/core/constants';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function grassMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    flatHeight: true, // dead-flat ground: no slope/altitude gates in play, only the tint math
  };
}

function ctxWith(map: GameMap): BrushContext {
  return { ...EMPTY_CONTEXT, tiles: map };
}

/** Decode the packed ABGR the shader consumes back to [r,g,b] (see `hexToAbgr`). */
function rgbOf(c: number): [number, number, number] {
  return [c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff];
}

const GRASS_RGB = (() => {
  const n = parseInt(TILE_COLORS.grass.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] as [number, number, number];
})();

describe('speciesTintRgb', () => {
  it('uses the authored petalTint verbatim for a flower species', () => {
    // 0xC43C2C — scarlet corn-poppy bloom (flora-facts-data.ts).
    expect(speciesTintRgb('common-poppy')).toEqual([0xc4, 0x3c, 0x2c]);
  });

  it('white ray florets for oxeye-daisy (a distinct authored petalTint)', () => {
    expect(speciesTintRgb('oxeye-daisy')).toEqual([0xea, 0xe8, 0xde]);
  });

  it('differentiates a conifer, a grass and a species with no petalTint (not one flat green)', () => {
    const pine = speciesTintRgb('scots-pine');   // needle/evergreen → dark conifer fallback
    const grass = speciesTintRgb('tussock-grass'); // habit grass → pale sward fallback
    expect(pine).not.toBeNull();
    expect(grass).not.toBeNull();
    expect(pine).not.toEqual(grass);
    // The conifer fallback should read darker overall than the grass fallback.
    const luminance = (rgb: [number, number, number]) => rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    expect(luminance(pine!)).toBeLessThan(luminance(grass!));
  });

  it('returns null for a rock species (loose stone contributes no living-cover tint)', () => {
    expect(speciesTintRgb('granite-boulder')).toBeNull();
  });

  it('returns null for an unknown/non-flora kind', () => {
    expect(speciesTintRgb('not-a-real-species')).toBeNull();
  });
});

describe('accumulateFloraTint', () => {
  it('is deterministic: identical calls on fresh maps produce identical buffers', () => {
    const mapA = grassMap(4, 4);
    const mapB = grassMap(4, 4);
    accumulateFloraTint(mapA, 1.3, 2.2, 'common-poppy', 1);
    accumulateFloraTint(mapA, 1.3, 2.2, 'oxeye-daisy', 0.5);
    accumulateFloraTint(mapB, 1.3, 2.2, 'common-poppy', 1);
    accumulateFloraTint(mapB, 1.3, 2.2, 'oxeye-daisy', 0.5);
    expect(Array.from(mapA.floraTint!.sumR)).toEqual(Array.from(mapB.floraTint!.sumR));
    expect(Array.from(mapA.floraTint!.sumG)).toEqual(Array.from(mapB.floraTint!.sumG));
    expect(Array.from(mapA.floraTint!.sumB)).toEqual(Array.from(mapB.floraTint!.sumB));
    expect(Array.from(mapA.floraTint!.weight)).toEqual(Array.from(mapB.floraTint!.weight));
  });

  it('accumulates multiple contributions into the same cell (sums, not overwrites)', () => {
    const map = grassMap(2, 2);
    accumulateFloraTint(map, 0.2, 0.2, 'common-poppy', 1);
    accumulateFloraTint(map, 0.4, 0.4, 'common-poppy', 1);
    const idx = 0; // both land in cell (0,0)
    expect(map.floraTint!.weight[idx]).toBeCloseTo(2, 6);
    expect(map.floraTint!.sumR[idx]).toBeCloseTo(0xc4 * 2, 6);
  });

  it('never allocates the field for a rock/unknown kind or a non-positive weight', () => {
    const map = grassMap(2, 2);
    accumulateFloraTint(map, 0.5, 0.5, 'granite-boulder', 1);
    accumulateFloraTint(map, 0.5, 0.5, 'not-a-real-species', 1);
    accumulateFloraTint(map, 0.5, 0.5, 'common-poppy', 0);
    accumulateFloraTint(map, 0.5, 0.5, 'common-poppy', -1);
    expect(map.floraTint).toBeUndefined();
  });

  it('ignores an out-of-bounds cell without throwing', () => {
    const map = grassMap(2, 2);
    expect(() => accumulateFloraTint(map, -5, -5, 'common-poppy', 1)).not.toThrow();
    expect(() => accumulateFloraTint(map, 50, 50, 'common-poppy', 1)).not.toThrow();
  });
});

describe('packColorField — flora tint blend', () => {
  it('is byte-identical to the pre-T4 path when floraTint is absent', () => {
    const map = grassMap(3, 3);
    const withoutField = packColorField(map);
    const plain = packColorField(grassMap(3, 3));
    expect(Array.from(withoutField)).toEqual(Array.from(plain));
    for (const c of withoutField) expect(c).toBe(hexToAbgr(TILE_COLORS.grass));
  });

  it('leaves zero-weight cells untouched even when the field exists (some OTHER cell tinted)', () => {
    const map = grassMap(3, 1);
    accumulateFloraTint(map, 2.5, 0.5, 'common-poppy', 3); // only cell (2,0)
    const colors = packColorField(map);
    expect(colors[0]).toBe(hexToAbgr(TILE_COLORS.grass));
    expect(colors[1]).toBe(hexToAbgr(TILE_COLORS.grass));
    expect(colors[2]).not.toBe(hexToAbgr(TILE_COLORS.grass));
  });

  it('biome stays hue authority: a heavily-flowered cell shifts only PARTWAY toward the bloom colour', () => {
    const map = grassMap(1, 1);
    accumulateFloraTint(map, 0.5, 0.5, 'common-poppy', 10); // saturate the blend cap
    const colors = packColorField(map);
    const [r, g, b] = rgbOf(colors[0]);
    const poppy = speciesTintRgb('common-poppy')!;
    // Moved toward the poppy (R up, G/B down from grass) …
    expect(r).toBeGreaterThan(GRASS_RGB[0]);
    expect(g).toBeLessThan(GRASS_RGB[1]);
    expect(b).toBeLessThan(GRASS_RGB[2]);
    // … but nowhere near a full repaint (biome dominance).
    expect(r).toBeLessThan(poppy[0]);
    expect(g).toBeGreaterThan(poppy[1]);
    expect(b).toBeGreaterThan(poppy[2]);
    // Alpha stays opaque.
    expect((colors[0] >>> 24) & 0xff).toBe(0xff);
  });

  it('is density-proportional: a lightly-covered cell washes less than a saturated one', () => {
    const light = grassMap(1, 1);
    const heavy = grassMap(1, 1);
    accumulateFloraTint(light, 0.5, 0.5, 'common-poppy', 0.05); // a single tiny tuft
    accumulateFloraTint(heavy, 0.5, 0.5, 'common-poppy', 10);   // saturated
    const [rl] = rgbOf(packColorField(light)[0]);
    const [rh] = rgbOf(packColorField(heavy)[0]);
    const deltaLight = rl - GRASS_RGB[0];
    const deltaHeavy = rh - GRASS_RGB[0];
    expect(deltaLight).toBeGreaterThan(0);       // some wash …
    expect(deltaLight).toBeLessThan(deltaHeavy); // … but far less than the saturated cell
  });
});

describe('packColorFieldMemo — tint presence invalidation', () => {
  it('a tint-absent world memoizes the SAME reference across repeated calls', () => {
    const map = grassMap(4, 4);
    const a = packColorFieldMemo(map);
    const b = packColorFieldMemo(map);
    expect(a).toBe(b);
  });

  it('gaining a floraTint field invalidates the memo even with tilesRev unchanged', () => {
    const map = grassMap(4, 4);
    const before = packColorFieldMemo(map);
    accumulateFloraTint(map, 1.5, 1.5, 'common-poppy', 10);
    const after = packColorFieldMemo(map);
    expect(after).not.toBe(before);            // recomputed, not served stale
    expect(Array.from(after)).not.toEqual(Array.from(before)); // and content actually differs
    // A further call with nothing changed re-memoizes (same reference again).
    const again = packColorFieldMemo(map);
    expect(again).toBe(after);
  });
});

describe('no-op on a floraless / rock-only placement', () => {
  const ROCK_PARAMS: VegetationParams = {
    brush: 'test_rock', tileType: 'grass', kinds: [['granite-boulder', 1]],
    density: 0.9, scaleRange: [0.8, 1.2], rotationRange: 0, offsetRange: [0.5, 0.5],
  };

  it('placeVegetation with an all-rock kind pool never allocates map.floraTint', () => {
    const map = grassMap(10, 10);
    const region = { x: 0, y: 0, w: 10, h: 10 };
    const placed = placeVegetation(region, 7, ctxWith(map), ROCK_PARAMS);
    expect(placed.length).toBeGreaterThan(0); // sanity: rocks DID place
    expect(map.floraTint).toBeUndefined();
  });

  it('fillBareGround on a world with no open ground places nothing and leaves floraTint absent', () => {
    const tiles: Tile[][] = [[{ type: 'water', x: 0, y: 0, walkable: false, state: 'realized' }]];
    const map: GameMap = {
      tiles, width: 1, height: 1, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], flatHeight: true,
    };
    const world = new World(map);
    const placed = fillBareGround(world, map, 1);
    expect(placed).toBe(0);
    expect(map.floraTint).toBeUndefined();
  });

  it('fillBareGround on open grass DOES bake a floraTint (real-world integration of the seam)', () => {
    const map = grassMap(24, 24);
    const world = new World(map);
    const placed = fillBareGround(world, map, 99);
    expect(placed).toBeGreaterThan(0);
    expect(map.floraTint).toBeDefined();
    let anyWeight = false;
    for (const w of map.floraTint!.weight) if (w > 0) { anyWeight = true; break; }
    expect(anyWeight).toBe(true);
  });
});

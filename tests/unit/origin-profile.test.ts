// tests/unit/origin-profile.test.ts
// The pure, deterministic per-run origin picker (src/game/origin-profile.ts) —
// the "New Game" opening variety slice. Driven by tiny synthetic maps + POI so
// the terrain-flavor classification and the seed-variety are tested without a
// full worldgen. No golden pins; no ART_RECIPE_VERSION / WORLD_CONTENT_VERSION.
import { describe, it, expect } from 'vitest';
import {
  originProfileFor,
  FOUNDING_MIND_NAMES,
  type OriginProfile,
} from '@/game/origin-profile';
import type { GameMap, WorldSeed, POI } from '@/core/types';

/** A minimal-but-real GameMap-shaped object (originProfileFor only reads
 *  tiles/width/height/seed). `fill` is every tile's type; `patch` stamps a disc
 *  of `patchType` around the cradle so the scanner resolves it. */
function makeMap(seed: number, fill: string, patch?: { cx: number; cy: number; r: number; type: string }): GameMap {
  const width = 12;
  const height = 12;
  const tiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      type: fill, x, y, walkable: true, state: 'realized' as const,
    })),
  );
  if (patch) {
    for (let dy = -patch.r; dy <= patch.r; dy++) {
      for (let dx = -patch.r; dx <= patch.r; dx++) {
        const x = patch.cx + dx;
        const y = patch.cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        tiles[y][x].type = patch.type;
      }
    }
  }
  return {
    tiles, width, height, seed, success: true, worldSeed: null,
    villages: [], buildings: [], stats: { iterations: 1, backtracks: 0 },
  } as unknown as GameMap;
}

function makeSeed(poi?: POI): WorldSeed {
  return {
    name: 'Testworld',
    size: { width: 12, height: 12 },
    biome: 'temperate_grassland',
    pois: poi ? [poi] : [],
    connections: [],
    constraints: [],
  };
}

const CRADLE: POI = {
  id: 'p0',
  type: 'village',
  position: { x: 6, y: 6 },
  npcs: [{ name: 'Tola', role: 'farmer' }],
} as unknown as POI;

/** A full-size 'water' disc around the cradle → the flavor must resolve to water. */
function waterMap(): GameMap {
  return makeMap(7, 'grass', { cx: 6, cy: 6, r: 2, type: 'river' });
}

describe('originProfileFor — determinism & terrain correctness', () => {
  it('returns an identical profile for the same (map, worldSeed) on every call', () => {
    const map = waterMap();
    const ws = makeSeed(CRADLE);
    const a = originProfileFor(map, ws);
    const b = originProfileFor(map, ws);
    expect(a).toEqual(b);
  });

  it('classifies a water cradle as the water origin', () => {
    const p = originProfileFor(waterMap(), makeSeed(CRADLE));
    expect(p.flavor).toBe('water');
    expect(p.place).toMatch(/water|stream|river/i);
  });

  it('classifies a forest cradle as the forest origin', () => {
    const map = makeMap(7, 'grass', { cx: 6, cy: 6, r: 2, type: 'dense_forest' });
    expect(originProfileFor(map, makeSeed(CRADLE)).flavor).toBe('forest');
  });

  it('classifies a swamp cradle as the bog origin', () => {
    const map = makeMap(7, 'grass', { cx: 6, cy: 6, r: 2, type: 'swamp' });
    expect(originProfileFor(map, makeSeed(CRADLE)).flavor).toBe('bog');
  });

  it('classifies a sand/dirt cradle as the dry origin', () => {
    const map = makeMap(7, 'grass', { cx: 6, cy: 6, r: 2, type: 'sand' });
    expect(originProfileFor(map, makeSeed(CRADLE)).flavor).toBe('dry');
  });

  it('a genome with NO inhabited/positioned POI still yields a deterministic meadow origin, no throw', () => {
    const p = originProfileFor(makeMap(1, 'grass'), makeSeed());
    // Flavor falls back to the open-land meadow; the profile is still seeded
    // (first mind + locative come from the substrate), and always safe.
    expect(p.flavor).toBe('meadow');
    expect(FOUNDING_MIND_NAMES).toContain(p.firstMind);
    expect(p.place).toMatch(/grass|meadow|hills/i);
    expect(originProfileFor(makeMap(1, 'grass'), makeSeed())).toEqual(p);
  });
});

describe('originProfileFor — seeded variety', () => {
  it('every first mind is one of the named founding band', () => {
    for (let seed = 0; seed < 10; seed++) {
      const p: OriginProfile = originProfileFor(makeMap(seed, 'grass'), makeSeed(CRADLE));
      expect(FOUNDING_MIND_NAMES).toContain(p.firstMind);
    }
  });

  it('produces DIFFERENT openings across different substrate seeds', () => {
    // Deterministic variety: across a spread of seeds there must be more than one
    // distinct (flavor/variant/first-mind) opening — the point of the feature.
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      seen.add(JSON.stringify(originProfileFor(makeMap(seed, 'grass'), makeSeed(CRADLE))));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps the SAME seed identical regardless of call order (replay-safe)', () => {
    const ws = makeSeed(CRADLE);
    // Interleave two different worlds — each must produce its own stable profile.
    const a1 = originProfileFor(makeMap(9, 'grass'), ws);
    const b1 = originProfileFor(makeMap(42, 'grass'), ws);
    const a2 = originProfileFor(makeMap(9, 'grass'), ws);
    const b2 = originProfileFor(makeMap(42, 'grass'), ws);
    expect(a1).toEqual(a2);
    expect(b1).toEqual(b2);
  });
});

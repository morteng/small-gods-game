// tests/unit/clutter-flora-art-source.test.ts — ground flora (habit herb/grass/
// fern) renders as clutter-atlas billboards, never through the parametric
// manifold-compose path; trees/shrubs/rocks stay parametric.
import { describe, it, expect } from 'vitest';
import { ClutterFloraArtSource, clutterCategoryFor, type ClutterAtlas } from '@/render/clutter-flora-art-source';
import { isClutterFloraKind } from '@/flora/flora-registry';
import { isPlantPreset, plantPresetNames } from '@/blueprint/presets';
import { buildRenderContext } from '@/game/render-context';
import { createState } from '@/core/state';
import { AssetManager } from '@/render/asset-manager';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { createDevMode } from '@/dev/DevMode';
import type { ArtResolver } from '@/render/art-resolver';
import type { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { ClutterManifest } from '@/render/gpu/grass-scatter';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';

/** The full ground-flora set (habit herb/grass/fern in the flora DB). */
const GROUND_SPECIES = [
  'foxglove', 'common-poppy', 'oxeye-daisy', 'cotton-thistle', 'bulrush',
  'tussock-grass', 'esparto-grass', 'marram-grass', 'common-reed',
  'carex-sedge', 'bracken', 'lady-fern',
];

const fakeManifest: ClutterManifest = {
  cell: 64, cols: 6, rows: 25, count: 150,
  ranges: {
    grass: { start: 0, count: 17 }, flower: { start: 17, count: 33 },
    reed: { start: 50, count: 16 }, rock: { start: 66, count: 41 },
    seaweed: { start: 107, count: 13 }, wrack: { start: 120, count: 16 },
    lilypad: { start: 136, count: 14 },
  },
  cats: [],
};

const fakeAtlas = (): ClutterAtlas => ({
  image: {} as CanvasImageSource,
  manifest: fakeManifest,
});

describe('isClutterFloraKind', () => {
  it('is true for every ground species, false for tree/shrub/rock kinds', () => {
    for (const k of GROUND_SPECIES) expect(isClutterFloraKind(k), k).toBe(true);
    for (const k of ['english-oak', 'scots-pine', 'hawthorn', 'common-gorse', 'granite-boulder', 'boulder', 'cottage', 'nope']) {
      expect(isClutterFloraKind(k), k).toBe(false);
    }
  });
});

describe('clutterCategoryFor', () => {
  it('maps herbs to flower, grasses/ferns to grass, reed-reading species to reed', () => {
    expect(clutterCategoryFor('foxglove')).toBe('flower');
    expect(clutterCategoryFor('common-poppy')).toBe('flower');
    expect(clutterCategoryFor('oxeye-daisy')).toBe('flower');
    expect(clutterCategoryFor('cotton-thistle')).toBe('flower');
    expect(clutterCategoryFor('tussock-grass')).toBe('grass');
    expect(clutterCategoryFor('esparto-grass')).toBe('grass');
    expect(clutterCategoryFor('marram-grass')).toBe('grass');
    expect(clutterCategoryFor('bracken')).toBe('grass');
    expect(clutterCategoryFor('lady-fern')).toBe('grass');
    expect(clutterCategoryFor('common-reed')).toBe('reed');
    expect(clutterCategoryFor('bulrush')).toBe('reed');
    expect(clutterCategoryFor('carex-sedge')).toBe('reed');
    expect(clutterCategoryFor('english-oak')).toBeNull();
    expect(clutterCategoryFor('granite-boulder')).toBeNull();
  });
});

describe('plantPresetNames vs isPlantPreset (prewarm/compose set narrowing)', () => {
  it('excludes ground species from the compose/prewarm set', () => {
    const names = new Set(plantPresetNames());
    for (const k of GROUND_SPECIES) expect(names.has(k), k).toBe(false);
    // Trees and rocks stay composed (rock exclusion regressed once — keep pinned).
    expect(names.has('english-oak')).toBe(true);
    expect(names.has('granite-boulder')).toBe(true);
  });

  it('ground species remain plant presets (draw-list gate keeps routing them)', () => {
    for (const k of GROUND_SPECIES) expect(isPlantPreset(k), k).toBe(true);
  });
});

describe('ClutterFloraArtSource', () => {
  const fakeSlice = (calls: number[]) =>
    (_atlas: ClutterAtlas, cellIndex: number, targetPxH: number): SpriteCanvas => {
      calls.push(cellIndex);
      return { width: 10, height: targetPxH } as unknown as SpriteCanvas;
    };

  it('misses before warm, slices after; version bumps once on load', async () => {
    const cells: number[] = [];
    const src = new ClutterFloraArtSource({ load: async () => fakeAtlas(), slice: fakeSlice(cells) });
    expect(src.peek('foxglove')).toBeNull();
    expect(src.version()).toBe(0);
    await src.warm();
    expect(src.version()).toBe(1);
    const pack = src.peek('foxglove');
    expect(pack).not.toBeNull();
    expect(pack!.albedo.height).toBeGreaterThan(0);
    // Albedo-only: no compose-derived maps ride along.
    expect(pack!.normal).toBeUndefined();
    expect(pack!.material).toBeUndefined();
    // Cell lands inside the species' category range (foxglove → flower).
    const r = fakeManifest.ranges.flower;
    expect(cells[0]).toBeGreaterThanOrEqual(r.start);
    expect(cells[0]).toBeLessThan(r.start + r.count);
  });

  it('is deterministic and memoised per (kind, variant); variants may differ', async () => {
    const cellsA: number[] = [];
    const a = new ClutterFloraArtSource({ load: async () => fakeAtlas(), slice: fakeSlice(cellsA) });
    await a.warm();
    const p0 = a.peek('tussock-grass', 0);
    expect(a.peek('tussock-grass', 0)).toBe(p0);       // memoised
    a.peek('tussock-grass', 1);
    expect(cellsA.length).toBe(2);                     // one slice per (kind, variant)
    const cellsB: number[] = [];
    const b = new ClutterFloraArtSource({ load: async () => fakeAtlas(), slice: fakeSlice(cellsB) });
    await b.warm();
    b.peek('tussock-grass', 0);
    b.peek('tussock-grass', 1);
    expect(cellsB).toEqual(cellsA);                    // same inputs → same cells
  });

  it('caches null for non-clutter kinds and after a failed load', async () => {
    const src = new ClutterFloraArtSource({ load: async () => fakeAtlas(), slice: fakeSlice([]) });
    await src.warm();
    expect(src.peek('english-oak')).toBeNull();
    const dead = new ClutterFloraArtSource({ load: async () => null });
    await dead.warm();
    expect(dead.peek('foxglove')).toBeNull();
    expect(dead.version()).toBe(0);
  });
});

describe('render-context dispatch (habit routing)', () => {
  const stubArtResolver = { peek: () => null, warm: () => {}, clear: () => {} } as unknown as ArtResolver;
  const stubBuildingSource = { peek: () => null, warm: () => {}, version: () => 0 } as unknown as ParametricBuildingSource;

  function rcWith(plantSource: ParametricPlantSource, clutter: ClutterFloraArtSource) {
    const state = createState();
    state.map = { width: 1, height: 1, tiles: [] } as never;
    return buildRenderContext({
      state, viewport: { width: 1, height: 1 }, sheets: new Map(),
      assets: new AssetManager(), decorationImages: new DecorationImageCache(),
      artResolver: stubArtResolver, buildingArtResolver: stubArtResolver,
      parametricBuildingSource: stubBuildingSource,
      parametricPlantSource: plantSource,
      clutterFloraSource: clutter,
      devMode: createDevMode(),
    });
  }

  it('ground flora resolves from the clutter source; the parametric source is never touched', async () => {
    const parametricCalls: string[] = [];
    const plantSource = {
      peek: (k: string) => { parametricCalls.push(`peek:${k}`); return null; },
      warm: (k: string) => { parametricCalls.push(`warm:${k}`); },
      warmVariant: (k: string) => { parametricCalls.push(`warmVariant:${k}`); },
      version: () => 0,
    } as unknown as ParametricPlantSource;
    const clutter = new ClutterFloraArtSource({
      load: async () => fakeAtlas(),
      slice: (_a, _c, h) => ({ width: 8, height: h } as unknown as SpriteCanvas),
    });
    await clutter.warm();
    const rc = rcWith(plantSource, clutter);
    for (const k of GROUND_SPECIES) {
      expect(rc.resolveParametricPlantArt!(k, 0), k).not.toBeNull();
    }
    expect(parametricCalls).toEqual([]);
  });

  it('tree kinds keep the parametric path; the clutter source is never sliced for them', async () => {
    const sliced: number[] = [];
    const clutter = new ClutterFloraArtSource({
      load: async () => fakeAtlas(),
      slice: (_a, c, h) => { sliced.push(c); return { width: 8, height: h } as unknown as SpriteCanvas; },
    });
    await clutter.warm();
    const treePack = { albedo: { width: 40, height: 90 } };
    let warmedVariant = '';
    const plantSource = {
      peek: () => treePack,
      warm: () => {},
      warmVariant: (k: string, v: number) => { warmedVariant = `${k}#${v}`; },
      version: () => 0,
    } as unknown as ParametricPlantSource;
    const rc = rcWith(plantSource, clutter);
    expect(rc.resolveParametricPlantArt!('english-oak', 1)).toBe(treePack);
    expect(warmedVariant).toBe('english-oak#1');
    expect(sliced).toEqual([]);
  });

  it('a cold clutter source returns null (draw list billboard fallback) and warms', () => {
    let warmed = 0;
    const clutter = new ClutterFloraArtSource({ load: async () => { warmed++; return null; } });
    const plantSource = { peek: () => null, warm: () => {}, warmVariant: () => {}, version: () => 0 } as unknown as ParametricPlantSource;
    const rc = rcWith(plantSource, clutter);
    expect(rc.resolveParametricPlantArt!('foxglove', 0)).toBeNull();
    rc.resolveParametricPlantArt!('foxglove', 0);
    expect(warmed).toBe(1);                            // load kicked once, memoised
  });
});

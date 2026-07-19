// tests/unit/fishery-site.test.ts — pond fishery (rivers R3 P3): the hydrology-derived
// bank-tag store, the planCivics `fishery` branch, and the hut's jetty + drying-rack
// furniture. Mirrors the existing mill test precedent (settlement-plan-s4.test.ts's
// "only sites a mill when water is in range", settlement-growth-s6.test.ts's mill-as-a-
// working-building describe block).
import { describe, it, expect, beforeAll } from 'vitest';
import { WaterType } from '@/core/types';
import type { Tile } from '@/core/types';
import type { WaterBody } from '@/terrain/river-network';
import { getFisherySites, fisherySitesNear, computeFisherySitesFromLakes } from '@/world/fishery-site-store';
import {
  planSettlement, subdivideLots, widenMarket, planCivics, CIVIC_RULES,
  type FisheryPlacement, type SettlementPlan,
} from '@/world/settlement-plan';
import { emitFisheryFurniture } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity } from '@/blueprint/entity';
import { isBuilding as isBuildingEntity } from '@/world/building-collision';
import { OccupancyGrid } from '@/world/occupancy-grid';
import { EntityRegistry } from '@/world/entity-registry';

beforeAll(() => ensureBuildingTypesRegistered());

// ─── fixtures ───────────────────────────────────────────────────────────────────

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true }) as unknown as Tile));
}

const CENTER = { x: 24, y: 24 };
const villageRule = getZoneRule('village');

function freshPlan(tiles = grassTiles(), seed = 7): SettlementPlan {
  const plan = planSettlement(CENTER, villageRule, tiles, [{ dx: 1, dy: 0 }], new Random(seed));
  widenMarket(plan, tiles);
  subdivideLots(plan, tiles, seed);
  return plan;
}

/** A pond WaterBody at a given top-left corner, `side`×`side` cells (area = side²). */
function pondBody(id: string, x0: number, y0: number, side: number, W: number, opts: Partial<WaterBody> = {}): WaterBody {
  const cells: number[] = [];
  for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) cells.push((y0 + dy) * W + (x0 + dx));
  const area = cells.length;
  return {
    id, klass: 'pond', cells, area, x: x0 + side / 2, y: y0 + side / 2,
    outletIds: [], inletIds: [], ...opts,
  };
}

// ─── (a) the hydrology-derived bank-tag store ──────────────────────────────────

describe('computeFisherySitesFromLakes', () => {
  const W = 12, H = 12;

  it('tags dry bank cells adjacent to a pond, never a lake/mere/ocean shore', () => {
    // A 2×2 pond (area 4, spec range) at (2,2)-(3,3), and a 4×4 LAKE (area 16, out of
    // scope) at (7,7)-(10,10) — both "wet" on the render raster.
    const pond = pondBody('pond-a', 2, 2, 2, W);
    const lake = pondBody('lake-a', 7, 7, 4, W, { klass: 'lake' });
    const renderWT = new Uint8Array(W * H); // all Dry
    for (const c of pond.cells) renderWT[c] = WaterType.Lake;
    for (const c of lake.cells) renderWT[c] = WaterType.Lake;

    const sites = computeFisherySitesFromLakes([pond, lake], renderWT, W, H);
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(s.pondId).toBe('pond-a');   // never the lake
      // the tagged cell itself must be dry
      expect(renderWT[s.y * W + s.x]).toBe(WaterType.Dry);
      // and orthogonally adjacent to an actual pond cell in the stated direction
      const [fx, fy] = s.waterFace === 'north' ? [0, -1] : s.waterFace === 'south' ? [0, 1]
        : s.waterFace === 'west' ? [-1, 0] : [1, 0];
      expect(pond.cells).toContain((s.y + fy) * W + (s.x + fx));
    }
    // no site anywhere near the lake body
    for (const s of sites) {
      expect(Math.abs(s.x - 8) + Math.abs(s.y - 8)).toBeGreaterThan(2);
    }
  });

  it('a landlocked map with only a lake (no pond) tags nothing', () => {
    const lake = pondBody('lake-only', 3, 3, 4, W, { klass: 'lake' });
    const renderWT = new Uint8Array(W * H);
    for (const c of lake.cells) renderWT[c] = WaterType.Lake;
    expect(computeFisherySitesFromLakes([lake], renderWT, W, H)).toEqual([]);
  });

  it('scores a bigger pond higher, and a fed/drained pond higher than a stagnant one of the same size', () => {
    const small = pondBody('small', 1, 1, 2, W);               // area 4
    const big = pondBody('big', 6, 1, 3, W);                   // area 9
    const renderWT = new Uint8Array(W * H);
    for (const c of small.cells) renderWT[c] = WaterType.Lake;
    for (const c of big.cells) renderWT[c] = WaterType.Lake;
    const sites = computeFisherySitesFromLakes([small, big], renderWT, W, H);
    const sSmall = sites.find((s) => s.pondId === 'small')!;
    const sBig = sites.find((s) => s.pondId === 'big')!;
    expect(sBig.strength).toBeGreaterThan(sSmall.strength);
    // strongest-first ordering
    expect(sites[0].strength).toBeGreaterThanOrEqual(sites[sites.length - 1].strength);

    const fed = pondBody('fed', 1, 8, 2, W, { outletIds: ['out1'] });
    const stagnant = pondBody('stagnant', 6, 8, 2, W);          // same area, no in/outlet
    const renderWT2 = new Uint8Array(W * H);
    for (const c of fed.cells) renderWT2[c] = WaterType.Lake;
    for (const c of stagnant.cells) renderWT2[c] = WaterType.Lake;
    const sites2 = computeFisherySitesFromLakes([fed, stagnant], renderWT2, W, H);
    const sFed = sites2.find((s) => s.pondId === 'fed')!;
    const sStagnant = sites2.find((s) => s.pondId === 'stagnant')!;
    expect(sFed.strength).toBeGreaterThan(sStagnant.strength);
  });

  it('is deterministic — same fixture yields byte-identical output', () => {
    const pond = pondBody('p', 2, 2, 2, W);
    const renderWT = new Uint8Array(W * H);
    for (const c of pond.cells) renderWT[c] = WaterType.Lake;
    const a = computeFisherySitesFromLakes([pond], renderWT, W, H);
    const b = computeFisherySitesFromLakes([pond], renderWT, W, H);
    expect(b).toEqual(a);
  });
});

describe('fisherySitesNear', () => {
  it('returns sites within range, nearest first', () => {
    const sites = [
      { x: 10, y: 10, waterFace: 'south' as const, pondId: 'a', area: 4, strength: 0.5 },
      { x: 20, y: 10, waterFace: 'south' as const, pondId: 'b', area: 4, strength: 0.5 },
      { x: 100, y: 100, waterFace: 'south' as const, pondId: 'c', area: 4, strength: 0.5 },
    ];
    const near = fisherySitesNear(sites, 12, 10, 15);
    expect(near.map((s) => s.pondId)).toEqual(['a', 'b']);
  });
});

// ─── (b) the planCivics `fishery` branch (real hint-based siting) ─────────────

describe('CIVIC_RULES.fishery + planCivics', () => {
  it('registers a 2×2 water-sited civic rule', () => {
    expect(CIVIC_RULES.fishery).toEqual({ size: { w: 2, h: 2 }, site: 'water', nearWater: 3 });
  });

  it('sites no fishery when no hint is in range (and no raw water tiles exist)', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const fishery: FisheryPlacement = { hints: [], isWater: () => false };
    const civics = planCivics(plan, tiles, 7, 0, undefined, fishery);
    expect(civics.some((c) => c.type === 'fishery')).toBe(false);
  });

  it('seats the hut flush against a tagged pond hint, carrying the resolved waterFace', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    // A hint well clear of the plan's own roads/lots (radius ~10 from CENTER); water lies
    // generously east of it — the exact seated origin doesn't matter, only that SOME origin
    // among the tried slides finds dry ground with its east flank wet.
    const hint = { x: 35, y: 24, face: 'east' as const };
    const isWater = (x: number, y: number): boolean => x >= 36;
    const fishery: FisheryPlacement = { hints: [hint], isWater };
    const civics = planCivics(plan, tiles, 7, 0, undefined, fishery);
    const found = civics.find((c) => c.type === 'fishery');
    expect(found, 'a fishery is sited against the hint').toBeDefined();
    expect(found!.waterFace).toBe('east');
    expect(found!.w).toBe(2);
    expect(found!.h).toBe(2);
    // The footprint itself never overlaps the "water" (the hut sits on dry ground).
    expect(found!.x + found!.w - 1).toBeLessThan(36);
  });

  it('is deterministic — same inputs yield the identical resolved site', () => {
    const run = () => {
      const tiles = grassTiles();
      const plan = freshPlan(tiles);
      const fishery: FisheryPlacement = { hints: [{ x: 35, y: 24, face: 'east' as const }], isWater: (x) => x >= 36 };
      return planCivics(plan, tiles, 7, 0, undefined, fishery).find((c) => c.type === 'fishery');
    };
    expect(run()).toEqual(run());
  });
});

// ─── (c) the hut + jetty + drying racks realize step ───────────────────────────

describe('fisherman_hut (catalogue → geometry bridge)', () => {
  it('resolves a 2×2 building matching the CIVIC_RULES.fishery footprint', () => {
    const rb = synthesizeBlueprint('fisherman_hut');
    expect(rb, 'fisherman_hut should synthesise').toBeDefined();
    expect(rb!.class).toBe('building');
    expect(rb!.footprint).toEqual({ w: 2, h: 2 });
  });

  it('is emitted as a building-tagged entity (participates in building.on-water)', () => {
    const rb = synthesizeBlueprint('fisherman_hut')!;
    const hut = blueprintEntity('hut1', rb, 5, 5, {});
    expect(isBuildingEntity(hut)).toBe(true);
    expect(hut.tags).toContain('building');
  });
});

describe('emitFisheryFurniture', () => {
  const hutFootprint = { w: 2, h: 2 };
  // A hut at (10,10)-(11,11), water flank SOUTH: the flank point is (11,12) (see
  // `flankPoint` — centre (11,11), face south ⇒ floor(11 + 1*(1+0.5)) = 12).
  const civic = { type: 'fishery', x: 10, y: 10, w: 2, h: 2, waterFace: 'south' as const };

  function freshCtx(overrides: Partial<Parameters<typeof emitFisheryFurniture>[0]> = {}) {
    const tiles = grassTiles(24, 24);
    return {
      poiId: 'v1', civic, hutFootprint,
      isWater: (x: number, y: number) => y >= 12,   // everything south of the hut is the pond
      tiles, occ: new OccupancyGrid(), registry: new EntityRegistry(),
      nextSeed: (() => { let n = 0; return () => (++n); })(),
      ...overrides,
    };
  }

  it('emits a jetty (non-solid prop) running out over the water, flush against the hut', () => {
    const out = emitFisheryFurniture(freshCtx());
    const jetty = out.find((e) => e.id.endsWith('_fishery_jetty'));
    expect(jetty, 'a jetty is emitted').toBeDefined();
    expect(jetty!.tags).toContain('prop');
    expect(jetty!.tags).not.toContain('building');
    expect(isBuildingEntity(jetty!)).toBe(false);
    // Every jetty cell sits at/after the water flank (y >= 12) — genuinely over water.
    const fp = jetty!.properties!.footprint as { w: number; h: number };
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        expect(jetty!.y + dy).toBeGreaterThanOrEqual(12);
      }
    }
    // Flush against the hut — the nearest jetty row is exactly the flank point's row.
    expect(jetty!.y).toBe(12);
  });

  it('emits drying racks (a prop) on the dry apron opposite the water', () => {
    const out = emitFisheryFurniture(freshCtx());
    const racks = out.find((e) => e.id.endsWith('_fishery_racks'));
    expect(racks, 'racks are emitted').toBeDefined();
    expect(racks!.tags).toContain('prop');
    expect(isBuildingEntity(racks!)).toBe(false);
    // North of the hut (opposite 'south'), never in the water.
    expect(racks!.y).toBeLessThan(10);
  });

  it('skips the jetty when the far end is not real water (no beaching a jetty on land)', () => {
    const out = emitFisheryFurniture(freshCtx({ isWater: () => false }));
    expect(out.some((e) => e.id.endsWith('_fishery_jetty'))).toBe(false);
  });

  it('skips the racks when the dry apron is already claimed', () => {
    const occ = new OccupancyGrid();
    occ.claim(11, 9, 'civic'); // pre-claim the exact apron cell (north flank point)
    const out = emitFisheryFurniture(freshCtx({ occ }));
    expect(out.some((e) => e.id.endsWith('_fishery_racks'))).toBe(false);
  });

  it('is deterministic — same inputs yield identical entity positions', () => {
    const a = emitFisheryFurniture(freshCtx());
    const b = emitFisheryFurniture(freshCtx());
    const strip = (es: typeof a) => es.map((e) => ({ x: e.x, y: e.y, kind: e.kind, tags: e.tags }));
    expect(strip(b)).toEqual(strip(a));
  });
});

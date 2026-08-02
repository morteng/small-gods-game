/**
 * Interaction-scaling S3.3 — two located defects in the materialization spawn
 * path (docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md, Phase 3
 * refresh (c)):
 *
 *  1. `resolveBuildingDraw` fell back to footprint-local (1,1) — the SOLID
 *     centre of a typical 3×3 — for any preset `getBuildingTemplate` doesn't
 *     know (every parametric kind: yurt/townhouse/manor/shrine/granary/…).
 *     Fixed by preferring the stored blueprint's `collision.doorCells[0]`
 *     (the same tile `building-placer.ts` marks walkable at commit time),
 *     with `homeTileFor` snapping to the nearest walkable tile as a backstop.
 *  2. `marketAnchorTile` returned the centre of the footprinted `well` civic
 *     site — solid ground, not a place a mortal can stand — so `socialize`/
 *     `worship` sent NPCs to an unreachable venue. Fixed with the same
 *     walkability snap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { World } from '@/world/world';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { resolveBuildingDraw } from '@/sim/population/building-capacity';
import { homeTileFor } from '@/sim/materialization';
import { marketAnchorTile } from '@/sim/population/settlement-demand';
import type { BuildingInstance, GameMap, Tile } from '@/core/types';
import type { SettlementPlan } from '@/world/settlement-plan';

beforeAll(() => loadDefaultPacks());

function blankMap(w = 24, h = 24): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

/** Stamp a footprint on the tile grid exactly as `building-placer.ts`'s
 *  `clearFootprint` + door-open sequence does: the whole footprint unwalkable,
 *  then only the compiled door cell reopened. Ground truth for the tests below. */
function stampFootprint(
  map: GameMap, originX: number, originY: number,
  collision: { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] },
): void {
  const doors = new Set(collision.doorCells);
  for (let dy = 0; dy < collision.footprint.h; dy++) {
    for (let dx = 0; dx < collision.footprint.w; dx++) {
      const t = map.tiles[originY + dy]?.[originX + dx];
      if (t) t.walkable = doors.has(`${dx},${dy}`);
    }
  }
}

describe('resolveBuildingDraw — door tile from the stored blueprint (defect 1)', () => {
  // yurt/manor/shrine/granary/etc. have no legacy `getBuildingTemplate` entry
  // (re-derived list — see the round's report); yurt is representative.
  it('a parametric kind (yurt, no legacy template) resolves the REAL compiled door, not the footprint centre', () => {
    const map = blankMap();
    const rb = synthesizeBlueprint('yurt')!;
    expect(rb).toBeTruthy();
    const originX = 5, originY = 5;
    const entity = blueprintEntity('village_bld_0', rb, originX, originY, { poiId: 'village' });
    const stored = blueprintOf(entity)!;
    stampFootprint(map, originX, originY, stored.collision);

    const world = new World(map);
    world.addEntity(entity);
    const inst: BuildingInstance = {
      id: entity.id, templateId: 'yurt', tileX: originX, tileY: originY, poiId: 'village', state: 'intact',
    };

    const draw = resolveBuildingDraw(inst, world)!;
    const [ldx, ldy] = stored.collision.doorCells[0]!.split(',').map(Number);
    expect(draw.doorX).toBe(originX + ldx);
    expect(draw.doorY).toBe(originY + ldy);
    // The resolved door must land on ground `building-placer.ts` actually opened
    // (a `blocked` structure cell can still carry a threshold — doors punch
    // through walls — so walkability, not blocked-set membership, is ground truth).
    expect(map.tiles[draw.doorY]![draw.doorX]!.walkable).toBe(true);
    // The defect this pins: the pre-fix footprint-local (1,1) proxy is NOT
    // where this test's stamped ground is walkable, on a footprint this size —
    // confirming the bug would really have spawned inside solid ground here.
    if (stored.collision.footprint.w > 2 && stored.collision.footprint.h > 2) {
      expect(map.tiles[originY + 1]![originX + 1]!.walkable).toBe(false);
    }
  });

  it('WITHOUT a world, a parametric kind still falls back to the footprint-local proxy (the pre-existing legacy behaviour, now covered by the homeTileFor backstop below)', () => {
    const inst: BuildingInstance = { id: 'x', templateId: 'yurt', tileX: 5, tileY: 5, poiId: 'village', state: 'intact' };
    const draw = resolveBuildingDraw(inst)!;
    expect(draw).toMatchObject({ doorX: 6, doorY: 6 }); // tileX+1, tileY+1 — the old (1,1) guess
  });
});

describe('homeTileFor — walkability backstop', () => {
  it('snaps off a solid door tile onto the nearest walkable ground', () => {
    const map = blankMap();
    // A 3×3 solid footprint at (5,5), matching clearFootprint's convention — no
    // door opened, so (6,6) (the footprint-local (1,1) proxy) is genuinely solid.
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) map.tiles[5 + dy]![5 + dx]!.walkable = false;
    }
    const draw = {
      buildingId: 'x', poiId: 'village', kind: 'yurt', klass: 'dwelling' as const,
      residents: 4, workers: 0, visitorDraw: 0, doorX: 6, doorY: 6,
    };
    const home = homeTileFor(draw, map);
    expect(map.tiles[home.y]![home.x]!.walkable).toBe(true);
    expect(home).not.toEqual({ x: 6, y: 6 });
  });

  it('is a no-op when the door tile is already walkable', () => {
    const map = blankMap();
    const draw = {
      buildingId: 'x', poiId: 'village', kind: 'cottage', klass: 'dwelling' as const,
      residents: 5, workers: 0, visitorDraw: 0, doorX: 6, doorY: 6,
    };
    expect(homeTileFor(draw, map)).toEqual({ x: 6, y: 6 });
  });
});

describe('marketAnchorTile — walkability snap off the footprinted well (defect 2)', () => {
  it('snaps off a solid well footprint onto walkable ground', () => {
    const map = blankMap();
    // A 2x2 well, fully solid (no door — a well has no threshold), centred at (10,10).
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) map.tiles[10 + dy]![10 + dx]!.walkable = false;
    }
    const plan: SettlementPlan = {
      poiId: 'village', center: { x: 10, y: 10 }, nodes: [], edges: [], slots: [], lots: [], wards: [],
      civics: [{ type: 'well', x: 10, y: 10, w: 2, h: 2 }], market: [],
    };
    map.settlementPlans = [plan];

    const anchor = marketAnchorTile(map, 'village')!;
    expect(anchor).toBeTruthy();
    expect(map.tiles[anchor.y]![anchor.x]!.walkable).toBe(true);
    // The naive centre (well.x + w/2, well.y + h/2) = (11,11) is solid; the
    // walkable snap must land somewhere else.
    expect(anchor).not.toEqual({ x: 11, y: 11 });
  });

  it('is a no-op when the well tile is already walkable (no regression on the common case)', () => {
    const map = blankMap();
    const plan: SettlementPlan = {
      poiId: 'village', center: { x: 10, y: 10 }, nodes: [], edges: [], slots: [], lots: [], wards: [],
      civics: [{ type: 'well', x: 10, y: 10, w: 2, h: 2 }], market: [],
    };
    map.settlementPlans = [plan];
    expect(marketAnchorTile(map, 'village')).toEqual({ x: 11, y: 11 });
  });
});

// tests/unit/settlement-growth-social-gravity.test.ts — trails feed growth (synthesis 2.3)
//
// Foundation's "social gravity": new housing sites relative to existing worn paths, so the
// desire lines believers carved shape the town that shaped them. Pure scoring change: a free
// lot within TRAIL_GRAVITY_RADIUS of a promoted trample cell (or a high-wear ≥ REVERT_LO cell)
// outranks an otherwise-equal lot; the bonus never crosses the infill-first class gap.
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import {
  growSettlement, trailGravityBonus, TRAIL_GRAVITY_BONUS, TRAIL_GRAVITY_RADIUS,
  type GrowthCtx,
} from '@/sim/systems/settlement-growth-system';
import { TrampleGrid, TRAMPLE } from '@/sim/trample';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI } from '@/core/types';
import type { Lot } from '@/world/settlement-plan';

beforeAll(() => ensureBuildingTypesRegistered());

const CENTER = { x: 24, y: 24 };
const POI_ID = 'v1';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
}

/** Same deterministic village fixture as settlement-growth-system.test.ts. Seed 12 (vs 11
 *  there) lays out several same-class free lots that FIT a dwelling, so the gravity re-ordering
 *  is observable (seed 11's only class-mate lot is too small to host one). */
function villageWorld(seed = 12) {
  const tiles = grassTiles();
  const poi: POI = { id: POI_ID, type: 'village', name: 'T', position: CENTER } as unknown as POI;
  const map: GameMap = {
    tiles, width: 48, height: 48, villages: [], seed: 1, success: true,
    worldSeed: { pois: [poi] } as unknown as GameMap['worldSeed'],
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap;
  const world = new World(map);
  const rule = {
    ...getZoneRule('village'),
    radius: { min: 10, max: 10 },
    buildingCount: { min: 2, max: 2 },
  };
  const result = placeSettlement(
    poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }],
    new Random(seed), 'medieval', world, 42,
  );
  for (const e of result.entities) world.indexExisting(e);
  for (const rt of result.roadTiles) {
    const t = tiles[rt.y]?.[rt.x];
    if (t) { t.type = rt.type; t.walkable = true; }
  }
  map.settlementPlans = [result.plan];
  return { world, map, plan: result.plan };
}

function gctx(world: World, seed: number, trample?: TrampleGrid | null): GrowthCtx {
  const clock = new SimClock();
  return { world, rng: createRng(seed), now: 0, log: new EventLog(clock), trample };
}

/** Promote a small trail blob adjacent to (but outside) the given lot. */
function seedTrailBeside(grid: TrampleGrid, lot: Lot): void {
  const minX = Math.min(...lot.tiles.map(t => t.x));
  const minY = Math.min(...lot.tiles.map(t => t.y));
  // A promoted cell one tile diagonal off the lot corner — within TRAIL_GRAVITY_RADIUS.
  const snap = grid.serialize();
  snap.cells.push([(minY - 1) * grid.width + (minX - 1), TRAMPLE.SATURATION_CAP]);
  snap.promoted.push([(minY - 1) * grid.width + (minX - 1), 'grass']);
  grid.hydrate(snap);
}

describe('trailGravityBonus', () => {
  it('is 0 with no grid, full bonus beside a promoted cell, 0 far away', () => {
    const { plan } = villageWorld();
    const lot = plan.lots.find(l => !l.buildingId)!;
    expect(trailGravityBonus(null, lot)).toBe(0);
    expect(trailGravityBonus(undefined, lot)).toBe(0);

    const grid = new TrampleGrid(48, 48);
    expect(trailGravityBonus(grid, lot)).toBe(0);
    seedTrailBeside(grid, lot);
    expect(trailGravityBonus(grid, lot)).toBe(TRAIL_GRAVITY_BONUS);
  });

  it('also fires on high-wear (≥ REVERT_LO) cells that have not yet promoted', () => {
    const { plan } = villageWorld();
    const lot = plan.lots.find(l => !l.buildingId)!;
    const grid = new TrampleGrid(48, 48);
    const t = lot.tiles[0];
    grid.deposit(t.x - TRAIL_GRAVITY_RADIUS, t.y, TRAMPLE.REVERT_LO);
    expect(trailGravityBonus(grid, lot)).toBe(TRAIL_GRAVITY_BONUS);
    // Sub-LO wear is latent, not gravity.
    const faint = new TrampleGrid(48, 48);
    faint.deposit(t.x - TRAIL_GRAVITY_RADIUS, t.y, TRAMPLE.REVERT_LO - 1);
    expect(trailGravityBonus(faint, lot)).toBe(0);
  });
});

describe('growth follows the desire lines (social gravity)', () => {
  it('a trail-adjacent lot outranks the otherwise-equal control choice', () => {
    // CONTROL: no trample — record which lot growth picks.
    const control = villageWorld();
    expect(growSettlement(gctx(control.world, 7), control.plan, 'ctl')).toBe(true);
    const controlLot = control.plan.lots.find(l => l.buildingId?.includes('_bld_g'))!;
    expect(controlLot).toBeDefined();

    // GRAVITY: identical world + rng, with a promoted trail beside one OTHER free lot per run.
    // The bonus reorders within the near-claimed/frontage class, so not every candidate can
    // out-rank the control choice — assert gravity moves the choice onto at least one
    // trail-adjacent candidate ("otherwise-equal site" beaten by adjacency), and that it never
    // selects a lot that is neither the control choice nor the seeded candidate.
    // Same infill class as the control choice — the bonus reorders WITHIN a class by design
    // (it must never beat the infill-first gap), so only class-mates are fair candidates.
    const probe = villageWorld();
    const claimed = probe.plan.lots.filter(l => l.buildingId);
    const nearClaimed = (l: Lot): boolean =>
      claimed.some(c => c.frontage.some(cf => l.frontage.some(lf =>
        Math.max(Math.abs(cf.x - lf.x), Math.abs(cf.y - lf.y)) <= 2)));
    const controlClass = nearClaimed(probe.plan.lots.find(l => l.id === controlLot.id)!);
    const candidates = probe.plan.lots.filter(l => !l.buildingId && l.id !== controlLot.id
      && l.side[0] === controlLot.side[0] && l.side[1] === controlLot.side[1]
      && nearClaimed(l) === controlClass);
    expect(candidates.length).toBeGreaterThan(0);

    let moved = 0;
    for (const cand of candidates) {
      const grav = villageWorld();
      const target = grav.plan.lots.find(l => l.id === cand.id)!;
      const grid = new TrampleGrid(48, 48);
      seedTrailBeside(grid, target);
      expect(growSettlement(gctx(grav.world, 7, grid), grav.plan, 'ctl')).toBe(true);
      const chosen = grav.plan.lots.find(l => l.buildingId?.includes('_bld_g'))!;
      expect([target.id, controlLot.id]).toContain(chosen.id);   // gravity, not chaos
      if (chosen.id === target.id) moved++;
    }
    expect(moved).toBeGreaterThan(0);                            // adjacency won somewhere
  });

  it('is deterministic and a no-op without a grid (control parity)', () => {
    const a = villageWorld();
    const b = villageWorld();
    growSettlement(gctx(a.world, 7), a.plan, 'ctl');
    growSettlement(gctx(b.world, 7, null), b.plan, 'ctl');
    const lotA = a.plan.lots.find(l => l.buildingId?.includes('_bld_g'))!;
    const lotB = b.plan.lots.find(l => l.buildingId?.includes('_bld_g'))!;
    expect(lotA.id).toBe(lotB.id);
  });
});

// tests/unit/trample.test.ts — emergent desire-line trample grid (WP-O)
import { describe, it, expect } from 'vitest';
import { TrampleGrid, TRAMPLE, isTrampleEligible } from '@/sim/trample';
import { TrampleDepositSystem, TramplePromoteDecaySystem } from '@/sim/systems/trample-system';
import { findPath, tileCost, TRAIL_COST } from '@/sim/pathfinding';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile } from '@/core/types';

function grassMap(w = 6, h = 6, type = 'grass'): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type, x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

describe('TrampleGrid — deposit & determinism', () => {
  it('accumulates wear and saturates at the cap', () => {
    const g = new TrampleGrid(4, 4);
    g.deposit(1, 1, 100);
    g.deposit(1, 1, 100);
    g.deposit(1, 1, 100);
    expect(g.wearAt(1, 1)).toBe(TRAMPLE.SATURATION_CAP);
  });

  it('is deterministic: the same deposit sequence yields an identical grid', () => {
    const seq: [number, number][] = [[1, 1], [1, 1], [2, 3], [1, 1], [2, 3], [0, 0]];
    const a = new TrampleGrid(8, 8);
    const b = new TrampleGrid(8, 8);
    for (const [x, y] of seq) a.deposit(x, y);
    for (const [x, y] of seq) b.deposit(x, y);
    expect(a.serialize()).toEqual(b.serialize());
  });

  it('ignores out-of-bounds deposits', () => {
    const g = new TrampleGrid(4, 4);
    g.deposit(-1, 0);
    g.deposit(0, 99);
    expect(g.activeCount()).toBe(0);
  });
});

describe('TrampleGrid — promote / decay hysteresis', () => {
  it('sub-threshold traffic never promotes (no upward flicker)', () => {
    const map = grassMap();
    const g = new TrampleGrid(map.width, map.height);
    // Hold wear just under HI across many passes — it must never become dirt.
    for (let i = 0; i < 20; i++) {
      g.deposit(2, 2, 10); // small quantum; decay keeps it under HI
      g.promoteDecay(map);
      expect(map.tiles[2][2].type).toBe('grass');
      expect(g.isPromoted(2, 2)).toBe(false);
    }
  });

  it('promotes soft ground to dirt once wear reaches HI', () => {
    const map = grassMap();
    const g = new TrampleGrid(map.width, map.height);
    g.deposit(2, 2, TRAMPLE.PROMOTE_HI + 4);
    g.promoteDecay(map);
    expect(map.tiles[2][2].type).toBe('dirt');
    expect(map.tiles[2][2].walkable).toBe(true);
    expect(g.isPromoted(2, 2)).toBe(true);
  });

  it('a promoted trail stays dirt under light traffic in the HI/LO band', () => {
    const map = grassMap();
    const g = new TrampleGrid(map.width, map.height);
    g.deposit(2, 2, TRAMPLE.PROMOTE_HI); // promote
    g.promoteDecay(map);
    expect(map.tiles[2][2].type).toBe('dirt');
    // Balanced traffic holds wear inside the band — never reverts.
    for (let i = 0; i < 15; i++) {
      g.deposit(2, 2, 20);
      g.promoteDecay(map);
      expect(map.tiles[2][2].type).toBe('dirt');
    }
  });

  it('reverts a trail to its original ground once wear decays below LO', () => {
    const map = grassMap(6, 6, 'meadow');
    const g = new TrampleGrid(map.width, map.height);
    g.deposit(2, 2, TRAMPLE.PROMOTE_HI);
    g.promoteDecay(map);
    expect(map.tiles[2][2].type).toBe('dirt');
    // No further traffic: geometric decay eventually drops below LO → revert.
    let reverted = false;
    for (let i = 0; i < 60 && !reverted; i++) {
      g.promoteDecay(map);
      if (map.tiles[2][2].type !== 'dirt') reverted = true;
    }
    expect(reverted).toBe(true);
    expect(map.tiles[2][2].type).toBe('meadow'); // restored to ORIGINAL, not grass
    expect(g.isPromoted(2, 2)).toBe(false);
  });
});

describe('trample systems — deposit sustains an active trail', () => {
  it('continued footfall on a promoted trail keeps it dirt (no revert flicker)', () => {
    const map = grassMap(6, 6);
    const world = new World(map);
    // One NPC parked on the trail tile, walking it every deposit fire.
    world.addEntity({ id: 'walker', kind: 'npc', x: 2.5, y: 2.5, properties: {} } as never);
    const grid = new TrampleGrid(map.width, map.height);
    const deposit = new TrampleDepositSystem(() => map, () => grid);
    const decay = new TramplePromoteDecaySystem(() => map, () => grid);
    const ctx = { world } as SystemContext;

    // Warm the tile over HI so it promotes, then run many deposit+decay cycles.
    grid.deposit(2, 2, TRAMPLE.PROMOTE_HI);
    decay.tick(ctx);
    expect(map.tiles[2][2].type).toBe('dirt');

    // Deposit fires ~10× between each decay pass (3 Hz vs 0.25 Hz) — model that.
    for (let day = 0; day < 30; day++) {
      for (let f = 0; f < 12; f++) deposit.tick(ctx);
      decay.tick(ctx);
      expect(map.tiles[2][2].type).toBe('dirt'); // sustained, never reverts
    }
  });
});

describe('TrampleGrid — terrain opt-out', () => {
  it('never trampls roads, water, farmland, stone, or footprints', () => {
    const cases: { type: string; walkable?: boolean }[] = [
      { type: 'road' }, { type: 'dirt_road' }, { type: 'stone_road_ew' },
      { type: 'bridge' }, { type: 'water' }, { type: 'river' },
      { type: 'farm_field' }, { type: 'mountain' }, { type: 'dirt' },
      { type: 'grass', walkable: false }, // building footprint on grass
    ];
    for (const c of cases) {
      const map = grassMap(3, 3);
      map.tiles[1][1] = { type: c.type, x: 1, y: 1, walkable: c.walkable ?? true, state: 'realized' } as Tile;
      const g = new TrampleGrid(3, 3);
      g.deposit(1, 1, TRAMPLE.SATURATION_CAP);
      g.promoteDecay(map);
      expect(map.tiles[1][1].type).toBe(c.type); // untouched
      expect(g.isPromoted(1, 1)).toBe(false);
    }
  });

  it('isTrampleEligible gates soft ground only', () => {
    expect(isTrampleEligible({ type: 'grass', walkable: true } as Tile)).toBe(true);
    expect(isTrampleEligible({ type: 'meadow', walkable: true } as Tile)).toBe(true);
    expect(isTrampleEligible({ type: 'road', walkable: true } as Tile)).toBe(false);
    expect(isTrampleEligible({ type: 'dirt', walkable: true } as Tile)).toBe(false);
    expect(isTrampleEligible({ type: 'grass', walkable: false } as Tile)).toBe(false);
    expect(isTrampleEligible(undefined)).toBe(false);
  });
});

describe('pathfinder coupling — A* bundles onto a formed trail', () => {
  it('prefers an equal-length dirt route over the all-grass one', () => {
    // 3x3, start (0,0) → goal (2,2). Lay a dirt L-route down the left+bottom
    // edges; every other tile is grass. The dirt route is strictly cheapest.
    const map = grassMap(3, 3);
    const trail: [number, number][] = [[0, 1], [0, 2], [1, 2], [2, 2]];
    for (const [x, y] of trail) map.tiles[y][x].type = 'dirt';

    const res = findPath(map, 0, 0, 2, 2);
    expect(res).not.toBeNull();
    // 4 dirt tiles entered → 4 × 0.8.
    expect(res!.cost).toBeCloseTo(4 * TRAIL_COST, 6);
    // The route runs along the dirt trail, not through the grass interior.
    const onTrail = new Set(trail.map(([x, y]) => `${x},${y}`));
    for (const step of res!.path.slice(1)) expect(onTrail.has(`${step.x},${step.y}`)).toBe(true);
    expect(tileCost({ type: 'dirt' } as Tile)).toBeLessThan(tileCost({ type: 'grass' } as Tile));
  });
});

describe('TrampleGrid — snapshot roundtrip & scrub reconciliation', () => {
  function stateWithGrid() {
    const s = createState();
    const map = grassMap(8, 8);
    s.map = map;
    s.world = new World(map);
    s.trample = new TrampleGrid(map.width, map.height);
    return s;
  }

  it('grid + promoted originals survive capture/restore identically', () => {
    const s = stateWithGrid();
    s.trample!.deposit(3, 3, TRAMPLE.PROMOTE_HI + 10);
    s.trample!.deposit(4, 4, 40);
    s.trample!.promoteDecay(s.map!); // (3,3) becomes dirt
    const captured = s.trample!.serialize();
    expect(s.map!.tiles[3][3].type).toBe('dirt');

    const snap = captureSnapshot(s);
    // Mutate after capture: carve a NEW trail at (5,5).
    s.trample!.deposit(5, 5, TRAMPLE.PROMOTE_HI + 10);
    s.trample!.promoteDecay(s.map!);
    expect(s.map!.tiles[5][5].type).toBe('dirt');

    restoreSnapshot(s, snap);
    // Grid restored to captured contents…
    expect(s.trample!.serialize()).toEqual(captured);
    // …and the map reconciled: (3,3) stays dirt, the post-capture (5,5) reverted.
    expect(s.map!.tiles[3][3].type).toBe('dirt');
    expect(s.map!.tiles[5][5].type).toBe('grass');
  });

  it('restoring a pre-trample snapshot clears any live trails', () => {
    const s = stateWithGrid();
    const snap = captureSnapshot(s); // capture BEFORE any trample state exists
    // Simulate a pre-trample save: strip the field so restore hits the fallback.
    delete (snap as { trample?: unknown }).trample;

    s.trample!.deposit(2, 2, TRAMPLE.PROMOTE_HI + 10);
    s.trample!.promoteDecay(s.map!);
    expect(s.map!.tiles[2][2].type).toBe('dirt');

    restoreSnapshot(s, snap);
    expect(s.map!.tiles[2][2].type).toBe('grass'); // trail undone
    expect(s.trample!.isPromoted(2, 2)).toBe(false);
  });
});

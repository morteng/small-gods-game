// Road-wear economy S1 — the 3 Hz piggyback. The TrampleDepositSystem attributes footfall on a
// road tile to the covering graph edge (roads shed trample wear, so the footfall is free) while
// leaving the trample grid untouched; footfall on soft ground still wears the grid, not the edge.
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { TrampleGrid } from '@/sim/trample';
import { TrampleDepositSystem } from '@/sim/systems/trample-system';
import { RoadUseTally } from '@/world/road-use';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';

const W = 12, H = 12;

/** A grass map with a horizontal `dirt_road` strip along row 5 (cols 3..8). */
function roadStripMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) {
      const onRoad = y === 5 && x >= 3 && x <= 8;
      row.push({ type: onRoad ? 'dirt_road' : 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  const map = {
    tiles, width: W, height: H, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
  const graph: RoadGraph = {
    nodes: [], rev: 0,
    edges: [{
      id: 'e0', a: 'a', b: 'b',
      polyline: Array.from({ length: 6 }, (_, i) => ({ x: 3 + i, y: 5 })),
      feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [],
    }],
  };
  map.roadGraph = graph;
  return map;
}

function fireDeposit(map: GameMap, world: World, grid: TrampleGrid, roadUse: RoadUseTally | null): void {
  new TrampleDepositSystem(() => map, () => grid, () => roadUse).tick({ world } as unknown as SystemContext);
}

describe('TrampleDepositSystem — road-use piggyback (S1)', () => {
  it('footfall on a road tile records USE on its edge and does NOT wear the trample grid', () => {
    const map = roadStripMap();
    const world = new World(map);
    const grid = new TrampleGrid(W, H);
    const roadUse = new RoadUseTally();
    world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: {} }); // on the road strip

    fireDeposit(map, world, grid, roadUse);

    expect(roadUse.rawPasses('e0')).toBe(1);
    expect(grid.activeCount()).toBe(0); // roads shed trample wear
  });

  it('footfall on soft ground wears the grid and records NO edge use', () => {
    const map = roadStripMap();
    const world = new World(map);
    const grid = new TrampleGrid(W, H);
    const roadUse = new RoadUseTally();
    world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 2, properties: {} }); // grass, off the road

    fireDeposit(map, world, grid, roadUse);

    expect(grid.activeCount()).toBeGreaterThan(0);
    expect(roadUse.activeEdges()).toBe(0);
  });

  it('accrues one pass per deposit fire per NPC on the road', () => {
    const map = roadStripMap();
    const world = new World(map);
    const grid = new TrampleGrid(W, H);
    const roadUse = new RoadUseTally();
    world.addEntity({ id: 'n1', kind: 'npc', x: 4, y: 5, properties: {} });
    world.addEntity({ id: 'n2', kind: 'npc', x: 7, y: 5, properties: {} });

    fireDeposit(map, world, grid, roadUse);
    fireDeposit(map, world, grid, roadUse);

    expect(roadUse.rawPasses('e0')).toBe(4); // 2 NPCs × 2 fires
  });

  it('is a safe no-op when no tally is wired (default closure) — pure trample behaviour', () => {
    const map = roadStripMap();
    const world = new World(map);
    const grid = new TrampleGrid(W, H);
    world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: {} });
    // Two-arg constructor: the legacy call site with no road-use tally must still run.
    new TrampleDepositSystem(() => map, () => grid).tick({ world } as unknown as SystemContext);
    expect(grid.activeCount()).toBe(0); // road tile, no wear, no throw
  });
});

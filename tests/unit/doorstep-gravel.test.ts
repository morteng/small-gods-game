import { describe, it, expect } from 'vitest';
import type { Tile, Entity, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import type { SettlementPlan } from '@/world/settlement-plan';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import { depositDoorstepGravel } from '@/world/doorstep-gravel';

/** All-grass tile grid (soft ground, gravel-eligible), with an optional dirt_road ribbon
 *  stamped along one row — the shape settlement roads leave behind. */
function grid(w: number, h: number, roadY?: number): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      const type = roadY !== undefined && y === roadY ? 'dirt_road' : 'grass';
      row.push({ type, walkable: true } as unknown as Tile);
    }
    rows.push(row);
  }
  return rows;
}

/** A straight horizontal single-edge road graph along `y`, spanning [x0,x1). */
function straightGraph(y: number, x0: number, x1: number): RoadGraph {
  const polyline = [];
  for (let x = x0; x < x1; x++) polyline.push({ x, y });
  const edge: RoadEdge = {
    id: 'e1', a: 'n0', b: 'n1', polyline, feature: 'road', class: 'road', surface: 'dirt',
    bridgeCells: [],
  };
  return { nodes: [{ id: 'n0', x: x0, y, kind: 'end' }, { id: 'n1', x: x1 - 1, y, kind: 'end' }], edges: [edge] };
}

/** A door-bearing building entity: origin (ox,oy), footprint w×h, south-facing main door. */
function building(id: string, kind: string, ox: number, oy: number, w: number, h: number): Entity {
  const anchors = [{ kind: 'door', main: true, x: ox + w / 2, y: oy + h, facing: [0, 1] as [number, number] }];
  return {
    id, kind, x: ox, y: oy, tags: ['building'],
    properties: { poiId: 'poi1', footprint: { w, h }, anchors },
  } as unknown as Entity;
}

function fakeWorld(entities: Entity[]): World {
  return { registry: { all: () => entities } } as unknown as World;
}

const plan = { poiId: 'poi1', civics: [] } as unknown as SettlementPlan;

/** A cottage fronting the road at x≈20 (door steps onto (20,19), one tile above the road at y=20). */
function cottageMap(): { map: GameMap; world: World } {
  const tiles = grid(60, 40, 20);
  const map = { tiles, width: 60, height: 40, roadGraph: straightGraph(20, 0, 60) } as unknown as GameMap;
  const world = fakeWorld([building('b_cottage', 'cottage', 19, 17, 3, 2)]);
  return { map, world };
}

describe('doorstep-gravel — depositDoorstepGravel', () => {
  it('promotes ground near the doorstep and along the road it fronts', () => {
    const { map, world } = cottageMap();
    const stats = depositDoorstepGravel(map, [plan], world, 7);
    expect(stats.buildings).toBe(1);
    expect(stats.cells).toBeGreaterThan(0);
    // The doorstep-adjacent straddle cell beside the road should have promoted.
    expect(map.tiles[19][21].type === 'gravel' || map.tiles[19][19].type === 'gravel').toBe(true);
  });

  it('never overwrites the road tile itself, water, or anything outside the eligible whitelist', () => {
    const { map, world } = cottageMap();
    // Put a water tile right where the apron would otherwise land.
    map.tiles[19][21] = { type: 'water', walkable: true } as unknown as Tile;
    depositDoorstepGravel(map, [plan], world, 7);
    expect(map.tiles[20][20].type).toBe('dirt_road'); // the road ribbon itself, untouched
    expect(map.tiles[19][21].type).toBe('water');      // explicitly excluded surface, untouched
  });

  it('bumps tilesRev only when a promotion actually happens', () => {
    const { map, world } = cottageMap();
    expect(map.tilesRev).toBeUndefined();
    depositDoorstepGravel(map, [plan], world, 7);
    expect(map.tilesRev).toBeGreaterThanOrEqual(1);

    // A world with no buildings at all: no tiles change, no bump.
    const tiles2 = grid(60, 40, 20);
    const map2 = { tiles: tiles2, width: 60, height: 40, roadGraph: straightGraph(20, 0, 60) } as unknown as GameMap;
    const stats2 = depositDoorstepGravel(map2, [plan], fakeWorld([]), 7);
    expect(stats2.cells).toBe(0);
    expect(map2.tilesRev).toBeUndefined();
  });

  it('graph-walk falloff: a cell far along the road from the doorstep gets less/no gravel than one close to it', () => {
    const { map, world } = cottageMap();
    depositDoorstepGravel(map, [plan], world, 7);
    // Close: one tile beside the road right where the cottage fronts it (~1-2 tiles from the door).
    const close = map.tiles[19][20].type === 'gravel' || map.tiles[19][19].type === 'gravel' || map.tiles[19][21].type === 'gravel';
    // Far: 30 tiles down the same road ribbon — well past both ORDINARY_REACH (8) and BUSY_REACH (16).
    const far = map.tiles[19][50].type;
    expect(close).toBe(true);
    expect(far).toBe('grass'); // untouched — falloff reached 0 long before this cell
  });

  it('a busy building (market) radiates farther than an ordinary cottage at the same distance', () => {
    const cottage = building('b_cottage', 'cottage', 19, 17, 3, 2);
    const market = building('b_market', 'market_stall', 39, 17, 3, 2);

    const m1 = { tiles: grid(80, 40, 20), width: 80, height: 40, roadGraph: straightGraph(20, 0, 80) } as unknown as GameMap;
    depositDoorstepGravel(m1, [plan], fakeWorld([cottage]), 7);
    const m2 = { tiles: grid(80, 40, 20), width: 80, height: 40, roadGraph: straightGraph(20, 0, 80) } as unknown as GameMap;
    depositDoorstepGravel(m2, [plan], fakeWorld([market]), 7);

    // ~6 tiles along the road from each doorstep's road-graph snap point: the ordinary
    // cottage's road-side apron has already faded below the promote threshold by here, while
    // the busy market's (heavier + longer reach) apron is still solidly promoting.
    expect(m1.tiles[19][20 + 5].type).toBe('grass');
    expect(m2.tiles[19][40 + 5].type).toBe('gravel');
  });

  it('is deterministic: the same seed reproduces byte-identical gravel cells regardless of building order', () => {
    const a = building('b_market', 'market_stall', 10, 17, 3, 2);
    const b = building('b_cottage', 'cottage', 30, 17, 3, 2);
    const cellsOf = (m: GameMap): string[] => {
      const out: string[] = [];
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.tiles[y][x].type === 'gravel') out.push(`${x},${y}`);
      return out.sort();
    };

    const m1 = { tiles: grid(60, 40, 20), width: 60, height: 40, roadGraph: straightGraph(20, 0, 60) } as unknown as GameMap;
    depositDoorstepGravel(m1, [plan], fakeWorld([a, b]), 42);
    const m2 = { tiles: grid(60, 40, 20), width: 60, height: 40, roadGraph: straightGraph(20, 0, 60) } as unknown as GameMap;
    depositDoorstepGravel(m2, [plan], fakeWorld([b, a]), 42);

    expect(cellsOf(m1)).toEqual(cellsOf(m2));
    expect(cellsOf(m1).length).toBeGreaterThan(0);
  });

  it('no-ops on a peopleless world (no settlement plans / no buildings)', () => {
    const tiles = grid(40, 40, 20);
    const map = { tiles, width: 40, height: 40, roadGraph: straightGraph(20, 0, 40) } as unknown as GameMap;
    const stats = depositDoorstepGravel(map, [], fakeWorld([]), 7);
    expect(stats).toEqual({ buildings: 0, cells: 0 });
    expect(map.tilesRev).toBeUndefined();
  });

  it('no-ops on a world with no road graph', () => {
    const tiles = grid(40, 40);
    const map = { tiles, width: 40, height: 40 } as unknown as GameMap; // no roadGraph
    const world = fakeWorld([building('b_cottage', 'cottage', 19, 17, 3, 2)]);
    const stats = depositDoorstepGravel(map, [plan], world, 7);
    expect(stats).toEqual({ buildings: 0, cells: 0 });
    expect(map.tilesRev).toBeUndefined();
  });
});

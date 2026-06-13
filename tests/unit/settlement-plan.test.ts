// tests/unit/settlement-plan.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { planSettlement, orderedSlotsFor, WATER_TYPES } from '@/world/settlement-plan';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { World } from '@/world/world';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true }) as unknown as Tile));
}

function emptyMap(tiles: Tile[][]): GameMap {
  return { tiles, width: tiles[0].length, height: tiles.length, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 },
    buildings: [] } as unknown as GameMap;
}

const CENTER = { x: 24, y: 24 };
const villageRule = getZoneRule('village');   // branching dirt roads
const cityRule = getZoneRule('city');         // grid stone roads

describe('planSettlement — road graph', () => {
  it('linear layout yields a through street along the dominant connection axis', () => {
    const rule = { ...villageRule, roadLayout: 'linear' as const };
    const plan = planSettlement(CENTER, rule, grassTiles(), [{ dx: 0, dy: 1 }], new Random(7));
    expect(plan.edges.length).toBe(2);                       // founding node splits the spine
    expect(plan.edges.every(e => e.kind === 'through')).toBe(true);
    // vertical axis: all road tiles share x
    for (const e of plan.edges) for (const t of e.tiles) expect(t.x).toBe(CENTER.x);
    expect(plan.nodes[0]).toMatchObject({ kind: 'founding', ...CENTER });
  });

  it('branching adds two perpendicular lanes at the founding node', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    const lanes = plan.edges.filter(e => e.kind === 'lane');
    expect(lanes.length).toBe(2);
    for (const l of lanes) for (const t of l.tiles) expect(t.x).toBe(CENTER.x);
  });

  it('grid yields parallel lanes plus cross connectors', () => {
    const plan = planSettlement(CENTER, cityRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    const lanes = plan.edges.filter(e => e.kind === 'lane');
    expect(lanes.length).toBe(4);                            // 2 parallel + 2 cross
    const parallel = lanes.filter(l => l.tiles.every(t => t.y === l.tiles[0].y));
    expect(parallel.length).toBe(2);
    expect(new Set(parallel.map(l => l.tiles[0].y))).toEqual(new Set([CENTER.y - 3, CENTER.y + 3]));
  });

  it('never places road tiles on water and stays deterministic', () => {
    const tiles = grassTiles();
    for (let x = 0; x < 48; x++) tiles[26][x].type = 'river';
    const planA = planSettlement(CENTER, cityRule, tiles, [{ dx: 1, dy: 0 }], new Random(3));
    const planB = planSettlement(CENTER, cityRule, tiles, [{ dx: 1, dy: 0 }], new Random(3));
    for (const e of planA.edges) for (const t of e.tiles) {
      expect(WATER_TYPES.has(tiles[t.y][t.x].type)).toBe(false);
    }
    expect(planB).toEqual(planA);
  });

  it('no-road layouts produce an empty plan', () => {
    const plan = planSettlement(CENTER, getZoneRule('temple'), grassTiles(), [], new Random(7));
    expect(plan.edges).toEqual([]);
    expect(plan.slots).toEqual([]);
  });
});

describe('planSettlement — frontage slots', () => {
  it('every slot sits beside its road tile, perpendicular to the edge', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    expect(plan.slots.length).toBeGreaterThan(0);
    for (const s of plan.slots) {
      const edge = plan.edges[s.edge];
      expect(edge.tiles.some(t => t.x === s.roadX && t.y === s.roadY)).toBe(true);
      expect(Math.abs(s.side[0]) + Math.abs(s.side[1])).toBe(1);
    }
  });

  it('orderedSlotsFor filters to door-opposing sides and respects affinity', () => {
    const plan = planSettlement(CENTER, villageRule, grassTiles(), [{ dx: 1, dy: 0 }], new Random(7));
    // south door (facing [0,1]) wants slots on the NORTH side of a road ([0,-1])
    const south = orderedSlotsFor(plan, [0, 1], { affinity: 'center' }, new Random(1));
    expect(south.length).toBeGreaterThan(0);
    for (const s of south) expect(s.side).toEqual([0, -1]);
    // centre affinity: first candidate is nearer the founding node than the last
    expect(south[0].dist).toBeLessThanOrEqual(south[south.length - 1].dist);
    const edgey = orderedSlotsFor(plan, [0, 1], { affinity: 'edge' }, new Random(1));
    expect(edgey[0].dist).toBeGreaterThanOrEqual(edgey[edgey.length - 1].dist);
  });
});

describe('placeSettlement — plan execution', () => {
  const poi: POI = { id: 'v1', type: 'village', name: 'Test', position: CENTER } as unknown as POI;

  function run(seed = 11, rule = villageRule, tiles = grassTiles()) {
    const world = new World(emptyMap(tiles));
    const result = placeSettlement(poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }], new Random(seed), 'medieval', world);
    return { world, result, tiles };
  }

  it('slot-placed buildings front a road: walking out of the door reaches one within 2 tiles', () => {
    const { result } = run();
    // result.entities now carries civic props too (S5) — restrict to buildings.
    const buildings = result.entities.filter(e => blueprintOf(e)?.rb.class === 'building');
    expect(buildings.length).toBeGreaterThan(0);
    const roadSet = new Set(result.roadTiles.map(rt => `${rt.x},${rt.y}`));
    let fronting = 0;
    for (const e of buildings) {
      const bp = blueprintOf(e)!;
      const [dlx, dly] = bp.collision.doorCells[0].split(',').map(Number);
      const doorX = e.x + dlx, doorY = e.y + dly;
      // a road tile within Chebyshev distance 2 of the door (door may sit
      // behind the preset's own yard strip)
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          if (roadSet.has(`${doorX + dx},${doorY + dy}`)) near = true;
        }
      }
      if (near) fronting++;
    }
    // most buildings front a road (fallback placements may not)
    expect(fronting / buildings.length).toBeGreaterThanOrEqual(0.5);
  });

  it('building footprints never cover road tiles and never overlap each other', () => {
    const { result } = run();
    const roadSet = new Set(result.roadTiles.map(rt => `${rt.x},${rt.y}`));
    const seen = new Set<string>();
    for (const e of result.entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      const bp = blueprintOf(e)!;
      for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
          const k = `${e.x + dx},${e.y + dy}`;
          expect(roadSet.has(k), `building on road at ${k}`).toBe(false);
          expect(seen.has(k), `overlap at ${k}`).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it('docks only place within 2 tiles of water (site rule enforced)', () => {
    const portPoi = { ...poi, id: 'p1', type: 'port' } as unknown as POI;
    const rule = getZoneRule('port');
    // No water anywhere → the dock must NOT place at all.
    const dryTiles = grassTiles();
    const dryWorld = new World(emptyMap(dryTiles));
    const dry = placeSettlement(portPoi, rule, dryTiles, dryWorld.registry, [], new Random(5), 'medieval', dryWorld);
    expect(dry.entities.filter(e => blueprintOf(e)?.rb.preset === 'dock')).toEqual([]);
    // Water nearby → dock places, within 2 tiles of it.
    const wetTiles = grassTiles();
    for (let x = 0; x < 48; x++) wetTiles[28][x].type = 'shallow_water';
    const wetWorld = new World(emptyMap(wetTiles));
    const wet = placeSettlement(portPoi, rule, wetTiles, wetWorld.registry, [], new Random(5), 'medieval', wetWorld);
    const docks = wet.entities.filter(e => blueprintOf(e)?.rb.preset === 'dock');
    expect(docks.length).toBeGreaterThan(0);
    for (const d of docks) {
      const bp = blueprintOf(d)!;
      expect(Math.abs(d.y + bp.collision.footprint.h - 1 - 28) <= 2 || Math.abs(d.y - 28) <= 2).toBe(true);
    }
  });

  it('is deterministic: same seed produces identical layout', () => {
    const a = run(42);
    const b = run(42);
    expect(b.result.roadTiles).toEqual(a.result.roadTiles);
    expect(b.result.entities.map(e => [e.id, e.x, e.y]))
      .toEqual(a.result.entities.map(e => [e.id, e.x, e.y]));
  });

  it('returns the plan alongside entities and roads', () => {
    const { result } = run();
    expect(result.plan.nodes[0].kind).toBe('founding');
    expect(result.plan.edges.length).toBeGreaterThan(0);
  });
});

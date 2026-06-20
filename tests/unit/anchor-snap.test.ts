// tests/unit/anchor-snap.test.ts
import { describe, it, expect } from 'vitest';
import { matchAnchors, DEFAULT_RULES, type RoadPolyline } from '@/world/anchor-rules';
import { collectAnchors } from '@/world/anchor-collect';
import type { Anchor } from '@/world/anchors';
import type { World } from '@/world/world';
import type { RoadGraph } from '@/world/road-graph';

// A straight horizontal road along y=5, x∈[0,10].
const ROAD: RoadPolyline = { id: 're0', points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] };

function door(x: number, y: number, facing: [number, number], id = `d${x}_${y}`): Anchor {
  return { kind: 'door', x, y, facing, id, ownerId: id };
}

describe('matchAnchors — structure→road', () => {
  it('links a door that faces the road within gap', () => {
    const a = door(3, 4, [0, 1]); // sits just above road, faces +y (down toward road)
    const links = matchAnchors([a], { roads: [ROAD] });
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe('connects');
    expect(links[0].a.id).toBe(a.id);
    expect(links[0].b.kind).toBe('road');
    expect(links[0].b.ownerId).toBe('re0');
    expect(links[0].gap).toBeCloseTo(1, 5);
  });

  it('rejects a door facing AWAY from the road', () => {
    const a = door(3, 4, [0, -1]); // faces up, away from road below
    expect(matchAnchors([a], { roads: [ROAD] })).toHaveLength(0);
  });

  it('rejects a door beyond maxGap (1.6 tiles)', () => {
    const a = door(3, 2, [0, 1]); // 3 tiles above the road
    expect(matchAnchors([a], { roads: [ROAD] })).toHaveLength(0);
  });

  it('snaps each door to exactly one road point (greedy, single link)', () => {
    const road2: RoadPolyline = { id: 're1', points: [{ x: 0, y: 6 }, { x: 10, y: 6 }] };
    const a = door(3, 5.5, [0, 1]); // between two roads, faces down toward re1 (y=6)
    const links = matchAnchors([a], { roads: [ROAD, road2] });
    expect(links).toHaveLength(1);
    expect(links[0].b.ownerId).toBe('re1');
  });

  it('respects the blocked predicate (rejects a link crossing an occupant)', () => {
    const a = door(3, 4, [0, 1]);
    const links = matchAnchors([a], { roads: [ROAD], blocked: () => true });
    expect(links).toHaveLength(0);
  });
});

describe('matchAnchors — wall_end↔wall_end', () => {
  const w = (x: number, y: number, id: string): Anchor => ({ kind: 'wall_end', x, y, facing: [1, 0], id, ownerId: id });

  it('joins two nearby wall ends with one link (no mirror duplicate)', () => {
    const links = matchAnchors([w(2, 2, 'wA'), w(2.5, 2, 'wB')], {});
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe('connects');
  });

  it('leaves distant wall ends unlinked', () => {
    expect(matchAnchors([w(2, 2, 'wA'), w(8, 2, 'wB')], {})).toHaveLength(0);
  });
});

describe('matchAnchors — determinism', () => {
  it('produces identical links regardless of input order', () => {
    const anchors = [door(3, 4, [0, 1], 'a'), door(7, 4, [0, 1], 'b'), door(5, 4, [0, 1], 'c')];
    const forward = matchAnchors(anchors, { roads: [ROAD] });
    const reversed = matchAnchors([...anchors].reverse(), { roads: [ROAD] });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(forward).toHaveLength(3);
  });

  it('DEFAULT_RULES are the documented kinds', () => {
    expect(DEFAULT_RULES.map((r) => `${r.a}->${r.b}`)).toEqual([
      'door->road', 'frontage->road', 'gate->road', 'service->road', 'wall_end->wall_end',
    ]);
  });
});

describe('collectAnchors', () => {
  // Minimal duck-typed world: just the query() the collector uses.
  const fakeWorld = (entities: Array<{ id: string; properties?: Record<string, unknown> }>): World =>
    ({ query: () => entities }) as unknown as World;

  const roadGraph: RoadGraph = {
    nodes: [],
    edges: [{ id: 're0', a: 'n0', b: 'n1', polyline: [{ x: 0, y: 5 }, { x: 10, y: 5 }], feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] }],
  };

  it('stamps ownerId + id on entity anchors and emits road polylines', () => {
    const world = fakeWorld([
      { id: 'bldg7', properties: { anchors: [{ kind: 'door', x: 3, y: 4, facing: [0, 1] }] as Anchor[] } },
    ]);
    const { anchors, roads } = collectAnchors(world, roadGraph, 64);
    const door = anchors.find((a) => a.kind === 'door')!;
    expect(door.ownerId).toBe('bldg7');
    expect(door.id).toBe('bldg7:a0');
    expect(roads).toHaveLength(1);
    expect(roads[0].id).toBe('re0');
    // road endpoint anchors emitted too
    expect(anchors.filter((a) => a.kind === 'road').map((a) => a.id).sort()).toEqual(['re0:end-a', 're0:end-b']);
  });

  it('round-trips into matchAnchors to produce a door→road link', () => {
    const world = fakeWorld([
      { id: 'bldg7', properties: { anchors: [{ kind: 'door', x: 3, y: 4, facing: [0, 1] }] as Anchor[] } },
    ]);
    const { anchors, roads } = collectAnchors(world, roadGraph, 64);
    const links = matchAnchors(anchors, { roads });
    const doorLink = links.find((l) => l.a.ownerId === 'bldg7');
    expect(doorLink?.b.ownerId).toBe('re0');
    expect(doorLink?.relation).toBe('connects');
  });
});

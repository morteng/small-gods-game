// Road-wear economy S2 — the tick-system wiring: the class inputs built from the live world
// (the highway lord gate) and the promote/demote SimEvent emitter.
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { buildRoadClassInputs, emitRoadClassEvent } from '@/sim/systems/road-evolution-system';
import type { RoadEdge } from '@/world/road-graph';
import type { GameMap } from '@/core/types';

function mapWithGraph(edges: RoadEdge[], nodes = [
  { id: 'n0', x: 0, y: 0, kind: 'poi' as const, poiRef: 'town' },
  { id: 'n1', x: 5, y: 0, kind: 'poi' as const, poiRef: 'castle' },
]): GameMap {
  return {
    tiles: [], width: 8, height: 3, villages: [], seed: 1, success: true,
    worldSeed: { pois: [{ id: 'town' }, { id: 'castle' }] },
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    roadGraph: { nodes, edges, rev: 0 },
  } as unknown as GameMap;
}
function edge(): RoadEdge {
  return { id: 'e0', a: 'n0', b: 'n1', polyline: [{ x: 1, y: 0 }], feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] };
}

describe('buildRoadClassInputs — the highway lord gate', () => {
  it('hasLordSeatFor is false with no seat at either endpoint', () => {
    const map = mapWithGraph([edge()]);
    const world = new World(map);
    const inp = buildRoadClassInputs(map, world, () => 0.5);
    expect(inp.hasLordSeatFor(map.roadGraph!.edges[0])).toBe(false);
  });

  it('a garrisoned seat at an endpoint unlocks the gate', () => {
    const map = mapWithGraph([edge()]);
    const world = new World(map);
    world.lords.set('castle', { npcId: 'l', lineageId: 'l', tithe: 0.3, garrison: 3, unrest: 0, keepTier: 1 });
    const inp = buildRoadClassInputs(map, world, () => 0.5);
    expect(inp.hasLordSeatFor(map.roadGraph!.edges[0])).toBe(true);
  });

  it('a castle GRIPPING an endpoint settlement funds it (dominion link)', () => {
    const map = mapWithGraph([edge()]);
    const world = new World(map);
    world.lords.set('keep', { npcId: 'l', lineageId: 'l', tithe: 0.3, garrison: 2, unrest: 0, keepTier: 1 });
    world.dominions.set('town', 'keep'); // the castle 'keep' grips the endpoint 'town'
    const inp = buildRoadClassInputs(map, world, () => 0.5);
    expect(inp.hasLordSeatFor(map.roadGraph!.edges[0])).toBe(true);
  });

  it('a seat with NO garrison does not fund a highway', () => {
    const map = mapWithGraph([edge()]);
    const world = new World(map);
    world.lords.set('castle', { npcId: 'l', lineageId: 'l', tithe: 0.3, garrison: 0, unrest: 0, keepTier: 0 });
    const inp = buildRoadClassInputs(map, world, () => 0.5);
    expect(inp.hasLordSeatFor(map.roadGraph!.edges[0])).toBe(false);
  });

  it('wealthFor is passed through verbatim and endpoint ids resolve', () => {
    const map = mapWithGraph([edge()]);
    const world = new World(map);
    const inp = buildRoadClassInputs(map, world, (e) => (e.id === 'e0' ? 0.42 : 0));
    const e = map.roadGraph!.edges[0];
    expect(inp.wealthFor(e)).toBe(0.42);
    expect(inp.endpointPoiIds(e)).toEqual(['town', 'castle']);
  });
});

describe('emitRoadClassEvent — promote vs demote discrimination', () => {
  it('a rising class appends road_promoted', () => {
    const log = new EventLog(new SimClock());
    emitRoadClassEvent(log, { edgeId: 'e0', from: 'track', to: 'road', fromPoiId: 'town', toPoiId: 'castle', surfaceChanged: true });
    const ev = log.since(0)[0].event;
    expect(ev.type).toBe('road_promoted');
    expect(ev).toMatchObject({ edgeId: 'e0', from: 'track', to: 'road', fromPoiId: 'town', toPoiId: 'castle' });
  });

  it('a falling class appends road_demoted', () => {
    const log = new EventLog(new SimClock());
    emitRoadClassEvent(log, { edgeId: 'e0', from: 'highway', to: 'road', surfaceChanged: false });
    expect(log.since(0)[0].event.type).toBe('road_demoted');
  });
});

import { describe, it, expect } from 'vitest';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24;
function edge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

describe('buildCrossingStructureEntities', () => {
  it('spawns grey-massing structures (deck + piers + ancillary buildings) for a rich crossing', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const kinds = new Set(ents.map((e) => e.kind));
    // The span itself now renders: a deck + supporting piers (G5).
    expect(kinds.has('bridge_deck')).toBe(true);
    expect(ents.some((e) => e.kind === 'bridge_pier')).toBe(true);
    // toll/guard/shrine/shop×2/gatehouse/mill → grey-massing ancillary buildings.
    const buildings = ents.filter((e) => (e.properties as any).category === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(5);
    expect(kinds.has('shrine')).toBe(true);
    expect(kinds.has('guard_post')).toBe(true);
    // positioned at real tiles
    expect(ents.every((e) => Number.isInteger(e.x) && Number.isInteger(e.y))).toBe(true);
  });

  it('a poor footpath crossing spawns just its bare footbridge (deck + 2 piers, no buildings)', () => {
    const poly = [4, 5, 6, 7].map((x) => ({ x, y: 4 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'path', bridgeCells: [4 * W + 5] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'stone-age', prosperity: 'poor' } });
    expect(ents.filter((e) => e.kind === 'bridge_deck')).toHaveLength(1);
    expect(ents.filter((e) => e.kind === 'bridge_pier')).toHaveLength(2);
    // No ancillary buildings on a poor footpath.
    expect(ents.some((e) => (e.properties as any).category === 'building')).toBe(false);
  });

  it('deck rides its bank elevation (liftElev); piers stay grounded (foot-sampled)', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    const ents = buildCrossingStructureEntities(graph, W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      deckElevAt: () => 0.42,
    });
    const deck = ents.find((e) => e.kind === 'bridge_deck')!;
    expect((deck.properties as any).liftElev).toBe(0.42);
    const pier = ents.find((e) => e.kind === 'bridge_pier')!;
    expect((pier.properties as any).liftElev).toBeUndefined();
  });

  it('is deterministic', () => {
    const poly = [8, 9, 10, 11, 12].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'road', bridgeCells: [6 * W + 10] })] };
    const a = buildCrossingStructureEntities(graph, W);
    const b = buildCrossingStructureEntities(graph, W);
    expect(a.map((e) => `${e.kind}@${e.x},${e.y}`)).toEqual(b.map((e) => `${e.kind}@${e.x},${e.y}`));
  });

  it('without cellBlocked, positions are unchanged (legacy path is byte-identical)', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    const legacy = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const guarded = buildCrossingStructureEntities(graph, W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      cellBlocked: () => false, // nothing blocked → must match the no-predicate path tile-for-tile
    });
    expect(guarded.map((e) => `${e.kind}@${e.x},${e.y}`)).toEqual(legacy.map((e) => `${e.kind}@${e.x},${e.y}`));
  });

  it('nudges ancillary structures off blocked cells; no solid cell lands on a blocked tile', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    // Block a fat band straight through where the aprons want to sit (rows 6..14, the inland
    // side) — emulates a settlement abutting the crossing. The road row itself (y=10) is open.
    const blocked = (x: number, y: number) => y >= 6 && y <= 9 && x >= 4 && x <= 18;
    const ents = buildCrossingStructureEntities(graph, W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      cellBlocked: blocked,
    });
    // Every spawned BUILDING's footprint origin clears the band (nudged out or dropped). Deck
    // and piers ride over the water on the road line — they're not subject to the apron nudge.
    const buildings = ents.filter((e) => (e.properties as any).category === 'building');
    for (const e of buildings) {
      expect(blocked(e.x, e.y)).toBe(false);
    }
    // And no two crossing buildings share an origin tile (intra-batch claim works).
    const origins = buildings.map((e) => `${e.x},${e.y}`);
    expect(new Set(origins).size).toBe(origins.length);
  });
});

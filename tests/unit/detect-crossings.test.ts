import { describe, it, expect } from 'vitest';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import { buildCrossing } from '@/world/connectome/crossing-builder';
import { collectByKind } from '@/world/connectome/world-node';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24;
function edge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

describe('detectCrossings', () => {
  it('emits one spec per contiguous bridge-cell run, with span + class + banks', () => {
    // Road along row 10, x=4..9; cells 6,7 are bridged (a 2-tile crossing).
    const poly = [4, 5, 6, 7, 8, 9].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 6, 10 * W + 7] })] };
    const specs = detectCrossings(graph, W);
    expect(specs).toHaveLength(1);
    expect(specs[0].spanTiles).toBe(2);
    expect(specs[0].roadClass).toBe('highway');
    expect(specs[0].banks).toEqual([{ x: 5, y: 10 }, { x: 8, y: 10 }]); // flanking approaches
    expect(specs[0].waterRef).toContain('water@');
  });

  it('separates two distinct crossings on the same road', () => {
    const poly = Array.from({ length: 12 }, (_, x) => ({ x, y: 5 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [5 * W + 3, 5 * W + 7, 5 * W + 8] })] };
    const specs = detectCrossings(graph, W);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.spanTiles).sort()).toEqual([1, 2]);
  });

  it('ignores rivers, walls, and edges with no bridge cells', () => {
    const graph: RoadGraph = {
      nodes: [], edges: [
        edge('r', [{ x: 1, y: 1 }, { x: 2, y: 1 }], { feature: 'river', bridgeCells: [W + 1] }),
        edge('dry', [{ x: 1, y: 3 }, { x: 2, y: 3 }]),
      ],
    };
    expect(detectCrossings(graph, W)).toHaveLength(0);
  });

  it('pulls site params from the resolver at the run midpoint → drives the built site', () => {
    const poly = [4, 5, 6, 7, 8].map((x) => ({ x, y: 12 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [12 * W + 6] })] };
    const specs = detectCrossings(graph, W, {
      siteParamsAt: () => ({ era: 'late-medieval', prosperity: 'rich', biome: 'river-meadow' }),
    });
    expect(specs[0].era).toBe('late-medieval');
    // Feeding the detected spec into the producer yields the rich inhabited site.
    const site = buildCrossing({ ...specs[0], spanTiles: 8 });
    expect(collectByKind(site, 'building').length).toBeGreaterThan(3); // shops+gate+toll+guard+shrine+mill
  });

  it('falls back to neutral defaults when no resolver is supplied', () => {
    const poly = [4, 5, 6].map((x) => ({ x, y: 2 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [2 * W + 5] })] };
    const specs = detectCrossings(graph, W);
    expect(specs[0].era).toBe('early-medieval');
    expect(specs[0].prosperity).toBe('modest');
  });

  // ── bank snapping (C-4a: bridge.seating) ────────────────────────────────────────────
  it('snaps a WET bank anchor outward to dry land so the deck seats on the bank', () => {
    // Road row 6, x=4..9; bridge at x=6,7. The far approach point x=8 is itself water (a channel
    // wider than the detected run), the dry bank resumes at x=9.
    const poly = [4, 5, 6, 7, 8, 9].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [6 * W + 6, 6 * W + 7] })] };
    const wet = new Set(['8,6']);                       // (8,6) is open water
    const specs = detectCrossings(graph, W, { isWater: (x, y) => wet.has(`${x},${y}`) });
    // near bank (x=5) is dry → unchanged; far bank snapped from wet (8,6) out to dry (9,6).
    expect(specs[0].banks![0]).toEqual({ x: 5, y: 6 });
    expect(specs[0].banks![1]).toEqual({ x: 9, y: 6 });
  });

  // ── junction/terminus-in-water seating (offset-bridge fix) ──────────────────────────
  it('seats a crossing whose ribbon ENDS mid-channel by snapping the far bank across the water', () => {
    // A road that ends AT the water — its last polyline cell (6,6) is wet (a junction the router
    // dropped in the channel; the connected road continues onto dry ground one cell past the end).
    // The ribbon walk runs off its end while still wet; the nearestDry snap along the road's own
    // outward tangent seats the far abutment on the dry far bank (7,6) instead of DECLINING to the
    // raw chord (a deck sitting beside the road, not spanning it — the user-reported defect).
    const poly = [4, 5, 6].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [6 * W + 6] })] };
    const wet = new Set(['6,6']);            // only the ribbon-END cell is water; (5,6)+(7,6) dry
    const specs = detectCrossings(graph, W, {
      isWater: (x, y) => wet.has(`${x},${y}`),
      bridgeAt: (x, y) => wet.has(`${x},${y}`),
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].bankCells).toBeDefined();                    // SEATED on the ribbon, not the fallback
    const [ca, cb] = specs[0].bankCells!;
    expect(wet.has(`${ca[0]},${ca[1]}`)).toBe(false);            // both abutments on dry ground
    expect(wet.has(`${cb[0]},${cb[1]}`)).toBe(false);
    // The far abutment lands ACROSS the channel (east, in line with the road), not to the side.
    expect(cb).toEqual([7, 6]);
  });

  it('still DECLINES when the ribbon ends in OPEN water with no dry cell within reach', () => {
    // A road running entirely through open water (an estuary): nearestDry finds NO bank in range,
    // so the crossing declines rather than inventing an abutment in the middle of the water.
    const poly = [4, 5, 6].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [6 * W + 6] })] };
    const allWet = () => true;
    const specs = detectCrossings(graph, W, { isWater: allWet, bridgeAt: allWet });
    expect(specs).toHaveLength(1);
    expect(specs[0].bankCells).toBeUndefined();                  // no dry ground → no invented bank
  });

  it('leaves dry bank anchors exactly where they were (no isWater ⇒ legacy behaviour)', () => {
    const poly = [4, 5, 6, 7, 8].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [6 * W + 6] })] };
    const withWater = detectCrossings(graph, W, { isWater: () => false });   // all dry
    const legacy = detectCrossings(graph, W);
    expect(withWater[0].banks).toEqual(legacy[0].banks);
    expect(legacy[0].banks).toEqual([{ x: 5, y: 6 }, { x: 7, y: 6 }]);
  });
});

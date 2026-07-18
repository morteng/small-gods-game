// tests/unit/road-graph-split.test.ts — road-wear economy S4: the FIRST runtime edge splitter.
// Pins `splitEdgeAtIndex` / `unsplitEdge` (src/world/road-graph.ts): the mid-edge junction split an
// adoption lands, and its exact reverse (the scrub-back path of the adoption ledger replay). These
// are pure graph surgery — no map, no world — so the fixtures are a hand-authored RoadGraph with a
// single host edge carrying dynamics/use/bridgeCells/pins, and the assertions pin the halves'
// partition + id determinism (a re-split after unsplit must reproduce byte-identical ids).
import { describe, it, expect } from 'vitest';
import {
  splitEdgeAtIndex, unsplitEdge,
  type RoadEdge, type RoadGraph, type RoadNode, type EdgeSplitRecord,
} from '@/world/road-graph';

const WIDTH = 10;

/** A 7-cell horizontal host edge `reH` (0,0)…(6,0) with two `end` nodes, plus deep-copyable
 *  dynamics/use, bridgeCells [1,3,5] (flat, width 10) and pins [0,3,5]. Fresh objects each call. */
function mkGraph(over: Partial<RoadEdge> = {}): RoadGraph {
  const nodes: RoadNode[] = [
    { id: 'nA', x: 0, y: 0, kind: 'end' },
    { id: 'nB', x: 6, y: 0, kind: 'end' },
  ];
  const host: RoadEdge = {
    id: 'reH', a: 'nA', b: 'nB',
    polyline: Array.from({ length: 7 }, (_, i) => ({ x: i, y: 0 })),
    feature: 'road', class: 'road', surface: 'dirt',
    bridgeCells: [1, 3, 5],
    dynamics: { ageYears: 3, condition: 0.8, traffic: 0.4, wear: 0.2, overgrowth: 0.1 },
    use: { ema01: 0.5, tallies: 7, sinceTick: 100 },
    pins: [0, 3, 5],
    ...over,
  };
  return { nodes, edges: [host], rev: 0 };
}

describe('splitEdgeAtIndex — the mid-edge junction split', () => {
  it('partitions the polyline (sharing the split cell), wires a/b nodes, mints a junction + <host>a/<host>b ids, bumps rev', () => {
    const g = mkGraph();
    const rec = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    expect(rec).not.toBeNull();
    expect(rec).toMatchObject({ hostEdgeId: 'reH', atIndex: 3, nodeId: 'rn-split:reH@3', halfIds: ['reHa', 'reHb'] });

    // Host gone; both halves present.
    expect(g.edges.some((e) => e.id === 'reH')).toBe(false);
    const a = g.edges.find((e) => e.id === 'reHa')!;
    const b = g.edges.find((e) => e.id === 'reHb')!;
    // Halves partition the polyline, SHARING (3,0) (it ends A and starts B).
    expect(a.polyline).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    expect(b.polyline).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 6, y: 0 }]);
    // Node wiring: A runs host.a → junction, B runs junction → host.b.
    expect(a.a).toBe('nA'); expect(a.b).toBe('rn-split:reH@3');
    expect(b.a).toBe('rn-split:reH@3'); expect(b.b).toBe('nB');
    // Junction node created at the split cell.
    const jn = g.nodes.find((n) => n.id === 'rn-split:reH@3')!;
    expect(jn).toMatchObject({ x: 3, y: 0, kind: 'junction' });
    // rev bumped.
    expect(g.rev).toBe(1);
    // feature/class/surface preserved on both halves.
    for (const h of [a, b]) expect(h).toMatchObject({ feature: 'road', class: 'road', surface: 'dirt' });
  });

  it('DEEP-copies dynamics + use onto each half (mutating one half never touches the other)', () => {
    const g = mkGraph();
    splitEdgeAtIndex(g, 'reH', 3, WIDTH);
    const a = g.edges.find((e) => e.id === 'reHa')!;
    const b = g.edges.find((e) => e.id === 'reHb')!;
    // Distinct object identities, equal values.
    expect(a.use).not.toBe(b.use);
    expect(a.dynamics).not.toBe(b.dynamics);
    expect(a.use).toEqual({ ema01: 0.5, tallies: 7, sinceTick: 100 });
    expect(a.dynamics).toEqual({ ageYears: 3, condition: 0.8, traffic: 0.4, wear: 0.2, overgrowth: 0.1 });
    // Mutate A's copies — B is unaffected.
    a.use!.ema01 = 0.99;
    a.dynamics!.wear = 0.99;
    expect(b.use!.ema01).toBe(0.5);
    expect(b.dynamics!.wear).toBe(0.2);
  });

  it('partitions bridgeCells by side — a bridge cell AT the split index appears in BOTH halves', () => {
    const g = mkGraph();
    splitEdgeAtIndex(g, 'reH', 3, WIDTH);
    const a = g.edges.find((e) => e.id === 'reHa')!;
    const b = g.edges.find((e) => e.id === 'reHb')!;
    // cellsA = {0,1,2,3} ⇒ [1,3]; cellsB = {3,4,5,6} ⇒ [3,5]. The shared cell 3 is in both.
    expect(a.bridgeCells).toEqual([1, 3]);
    expect(b.bridgeCells).toEqual([3, 5]);
  });

  it('partitions pins by side and SHIFTS the B-side pins into the half-local index space', () => {
    const g = mkGraph({ pins: [0, 3, 5] });
    splitEdgeAtIndex(g, 'reH', 3, WIDTH);
    const a = g.edges.find((e) => e.id === 'reHa')!;
    const b = g.edges.find((e) => e.id === 'reHb')!;
    // pinsA = pins ≤ 3 → [0,3]; pinsB = pins ≥ 3, minus the split index → [3-3, 5-3] = [0,2].
    expect(a.pins).toEqual([0, 3]);
    expect(b.pins).toEqual([0, 2]);
  });

  it('a host without pins/use/dynamics splits cleanly (the optional fields simply stay absent)', () => {
    const g = mkGraph({ pins: undefined, use: undefined, dynamics: undefined });
    const rec = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    expect(rec).not.toBeNull();
    const a = g.edges.find((e) => e.id === 'reHa')!;
    expect(a.pins).toBeUndefined();
    expect(a.use).toBeUndefined();
    expect(a.dynamics).toBeUndefined();
  });

  it('a NON-interior index (0, len-1) or a missing edge returns null and mutates nothing', () => {
    for (const [edgeId, index] of [['reH', 0], ['reH', 6], ['nope', 3]] as const) {
      const g = mkGraph();
      const before = structuredClone(g);
      expect(splitEdgeAtIndex(g, edgeId, index, WIDTH)).toBeNull();
      expect(g).toEqual(before);          // edges, nodes AND rev untouched
    }
  });
});

describe('unsplitEdge — the exact reverse (adoption scrub-back)', () => {
  it('merges the halves back into the host: polyline/id/bridgeCells/pins restored, orphan junction dropped, rev bumped', () => {
    const g = mkGraph();
    const original = structuredClone(g.edges[0]);
    const rec = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    expect(unsplitEdge(g, rec)).toBe(true);

    const merged = g.edges.find((e) => e.id === 'reH')!;
    expect(merged.polyline).toEqual(original.polyline);          // exact geometry back
    expect(merged.a).toBe('nA'); expect(merged.b).toBe('nB');
    expect(merged.bridgeCells).toEqual([1, 3, 5]);               // union, sorted
    expect(merged.pins).toEqual([0, 3, 5]);                      // B-side un-shifted, union sorted
    // Halves gone; the junction node — referenced by nothing — is dropped.
    expect(g.edges.some((e) => e.id === 'reHa' || e.id === 'reHb')).toBe(false);
    expect(g.nodes.some((n) => n.id === 'rn-split:reH@3')).toBe(false);
    // split (rev 1) then unsplit (rev 2).
    expect(g.rev).toBe(2);
  });

  it('KEEPS the junction node when another edge still references it', () => {
    const g = mkGraph();
    const rec = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    // A second edge hangs off the new junction.
    g.edges.push({
      id: 'spur', a: 'rn-split:reH@3', b: 'nB',
      polyline: [{ x: 3, y: 0 }, { x: 3, y: 1 }], feature: 'road', class: 'path', surface: 'dirt', bridgeCells: [],
    });
    expect(unsplitEdge(g, rec)).toBe(true);
    // Halves merged, but the junction survives (the spur still needs it).
    expect(g.edges.some((e) => e.id === 'reH')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'rn-split:reH@3')).toBe(true);
  });

  it('returns false and touches nothing when a half is missing', () => {
    const g = mkGraph();
    const before = structuredClone(g);
    const bogus: EdgeSplitRecord = { hostEdgeId: 'reH', atIndex: 3, nodeId: 'rn-split:reH@3', halfIds: ['reHa', 'reHb'] };
    expect(unsplitEdge(g, bogus)).toBe(false);
    expect(g).toEqual(before);
  });

  it('split → unsplit → split reproduces byte-identical ids (the replay-determinism invariant)', () => {
    const g = mkGraph();
    const rec1 = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    unsplitEdge(g, rec1);
    const rec2 = splitEdgeAtIndex(g, 'reH', 3, WIDTH)!;
    expect(rec2.hostEdgeId).toBe(rec1.hostEdgeId);
    expect(rec2.atIndex).toBe(rec1.atIndex);
    expect(rec2.nodeId).toBe(rec1.nodeId);
    expect(rec2.halfIds).toEqual(rec1.halfIds);
  });
});

import { describe, it, expect } from 'vitest';
import { evaluateConnectome, DEFAULT_RULES, type DiagnosticContext } from '@/world/connectome-diagnostics';

/** Minimal fakes — the graph rules read only `map.roadGraph`; the footprint rules read
 *  `world.query({tag})`, which returns [] here (covered live + by spatial-invariants). */
function ctx(graph: unknown): DiagnosticContext {
  return {
    world: { query: () => [] } as unknown as DiagnosticContext['world'],
    map: { width: 8, height: 8, tiles: [], roadGraph: graph } as unknown as DiagnosticContext['map'],
  };
}

const node = (id: string, poiRef?: string) => ({ id, x: 0, y: 0, kind: poiRef ? 'poi' : 'waypoint', poiRef });
const edge = (id: string, a: string, b: string, feature = 'road') =>
  ({ id, a, b, feature, class: 'road', surface: 'dirt', polyline: [], bridgeCells: [] });

describe('connectome diagnostics', () => {
  it('flags parallel roads between the same two places', () => {
    const graph = {
      nodes: [node('n:church', 'poi:church'), node('n:tavern', 'poi:tavern'), node('w:1')],
      // two distinct edges church↔tavern (one direct, one via a waypoint that still
      // resolves to the same POI pair), plus an unrelated edge.
      edges: [
        edge('e:1', 'n:church', 'n:tavern'),
        edge('e:2', 'n:tavern', 'n:church'),
        edge('e:3', 'n:church', 'w:1'),
      ],
    };
    const rep = evaluateConnectome(ctx(graph));
    const parallel = rep.diagnostics.filter((d) => d.rule === 'road.redundant-parallel');
    expect(parallel).toHaveLength(1);
    expect(parallel[0].severity).toBe('warn');
    expect(parallel[0].metrics?.count).toBe(2);
    expect(parallel[0].locus.edges).toEqual(['e:1', 'e:2']);
    expect(parallel[0].suggestedFix?.verb).toBe('merge_roads');
  });

  it('does not flag a single road between two places', () => {
    const graph = { nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.byRule['road.redundant-parallel'] ?? 0).toBe(0);
  });

  it('flags an oversubscribed junction (pressure point) above the degree budget', () => {
    const hub = node('hub');
    const spokes = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => node(s));
    const graph = {
      nodes: [hub, ...spokes],
      edges: spokes.map((s, i) => edge(`e:${i}`, 'hub', s.id)),
    };
    const rep = evaluateConnectome(ctx(graph));
    const press = rep.diagnostics.filter((d) => d.rule === 'junction.oversubscribed');
    expect(press).toHaveLength(1);
    expect(press[0].severity).toBe('info');
    expect(press[0].metrics?.degree).toBe(6);
    expect(press[0].locus.nodes).toEqual(['hub']);
  });

  it('ignores river/wall edges in road rules', () => {
    const graph = {
      nodes: [node('a'), node('b')],
      edges: [edge('r:1', 'a', 'b', 'river'), edge('r:2', 'a', 'b', 'river')],
    };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.byRule['road.redundant-parallel'] ?? 0).toBe(0);
  });

  it('grades the report by severity and rule', () => {
    const graph = {
      nodes: [node('a'), node('b')],
      edges: [edge('e:1', 'a', 'b'), edge('e:2', 'a', 'b')],
    };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.total).toBe(rep.diagnostics.length);
    expect(rep.counts.warn).toBe(1);
    expect(rep.byRule['road.redundant-parallel']).toBe(1);
  });

  it('a clean world produces an empty report', () => {
    const rep = evaluateConnectome(ctx({ nodes: [], edges: [] }));
    expect(rep.total).toBe(0);
    expect(rep.counts).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('exposes a stable default rule set', () => {
    expect(DEFAULT_RULES.map((r) => r.id)).toEqual([
      'building.overlap', 'barrier.through-building', 'road.through-building',
      'road.redundant-parallel', 'junction.oversubscribed',
    ]);
  });
});

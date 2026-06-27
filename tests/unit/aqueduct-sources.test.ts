import { describe, it, expect } from 'vitest';
import { findHighlandSources } from '@/world/connectome/aqueduct-sources';
import type { WaterNetwork, WaterNode, WaterNodeKind } from '@/terrain/river-network';

let cell = 0;
const node = (id: string, kind: WaterNodeKind, x: number, y: number): WaterNode =>
  ({ id, kind, cell: cell++, x, y });

/** A minimal WaterNetwork carrying just the nodes the source extractor reads. */
function net(nodes: WaterNode[]): WaterNetwork {
  return {
    nodes, reaches: [], lakes: [],
    byId: new Map(nodes.map((n) => [n.id, n])),
    nodeAtCell: new Map(), width: 64, height: 64,
  };
}

describe('findHighlandSources — water connectome → aqueduct intakes', () => {
  const flat = { elevAt: () => 0.5, reliefM: 100 };   // every tile at 50 m

  it('keeps springs and lake outlets, drops confluences / inlets / mouths', () => {
    const n = net([
      node('s1', 'spring', 4, 4),
      node('lo1', 'lake_outlet', 10, 2),
      node('c1', 'confluence', 8, 8),
      node('li1', 'lake_inlet', 12, 9),
      node('m1', 'mouth', 0, 30),
    ]);
    const sources = findHighlandSources(n, flat);
    expect(sources.map((s) => s.id).sort()).toEqual(['aqsrc:lo1', 'aqsrc:s1']);
    const s1 = sources.find((s) => s.id === 'aqsrc:s1')!;
    expect(s1).toMatchObject({ x: 4, y: 4 });
  });

  it('applies an absolute highland floor', () => {
    const elev: Record<string, number> = { high: 0.9, low: 0.1 };   // 90 m vs 10 m at reliefM 100
    const n = net([node('high', 'spring', 5, 5), node('low', 'spring', 20, 20)]);
    const sources = findHighlandSources(n, {
      elevAt: (x) => (x === 5 ? elev.high : elev.low), reliefM: 100, minElevM: 50,
    });
    expect(sources.map((s) => s.id)).toEqual(['aqsrc:high']);   // the 10 m spring is below the floor
  });

  it('honours a custom include-kinds set', () => {
    const n = net([node('s1', 'spring', 1, 1), node('lo1', 'lake_outlet', 2, 2)]);
    const onlySprings = findHighlandSources(n, { ...flat, includeKinds: ['spring'] });
    expect(onlySprings.map((s) => s.id)).toEqual(['aqsrc:s1']);
  });

  it('preserves network node order and returns [] for a sourceless network', () => {
    const n = net([node('b', 'spring', 3, 3), node('a', 'spring', 9, 9)]);
    expect(findHighlandSources(n, flat).map((s) => s.id)).toEqual(['aqsrc:b', 'aqsrc:a']);
    expect(findHighlandSources(net([]), flat)).toEqual([]);
  });
});
